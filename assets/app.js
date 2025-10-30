// KEEP just this one from supabaseClient.js
import {
  sb,
  fetchClubs,
  createClubDB,
  updateClubDB,
  deleteClubDB,
  adjustBudgetDB,
  onClubsRealtime,
  loadConstraintsFromSupabase,
  loadSettingsFromSupabase
} from "./supabaseClient.js";


import {
  STORAGE_KEY,
  SAMPLE_CSV,
  parseCSV,
  shuffle,
  csvExport,
  toNum,
  categoryFromRank
} from "./utils.js";

import {
  DEFAULT_CONSTRAINTS,
  evaluateRosterCompliance,
  computeValueScore,
  tierFromScore
} from "./constraints.js";



// -------- Auth ----------
const AUTH_USER = "HRB";
const AUTH_PASS = "sandeep";

// -------- State ----------
let state = {
  // data
  players: [],
  queue: [],
  totalPoints: 15000,
  playersNeeded: 15,
  minBasePerPlayer: 500, // guardrail per remaining slot (defaults to Cat5)
  activeId: null,
  log: [],
  constraints: DEFAULT_CONSTRAINTS,

 catBase: { c1:1500, c2:1200, c3:900, c4:700, c5:500 },

  // auth/setup
  auth: { loggedIn: false },
  setup: {
    done: false,
    playersCap: 15,
    overallPoints: 15000,
    catBase: { c1:1500, c2:1200, c3:900, c4:700, c5:500 },
    guardMin: 0,
    preselectedName: "",
    preselectedBid: 0
  },

  // ✅ clubs & ownership (keep these INSIDE)
  myClubSlug: "high-range-blasters",
  clubs: [] // HRB is auto-seeded in load() via ensureMyClubSeeded()
};
  
 
// -------- DOM ----------
const $ = s => document.querySelector(s);
// Views
const appMain = $("#appMain");
const loginView = $("#loginView");
const settingsView = $("#settingsView");

// Login
const loginUser = $("#loginUser");
const loginPass = $("#loginPass");
const loginError = $("#loginError");
$("#btn-login")?.addEventListener("click", onLogin);
$("#btn-logout")?.addEventListener("click", onLogout);

// Settings inputs
const cfgPlayersCap = $("#cfgPlayersCap");
const cfgTotalPoints = $("#cfgTotalPoints");
const cfgBaseC1 = $("#cfgBaseC1");
const cfgBaseC2 = $("#cfgBaseC2");
const cfgBaseC3 = $("#cfgBaseC3");
const cfgBaseC4 = $("#cfgBaseC4");
const cfgBaseC5 = $("#cfgBaseC5");
const cfgGuardMin = $("#cfgGuardMin");
const cfgPreName = $("#cfgPreName");
const cfgPreBid = $("#cfgPreBid");
const cfgAvailableScore = $("#cfgAvailableScore");
const settingsError = $("#settingsError");
$("#btn-save-settings")?.addEventListener("click", onSaveSettings);
[cfgPlayersCap,cfgTotalPoints,cfgBaseC1,cfgBaseC2,cfgBaseC3,cfgBaseC4,cfgBaseC5,cfgGuardMin,cfgPreName,cfgPreBid]
  .forEach(el => el?.addEventListener("input", updateAvailableScorePreview));

// Left controls
$("#totalPoints")?.addEventListener("change", e => { state.totalPoints = toNum(e.target.value, state.totalPoints); persist(); render(); });
$("#playersNeeded")?.addEventListener("change", e => { state.playersNeeded = toNum(e.target.value, state.playersNeeded); persist(); render(); });
$("#minBasePerPlayer")?.addEventListener("change", e => { state.minBasePerPlayer = toNum(e.target.value, state.minBasePerPlayer); persist(); render(); });
$("#btn-shuffle")?.addEventListener("click", () => randomizeQueue());
$("#btn-next")?.addEventListener("click", () => nextPlayer());
$("#btn-undo")?.addEventListener("click", () => undo());

// Import
const csvUrlEl = $("#csvUrl");
const csvPasteEl = $("#csvPaste");
$("#btn-fetch")?.addEventListener("click", () => importFromCsvUrl());
$("#btn-clear-url")?.addEventListener("click", () => { csvUrlEl.value = ""; });
$("#btn-import")?.addEventListener("click", () => importFromPaste());
$("#btn-clear-paste")?.addEventListener("click", () => { csvPasteEl.value = ""; });

// Stats/Right/Middle
const remainingPointsEl = $("#remainingPoints");
const remainingSlotsEl = $("#remainingSlots");
const guardrailEl = $("#guardrail");
const playersListEl = $("#playersList");
const playersCountEl = $("#playersCount");
const complianceBarEl = $("#complianceBar");
const liveBidEl = $("#liveBid");
const selectedListEl = $("#selectedList");

// Typeahead
const startNameEl = $("#startName");
const startResultsEl = $("#startResults");
const seedBaseEl = $("#seedBase");
const btnStartBid = $("#btn-start-bid");
startNameEl?.addEventListener("input", onTypeahead);
btnStartBid?.addEventListener("click", onSetActiveFromTypeahead);

// Header buttons
$("#btn-export")?.addEventListener("click", () => exportWon());
$("#btn-reset")?.addEventListener("click", () => { localStorage.removeItem(STORAGE_KEY); location.reload(); });

// -------- Init ----------
load();
routeViews();

(async () => {
  if (state.auth.loggedIn && state.setup.done) {
    await ensureMyClubSeeded(); // pulls DB, seeds HRB if missing
    render();
    warmloadSupabase(); // your existing optional loader

    // Realtime: refresh clubs on any DB change
    onClubsRealtime(async () => {
      try {
        state.clubs = await fetchClubs();
        render();
      } catch {}
    });
  }
})();

// -------- Routing ----------
function routeViews(){
  const logged = !!state.auth.loggedIn;
  const setupDone = !!state.setup.done;
  $("#btn-logout").style.display = logged ? "inline-block" : "none";

  if (!logged) {
    show(loginView); hide(settingsView); hide(appMain);
    loginUser.value = AUTH_USER; loginPass.value = AUTH_PASS; loginError.textContent = "";
    return;
  }
  if (logged && !setupDone){
    // Prefill
    cfgPlayersCap.value = state.setup.playersCap;
    cfgTotalPoints.value = state.setup.overallPoints;
    cfgBaseC1.value = state.setup.catBase.c1;
    cfgBaseC2.value = state.setup.catBase.c2;
    cfgBaseC3.value = state.setup.catBase.c3;
    cfgBaseC4.value = state.setup.catBase.c4;
    cfgBaseC5.value = state.setup.catBase.c5;
    cfgGuardMin.value = state.setup.guardMin || "";
    cfgPreName.value = state.setup.preselectedName || "";
    cfgPreBid.value = state.setup.preselectedBid || 0;
    updateAvailableScorePreview();
    show(settingsView); hide(loginView); hide(appMain);
    return;
  }
  show(appMain); hide(loginView); hide(settingsView);
}
function show(el){ if (el) el.style.display = ""; }
function hide(el){ if (el) el.style.display = "none"; }

// -------- Auth ----------
function onLogin(){
  const u = (loginUser.value || "").trim();
  const p = (loginPass.value || "").trim();
  if (u === AUTH_USER && p === AUTH_PASS) {
    state.auth.loggedIn = true; persist(); routeViews();
  } else {
    loginError.textContent = "Invalid username or password.";
  }
}
function onLogout(){ state.auth.loggedIn = false; persist(); routeViews(); }

// -------- Preselected helpers ----------
function parsePreselectedInput(rawNameField, singleBidField) {
  const s = (rawNameField || "").trim();
  if (!s) return [];
  const looksLikeList = /[=;]/.test(s) || (s.includes(",") && s.includes("="));
  if (looksLikeList) {
    return s.split(/[;,]/g).map(x => x.trim()).filter(Boolean).map(pair => {
      const [n, b] = pair.split("=").map(z => (z ?? "").trim());
      return { name: n, bid: Number(b) || 0 };
    }).filter(x => x.name);
  }
  return [{ name: s, bid: Number(singleBidField) || 0 }];
}
function applyPreselected(preList, players) {
  const applied = []; const missing = [];
  const next = players.map(p => ({ ...p }));
  preList.forEach(entry => {
    const target = next.find(x => (x.name || "").trim().toLowerCase() === entry.name.trim().toLowerCase());
    if (target) {
      if (target.status !== "won") { target.status="won"; target.finalBid = Math.max(0, Number(entry.bid)||0); }
      applied.push({ name: target.name, bid: target.finalBid||0 });
    } else missing.push(entry.name);
  });
  return { playersUpdated: next, applied, missing };
}
function reapplyPreselectedIfAny() {
  const preList = parsePreselectedInput(state.setup.preselectedName, state.setup.preselectedBid);
  if (!preList.length) return;
  const { playersUpdated } = applyPreselected(preList, state.players);
  state.players = playersUpdated;
}

// -------- Settings ----------
function updateAvailableScorePreview(){
  const total = toNum(cfgTotalPoints.value, 15000);
  const preList = parsePreselectedInput(cfgPreName.value, cfgPreBid.value);
  const preTotal = preList.reduce((t, x) => t + Math.max(0, Number(x.bid) || 0), 0);
  cfgAvailableScore.textContent = Math.max(0, total - preTotal);
}
function onSaveSettings(){
  settingsError.textContent = "";
  const playersCap = toNum(cfgPlayersCap.value, 15);
  const overallPoints = toNum(cfgTotalPoints.value, 15000);
  const catBase = {
    c1: toNum(cfgBaseC1.value, 1500),
    c2: toNum(cfgBaseC2.value, 1200),
    c3: toNum(cfgBaseC3.value, 900),
    c4: toNum(cfgBaseC4.value, 700),
    c5: toNum(cfgBaseC5.value, 500),
  };
  const guardMin = toNum(cfgGuardMin.value, 0);
  const preName = (cfgPreName.value || "").trim();
  const preBid = toNum(cfgPreBid.value, 0);

  if (playersCap <= 0 || overallPoints <= 0) { settingsError.textContent = "Enter positive values for players and points."; return; }

  state.setup.playersCap = playersCap;
  state.setup.overallPoints = overallPoints;
  state.setup.catBase = catBase;
  state.setup.guardMin = guardMin;
  state.setup.preselectedName = preName;
  state.setup.preselectedBid = preBid;
  state.setup.done = true;

  state.playersNeeded = playersCap;
  state.totalPoints = overallPoints;
  state.catBase = { ...catBase };
  state.minBasePerPlayer = guardMin > 0 ? guardMin : catBase.c5;

  // Inject category base into players if base is blank/0
  state.players = state.players.map(p => {
    const c = p.category || categoryFromRank(p.rank);
    const catBaseVal = c===1?catBase.c1:c===2?catBase.c2:c===3?catBase.c3:c===4?catBase.c4:catBase.c5;
    return { ...p, category: c, base: p.base>0 ? p.base : catBaseVal };
  });

  // Apply preselected
  const preList = parsePreselectedInput(preName, preBid);
  if (preList.length) {
    const { playersUpdated, missing } = applyPreselected(preList, state.players);
    state.players = playersUpdated;
    if (missing.length) settingsError.textContent = `Not found (will recheck after CSV import): ${missing.join(", ")}`;
  }

  persist(); routeViews(); render();
}

// -------- Load / Save ----------
function load(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
    if (!state.players || !state.players.length){
      state.players = parseCSV(SAMPLE_CSV);
      state.queue = shuffle(state.players.map(p=>p.id));
      state.activeId = null;
    }
  } catch {
    state.players = parseCSV(SAMPLE_CSV);
    state.queue = shuffle(state.players.map(p=>p.id));
    state.activeId = null;
  }
  // reflect controls
  $("#totalPoints").value = state.totalPoints;
  $("#playersNeeded").value = state.playersNeeded;
  $("#minBasePerPlayer").value = state.minBasePerPlayer;
    ensureMyClubSeeded();
  persist();

}
async function warmloadSupabase(){
  const team = "high-range-blasters";
  try {
    const s = await loadSettingsFromSupabase(team);
    if (s) {
      state.totalPoints = s.total_points ?? state.totalPoints;
      state.playersNeeded = s.players_needed ?? state.playersNeeded;
      $("#totalPoints").value = state.totalPoints;
      $("#playersNeeded").value = state.playersNeeded;
    }
    const c = await loadConstraintsFromSupabase(team);
    if (c && c.length) state.constraints = c;
    persist(); render();
  } catch {}
}
function persist(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
// ---------- Clubs helpers ----------
function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

async function ensureMyClubSeeded() {
  // Pull clubs from DB first
  try {
    const dbClubs = await fetchClubs();
    state.clubs = dbClubs;
  } catch (e) {
    console.warn("fetchClubs failed (offline?):", e);
    state.clubs = state.clubs || [];
  }

  // Ensure HRB exists
  const hrbSlug = state.myClubSlug;
  const found = state.clubs.find(c => c.slug === hrbSlug);
  if (!found) {
    const start = state.totalPoints || 15000;
    const hrb = { slug: hrbSlug, name: "High Range Blasters", logo_url: "/assets/highrange.svg", starting_budget: start };
    try {
      await createClubDB(hrb);
      state.clubs = await fetchClubs();
    } catch (e) {
      // fallback to local mirror if DB not available
      state.clubs.push({ id: "local-hrb", slug: hrbSlug, name: "High Range Blasters", logo_url: "/assets/highrange.svg", starting_budget: start, budget_left: start });
    }
  }
  persist();
}
async function addClub({ name, logo, startingBudget }) {
  const slug = slugify(name);
  if (!slug) throw new Error("Club name required.");

  await createClubDB({
    slug,
    name: name.trim(),
    logo_url: (logo || "").trim() || null,
    starting_budget: Math.max(0, Number(startingBudget) || 0)
  });
  state.clubs = await fetchClubs();
  persist();
}

async function editClub({ id, name, logo, startingBudget }) {
  await updateClubDB({
    id,
    name: name?.trim(),
    logo_url: (logo || "").trim(),
    starting_budget: startingBudget != null ? Math.max(0, Number(startingBudget) || 0) : undefined
  });
  state.clubs = await fetchClubs();
  persist();
}

async function removeClub(id) {
  await deleteClubDB(id);
  state.clubs = await fetchClubs();
  persist();
}


function clubStats(slug) {
  const club = state.clubs.find(c => c.slug === slug);
  if (!club) return { club: null, count: 0, spend: 0, budgetLeft: 0, players: [] };
  const players = (state.players || []).filter(p => p.status === "won" && p.owner === slug);
  const spend = players.reduce((s, p) => s + (Number(p.finalBid) || 0), 0);
  const budgetLeft = Math.max(0, (Number(club.startingBudget) || 0) - spend);
  return { club, count: players.length, spend, budgetLeft, players };
}

function renderOtherClubsPanel() {
  const root = document.getElementById("otherClubsPanel");
  if (!root) return;
  const others = (state.clubs || []).filter(c => c.slug !== state.myClubSlug);

  const blocks = others.map(c => {
    const stats = clubStats(c.slug);
    const list = stats.players.length
      ? stats.players.map(p => `
          <div class="item" style="padding:6px 0;border-bottom:1px solid #f3f4f6">
            <div class="title"><b>${p.name}</b></div>
            <div class="meta">#${p.rank} · Cat ${p.category} · ${p.role || ""}</div>
            <div class="meta">Bid: <b>${p.finalBid ?? "-"}</b></div>
          </div>
        `).join("")
      : `<div class="hint">No players yet.</div>`;

    return `
      <div class="card" style="padding:12px">
        <div class="row">
          ${c.logo ? `<img src="${c.logo}" alt="${c.name}" class="brand-logo" style="width:36px;height:36px;border-radius:999px;object-fit:cover;margin-right:8px;" />` : `<div style="width:36px;height:36px;border-radius:999px;background:#e5e7eb;margin-right:8px;"></div>`}
          <div>
            <div class="title"><b>${c.name}</b></div>
            <div class="meta">Players: ${stats.count} • Spend: ${stats.spend} • Budget left: ${stats.budgetLeft}</div>
          </div>
        </div>
        <div style="margin-top:10px; max-height:220px; overflow:auto;">${list}</div>
      </div>
    `;
  }).join("");

  root.innerHTML = blocks || `<div class="hint">Add clubs to see their squads.</div>`;
}

// wire the small "Add Club" card in index.html
(function wireAddClubUI(){
  const btn = document.getElementById("btn-create-club");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const name = (document.getElementById("club-name")?.value || "").trim();
    const logo = (document.getElementById("club-logo")?.value || "").trim();
    const budget = (document.getElementById("club-budget")?.value || "").trim();
    const msg = document.getElementById("club-create-msg");
    try {
      addClub({ name, logo, startingBudget: budget });
      if (msg) msg.textContent = "Club created.";
      if (document.getElementById("club-name")) document.getElementById("club-name").value = "";
      if (document.getElementById("club-logo")) document.getElementById("club-logo").value = "";
      if (document.getElementById("club-budget")) document.getElementById("club-budget").value = "";
      renderOtherClubsPanel();
    } catch (e) {
      if (msg) msg.textContent = "Error: " + (e?.message || e);
    }
  });
})();

// -------- Derived ----------
function remainingSlots(){ return Math.max(0, state.playersNeeded - state.players.filter(p=>p.status==="won").length); }
function spentPoints(){ return state.players.reduce((t,p)=>t + (p.status==="won"?(p.finalBid||0):0),0); }
function remainingPoints(){ return Math.max(0, state.totalPoints - spentPoints()); }
function guardrailOK(afterSpend=0){
  const remAfter = remainingPoints() - afterSpend;
  const slotsAfter = Math.max(0, remainingSlots() - (afterSpend>0?1:0));
  return remAfter >= (slotsAfter * state.minBasePerPlayer);
}

// -------- Queue / Actions ----------
function randomizeQueue(){
  const ids = state.players.filter(p=>p.status==="pending").map(p=>p.id);
  state.queue = shuffle(ids); state.activeId=null; persist(); render();
}
function nextPlayer(){
  if (!state.queue.length){ randomizeQueue(); return; }
  const [head,...rest] = state.queue; state.queue=rest; state.activeId=head; persist(); render();
}
async function markWon(id, bid) {
  const winningBid = Math.max(0, Number(bid) || 0);

  // Update local player
  state.players = state.players.map(p => p.id === id ? { ...p, status: "won", owner: state.myClubSlug, finalBid: winningBid } : p);
  state.log.push({ type: "won", id, bid: winningBid });
  state.activeId = null;
  persist();

  // Adjust HRB budget in DB (best-effort)
  try {
    const hrb = (state.clubs || []).find(c => c.slug === state.myClubSlug);
    if (hrb?.id) await adjustBudgetDB({ club_id: hrb.id, delta: -winningBid });
    // refresh clubs to get updated budget_left
    state.clubs = await fetchClubs();
  } catch (e) {
    console.warn("adjustBudgetDB failed:", e);
  }

  render();
}

function markLostToOtherClub(id) {
  const player = state.players.find(p => p.id === id);
  if (!player) return;

  const clubNames = (state.clubs || []).filter(c => c.slug !== state.myClubSlug).map(c => c.name);
  if (!clubNames.length) {
    state.players = state.players.map(p => p.id === id ? { ...p, status: "lost", owner: null, finalBid: undefined } : p);
    state.log.push({ type: "lost", id });
    state.activeId = null; persist(); render(); return;
  }

  const clubName = prompt(`Which club won ${player.name}?\nOptions: ${clubNames.join(", ")}`);
  if (!clubName) { updatePlayer(id, { status: "lost", owner: null }); return; }

  const club = state.clubs.find(c => c.name.toLowerCase().trim() === clubName.toLowerCase().trim());
  if (!club) { alert("Club not found. Type the exact name."); return; }

  const amtRaw = prompt(`Winning price for ${player.name} (by ${club.name})?`, String(player.base || ""));
  const finalBid = Math.max(0, Number(amtRaw) || 0);

  state.players = state.players.map(p => p.id === id ? { ...p, status: "won", owner: club.slug, finalBid } : p);
  state.log.push({ type: "lost", id, owner: club.slug, finalBid });
  state.activeId = null; persist(); render();
}


function undo(){
  const last = state.log.pop(); if (!last) return;
  if (last.type==="won"){
    state.players = state.players.map(p=>p.id===last.id?{...p,status:"pending",finalBid:undefined}:p);
  } else {
    state.players = state.players.map(p=>p.id===last.id?{...p,status:"pending"}:p);
  }
  persist(); render();
}
function updatePlayer(id, patch){ state.players = state.players.map(p=>p.id===id?{...p,...patch}:p); persist(); render(); }

// -------- Import / Export ----------
async function importFromCsvUrl(){
  const url = (csvUrlEl?.value||"").trim();
  if (!url){ alert("CSV URL is empty."); return; }
  try {
    const res = await fetch(url); const txt = await res.text(); const arr = parseCSV(txt);
    if (!arr.length){ alert("No rows found in CSV."); return; }
    state.players = arr.map(p=>{
      const c = p.category || categoryFromRank(p.rank);
      const baseVal = c===1?state.catBase.c1:c===2?state.catBase.c2:c===3?state.catBase.c3:c===4?state.catBase.c4:state.catBase.c5;
      return { ...p, category:c, base: p.base>0?p.base:baseVal };
    });
    reapplyPreselectedIfAny();
    state.queue = shuffle(state.players.filter(p=>p.status==="pending").map(p=>p.id));
    state.activeId = null; persist(); render();
  } catch(e){ alert("Failed to fetch CSV: "+e); }
}
function importFromPaste(){
  const txt = (csvPasteEl?.value||"").trim();
  if (!txt){ alert("Paste CSV is empty."); return; }
  try {
    const arr = parseCSV(txt);
    if (!arr.length){ alert("No rows found in CSV."); return; }
    state.players = arr.map(p=>{
      const c = p.category || categoryFromRank(p.rank);
      const baseVal = c===1?state.catBase.c1:c===2?state.catBase.c2:c===3?state.catBase.c3:c===4?state.catBase.c4:state.catBase.c5;
      return { ...p, category:c, base: p.base>0?p.base:baseVal };
    });
    reapplyPreselectedIfAny();
    state.queue = shuffle(state.players.filter(p=>p.status==="pending").map(p=>p.id));
    state.activeId = null; persist(); render();
  } catch(e){ alert("Parse error: "+e); }
}
function exportWon(){
  const won = state.players.filter(p=>p.status==="won");
  if (!won.length){ alert("No players won yet."); return; }
  const rows = won.map(p=>({
    name:p.name, rank:p.rank, category:p.category, role:p.role,
    rating10:p.rating10, finalBid:p.finalBid, alumni:p.alumni||"", age:p.age||""
  }));
  const csv = csvExport(rows);
  const blob = new Blob([csv],{type:"text/csv"}); const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download="hrb_roster.csv"; a.click(); URL.revokeObjectURL(url);
}

// -------- Typeahead (Start Bid) ----------
function onTypeahead(){
  const q = (startNameEl.value||"").trim().toLowerCase();
  if (q.length < 3){ startResultsEl.style.display="none"; startResultsEl.innerHTML=""; return; }
  const matches = state.players
    .filter(p => p.status==="pending" && (p.name||"").toLowerCase().includes(q))
    .sort((a,b)=>a.rank-b.rank)
    .slice(0,12);
  if (!matches.length){ startResultsEl.style.display="none"; startResultsEl.innerHTML=""; return; }
  const list = document.createElement("div"); list.className = "ta-list";
  list.innerHTML = matches.map(p=>{
    const cat = p.category || categoryFromRank(p.rank);
    return `<div class="ta-item" data-id="${p.id}">
      <b>${p.name}</b> <span class="ta-muted">#${p.rank} · Cat ${cat} · ${p.role}</span>
    </div>`;
  }).join("");
  startResultsEl.innerHTML = ""; startResultsEl.appendChild(list);
  startResultsEl.style.display = "";
  list.querySelectorAll(".ta-item").forEach(el=>{
    el.addEventListener("click", ()=>{
      const id = el.getAttribute("data-id");
      const p = state.players.find(x=>x.id===id);
      if (!p) return;
      state.activeId = p.id;
      const cat = p.category || categoryFromRank(p.rank);
      const baseVal = p.base>0 ? p.base :
        (cat===1?state.catBase.c1:cat===2?state.catBase.c2:cat===3?state.catBase.c3:cat===4?state.catBase.c4:state.catBase.c5);
      seedBaseEl.value = baseVal;
      startResultsEl.style.display="none"; startResultsEl.innerHTML="";
      persist(); render();
    });
  });
}
function onSetActiveFromTypeahead(){
  const q = (startNameEl.value||"").trim().toLowerCase();
  const p = state.players.find(x => x.status==="pending" && (x.name||"").toLowerCase()===q);
  if (!p){ alert("Pick from dropdown first (click on the exact player)."); return; }
  state.activeId = p.id;
  const cat = p.category || categoryFromRank(p.rank);
  const baseVal = p.base>0 ? p.base :
    (cat===1?state.catBase.c1:cat===2?state.catBase.c2:cat===3?state.catBase.c3:cat===4?state.catBase.c4:state.catBase.c5);
  seedBaseEl.value = baseVal;
  persist(); render();
}

// -------- Render ----------
function render(){
  if (!appMain || appMain.style.display==="none") return;

  remainingPointsEl.textContent = remainingPoints();
  remainingSlotsEl.textContent = remainingSlots();
  guardrailEl.classList.toggle("danger", !guardrailOK(0));
  guardrailEl.innerHTML = `Guardrail: <b>${guardrailOK(0) ? "OK" : "At Risk"}</b>`;

  playersCountEl.textContent = `(${state.players.length})`;
  renderCompliance();
  renderPlayersList();
  renderLiveBid();
  renderSelectedList();
    renderOtherClubsPanel();

}

function renderCompliance(){
  const c = evaluateRosterCompliance(state.players, state.constraints);
  const ok = c.allMinOk;
  complianceBarEl.className = "compliance " + (ok ? "ok" : "warn");
  complianceBarEl.innerHTML = `
    <div class="row" style="justify-content:space-between; margin-bottom:6px;">
      <div><b>Roster Requirements</b></div>
      <div>${ok ? "On Track" : "Incomplete"}</div>
    </div>
    ${c.results.map(r => `
      <div class="comp-row">
        <div>${r.role || "Any"}${r.batting_hand ? " · " + r.batting_hand + "-hand" : ""}${r.is_wk ? " · Wicket Keeper" : ""}</div>
        <div><b>${r.count}</b> / min ${r.min_count ?? 0}${typeof r.max_count === "number" ? ` (max ${r.max_count})` : ""}</div>
      </div>
    `).join("")}
  `;
}

function renderPlayersList(){
  playersListEl.innerHTML = "";
  const withScores = state.players.map(p => ({ ...p, valueScore: computeValueScore(p, state.players, state.constraints) }));
  withScores.forEach(p => {
    const tier = tierFromScore(p.valueScore);
    const div = document.createElement("div");
    div.className = "item " + (p.status !== "pending" ? "disabled" : "");
    div.innerHTML = `
      <div class="title">
        <div><b>${p.name}</b></div>
        <div class="${tier.class}"><span>${tier.label}</span><span>•</span><span>${p.valueScore.toFixed(1)}</span></div>
      </div>
      <div class="meta">
        #${p.rank} • Cat ${p.category} • ${p.role} • Rating10 ${p.rating10 ?? 0} • Base ${p.base}
        ${p.is_wk ? " • WK" : ""}${p.batting_hand ? " • " + p.batting_hand + "-hand" : ""}
        ${p.alumni ? " • " + p.alumni : ""}${p.age ? " • Age " + p.age : ""}
      </div>
      <div class="row" style="margin-top:6px;">
        <button class="btn btn-ghost" data-action="set-active">Set Active</button>
        ${p.status === "pending" ? `<button class="btn btn-ghost" data-action="mark-lost">Mark Lost</button>` : `<button class="btn btn-ghost" data-action="reopen">Reopen</button>`}
        ${p.status === "won" ? `<span style="margin-left:auto;font-size:12px;color:#475569">Final: <b>${p.finalBid}</b></span>` : ""}
      </div>
      <div class="info-grid" style="margin-top:6px;">
        <label class="info"><div class="k">Base</div><input data-edit="base" value="${p.base}" /></label>
        <label class="info"><div class="k">Rating10</div><input data-edit="rating10" value="${p.rating10 ?? 0}" /></label>
        <label class="info"><div class="k">Role</div><input data-edit="role" value="${p.role}" /></label>
      </div>
    `;
    div.querySelector("[data-action='set-active']")?.addEventListener("click", () => { state.activeId = p.id; seedBaseEl.value = p.base; persist(); render(); });
   div.querySelector("[data-action='mark-lost']")?.addEventListener("click", () => markLostToOtherClub(p.id));

    div.querySelector("[data-action='reopen']")?.addEventListener("click", () => updatePlayer(p.id, { status:"pending", finalBid: undefined }));

    div.querySelector("[data-edit='base']")?.addEventListener("change", e => updatePlayer(p.id, { base: toNum(e.target.value, p.base) }));
    div.querySelector("[data-edit='rating10']")?.addEventListener("change", e => updatePlayer(p.id, { rating10: toNum(e.target.value, p.rating10) }));
    div.querySelector("[data-edit='role']")?.addEventListener("change", e => updatePlayer(p.id, { role: String(e.target.value||p.role) }));

    playersListEl.appendChild(div);
  });
}

function renderLiveBid(){
  const p = state.players.find(x => x.id === state.activeId);
  if (!p) { liveBidEl.innerHTML = `<div class="hint">Pick a player via Start Bid above or click <b>Next Player</b>.</div>`; return; }

  const score = computeValueScore(p, state.players, state.constraints);
  const tier = tierFromScore(score);

  const basic = [`#${p.rank} · Cat ${p.category}`, p.role, `Rating10 ${p.rating10 ?? 0}`, p.is_wk?"WK":null, p.batting_hand?`${p.batting_hand}-hand`:null]
    .filter(Boolean).join(" • ");
  const extra = [p.alumni?`Alumni: ${p.alumni}`:null, p.dob?`DOB: ${p.dob}`:null, p.age?`Age: ${p.age}`:null].filter(Boolean).join(" • ");

  liveBidEl.innerHTML = `
    <div class="item">
      <div class="title">
        <div>
          <div style="font-size:18px;font-weight:600">${p.name}</div>
          <div class="meta">${basic}</div>
          ${extra ? `<div class="meta" style="margin-top:2px">${extra}</div>` : ``}
        </div>
        <div class="${tier.class}"><span>${tier.label}</span><span>•</span><span>${score.toFixed(1)}</span></div>
      </div>

      <div class="info-grid" style="margin-top:8px;">
        <div class="info"><div class="k">Base (cat/sheet)</div><div class="v">${p.base}</div></div>
        <div class="info"><div class="k">Value Score</div><div class="v">${score.toFixed(1)}</div></div>
      </div>

      <div class="row" style="margin-top:8px;">
        <label style="flex:1">Your Bid
          <input type="number" id="yourBid" value="${p.base}" />
          <div id="guardWarn" class="hint"></div>
        </label>
        <div class="col">
          <button id="btn-bid-base" class="btn">Bid Base</button>
          <button id="btn-plus10" class="btn btn-ghost">+10</button>
        </div>
      </div>

      <div class="row" style="margin-top:8px;">
        <button id="btn-mark-won" class="btn">Mark Won</button>
        <button id="btn-pass" class="btn btn-ghost">Pass</button>
        <button id="btn-skip" class="btn btn-ghost">Skip / Next</button>
      </div>
    </div>
  `;
// Show pass panel for assignment
const passPanel = document.getElementById("passPanel");
const passClubInput = document.getElementById("passClubInput");
const passBidAmount = document.getElementById("passBidAmount");
const passPanelMsg = document.getElementById("passPanelMsg");
const datalist = document.getElementById("clubNames");

if (passPanel && passClubInput && passBidAmount && datalist) {
  passPanel.style.display = "";
  passBidAmount.value = String(p.base || 0);

  // Populate datalist with other clubs (exclude HRB)
  const others = (state.clubs || []).filter(c => c.slug !== state.myClubSlug);
  datalist.innerHTML = others.map(c => `<option value="${c.name}"></option>`).join("");

  document.getElementById("btn-assign-to-club")?.addEventListener("click", async () => {
    const clubName = (passClubInput.value || "").trim();
    const club = others.find(c => c.name.toLowerCase() === clubName.toLowerCase());
    if (!club) { passPanelMsg.textContent = "Pick a valid club from the list."; return; }

    const winningBid = Math.max(0, Number(passBidAmount.value) || 0);

    // Local update
    state.players = state.players.map(x => x.id === p.id ? ({ ...x, status: "won", owner: club.slug, finalBid: winningBid }) : x);
    state.log.push({ type: "lost", id: p.id, owner: club.slug, bid: winningBid });
    state.activeId = null;
    persist();

    // DB budget adjust (best-effort)
    try {
      if (club.id) await adjustBudgetDB({ club_id: club.id, delta: -winningBid });
      state.clubs = await fetchClubs();
    } catch(e) {
      console.warn("adjustBudgetDB (other club) failed:", e);
    }

    render();
  });
} else {
  if (passPanel) passPanel.style.display = "none";
}

  const bidInput = document.getElementById("yourBid");
  const warn = document.getElementById("guardWarn");
  function validate(){
    const bid = toNum(bidInput.value, p.base);
    const ok = guardrailOK(bid);
    warn.textContent = ok ? "" : `Warning: this bid risks future slots — keep ≥ ${Math.max(0,(remainingSlots()-1)*state.minBasePerPlayer)}`;
    return ok;
  }
  validate();
  document.getElementById("btn-bid-base")?.addEventListener("click", ()=>{ bidInput.value = p.base; validate(); });
  document.getElementById("btn-plus10")?.addEventListener("click", ()=>{ bidInput.value = String(Math.max(p.base, toNum(bidInput.value, p.base)+10)); validate(); });
  document.getElementById("btn-mark-won")?.addEventListener("click", ()=>{
    const bid = toNum(bidInput.value, p.base);
    if (!guardrailOK(bid)) { alert("Guardrail violated. Reduce bid."); return; }
    markWon(p.id, bid);
  });
  document.getElementById("btn-pass")?.addEventListener("click", () => {
  // Just ensure the passPanel is visible; assignment happens via its "Assign" button
  const passPanel = document.getElementById("passPanel");
  if (passPanel) passPanel.scrollIntoView({ behavior: "smooth", block: "center" });
});


  document.getElementById("btn-skip")?.addEventListener("click", ()=> nextPlayer());
}

function renderSelectedList(){
  const won = state.players.filter(p=>p.status==="won").sort((a,b)=>(b.finalBid||0)-(a.finalBid||0));
  if (!won.length){ selectedListEl.innerHTML = `<div class="hint">No players selected yet.</div>`; return; }
  selectedListEl.innerHTML = won.map(p=>{
    const l1 = `${p.name} — #${p.rank} · Cat ${p.category} · ${p.role}${p.is_wk?" (WK)":""}`;
    const l2 = [`Rating10 ${p.rating10 ?? 0}`, p.alumni?`Alumni: ${p.alumni}`:null, p.age?`Age: ${p.age}`:null, `Bid: ${p.finalBid}`]
      .filter(Boolean).join(" • ");
    return `<div class="item">
      <div class="title"><div><b>${l1}</b></div></div>
      <div class="meta">${l2}</div>
    </div>`;
  }).join("");
}
