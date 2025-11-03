/* HRB Auction Assist — Assistant Mode (warn & advise; do not hard-block) */
const BUILD = "assistant-2025-11-03";
console.log("[HRB] build:", BUILD);

const DEFAULT = { slots: 15, total: 15000, minBase: 200 };
const NEED = { wk: 2, lhb: 2, bowl: 8 };

let state = {
  players: [],
  clubs: [
    { slug:"hrb", name:"High Range Blasters", starting: DEFAULT.total, left: DEFAULT.total },
    { slug:"kea", name:"KEA", starting: DEFAULT.total, left: DEFAULT.total },
    { slug:"ace", name:"ACE", starting: DEFAULT.total, left: DEFAULT.total },
    { slug:"tcc", name:"TCC", starting: DEFAULT.total, left: DEFAULT.total },
  ],
  my:"hrb",
  slots: DEFAULT.slots,
  minBase: DEFAULT.minBase,
  activeId: null,
  round: 1,
  timer: { sec:45, run:false },
  history: []
};

const $=id=>document.getElementById(id);
const toNum=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d;};

function playerBase(p){ return Math.max(state.minBase, toNum(p.base_point, state.minBase)); }
function remainingBudget(slug){ const c=state.clubs.find(c=>c.slug===slug); return c?toNum(c.left,c.starting):0; }
function myRemainingBudget(){ return remainingBudget(state.my); }
function myWon(){ return state.players.filter(p=>p.owner===state.my && p.status==="won"); }
function remainingSlots(){ return Math.max(0, state.slots - myWon().length); }

function computePI(p){
  if (p.performance_index!=null && p.performance_index!=="") return Math.max(0, Math.min(100, Number(p.performance_index)||0));
  // fallback: small heuristics
  let base = 50;
  if (/all/i.test(p.skill||"")) base+=8;
  if (/bowl/i.test(p.skill||"")) base+=6;
  if (/wk|wicket/i.test(p.skill||"")) base+=4;
  if (/left/i.test(p.batting_type||p.batting||"")) base+=3;
  base += (toNum(p.category,4)<=2)?8:(toNum(p.category,4)===3?3:0);
  return Math.max(0, Math.min(100, base));
}
function isWK(p){ const f=String(p.wk||"").toLowerCase(); return f==="y"||f==="yes"||f==="true"||/wk|wicket/i.test(p.skill||""); }
function isLeft(p){ return /left/i.test(String(p.batting_type||p.batting||"")); }
function isBowler(p){ return /bowl/i.test(String(p.skill||"")) || /all/i.test(String(p.skill||"")); }
function bidPriority(p){ const pi=computePI(p); const cat=toNum(p.category,4); const catBoost = (cat===1?12:(cat===2?8:(cat===3?4:0))); return Math.round(Math.min(120, pi+catBoost)); }

function recomputeClubBudgets(){
  state.clubs.forEach(c=>{
    const spend = state.players.filter(p=>p.owner===c.slug && p.status==="won").reduce((s,p)=>s+toNum(p.finalBid,0),0);
    c.left = Math.max(0, c.starting - spend);
  });
}

function guardrailOK(bid){
  const remAfter = Math.max(0, remainingSlots()-1);
  const floor = remAfter * state.minBase;
  const bud = myRemainingBudget();
  return (bid <= bud) && ((bud - bid) >= floor);
}
function maxSafeNow(p){
  const remAfter = Math.max(0, remainingSlots()-1);
  const floor = remAfter * state.minBase;
  const bud = myRemainingBudget();
  return Math.max(playerBase(p||{}), bud - floor);
}
function winProb(p, bid){
  // rough: compare vs average per-slot budgets of other clubs
  const others = state.clubs.filter(c=>c.slug!==state.my).map(c=>{
    const players = state.players.filter(x=>x.owner===c.slug && x.status==="won").length;
    const slots = Math.max(1, state.slots - players);
    return (toNum(c.left,0)/slots);
  });
  const bench = others.length ? others.reduce((a,b)=>a+b,0)/others.length : state.minBase;
  const ratio = bid / Math.max(1, bench);
  const prio = bidPriority(p)/120;
  const score = 0.4*ratio + 0.6*prio;
  if (score >= 1.0) return {label:"High", cls:"ok"};
  if (score >= 0.7) return {label:"Medium", cls:"warn"};
  return {label:"Low", cls:"err"};
}
function suggestedCap(p){
  const avgPerSlot = myRemainingBudget() / Math.max(1, remainingSlots());
  const prio = bidPriority(p); // 0..120
  const prioFactor = 0.6 + (prio/120)*0.9; // 0.6..1.5
  const capByPriority = avgPerSlot * prioFactor;
  const capByBase = playerBase(p) * (1 + computePI(p)/200); // 1..1.5 range
  return Math.round(Math.max(state.minBase, Math.min(capByPriority, capByBase)));
}

function pushHistory(tag){
  try{
    state.history.push(JSON.stringify({tag, players:state.players, clubs:state.clubs}));
    if (state.history.length>50) state.history.shift();
  }catch{}
}
function undo(){
  const raw = state.history.pop(); if(!raw) return;
  try{
    const snap=JSON.parse(raw);
    state.players = JSON.parse(JSON.stringify(snap.players||[]));
    state.clubs = JSON.parse(JSON.stringify(snap.clubs||[]));
    recomputeClubBudgets(); render();
  }catch(e){ console.warn("undo failed", e); }
}

function setActive(id){ state.activeId = id; renderLive(); }
function active(){ return state.players.find(p=>String(p.id)===String(state.activeId)); }

// Assistant mode: warn + confirm
function markHRBWon(playerId, price){
  const p = state.players.find(x=>String(x.id)===String(playerId)); if(!p) return;
  const bid = Number(price||0);
  if (!Number.isFinite(bid) || bid < state.minBase){ alert(`Enter a valid bid ≥ ${state.minBase}.`); return; }
  const msgs=[];
  if (bid < playerBase(p)) msgs.push(`Below base point (${playerBase(p)}).`);
  if (!guardrailOK(bid)) msgs.push(`Guardrail risk — save at least ${state.minBase} × remaining slots.`);
  if (msgs.length){
    if (!confirm("⚠️ "+msgs.join(" ")+" Proceed anyway?")) return;
  }
  pushHistory("HRB Won");
  p.status="won"; p.owner=state.my; p.finalBid=bid;
  recomputeClubBudgets(); render();
}
function assignToOther(playerId, clubSlug, price){
  const p = state.players.find(x=>String(x.id)===String(playerId)); if(!p) return;
  const c = state.clubs.find(c=>c.slug===clubSlug); if(!c){ alert("Pick a valid club."); return; }
  const bid = Number(price||0);
  if (!Number.isFinite(bid) || bid < state.minBase){ alert(`Enter a valid final bid ≥ ${state.minBase}.`); return; }
  pushHistory("Assign other");
  p.status="won"; p.owner=c.slug; p.finalBid=bid;
  recomputeClubBudgets(); render();
}

function renderPlayers(){
  const box=$("playersList"); const remaining=state.players.filter(p=>p.status!=="won");
  if ($("playersCount")) $("playersCount").textContent = `(${remaining.length})`;
  box.innerHTML = remaining.map(p=>{
    const pi=computePI(p), pr=bidPriority(p);
    return `<div class="rowp" data-id="${p.id}">
      <div><b>${p.name||"-"}</b></div>
      <div class="hint">${p.alumni||""}${(p.alumni&&p.phone)?" · ":""}${p.phone||""}</div>
      <div class="hint">PI:${pi} · Prio:${pr} · Cat:${toNum(p.category,"-")} · Base:${playerBase(p)}</div>
    </div>`;
  }).join("") || `<div class="hint">Import CSV to get started.</div>`;
  box.querySelectorAll(".rowp").forEach(el=> el.addEventListener("click", ()=> setActive(el.getAttribute("data-id")) ));
}
function renderLive(){
  const target=$("liveCard"); const p=active(); if(!target) return;
  if(!p){ target.innerHTML="Pick a player from the list."; $("insights").innerHTML=""; return; }
  const cap=suggestedCap(p); const pi=computePI(p); const pr=bidPriority(p);
  target.innerHTML = `<div>
    <div class="flex" style="justify-content:space-between;gap:8px;">
      <div><b>${p.name}</b></div>
      <div class="hint">${p.alumni||""}${(p.alumni&&p.phone)?" · ":""}${p.phone||""}</div>
    </div>
    <div class="hint">${p.skill||""}${p.batting_type?" · "+p.batting_type:""}${p.bowling_type?" · "+p.bowling_type:""} · Cat:${toNum(p.category,"-")} · Base:${playerBase(p)}</div>
    <div class="flex" style="gap:8px; margin-top:8px; align-items:flex-end;">
      <label style="flex:0 0 180px">Bid <input id="bidInput" type="number" min="${state.minBase}" placeholder="${cap}"></label>
      <button id="btn-win" class="btn">HRB Won</button>
      <select id="clubSel" style="max-width:180px;">
        ${state.clubs.filter(c=>c.slug!==state.my).map(c=>`<option value="${c.slug}">${c.name}</option>`).join("")}
      </select>
      <label style="flex:0 0 160px">Final Bid<input id="otherBid" type="number" min="${state.minBase}" placeholder="e.g. ${playerBase(p)}"></label>
      <button id="btn-assign" class="btn btn-ghost">Assign</button>
    </div>
    <div id="bidWarn" class="hint" style="margin-top:6px;"></div>
  </div>`;
  const bidEl=$("bidInput"), warn=$("bidWarn");
  function refreshWarn(){
    const v=Number(bidEl.value||0); const notes=[];
    if (v && v<playerBase(p)) notes.push(`Below base (${playerBase(p)}).`);
    if (v && !guardrailOK(v)) notes.push(`Guardrail: keep points for remaining slots.`);
    warn.innerHTML = notes.join(" ");
    renderInsights(p, v||null);
  }
  bidEl.addEventListener("input", refreshWarn);
  $("btn-win").addEventListener("click", ()=> markHRBWon(p.id, Number(bidEl.value||0)||playerBase(p)) );
  $("btn-assign").addEventListener("click", ()=> assignToOther(p.id, $("clubSel").value, Number($("otherBid").value||0)||playerBase(p)) );
  refreshWarn();
}
function renderSquad(){
  const box=$("squad"); const mine=myWon();
  const list = mine.map(p=>`<div class="flex" style="justify-content:space-between;border-bottom:1px solid #1f2937;padding:6px 0;">
    <div>${p.name}</div><div class="hint">${p.alumni||""}</div><div class="ok">${toNum(p.finalBid,0)} pts</div></div>`).join("");
  const left=myRemainingBudget();
  box.innerHTML = `<div class="hint">Players: <b>${mine.length}</b> · Budget left: <b>${left}</b></div>` + (list || `<div class="hint" style="margin-top:6px;">No players yet.</div>`);
}
function renderClubs(){
  const root=$("clubs");
  root.innerHTML = state.clubs.filter(c=>c.slug!==state.my).map(c=>{
    const won = state.players.filter(p=>p.owner===c.slug && p.status==="won");
    const list = won.map(p=>`<div class="flex" style="justify-content:space-between;border-bottom:1px solid #1f2937;padding:4px 0;"><div>${p.name}</div><div class="hint">${toNum(p.finalBid,0)} pts</div></div>`).join("");
    const slots=Math.max(0, state.slots - won.length);
    return `<div class="card" style="padding:8px;margin-bottom:8px;">
      <div class="flex" style="justify-content:space-between;"><div><b>${c.name}</b></div><div class="hint">Slots left: ${slots}</div></div>
      <div class="hint">Points left: <b>${toNum(c.left,0)}</b></div>
      <div style="max-height:160px;overflow:auto;margin-top:6px;">${list || "<div class='hint'>—</div>"}</div>
    </div>`;
  }).join("");
}
function renderCompliance(){
  const mine=myWon();
  const wk = mine.filter(isWK).length;
  const lhb = mine.filter(isLeft).length;
  const bowl = mine.filter(isBowler).length;
  const badge=(cur,req,label)=>`<span>${label}: <b class="${cur>=req?'ok':'err'}">${cur}/${req}</b></span>`;
  $("compliance").innerHTML = `${badge(wk,NEED.wk,"WK")} · ${badge(lhb,NEED.lhb,"LHB")} · ${badge(bowl,NEED.bowl,"Bowlers")}`;
}
function renderHealth(){
  const left = myRemainingBudget();
  const slots = remainingSlots();
  const avg = Math.round(left / Math.max(1, slots));
  const pool = state.players.filter(p=>p.status!=="won");
  const bases = pool.map(playerBase).sort((a,b)=>a-b);
  const med = bases.length? bases[Math.floor(bases.length/2)] : state.minBase;
  let label="Healthy", cls="ok";
  if (avg<med) { label="Tight"; cls="warn"; }
  if (avg<0.6*med) { label="Risk"; cls="err"; }
  $("health").innerHTML = `Remaining: <b>${left}</b> · Avg/slot: <b>${avg}</b> · Median base: <b>${med}</b> · <span class="${cls}">${label}</span>`;
}
function renderInsights(p, whatIf){
  const div=$("insights"); if(!div){return;}
  if(!p){ div.innerHTML=""; return; }
  const cap=suggestedCap(p);
  const safe=Math.max(playerBase(p), Math.round(cap*0.85));
  const stretch=Math.round(cap*1.15);
  const hard = maxSafeNow(p);
  const prob = winProb(p, Number(whatIf||cap));
  const scarcity = (()=>{
    const rem = state.players.filter(x=>x.status!=="won");
    const w = rem.filter(isWK).length;
    const l = rem.filter(isLeft).length;
    const b = rem.filter(isBowler).length;
    const notes=[];
    if (w<=2) notes.push("WK scarce");
    if (l<=6) notes.push("LHB scarce");
    if (b<=10) notes.push("Bowlers thinning");
    return notes.join(" · ") || "No strong scarcity signals.";
  })();
  div.innerHTML = `<div class="grid2">
    <div class="card">
      <div><b>Price band</b> <span class="hint">(safe–stretch)</span></div>
      <div style="margin-top:6px;">${safe} – ${stretch} (hard cap: <b>${hard}</b>)</div>
    </div>
    <div class="card">
      <div><b>Win probability</b></div>
      <div class="${prob.cls}" style="margin-top:6px;"><b>${prob.label}</b></div>
    </div>
  </div>
  <div class="space"></div>
  <div class="card">
    <div><b>Strategy</b></div>
    <div class="hint" style="margin-top:6px;">
      Target Cat 1–3; stay compliant (2 WK, 8 Bowlers, 2 LHB). Keep avg/slot ≥ median base to avoid late squeeze. Scarcity: ${scarcity}
    </div>
  </div>`;
}

function renderAll(){ renderPlayers(); renderLive(); renderSquad(); renderClubs(); renderCompliance(); renderHealth(); }

// Timer & round
let tHandle=null;
function paintTimer(){ const s=state.timer.sec; const m=String(Math.floor(s/60)).padStart(2,"0"); const ss=String(s%60).padStart(2,"0"); $("timer").textContent=`${m}:${ss}`; }
function startTimer(){ if(tHandle) return; tHandle=setInterval(()=>{ state.timer.sec=Math.max(0,state.timer.sec-1); paintTimer(); if(state.timer.sec<=0){ stopTimer(); }},1000); }
function stopTimer(){ if(tHandle){ clearInterval(tHandle); tHandle=null; } }
function resetTimer(){ state.timer.sec=45; paintTimer(); }
function nextRound(){ state.round+=1; $("roundNo").textContent=String(state.round); resetTimer(); }

// CSV
function splitCsv(text){ const rows=[],row=[],push=()=>rows.push(row.splice(0,row.length)); let cell="",inQ=false; for(let i=0;i<text.length;i++){ const ch=text[i],nx=text[i+1]; if(inQ){ if(ch==='"'&&nx=='"'){cell+='"';i++;continue;} if(ch=='"'){inQ=false;continue;} cell+=ch; continue;} if(ch=='"'){inQ=true;continue;} if(ch===','){row.push(cell);cell="";continue;} if(ch=='\n'){row.push(cell);cell="";push();continue;} cell+=ch;} row.push(cell); push(); return rows; }
function normHead(s){ return String(s||"").trim().toLowerCase(); }
function parsePlayersCSV(raw){
  const rows=splitCsv(raw).filter(r=>r.some(c=>String(c).trim()!=="")); if(!rows.length) return [];
  const header = rows[0].map(normHead);
  const idx = ( *aliases ) => { for(const a of aliases){ const i=header.indexOf(a); if(i>=0) return i; } return -1; };
  const i = {
    name: idx("name","player","player name"),
    alumni: idx("alumni","alumni name","member name"),
    phone: idx("phone","mobile","whatsapp","contact"),
    skill: idx("skill","role","playing role"),
    batting: idx("batting","batting_type","batting hand"),
    bowling: idx("bowling","bowling_type"),
    wk: idx("wk","wicket-keeper","wicket keeper","keeper"),
    cat: idx("category","cat"),
    base: idx("base_point","base","base point"),
    availability: idx("availability"),
    pi: idx("performance_index","pi")
  };
  const out=[];
  for (let r=1;r<rows.length;r++){
    const c=rows[r];
    const name=(c[i.name]||"").trim(); if(!name) continue;
    out.push({
      id: String(r), name,
      alumni:(c[i.alumni]||"").trim(),
      phone:(c[i.phone]||"").trim(),
      skill:(c[i.skill]||"").trim(),
      batting_type:(c[i.batting]||"").trim(),
      bowling_type:(c[i.bowling]||"").trim(),
      wk:(c[i.wk]||"").trim(),
      category: toNum(c[i.cat], null),
      base_point: toNum(c[i.base], null),
      availability:(c[i.availability]||"").trim(),
      performance_index: toNum(c[i.pi], null),
      status:"open", owner:null, finalBid:null
    });
  }
  return out;
}

async function fetchCSV(url){
  const res = await fetch(url, { cache:"no-store" });
  if (!res.ok) throw new Error("HTTP "+res.status);
  return await res.text();
}

// Export
function downloadCSV(rows, filename){
  const csv=rows.map(r=>r.map(v=>{const s=String(v??"");return /[\",\\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(",")).join("\\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
}
function exportWon(){
  const won=state.players.filter(p=>p.status==="won");
  const rows=[["Club","Player","Alumni","Phone","Bid"]];
  won.forEach(p=>{ const club=state.clubs.find(c=>c.slug===p.owner); rows.push([club?club.name:p.owner, p.name, p.alumni||"", p.phone||"", toNum(p.finalBid,0)]); });
  downloadCSV(rows, "auction-won-contacts.csv");
}
function exportState(){
  const rows=[[ "ID","Name","Alumni","Phone","Cat","Base","WK","Bat","Bowl","Status","Owner","Final Bid" ]];
  state.players.forEach(p=> rows.push([p.id,p.name,p.alumni||"",p.phone||"",toNum(p.category,""),toNum(p.base_point,""),p.wk||"",p.batting_type||"",p.bowling_type||"",p.status||"",p.owner||"",toNum(p.finalBid,"")]) );
  downloadCSV(rows, "auction-state.csv");
}

// Render root
function render(){
  renderPlayers(); renderLive(); renderSquad(); renderClubs(); renderCompliance(); renderHealth();
  $("btn-undo").disabled = state.history.length===0;
}

function boot(){
  // Timer wires
  $("btn-timer-start").addEventListener("click", startTimer);
  $("btn-timer-stop").addEventListener("click", stopTimer);
  $("btn-timer-reset").addEventListener("click", resetTimer);
  $("btn-undo").addEventListener("click", undo);
  $("btn-export").addEventListener("click", exportWon);
  $("btn-export-all").addEventListener("click", exportState);
  paintTimer();

  // CSV UI
  $("btn-fetch").addEventListener("click", async()=>{
    const url = $("csvUrl").value.trim(); const msg=$("csvMsg");
    try{ msg.textContent="Fetching…"; const txt=await fetchCSV(url); $("csvText").value=txt; msg.textContent="Fetched. Click Import to load players."; }
    catch(e){ msg.textContent="Fetch failed. Ensure the sheet is published and URL ends with output=csv."; }
  });
  $("btn-import").addEventListener("click", ()=>{
    const raw = $("csvText").value;
    const msg=$("csvMsg");
    try{
      const players = parsePlayersCSV(raw);
      if (!players.length) { msg.textContent="Could not parse CSV."; return; }
      state.players = players;
      state.clubs.forEach(c=>{ c.starting = DEFAULT.total; c.left = DEFAULT.total; });
      render(); msg.textContent = `Imported ${players.length} players.`;
    }catch(e){ msg.textContent="Import failed."; }
  });

  render();
}
document.addEventListener("DOMContentLoaded", boot);
