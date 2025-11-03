/* HRB Auction Assistant — Consolidated App
 * Build: hrb-2025-11-03-TIMER-ROUND-UNDO
 * Features: timer+round strip, undo, strict base_point enforcement,
 *           guardrails using base_point floor, UI glue & insights.
 */

(function(){
  console.log("[HRB] build: hrb-2025-11-03-TIMER-ROUND-UNDO");
  // ---------- Core State ----------
  window.state = {
    playersNeeded: 15,
    myClubSlug: "hrb",
    round: 1,
    timerSec: 0,
    activePlayerId: null,
    history: [],       // undo stack
    players: [],
    clubs: [
      { slug:"hrb", name:"High Range Blasters", starting_budget: 15000, budget_left: 15000 },
      { slug:"kea", name:"KEA", starting_budget: 15000, budget_left: 15000 },
      { slug:"ace", name:"ACE", starting_budget: 15000, budget_left: 15000 },
      { slug:"tcc", name:"TCC", starting_budget: 15000, budget_left: 15000 },
    ]
  };

  // ---------- Utilities ----------
  const $ = id => document.getElementById(id);
  const toNum = (v,d=0)=>{ const n=Number(v); return Number.isFinite(n)?n:d; };
  const minBase = ()=> 200;

  function slugify(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-"); }

  function getActivePlayer(){
    const id = state.activePlayerId;
    return id==null ? null : (state.players||[]).find(p=>String(p.id)===String(id))||null;
  }

  function remainingSlots(){
    const mine=(state.players||[]).filter(p=>p.owner===state.myClubSlug && p.status==="won").length;
    return Math.max(0, toNum(state.playersNeeded,15) - mine);
  }

  function remainingBudget(slug){
    const c=(state.clubs||[]).find(c=>c.slug===slug);
    return c ? toNum(c.budget_left, c.starting_budget||0) : 0;
  }

  function playerBase(p){
    return Math.max(minBase(), toNum(p && p.base_point, minBase()));
  }

  function remainingFloor(excludeId=null, slotsOverride=null){
    const pool=(state.players||[]).filter(p=>p.status!=="won" && (excludeId? String(p.id)!==String(excludeId):true));
    const k=Math.max(0, (slotsOverride==null? remainingSlots(): slotsOverride));
    if (k<=0) return 0;
    const bases=pool.map(p=>playerBase(p)).sort((a,b)=>a-b);
    let sum=0;
    for (let i=0;i<Math.min(k,bases.length);i++) sum+=bases[i];
    if (bases.length<k) sum+=(k-bases.length)*minBase();
    return sum;
  }

  // ---------- Persistence (no-op stubs for now) ----------
  window.persist = function(){ /* could save to localStorage */ };
  function pushHistory(action){
    state.history.push(JSON.stringify({ action, snapshot: {
      players: state.players, clubs: state.clubs, activePlayerId: state.activePlayerId,
      round: state.round, timerSec: state.timerSec
    }}));
    if (state.history.length>50) state.history.shift();
  }
  function restore(snapshot){
    state.players = snapshot.players.map(p=>({...p}));
    state.clubs   = snapshot.clubs.map(c=>({...c}));
    state.activePlayerId = snapshot.activePlayerId;
    state.round = snapshot.round;
    state.timerSec = snapshot.timerSec;
  }

  // ---------- Guardrails ----------
  function validateBidAgainstBase(p, bid){ return Number(bid)>=playerBase(p); }

  window.guardrailOK = function(bid){
    const p=getActivePlayer();
    const price = Number(bid||0);
    if (!p || !Number.isFinite(price)) return false;
    if (price < playerBase(p)) return false;
    const bud = remainingBudget(state.myClubSlug);
    const remSlotsAfter = Math.max(0, remainingSlots()-1);
    const floorAfter = remainingFloor(p.id, remSlotsAfter);
    return (price <= bud) && ((bud - price) >= floorAfter);
  };

  window.maxYouCanSpendNow = function(playerOpt){
    const p=playerOpt||getActivePlayer();
    const bud = remainingBudget(state.myClubSlug);
    const remSlotsAfter = Math.max(0, remainingSlots()-1);
    const floorAfter = remainingFloor(p && p.id, remSlotsAfter);
    return Math.max(playerBase(p||{}), bud - floorAfter);
  };

  // ---------- Budget recompute ----------
  window.recomputeBudgetsFromWins = function(){
    // reset to starting_budget then subtract won bids
    state.clubs.forEach(c=> c.budget_left = toNum(c.starting_budget,0));
    (state.players||[]).forEach(p=>{
      if (p.status==="won" && Number(p.finalBid)>0){
        const club = state.clubs.find(c=>c.slug===p.owner);
        if (club) club.budget_left = Math.max(0, club.budget_left - Number(p.finalBid));
      }
    });
  };

  // ---------- Actions (with strict enforcement) ----------
  function markWon(playerId, price){
    const p = (state.players||[]).find(x=>x.id===playerId);
    const bid=Number(price||0);
    if (!p) return;
    if (bid<playerBase(p)){ alert(`⚠️ Bid cannot be less than base point (${playerBase(p)}).`); return; }
    if (!window.guardrailOK(bid)){ alert("⚠️ Guardrail: this bid would leave insufficient points for remaining slots."); return; }
    pushHistory("markWon");
    p.status="won"; p.finalBid=bid; p.owner=state.myClubSlug;
    window.recomputeBudgetsFromWins(); window.persist(); render();
  }
  function assignToClubByNameOrSlug(playerId, clubText, price){
    const p=(state.players||[]).find(x=>x.id===playerId);
    const club=(state.clubs||[]).find(c=> c.slug===slugify(clubText) || c.name===clubText );
    const bid=Number(price||0);
    if (!p || !club) return;
    if (bid<playerBase(p)){ alert(`⚠️ Bid cannot be less than base point (${playerBase(p)}).`); return; }
    pushHistory("assignToClub");
    p.status="won"; p.finalBid=bid; p.owner=club.slug;
    window.recomputeBudgetsFromWins(); window.persist(); render();
  }
  window.markWon = markWon;
  window.assignToClubByNameOrSlug = assignToClubByNameOrSlug;

  // ---------- Safety Net (never persist below base) ----------
  function enforceRosterIntegrity(opts={silent:false}){
    const fixes = [];
    (state.players||[]).forEach(p=>{
      if (p.status==="won"){
        const base = playerBase(p);
        const bid  = toNum(p.finalBid,0);
        if (bid<base){
          fixes.push({name:p.name, bid, base, owner:p.owner});
          p.status="open"; p.owner=null; p.finalBid=null;
        }
      }
    });
    if (fixes.length && !opts.silent){
      const lines = fixes.map(f=>`• ${f.name}: bid ${f.bid} < base ${f.base} (owner: ${f.owner||"-"})`);
      alert("⚠️ Invalid wins detected (below base_point). Reverted.\n\n"+lines.join("\n"));
    }
  }
  const _persist = window.persist;
  window.persist = function(){ try{enforceRosterIntegrity({silent:true});}catch(e){} return _persist.apply(this, arguments); };
  const _render  = window.render || function(){};
  window.render  = function(){ try{enforceRosterIntegrity({silent:true});}catch(e){} return _render.apply(this, arguments); };

  // ---------- Timer + Round ----------
  function paintTimer(){
    const m = String(Math.floor(state.timerSec/60)).padStart(2,"0");
    const s = String(state.timerSec%60).padStart(2,"0");
    $("timer").textContent = `${m}:${s}`;
  }
  function setRound(n){ state.round=n; $("roundNo").textContent=String(n); }

  // ---------- UI Rendering ----------
  function renderPlayers(){
    const box = $("players"); box.innerHTML="";
    state.players.forEach(p=>{
      const div=document.createElement("div");
      div.className="player"+(p.id===state.activePlayerId?" active":"");
      const pi  = toNum(p.performance_index,0);
      const pr  = Math.round(Math.min(120, pi + (Number(p.category)===1?12:Number(p.category)===2?8:Number(p.category)===3?4:0)));
      div.innerHTML = `<div><b>${p.name||"-"}</b></div>
        <div class="muted">${p.alumni||p.club||""} · ${p.phone||""}</div>
        <div class="muted">PI:${pi} · Prio:${pr} · ${String(p.skill||"-").toUpperCase()} · Cat:${p.category||"-"} · Base:${playerBase(p)}</div>
        ${p.status==="won" ? `<div class="ok">Won by ${p.owner?.toUpperCase()} · ${p.finalBid} pts</div>` : ""}`;
      div.addEventListener("click", ()=>{ state.activePlayerId=p.id; glueRefresh(); });
      box.appendChild(div);
    });
  }
  function renderClubs(){
    const sel = $("otherClubSelect"); sel.innerHTML="";
    state.clubs.forEach(c=>{
      const opt=document.createElement("option");
      opt.value=c.slug; opt.textContent=c.name;
      if (c.slug===state.myClubSlug) return; // skip HRB here
      sel.appendChild(opt);
    });
    $("clubBudget").textContent = `HRB Remaining: ${remainingBudget(state.myClubSlug)} pts · Slots: ${remainingSlots()}`;
  }
  function renderActiveCard(){
    const card=$("activePlayerCard");
    const p=getActivePlayer();
    if (!p){ card.textContent="Select a player…"; return; }
    const pi  = toNum(p.performance_index,0);
    const pr  = Math.round(Math.min(120, pi + (Number(p.category)===1?12:Number(p.category)===2?8:Number(p.category)===3?4:0)));
    card.innerHTML = `<b>${p.name}</b><br>
    ${p.alumni||p.club||""} · ${p.phone||""}<br>
    ${String(p.skill||"-").toUpperCase()} · ${String(p.batting_type||p.batting||"-").toUpperCase()} · Cat:${p.category||"-"} · Base:${playerBase(p)}<br>
    <span class="muted">PI:${pi} · Prio:${pr}</span>`;
  }
  function renderInsights(){
    const p=getActivePlayer();
    const div=$("insights"); const health=$("health");
    if (!p){ div.textContent=""; health.textContent=""; return; }
    const remPts = remainingBudget(state.myClubSlug);
    const slots  = remainingSlots();
    const pool = state.players.filter(x=>x.status!=="won");
    const bases = pool.map(x=>playerBase(x)).sort((a,b)=>a-b);
    const median = bases.length? bases[Math.floor(bases.length/2)] : minBase();
    const avgPerSlot = Math.round(remPts/Math.max(1,slots));
    let label="Healthy", cls="ok";
    if (avgPerSlot<median) { label="Tight"; cls="warn"; }
    if (avgPerSlot<0.6*median) { label="Risk"; cls="err"; }
    health.innerHTML = `Remaining: <b>${remPts}</b> · Avg/slot: <b>${avgPerSlot}</b> · Median base: <b>${median}</b> · <span class="${cls}">${label}</span>`;
    div.innerHTML = `Max safe now: <b>${window.maxYouCanSpendNow(p)}</b> · Guardrail protects remaining base floor.`;
  }

  function renderAll(){ renderPlayers(); renderClubs(); renderActiveCard(); renderInsights(); paintTimer(); }

  // ---------- Glue (enable/disable buttons, input min) ----------
  function glueRefresh(){
    renderAll();
    const p=getActivePlayer();
    const btnWon=$("btn-mark-won"), warn=$("bidWarn"), input=$("bidInput");
    if (!p){ btnWon.disabled=true; if (warn) warn.textContent="Select a player to bid."; return; }
    input.min = String(playerBase(p));
    if (Number(input.value||0) < playerBase(p)) input.value = String(playerBase(p));
    const val=Number(input.value||0);
    let ok = (val >= playerBase(p)) && window.guardrailOK(val);
    btnWon.disabled = !ok;
    if (!ok){
      if (val < playerBase(p)) warn.textContent=`Enter a bid ≥ base point: ${playerBase(p)}`;
      else warn.textContent=`Guardrail: reduce bid. You can safely spend up to ${window.maxYouCanSpendNow(p)} now.`;
    } else {
      warn.textContent="";
    }
  }

  // ---------- Event wiring ----------
  function boot(){
    // seed with sample players if none (ID, base_point, etc.)
    if (!state.players.length){
      let id=1;
      const sample=[
        {name:"Ajin Skariah", club:"KEA", phone:"65807053", skill:"Batting All-Rounder", batting_type:"Right Hand Bat", bowling:"Right Arm Medium", category:1, base_point:1500, performance_index:95},
        {name:"Player B", club:"ACE", phone:"60000001", skill:"WK Batter", batting_type:"Right", category:1, base_point:1500, performance_index:82, wk:"Y"},
        {name:"Player C", club:"TCC", phone:"60000002", skill:"Bowler", batting_type:"Left", category:2, base_point:1000, performance_index:70},
        {name:"Player D", club:"KEA", phone:"60000003", skill:"All-rounder", batting_type:"Right", category:3, base_point:500, performance_index:65},
        {name:"Player E", club:"ACE", phone:"60000004", skill:"Batter", batting_type:"Left", category:4, base_point:200, performance_index:50},
      ];
      state.players = sample.map(p=>({ id:id++, status:"open", owner:null, finalBid:null, ...p }));
      state.activePlayerId = state.players[0].id;
    }

    // Timer buttons
    $("btn-timer-start").addEventListener("click", ()=>{ if (!window.__t){ window.__t=setInterval(()=>{ state.timerSec++; const m=String(Math.floor(state.timerSec/60)).padStart(2,"0"); const s=String(state.timerSec%60).padStart(2,"0"); $("timer").textContent=`${m}:${s}`; }, 1000); } });
    $("btn-timer-stop").addEventListener("click", ()=>{ if (window.__t){ clearInterval(window.__t); window.__t=null; } });
    $("btn-timer-reset").addEventListener("click", ()=>{ state.timerSec=0; const m="00", s="00"; $("timer").textContent=`${m}:${s}`; });

    // Round increment on next
    $("btn-next").addEventListener("click", ()=>{ state.round++; setRound(state.round); });

    // Bid input glue
    $("bidInput").addEventListener("input", glueRefresh);

    // HRB Won
    $("btn-mark-won").addEventListener("click", ()=>{
      const p=getActivePlayer(); if(!p) return;
      const val=Number($("bidInput").value||0);
      markWon(p.id, val);
      glueRefresh();
    });

    // Assign to other club
    $("btn-assign").addEventListener("click", ()=>{
      const p=getActivePlayer(); if(!p) return;
      const val=Number($("bidInput").value||0);
      const clubSlug=$("otherClubSelect").value;
      assignToClubByNameOrSlug(p.id, clubSlug, val);
      glueRefresh();
    });

    // Undo
    $("btn-undo").addEventListener("click", ()=>{
      const last = state.history.pop();
      if (!last) return;
      const snap = JSON.parse(last).snapshot;
      restore(snap);
      renderAll();
    });

    renderAll();
    console.log("boot()");
  }

  // ---------- Boot ----------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
