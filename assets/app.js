/* HRB Auction Assist – app.js (vanilla, no modules) */
const APP_BUILD = "hrb-2025-11-02-19";
console.log("[HRB] build:", APP_BUILD);
if (window.__HRB_APP_LOADED__) { throw new Error("DUP_LOAD"); }
window.__HRB_APP_LOADED__ = true;

/* ============= Constants ============= */
const DEFAULT_PLAYERS_CAP = 15;
const DEFAULT_TOTAL_POINTS = 15000;
const DEFAULT_MIN_BASE = 200;           // tournament minimum (guardrail)
const MUST_BID_THRESHOLD = 80;          // performance index threshold

// weights for performance index (tune as needed)
const PI_WEIGHTS = {
  batting: 0.55,
  bowling: 0.45,
  bat_avg: 0.35,
  strike_rate: 0.30,
  runs: 0.35,
  wickets: 0.55,
  eco_rate: 0.45
};

/* 8 fixed clubs (hard-coded names) */
const DEFAULT_CLUBS = [
  { name: "High Range Blasters", slug: "high-range-blasters", logo_url: "" },
  { name: "Black Panthers", slug: "black-panthers", logo_url: "" },
  { name: "White Elephants", slug: "white-elephants", logo_url: "" },
  { name: "Kerala Tuskers", slug: "kerala-tuskers", logo_url: "" },
  { name: "Warbow Wolverines", slug: "warbow-wolverines", logo_url: "" },
  { name: "Venad Warriers", slug: "venad-warriers", logo_url: "" },
  { name: "Thiruvalla Warriers", slug: "thiruvalla-warriers", logo_url: "" },
  { name: "God's Own XI", slug: "gods-own-xi", logo_url: "" },
];

/* ============= State ============= */
let state = {
  players: [],
  auth: { loggedIn: false, user: null },
  playersNeeded: DEFAULT_PLAYERS_CAP,
  totalPoints: DEFAULT_TOTAL_POINTS,
  minBasePerPlayer: DEFAULT_MIN_BASE,
  categoryBase: { c1: null, c2: null, c3: null, c4: null, c5: null },
  preselectedByClub: {},
  myClubSlug: "high-range-blasters",
  clubs: [],
  activePlayerId: null,
};

function persist(){ try{ localStorage.setItem("hrb-auction-state", JSON.stringify(state)); }catch{} }
function load(){ try{ const s=JSON.parse(localStorage.getItem("hrb-auction-state")||"{}"); if(s&&typeof s==="object"){ state={...state,...s}; } }catch{} }

/* ============= Utils ============= */
const $ = (id)=>document.getElementById(id);
const $$ = (sel,root=document)=>Array.from(root.querySelectorAll(sel));
const toNum = (v,d=0)=>{ const n=Number(v); return Number.isFinite(n)?n:d; };
const normalizeHeader = (s)=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");
const slugify = (s)=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
function minBase(){ return Number(state?.minBasePerPlayer)>0 ? Number(state.minBasePerPlayer) : DEFAULT_MIN_BASE; }
function show(el,on=true){ if(!el) return; el.style.display = on?"block":"none"; }

function availabilityIsBothDays(av){
  const s = String(av||"").trim(); if(!s) return false;
  if (/(both\s*days|two\s*days|day\s*1\s*and\s*day\s*2|sat\s*&\s*sun|saturday.*sunday)/i.test(s)) return true;
  const dateLike = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[^0-9]{0,5}\d{1,2}/gi);
  if (dateLike && dateLike.length>=2) return true;
  const tokens = s.split(/[^a-z0-9]+/i).filter(Boolean);
  const hasMonth = tokens.some(t=>/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i.test(t));
  const dayNums = tokens.filter(t=>/^\d{1,2}$/.test(t));
  if (hasMonth && dayNums.length>=2) return true;
  return false;
}

/* ============= Clubs ============= */
function ensureDefaultClubsSeeded(){
  if(!state.clubs) state.clubs=[];
  const seen=new Set(state.clubs.map(c=>c.slug));
  DEFAULT_CLUBS.forEach(def=>{
    if(!seen.has(def.slug)){
      const start = state.totalPoints || DEFAULT_TOTAL_POINTS;
      state.clubs.push({ id:`local-${def.slug}`, slug:def.slug, name:def.name, logo_url:def.logo_url||"", starting_budget:start, budget_left:start });
    }
  });
  recomputeBudgetsFromWins();
  persist();
}
function myClub(){ return (state.clubs||[]).find(c=>c.slug===state.myClubSlug)||null; }
function remainingSlots(){
  const mine=(state.players||[]).filter(p=>p.owner===state.myClubSlug&&p.status==="won").length;
  return Math.max(0,(state.playersNeeded||DEFAULT_PLAYERS_CAP)-mine);
}
function remainingBudget(slug){ const c=(state.clubs||[]).find(c=>c.slug===slug); return c?toNum(c.budget_left,c.starting_budget||0):0; }

/* ============= Performance Index & Priority ============= */
function clip01(x){ return Math.max(0, Math.min(1, x)); }
function norm(value, min, max){ if(value==null||!Number.isFinite(Number(value))) return 0; const n=(Number(value)-min)/(max-min||1); return clip01(n); }
function computePerformanceIndex(p){
  if (p.performance_index!=null && p.performance_index!=="" && Number.isFinite(Number(p.performance_index))) {
    const v = Number(p.performance_index); return Math.max(0, Math.min(100, v));
  }
  const bat = (
    PI_WEIGHTS.bat_avg * norm(p.bat_avg, 10, 45) +
    PI_WEIGHTS.strike_rate * norm(p.strike_rate, 70, 180) +
    PI_WEIGHTS.runs * norm(p.runs, 100, 1200)
  );
  const bowl = (
    PI_WEIGHTS.wickets * norm(p.wickets, 0, 50) +
    PI_WEIGHTS.eco_rate * (1 - norm(p.eco_rate, 4.5, 9.5))
  );
  const pi = 100 * (PI_WEIGHTS.batting * bat + PI_WEIGHTS.bowling * bowl);
  return Math.round(Math.max(0, Math.min(100, pi)));
}
function computeBidPriority(p){
  const pi = computePerformanceIndex(p);
  const fullAvail = availabilityIsBothDays(p.availability);
  const wkBoost = /wk/i.test(String(p.skill||"")) ? 6 : 0;
  const leftBoost = /left/i.test(String(p.batting_type||p.batting||"")) ? 4 : 0;
  const roleAdj = /all/i.test(String(p.skill||"")) ? 1.05 : 1.0;
  const base = pi + wkBoost + leftBoost + (fullAvail?8:-10);
  return Math.round(Math.max(0, Math.min(120, base * roleAdj)));
}
function suggestedCap(p){
  const budget = remainingBudget(state.myClubSlug);
  const slots = Math.max(1, remainingSlots());
  const avgPerSlot = budget / slots;
  const priority = computeBidPriority(p);   // 0..120
  const prioFactor = 0.6 + (priority/120)*0.9; // 0.6..1.5
  const basePoint = toNum(p.base_point, toNum(p.base, minBase()));
  const baseFactor = 1 + computePerformanceIndex(p)/200; // 1..1.5
  const capByPriority = avgPerSlot * prioFactor;
  const capByBase = basePoint * baseFactor;
  const cap = Math.max(minBase(), Math.round(Math.min(capByPriority, capByBase)));
  return cap;
}

/* ============= CSV parsing ============= */
function splitCsv(text){ const rows=[],row=[],push=()=>rows.push(row.splice(0,row.length)); let cell="",inQ=false; for(let i=0;i<text.length;i++){ const ch=text[i],nx=text[i+1]; if(inQ){ if(ch==='"'&&nx=='"'){cell+='"';i++;continue;} if(ch=='"'){inQ=false;continue;} cell+=ch; continue;} if(ch=='"'){inQ=true;continue;} if(ch===','){row.push(cell);cell="";continue;} if(ch=='\n'){row.push(cell);cell="";push();continue;} cell+=ch;} row.push(cell); push(); return rows; }
function parseCSVPlayers(raw){
  const rows=splitCsv(raw).filter(r=>r.some(c=>String(c).trim()!=="")); if(!rows.length) return [];
  const headerIdx = rows.findIndex(r=>{ const h=r.map(normalizeHeader); return h.includes("name") || h.includes("player name") || h.includes("player"); });
  if(headerIdx<0) return [];
  const header = rows[headerIdx].map(normalizeHeader); const body=rows.slice(headerIdx+1);
  const idx=(...aliases)=>{ for(const a of aliases){ const i=header.indexOf(a); if(i>=0) return i; } return -1; };
  const i = {
    player_id: idx("player_id","id"),
    name: idx("name","player name","player"),
    alumni: idx("alumni","alumni member name","member","alumni name"),
    phone: idx("phone","player contact number","mobile","whatsapp","contact"),
    skill: idx("skill","playing role","role"),
    batting_type: idx("batting_type","batting hand","batting"),
    bowling_type: idx("bowling_type","bowling"),
    wk: idx("wk","wicket-keeper","wicket keeper","keeper"),
    availability: idx("availability"),
    category: idx("category","cat"),
    base_point: idx("base_point","base","base point"),
    previous_team: idx("previous_team","represented teams","represented team"),
    matches: idx("matches_played","matches","m"),
    bat_avg: idx("bat_avg","batting avg","avg"),
    strike_rate: idx("strike_rate","sr","strike rate"),
    runs: idx("runs"),
    fifties: idx("50s","fifties"),
    hundreds: idx("100s","hundreds"),
    not_outs: idx("not_outs","no"),
    wickets: idx("wickets","wkts"),
    eco_rate: idx("eco_rate","economy","econ"),
    best_bowling: idx("best_bowling","bb"),
    five_wkts: idx("five_wkts","5w"),
    catches: idx("catches"),
    runouts: idx("runouts","ro"),
    performance_index: idx("performance_index"),
    popularity_index: idx("popularity_index","votes"),
    must_bid_flag: idx("must_bid_flag","must bid"),
    availability_flag: idx("availability_flag"),
    bid_priority_score: idx("bid_priority_score")
  };
  const players=[];
  body.forEach((cols,idxRow)=>{
    const name = (cols[i.name]||"").trim(); if(!name) return;
    const p = {
      id: (cols[i.player_id]||String(idxRow+1)).toString(),
      name,
      alumni: (cols[i.alumni]||"").trim(),
      phone: (cols[i.phone]||"").trim(),
      skill: (cols[i.skill]||"").trim(),
      batting_type: (cols[i.batting_type]||"").trim(),
      bowling_type: (cols[i.bowling_type]||"").trim(),
      wk: String(cols[i.wk]||"").trim(),
      availability: (cols[i.availability]||"").trim(),
      category: toNum(cols[i.category], null),
      base_point: toNum(cols[i.base_point], null),
      previous_team: (cols[i.previous_team]||"").trim(),
      matches_played: toNum(cols[i.matches], null),
      bat_avg: toNum(cols[i.bat_avg], null),
      strike_rate: toNum(cols[i.strike_rate], null),
      runs: toNum(cols[i.runs], null),
      fifty: toNum(cols[i.fifties], null),
      hundred: toNum(cols[i.hundreds], null),
      not_outs: toNum(cols[i.not_outs], null),
      wickets: toNum(cols[i.wickets], null),
      eco_rate: toNum(cols[i.eco_rate], null),
      best_bowling: (cols[i.best_bowling]||"").trim(),
      five_wkts: toNum(cols[i.five_wkts], null),
      catches: toNum(cols[i.catches], null),
      runouts: toNum(cols[i.runouts], null),
      performance_index: toNum(cols[i.performance_index], null),
      popularity_index: toNum(cols[i.popularity_index], null),
      must_bid_flag: (cols[i.must_bid_flag]||"").trim(),
      availability_flag: (cols[i.availability_flag]||"").trim(),
      bid_priority_score: toNum(cols[i.bid_priority_score], null),
      status: "new"
    };
    players.push(p);
  });
  return players;
}

/* ============= Budgets & Guardrail ============= */
function recomputeBudgetsFromWins(){
  (state.clubs||[]).forEach(c=>{
    const spent=(state.players||[]).filter(p=>p.owner===c.slug&&p.status==="won").reduce((s,p)=>s+toNum(p.finalBid,0),0);
    c.starting_budget = state.totalPoints || DEFAULT_TOTAL_POINTS;
    c.budget_left = Math.max(0, c.starting_budget - spent);
  });
}
function guardrailOK(bid){
  const rem=remainingSlots();
  const floor=minBase();
  const bud=remainingBudget(state.myClubSlug);
  return bid<=bud && bud-bid>=(rem-1)*floor;
}

/* ============= Live flow ============= */
function setActivePlayer(id){ state.activePlayerId=id||null; persist(); renderLiveBid(); }
function getActivePlayer(){ return (state.players||[]).find(p=>p.id===state.activePlayerId)||null; }

function markWon(playerId, price){
  const p=(state.players||[]).find(x=>x.id===playerId); if(!p) return;
  const bid=Number(price);
  if(!Number.isFinite(bid) || bid<minBase()){ alert("Please enter a valid bid ≥ "+minBase()+"."); return; }
  if(!guardrailOK(bid)){ alert("Guardrail violated. Reduce bid."); return; }
  p.status="won"; p.finalBid=bid; p.owner=state.myClubSlug;
  recomputeBudgetsFromWins(); persist(); render();
}

function assignToClubByNameOrSlug(playerId, clubText, price){
  const clubs=state.clubs||[]; let club=clubs.find(c=>c.slug===clubText);
  if(!club){ const t=String(clubText||"").trim().toLowerCase(); club=clubs.find(c=>(c.name||"").toLowerCase()===t)||clubs.find(c=>(c.name||"").toLowerCase().startsWith(t)); }
  const msg=$("passPanelMsg"); if(!club){ if(msg) msg.textContent="Pick a valid club from the list."; return; }
  const p=(state.players||[]).find(x=>x.id===playerId); if(!p) return;
  const bid=Number(price); const min=minBase();
  if(!Number.isFinite(bid) || bid<min){ if(msg) msg.textContent="Enter a valid final bid ≥ "+min+"."; return; }
  p.status="won"; p.finalBid=bid; p.owner=club.slug;
  recomputeBudgetsFromWins(); persist(); render();
}

/* ============= UI helpers ============= */
function miniRow(p){
  const alumni=p.alumni||"", phone=p.phone||"", sep=alumni&&phone?" · ":"";
  return `
  <div class="mini-row" style="padding:6px 0;border-bottom:1px solid #eef1f4">
    <div style="font-size:14px;font-weight:700">${p.name||"-"}</div>
    <div style="font-size:12px;color:#6b7280">${alumni}${sep}${phone}</div>
  </div>`;
}
function isLeftHand(hand){ return /left/i.test(String(hand||"")); }
function isBowler(role){ return /bowl/i.test(String(role||"")); }
function complianceForMySquad(){
  const mine=(state.players||[]).filter(p=>p.owner===state.myClubSlug&&p.status==="won");
  const wk=mine.filter(p=>/wk/i.test(String(p.skill||""))).length;
  const lhb=mine.filter(p=>isLeftHand(p.batting_type||p.batting||"")).length;
  const bowl=mine.filter(p=>isBowler(p.skill)||/all/i.test(String(p.skill||""))).length;
  return { wk, lhb, bowl };
}

/* ============= Renderers ============= */
function renderPlayersList(){
  const root=$("playersList"), counter=$("playersCount"); if(!root) return;
  const remaining=(state.players||[]).filter(p=>p.status!=="won");
  if(counter) counter.textContent = `(${remaining.length})`;
  root.innerHTML = remaining.length ? remaining.map(p=>{
    const pi = computePerformanceIndex(p);
    const priority = computeBidPriority(p);
    const must = (p.must_bid_flag && /y|yes|true/i.test(String(p.must_bid_flag))) || (pi>=MUST_BID_THRESHOLD && availabilityIsBothDays(p.availability));
    const lowAvail = !availabilityIsBothDays(p.availability);
    const tags = [
      must ? `<span style="background:#fde68a;color:#7c2d12;padding:2px 6px;border-radius:999px;font-size:11px;">Must Bid</span>` : "",
      lowAvail ? `<span style="background:#fee2e2;color:#7f1d1d;padding:2px 6px;border-radius:999px;font-size:11px;">Low availability</span>` : "",
      `<span style="background:#e5e7eb;color:#111827;padding:2px 6px;border-radius:999px;font-size:11px;">PI:${pi}</span>`
    ].filter(Boolean).join(" ");
    return `
      <div class="item" style="padding:10px;border-bottom:1px solid #eee;${lowAvail?'opacity:.92;':''}">
        <div class="row" style="display:flex;justify-content:space-between;gap:8px">
          <div>
            <div style="display:flex;gap:8px;align-items:center;"><b>${p.name}</b> ${tags}</div>
            <div class="meta" style="color:#6b7280">
              ${(p.alumni||"")}${(p.alumni&&p.phone)?" · ":""}${(p.phone||"")}
              ${(p.skill?" · "+p.skill:"")}${(p.batting_type?" · "+p.batting_type:"")}${(p.bowling_type?" · "+p.bowling_type:"")}
              ${(Number.isFinite(p.category)?" · Cat:"+p.category:"")}${(Number.isFinite(p.base_point)?" · Base:"+p.base_point:"")}
            </div>
          </div>
          <button class="btn btn-ghost" data-id="${p.id}" data-action="pick">Pick</button>
        </div>
      </div>`; }).join("") : `<div class="hint">Import players using the master template.</div>`;
  root.querySelectorAll("[data-action='pick']").forEach(btn=>{ btn.addEventListener("click", ()=> setActivePlayer(btn.getAttribute("data-id"))); });
}

function renderSelectedSquad(){
  const root=$("selectedList"); if(!root) return; const c=myClub();
  const mine=(state.players||[]).filter(p=>p.owner===state.myClubSlug&&p.status==="won");
  const header=`<div class="row" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="meta">Players: <b>${mine.length}</b> · Budget left: <b>${toNum(c?.budget_left,0)}</b></div></div>`;
  root.innerHTML = mine.length ? header + mine.map(miniRow).join("") : header + `<div class="hint">No players won yet.</div>`;
}

function renderOtherClubsPanel(){
  const root=$("otherClubsPanel"); if(!root) return;
  const others=(state.clubs||[]).filter(c=>c.slug!==state.myClubSlug);
  root.innerHTML = others.map(c=>{
    const players=(state.players||[]).filter(p=>p.owner===c.slug&&p.status==="won");
    const spend=players.reduce((s,p)=>s+toNum(p.finalBid,0),0);
    const balance=Math.max(0, (c.starting_budget||DEFAULT_TOTAL_POINTS)-spend);
    const list = players.length ? players.map(miniRow).join("") : `<div class="hint">No players yet.</div>`;
    const slots=Math.max(0,(state.playersNeeded||DEFAULT_PLAYERS_CAP)-players.length);
    return `
  <div class="club-box" style="padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:10px;background:#fff">
    <div class="club-head" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div style="font-size:14px;"><b>${c.name}</b></div>
      <div style="margin-left:auto;font-size:12px;color:#374151;">Balance players: <b>${slots}</b></div>
    </div>
    <div style="font-size:12px;color:#374151;margin-bottom:6px;">Balance points: <b>${balance}</b></div>
    <div class="club-list" style="max-height:220px;overflow:auto">${list}</div>
  </div>`; }).join("");
}

function renderComplianceBar(){
  const root=$("complianceBar"); if(!root) return;
  const {wk,lhb,bowl}=complianceForMySquad(); const need={wk:2, lhb:2, bowl:8};
  const badge=(cur,req,label)=>`<span>${label}: <b style="color:${cur>=req?"#16a34a":"#dc2626"}">${cur}/${req}</b></span>`;
  root.innerHTML = `<div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:8px">
  ${badge(wk,need.wk,"WK")} ${badge(lhb,need.lhb,"Left-hand")} ${badge(bowl,need.bowl,"Bowlers")}
</div>`;
}

function renderLiveBid(){
  const live=$("liveBid"); if(!live) return; const p=getActivePlayer();
  if(!p){ live.innerHTML = `<div class="hint">No active player. Use the Name picker or click Pick on the list.</div>`; return; }
  const pi = computePerformanceIndex(p); const priority=computeBidPriority(p); const cap=suggestedCap(p);
  const must = (p.must_bid_flag && /y|yes|true/i.test(String(p.must_bid_flag))) || (pi>=MUST_BID_THRESHOLD && availabilityIsBothDays(p.availability));
  const lowAvail=!availabilityIsBothDays(p.availability);
  const flags=[ must?`<span style="background:#fde68a;color:#7c2d12;padding:2px 8px;border-radius:999px;font-size:12px;">Must Bid</span>`:"", lowAvail?`<span style="background:#fee2e2;color:#7f1d1d;padding:2px 8px;border-radius:999px;font-size:12px;">Low availability</span>`:"", `<span style="background:#e5e7eb;color:#111827;padding:2px 8px;border-radius:999px;font-size:12px;">PI:${pi} · Prio:${priority}</span>` ].filter(Boolean).join(" ");
  live.innerHTML = `
    <div class="card" style="padding:12px;${must?"box-shadow:0 0 0 3px #fef08a inset;":""}">
      <div style="display:flex;gap:8px;align-items:center;">
        <div style="font-size:18px;font-weight:700">${p.name}</div>
        ${flags}
      </div>
      <div class="meta" style="color:#6b7280">
        ${(p.alumni||"")}${(p.alumni&&p.phone)?" · ":""}${(p.phone||"")}
        ${(p.skill?" · "+p.skill:"")}${(p.batting_type?" · "+p.batting_type:"")}${(p.bowling_type?" · "+p.bowling_type:"")}
        ${(Number.isFinite(p.category)?" · Cat:"+p.category:"")}${(Number.isFinite(p.base_point)?" · Base:"+p.base_point:"")}
      </div>
      <div class="row" style="display:flex;gap:8px;margin-top:10px;align-items:flex-end;flex-wrap:wrap">
        <label style="flex:0 1 180px">Bid Amount
          <input id="bidInput" type="number" min="200" placeholder="e.g. ${cap}" />
        </label>
        <div class="hint">Suggested Max: <b>${cap}</b></div>
        <button id="btn-mark-won" class="btn" disabled>HRB Won</button>
        <button id="btn-pass" class="btn btn-ghost">Pass / Assign</button>
      </div>
      <div id="bidWarn" class="hint" style="margin-top:6px;color:#dc2626"></div>
    </div>`;
  const bidEl=$("bidInput"), wonBtn=$("btn-mark-won"), warnEl=$("bidWarn");
  const validate=()=>{
    const raw=bidEl.value; if(!raw||!String(raw).trim().length){ warnEl.textContent="Enter a bid (≥ "+minBase()+")."; wonBtn.disabled=true; return false; }
    const price=Number(raw); if(!Number.isFinite(price)||price<minBase()){ warnEl.textContent="Enter a bid (≥ "+minBase()+")."; wonBtn.disabled=true; return false; }
    const ok=guardrailOK(price); wonBtn.disabled=!ok; const floor=Math.max(0,(remainingSlots()-1)*minBase()); warnEl.textContent = ok?"":`Guardrail: keep ≥ ${floor} for remaining slots.`; return ok; };
  bidEl.addEventListener("input", validate); validate();
  wonBtn.addEventListener("click", ()=>{ if(!validate()) return; markWon(p.id, Number(bidEl.value)); });
  $("btn-pass")?.addEventListener("click", ()=>{
    const panel=$("passPanel"); if(!panel) return;
    panel.style.display="block"; panel.scrollIntoView({behavior:"smooth", block:"center"});
    wirePassPanelForPlayer(p);
  });
}

function updateHeaderStats(){
  const c=myClub(); const remainingPts=c? toNum(c.budget_left,c.starting_budget||0):0; const remSlots=remainingSlots(); const guardEl=$("guardrail");
  if($("remainingPoints")) $("remainingPoints").textContent=remainingPts;
  if($("remainingSlots")) $("remainingSlots").textContent=remSlots;
  if(guardEl) guardEl.innerHTML = `Guardrail (min per slot): <b>${minBase()}</b>`;
}

function render(){ renderPlayersList(); renderOtherClubsPanel(); renderLiveBid(); renderSelectedSquad(); renderComplianceBar(); updateHeaderStats(); }

/* ============= Pass / Assign ============= */
function wirePassPanelForPlayer(p){
  const input=$("passClubInput"), list=$("clubNames"), amt=$("passBidAmount"), msg=$("passPanelMsg"), btn=$("btn-assign-to-club");
  if(!list) return; const clubs=state.clubs||[];
  list.innerHTML = clubs.map(c=>`<option value="${c.name}"></option>`).join("");
  if(amt) amt.value = $("bidInput")?.value || "";
  if(btn){
    btn.onclick=null; btn.addEventListener("click", ()=>{
      if(msg) msg.textContent="";
      const clubText=(input?.value||"").trim();
      const price=amt?.value||"";
      assignToClubByNameOrSlug(p.id, clubText, price);
    });
  }
}

/* ============= Export ============= */
function exportWonCSV(){
  const won=(state.players||[]).filter(p=>p.status==="won");
  const rows=[["Club","Player Name","Alumni","Phone","Final Bid"]];
  won.forEach(p=>{
    const club=(state.clubs||[]).find(c=>c.slug===p.owner);
    rows.push([club?club.name:(p.owner||""), p.name||"", p.alumni||"", p.phone||"", toNum(p.finalBid,0)]);
  });
  const csv=rows.map(r=>r.map(v=>{
    const s=String(v??""); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}), url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download="auction-won-contacts.csv"; document.body.appendChild(a); a.click(); URL.revokeObjectURL(url); a.remove();
}

/* ============= Settings & Startup ============= */
function recomputeAvailableScorePreview(){
  const total=toNum($("cfgTotalPoints")?.value, state.totalPoints||DEFAULT_TOTAL_POINTS);
  const hrbMap={};
  const preTxt=$("cfgPreName")?.value||"";
  if(preTxt.includes("=")){
    preTxt.split(";").forEach(s=>{
      s=s.trim(); if(!s) return;
      const [n,v]=s.split("=").map(x=>x.trim());
      if(n) hrbMap[n.toLowerCase()]=toNum(v,0);
    });
  }
  const preSum=Object.values(hrbMap).reduce((s,v)=>s+toNum(v,0),0);
  const out=Math.max(0,total-preSum);
  if($("cfgAvailableScore")) $("cfgAvailableScore").textContent=out;
}

function renderClubPreselectedPanel(){
  const root=$("clubPreselectedPanel"); if(!root) return; const clubs=state.clubs||[];
  const lines=clubs.map(c=>{
    const val=Object.entries(state.preselectedByClub?.[c.slug]||{}).map(([n,v])=>`${n}=${v}`).join("; ");
    return `
  <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:8px;">
    <label style="flex:0 0 220px;"><b>${c.name}</b></label>
    <label style="flex:1;">Preselected (Name=Price; Name2=Price)
      <input id="pre_${c.slug}" value="${val}" placeholder="e.g. John WK=1200; Anil=900" />
    </label>
  </div>`;
  }).join("");
  root.innerHTML = lines || `<div class="hint">Clubs will appear here.</div>`;
}

function collectClubPreselectedFromUI(){
  const out={}; (state.clubs||[]).forEach(c=>{
    const el=$("pre_"+c.slug); const txt=el?el.value:""; const map={};
    if(String(txt||"").includes("=")){
      txt.split(";").forEach(s=>{
        s=s.trim(); if(!s) return;
        const [n,v]=s.split("=").map(x=>x.trim());
        if(n) map[n.toLowerCase()]=toNum(v,0);
      });
    }
    out[c.slug]=map;
  });
  return out;
}

function wireCsvImportUI(){
  const urlEl=$("csvUrl"), pasteEl=$("csvPaste");
  const btnFetch=$("btn-fetch"), btnImport=$("btn-import");
  const btnClearUrl=$("btn-clear-url"), btnClearPaste=$("btn-clear-paste");
  const setMsg=(t)=>{ const m=$("importMsg"); if(m) m.textContent=t; };

  if(btnFetch&&urlEl){
    btnFetch.onclick=null; btnFetch.addEventListener("click", async()=>{
      try{
        setMsg("");
        const url=(urlEl.value||"").trim(); if(!url){ setMsg("Enter a Google Sheet CSV URL"); return; }
        const resp=await fetch(url,{cache:"no-store"}); if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text=await resp.text(); if(pasteEl) pasteEl.value=text;
        setMsg("Fetched CSV — click Import to load players.");
      }catch(e){ console.error(e); setMsg("Fetch failed. Ensure sheet is 'Published to the web' and URL ends with output=csv."); }
    });
  }
  if(btnImport&&pasteEl){
    btnImport.onclick=null; btnImport.addEventListener("click", ()=>{
      try{
        setMsg("");
        const raw=pasteEl.value||""; if(!raw.trim()){ setMsg("Paste CSV first or use Fetch CSV."); return; }
        let players=parseCSVPlayers(raw);
        if(!players.length){ setMsg("Could not parse. Ensure headers match the master template."); return; }
        state.players=players.map(p=>({ ...p, status: p.status==="won"?"won":"new" }));
        ensureDefaultClubsSeeded(); recomputeBudgetsFromWins(); persist(); render();
        setMsg(`Imported ${players.length} players.`);
        $("playersList")?.scrollIntoView({behavior:"smooth", block:"start"});
      }catch(e){ console.error(e); setMsg("Import failed. Check console."); }
    });
  }
  if(btnClearUrl&&urlEl){
    btnClearUrl.onclick=null; btnClearUrl.addEventListener("click", ()=>{ urlEl.value=""; const m=$("importMsg"); if(m) m.textContent=""; });
  }
  if(btnClearPaste&&pasteEl){
    btnClearPaste.onclick=null; btnClearPaste.addEventListener("click", ()=>{ pasteEl.value=""; const m=$("importMsg"); if(m) m.textContent=""; });
  }
}

function wireExportButton(){ const btn=$("btn-export"); if(!btn) return; btn.onclick=null; btn.addEventListener("click", exportWonCSV); }

function wireStartBidUI(){
  const input=$("startName"), menu=$("startResults"), btn=$("btn-start-bid"), seed=$("seedBase");
  if(!input||!menu||!btn) return;
  function candidates(q){ q=(q||"").trim().toLowerCase(); if(q.length<2) return []; return (state.players||[]).filter(p=>p.status!=="won").filter(p=> (p.name||"").toLowerCase().includes(q) || (p.alumni||"").toLowerCase().includes(q)).slice(0,10); }
  input.addEventListener("input", ()=>{
    const list=candidates(input.value);
    if(!list.length){ menu.style.display="none"; menu.innerHTML=""; return; }
    menu.style.display="block";
    menu.innerHTML=list.map(p=>`<div class="ta-item" data-id="${p.id}">${p.name}${p.alumni?" · "+p.alumni:""}</div>`).join("");
    $$(".ta-item",menu).forEach(el=>{
      el.addEventListener("click", ()=>{
        const id=el.getAttribute("data-id");
        setActivePlayer(id); menu.style.display="none";
        if(seed){ const player=state.players.find(x=>x.id===id); seed.value = Number.isFinite(player?.base_point)?player.base_point:(Number.isFinite(player?.base)?player.base:""); }
      });
    });
  });
  btn.addEventListener("click", ()=>{
    const q=(input.value||"").trim().toLowerCase(); if(!q) return;
    const rem=(state.players||[]).filter(p=>p.status!=="won");
    const exact = rem.find(p=>(p.name||"").toLowerCase()===q || (((p.name||"")+" "+(p.alumni||"")).toLowerCase()===q)) || rem.find(p=>(p.name||"").toLowerCase().startsWith(q));
    if(exact){
      setActivePlayer(exact.id);
      if(seed){ seed.value = Number.isFinite(exact.base_point)?exact.base_point:(Number.isFinite(exact.base)?exact.base:""); }
    }
  });
}

function wireLoginUI(){
  const view=$("loginView"), btn=$("btn-login"), u=$("loginUser"), p=$("loginPass"), err=$("loginError");
  if(!view||!btn) return;
  show(view,!state.auth.loggedIn);
  show($("settingsView"),false);
  show($("appMain"),state.auth.loggedIn);
  btn.onclick=null; btn.addEventListener("click", ()=>{
    const user=(u?.value||"").trim(), pass=(p?.value||"").trim();
    if(user!=="HRB"||pass!=="sandeep"){ if(err) err.textContent="Invalid credentials."; return; }
    state.auth={loggedIn:true,user:"HRB"}; persist();
    show(view,false); show($("settingsView"),true); show($("appMain"),false);
  });
}

function wireSettingsUI(){
  const btn=$("btn-save-settings"); if(!btn) return;
  const playersCap=$("cfgPlayersCap"), totalPts=$("cfgTotalPoints"), guardMin=$("cfgGuardMin");
  const preTxt=$("cfgPreName"), preSingle=$("cfgPreBid");
  ["cfgTotalPoints","cfgPreName"].forEach(id=>{ $(id)?.addEventListener("input", recomputeAvailableScorePreview); });
  renderClubPreselectedPanel();
  recomputeAvailableScorePreview();

  btn.onclick=null; btn.addEventListener("click", ()=>{
    state.playersNeeded = toNum(playersCap?.value, DEFAULT_PLAYERS_CAP);
    state.totalPoints = toNum(totalPts?.value, DEFAULT_TOTAL_POINTS);
    state.minBasePerPlayer = toNum(guardMin?.value, DEFAULT_MIN_BASE);

    // HRB preselected (optional)
    const my = {};
    const text=(preTxt?.value||"").trim();
    if(text.includes("=")){
      text.split(";").forEach(s=>{
        s=s.trim(); if(!s) return;
        const [n,v]=s.split("=").map(x=>x.trim());
        if(n) my[n.toLowerCase()]=toNum(v,0);
      });
    } else if (text && preSingle?.value){
      my[text.toLowerCase()] = toNum(preSingle.value,0);
    }
    // Other clubs preselected
    state.preselectedByClub = collectClubPreselectedFromUI();

    // apply preselected to budget (all clubs)
    ensureDefaultClubsSeeded();
    (state.clubs||[]).forEach(c=>{
      const map = (c.slug===state.myClubSlug) ? my : (state.preselectedByClub?.[c.slug]||{});
      const sum = Object.values(map).reduce((s,v)=>s+toNum(v,0),0);
      c.starting_budget = state.totalPoints;
      c.budget_left = Math.max(0, c.starting_budget - sum);
      // also mark players as won if found in sheet
      Object.keys(map).forEach(nameLC=>{
        const player=(state.players||[]).find(pp=> (pp.name||"").toLowerCase()===nameLC);
        if(player && player.status!=="won"){
          player.status="won"; player.finalBid=toNum(map[nameLC],0); player.owner=c.slug;
        }
      });
    });

    persist();
    show($("settingsView"),false); show($("appMain"),true);
    render();
  });
}

function wireLogout(){
  const btn=$("btn-logout"); if(!btn) return;
  btn.onclick=null; btn.addEventListener("click", ()=>{
    // Full reset to initial (fresh auction)
    state = {
      players: [],
      auth: { loggedIn: false, user: null },
      playersNeeded: DEFAULT_PLAYERS_CAP,
      totalPoints: DEFAULT_TOTAL_POINTS,
      minBasePerPlayer: DEFAULT_MIN_BASE,
      categoryBase: { c1: null, c2: null, c3: null, c4: null, c5: null },
      preselectedByClub: {},
      myClubSlug: "high-range-blasters",
      clubs: [],
      activePlayerId: null,
    };
    localStorage.removeItem("hrb-auction-state");
    persist();
    show($("appMain"),false); show($("settingsView"),false); show($("loginView"),true);
  });
}

/* ============= Boot ============= */
function boot(){
  load();
  ensureDefaultClubsSeeded();

  // Initial view routing
  show($("loginView"), !state.auth.loggedIn);
  show($("settingsView"), state.auth.loggedIn && (state.players||[]).length===0);
  show($("appMain"), state.auth.loggedIn && (state.players||[]).length>0);

  wireLoginUI();
  wireSettingsUI();
  wireCsvImportUI();
  wireExportButton();
  wireStartBidUI();
  wireLogout();

  // Failsafe: if all hidden, decide by auth
  (function ensureVisible() {
    const login = document.getElementById('loginView');
    const settings = document.getElementById('settingsView');
    const app = document.getElementById('appMain');
    const allHidden = [login, settings, app].every(el => !el || getComputedStyle(el).display === 'none');
    if (allHidden) {
      const st = JSON.parse(localStorage.getItem('hrb-auction-state')||'{}');
      const loggedIn = !!(st.auth && st.auth.loggedIn);
      if (login) login.style.display = loggedIn ? 'none' : '';
      if (settings) settings.style.display = loggedIn ? ( (st.players||[]).length? 'none' : '' ) : 'none';
      if (app) app.style.display = loggedIn ? ( (st.players||[]).length? '' : 'none' ) : 'none';
      console.warn('[hrb] All views were hidden; applied failsafe.');
    }
  })();

  if (state.auth.loggedIn && (state.players||[]).length>0) render();
  console.log("boot()");
}
document.addEventListener("DOMContentLoaded", boot);
