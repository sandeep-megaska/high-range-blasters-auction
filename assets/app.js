// assets/app.js — Full file
import {
  STORAGE_KEY,
  SAMPLE_CSV,
  parseCSV,
  shuffle,
  csvExport,
  toNum
} from "./utils.js";

import {
  DEFAULT_CONSTRAINTS,
  evaluateRosterCompliance,
  computeValueScore,
  tierFromScore
} from "./constraints.js";

import {
  loadConstraintsFromSupabase,
  loadSettingsFromSupabase
} from "./supabaseClient.js";
// --- Preselected parsing & application helpers ---
function parsePreselectedInput(rawNameField, singleBidField) {
  const s = (rawNameField || "").trim();
  if (!s) return [];

  // If user entered "Name1=1200; Name2=900" (or comma separated), parse pairs.
  const looksLikeList = /[=;]/.test(s) || (s.includes(",") && s.includes("="));
  if (looksLikeList) {
    return s
      .split(/[;,]/g)
      .map(x => x.trim())
      .filter(Boolean)
      .map(pair => {
        const [n, b] = pair.split("=").map(z => (z ?? "").trim());
        return { name: n, bid: Number(b) || 0 };
      })
      .filter(x => x.name);
  }
  // Single name → use the single bid box
  const singleBid = Number(singleBidField) || 0;
  return [{ name: s, bid: singleBid }];
}

function applyPreselected(preList, players) {
  // returns { playersUpdated, applied:[], missing:[] }
  const applied = [];
  const missing = [];
  const next = players.map(p => ({ ...p })); // shallow clone

  preList.forEach(entry => {
    const target = next.find(
      x => (x.name || "").trim().toLowerCase() === entry.name.trim().toLowerCase()
    );
    if (target) {
      if (target.status !== "won") {
        target.status = "won";
        target.finalBid = Math.max(0, Number(entry.bid) || 0);
        applied.push({ name: target.name, bid: target.finalBid });
      } else {
        // already won—leave as is
        applied.push({ name: target.name, bid: target.finalBid || 0 });
      }
    } else {
      missing.push(entry.name);
    }
  });

  return { playersUpdated: next, applied, missing };
}

function reapplyPreselectedIfAny() {
  const preList = parsePreselectedInput(
    state.setup.preselectedName,
    state.setup.preselectedBid
  );
  if (!preList.length) return;

  const { playersUpdated } = applyPreselected(preList, state.players);
  state.players = playersUpdated;
}

// ---------- Auth (hardcoded) ----------
const AUTH_USER = "HRB";
const AUTH_PASS = "sandeep";

// ---------- Global state ----------
let state = {
  // app
  players: [],
  queue: [],
  totalPoints: 1000,
  playersNeeded: 6,
  minBasePerPlayer: 50,
  activeId: null,
  log: [],
  constraints: DEFAULT_CONSTRAINTS,

  // auth + setup
  auth: { loggedIn: false },
  setup: {
    done: false,
    playersCap: 15,
    overallPoints: 15000,
    preselectedName: "",
    preselectedBid: 0
  }
};

// ---------- DOM refs ----------
const $ = (sel) => document.querySelector(sel);

// Views
const appMain = $("#appMain");
const loginView = $("#loginView");
const settingsView = $("#settingsView");

// Login form
const loginUser = $("#loginUser");
const loginPass = $("#loginPass");
const loginError = $("#loginError");
$("#btn-login")?.addEventListener("click", onLogin);

// Settings form
const cfgPlayersCap = $("#cfgPlayersCap");
const cfgTotalPoints = $("#cfgTotalPoints");
const cfgPreName = $("#cfgPreName");
const cfgPreBid = $("#cfgPreBid");
const cfgAvailableScore = $("#cfgAvailableScore");
const settingsError = $("#settingsError");
$("#btn-save-settings")?.addEventListener("click", onSaveSettings);
[cfgPlayersCap, cfgTotalPoints, cfgPreBid]?.forEach(el => {
  el?.addEventListener("input", updateAvailableScorePreview);
});

// Header buttons
$("#btn-logout")?.addEventListener("click", onLogout);
$("#btn-export")?.addEventListener("click", () => exportWon());
$("#btn-reset")?.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

// Controls (left card)
$("#totalPoints")?.addEventListener("change", e => {
  state.totalPoints = toNum(e.target.value, 0);
  persist(); render();
});
$("#playersNeeded")?.addEventListener("change", e => {
  state.playersNeeded = toNum(e.target.value, 0);
  persist(); render();
});
$("#minBasePerPlayer")?.addEventListener("change", e => {
  state.minBasePerPlayer = toNum(e.target.value, 0);
  persist(); render();
});
$("#btn-shuffle")?.addEventListener("click", () => randomizeQueue());
$("#btn-next")?.addEventListener("click", () => nextPlayer());
$("#btn-undo")?.addEventListener("click", () => undo());

// Import/export (left card)
const csvUrlEl = $("#csvUrl");
const csvPasteEl = $("#csvPaste");
$("#btn-fetch")?.addEventListener("click", () => importFromCsvUrl());
$("#btn-clear-url")?.addEventListener("click", () => { csvUrlEl.value = ""; });
$("#btn-import")?.addEventListener("click", () => importFromPaste());
$("#btn-clear-paste")?.addEventListener("click", () => { csvPasteEl.value = ""; });

// Right/Middle refs
const liveBidEl = $("#liveBid");
const playersListEl = $("#playersList");
const playersCountEl = $("#playersCount");
const remainingPointsEl = $("#remainingPoints");
const remainingSlotsEl = $("#remainingSlots");
const guardrailEl = $("#guardrail");
const complianceBarEl = $("#complianceBar");

// ---------- Init ----------
load();
routeViews();     // decide which view to show
if (state.auth.loggedIn && state.setup.done) {
  render();
  warmloadSupabase();
}

// ---------- View routing ----------
function routeViews(){
  const logged = !!state.auth.loggedIn;
  const setupDone = !!state.setup.done;

  // Logout button visibility
  const logoutBtn = $("#btn-logout");
  if (logoutBtn) logoutBtn.style.display = logged ? "inline-block" : "none";

  if (!logged) {
    show(loginView); hide(settingsView); hide(appMain);
    // Default credentials prefill (optional)
    if (loginUser) loginUser.value = AUTH_USER;
    if (loginPass) loginPass.value = AUTH_PASS;
    loginError.textContent = "";
    return;
  }
  if (logged && !setupDone) {
    // Prefill settings with saved or sensible defaults
    if (cfgPlayersCap) cfgPlayersCap.value = state.setup.playersCap ?? 15;
    if (cfgTotalPoints) cfgTotalPoints.value = state.setup.overallPoints ?? 15000;
    if (cfgPreName) cfgPreName.value = state.setup.preselectedName ?? "";
    if (cfgPreBid) cfgPreBid.value = state.setup.preselectedBid ?? 0;
    updateAvailableScorePreview();
    show(settingsView); hide(loginView); hide(appMain);
    return;
  }
  // logged + setup done
  show(appMain); hide(loginView); hide(settingsView);
}

function show(el){ if (el) el.style.display = ""; }
function hide(el){ if (el) el.style.display = "none"; }

// ---------- Auth handlers ----------
function onLogin(){
  const u = (loginUser?.value || "").trim();
  const p = (loginPass?.value || "").trim();
  if (u === AUTH_USER && p === AUTH_PASS) {
    state.auth.loggedIn = true;
    persist();
    routeViews();
  } else {
    if (loginError) loginError.textContent = "Invalid username or password.";
  }
}
function onLogout(){
  // Keep players/settings if you want; here we just flip auth
  state.auth.loggedIn = false;
  persist();
  routeViews();
}

// ---------- Settings handlers ----------
function updateAvailableScorePreview(){
  const total = toNum(cfgTotalPoints?.value, 15000);
  const preBid = toNum(cfgPreBid?.value, 0);
  if (cfgAvailableScore) cfgAvailableScore.textContent = Math.max(0, total - preBid);
}

function onSaveSettings(){
  settingsError.textContent = "";

  const playersCap = toNum(cfgPlayersCap?.value, 15);
  const overallPoints = toNum(cfgTotalPoints?.value, 15000);
  const preName = (cfgPreName?.value || "").trim();
  const preBid = toNum(cfgPreBid?.value, 0);

  if (playersCap <= 0 || overallPoints <= 0) {
    settingsError.textContent = "Enter positive values for players and points.";
    return;
  }
  if (preBid < 0) {
    settingsError.textContent = "Preselected bid cannot be negative.";
    return;
  }

  // Apply to app state
  state.setup.playersCap = playersCap;
  state.setup.overallPoints = overallPoints;
  state.setup.preselectedName = preName;
  state.setup.preselectedBid = preBid;
  state.setup.done = true;

  // Map settings → working controls
  state.totalPoints = overallPoints;
  state.playersNeeded = playersCap;

  // If preselected provided, try to mark as WON at given bid
  if (preName && preBid > 0) {
    const target = state.players.find(p => (p.name || "").trim().toLowerCase() === preName.toLowerCase());
    if (target && target.status === "pending") {
      // Use internal markWon (this logs and recomputes guardrails automatically)
      state.players = state.players.map(p => p.id===target.id ? { ...p, status:"won", finalBid: preBid } : p);
      state.log.push({ type:"won", id: target.id, bid: preBid });
    } else {
      // If not found, we still proceed; user can correct name later
      settingsError.textContent = "Note: preselected player name not found; no player was marked won.";
    }
  }

  persist();
  routeViews();   // go to app
  render();       // first render with applied settings
}

// ---------- Load / Save ----------
function load(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
    // Always ensure players exist
    if (!state.players || !Array.isArray(state.players) || state.players.length === 0){
      state.players = parseCSV(SAMPLE_CSV);
      state.queue = shuffle(state.players.map(p=>p.id));
      state.activeId = null;
    }
  } catch {
    state.players = parseCSV(SAMPLE_CSV);
    state.queue = shuffle(state.players.map(p=>p.id));
    state.activeId = null;
  }

  // Reflect to left-card inputs (when visible)
  const tp = $("#totalPoints"), pn = $("#playersNeeded"), mb = $("#minBasePerPlayer");
  if (tp) tp.value = state.totalPoints;
  if (pn) pn.value = state.playersNeeded;
  if (mb) mb.value = state.minBasePerPlayer;
}

async function warmloadSupabase(){
  const team = "high-range-blasters";
  try {
    const s = await loadSettingsFromSupabase(team);
    if (s) {
      state.totalPoints = s.total_points ?? state.totalPoints;
      state.playersNeeded = s.players_needed ?? state.playersNeeded;
      state.minBasePerPlayer = s.min_base_per_player ?? state.minBasePerPlayer;
      $("#totalPoints").value = state.totalPoints;
      $("#playersNeeded").value = state.playersNeeded;
      $("#minBasePerPlayer").value = state.minBasePerPlayer;
    }
    const c = await loadConstraintsFromSupabase(team);
    if (c && c.length) state.constraints = c;
    persist(); render();
  } catch { /* ignore */ }
}

function persist(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// ---------- Derived ----------
function remainingSlots(){
  const won = state.players.filter(p => p.status === "won").length;
  return Math.max(0, state.playersNeeded - won);
}
function spentPoints(){
  return state.players.reduce((t, p) => t + (p.status === "won" ? (p.finalBid || 0) : 0), 0);
}
function remainingPoints(){
  return Math.max(0, state.totalPoints - spentPoints());
}
function guardrailOK(afterSpend = 0){
  const remAfter = remainingPoints() - afterSpend;
  const slotsAfter = Math.max(0, remainingSlots() - (afterSpend > 0 ? 1 : 0));
  return remAfter >= (slotsAfter * state.minBasePerPlayer);
}

// ---------- Queue / actions ----------
function randomizeQueue(){
  const ids = state.players.filter(p => p.status === "pending").map(p => p.id);
  state.queue = shuffle(ids);
  state.activeId = null;
  persist(); render();
}
function nextPlayer(){
  if (!state.queue.length){ randomizeQueue(); return; }
  const [head, ...rest] = state.queue;
  state.queue = rest;
  state.activeId = head;
  persist(); render();
}
function markWon(id, bid){
  state.players = state.players.map(p => p.id===id ? { ...p, status:"won", finalBid: bid } : p);
  state.log.push({ type:"won", id, bid });
  state.activeId = null;
  persist(); render();
}
function markLost(id){
  state.players = state.players.map(p => p.id===id ? { ...p, status:"lost", finalBid: undefined } : p);
  state.log.push({ type:"lost", id });
  state.activeId = null;
  persist(); render();
}
function undo(){
  const last = state.log.pop();
  if (!last) return;
  if (last.type === "won"){
    state.players = state.players.map(p => p.id===last.id ? { ...p, status:"pending", finalBid: undefined } : p);
  } else {
    state.players = state.players.map(p => p.id===last.id ? { ...p, status:"pending" } : p);
  }
  persist(); render();
}
function updatePlayer(id, patch){
  state.players = state.players.map(p => p.id===id ? { ...p, ...patch } : p);
  persist(); render();
}

// ---------- Import / Export ----------
async function importFromCsvUrl(){
  const url = (csvUrlEl?.value || "").trim();
  if (!url) { alert("CSV URL is empty."); return; }
  try {
    const res = await fetch(url);
    const txt = await res.text();
    const arr = parseCSV(txt);
    if (!arr.length) { alert("No rows found in CSV."); return; }
    state.players = arr;
    state.queue = shuffle(arr.map(p=>p.id));
    state.activeId = null;
    persist(); render();
  } catch (e){
    alert("Failed to fetch CSV: " + e);
  }
}
function importFromPaste(){
  const txt = (csvPasteEl?.value || "").trim();
  if (!txt) { alert("Paste CSV is empty."); return; }
  try {
    const arr = parseCSV(txt);
    if (!arr.length) { alert("No rows found in CSV."); return; }
    state.players = arr;
    state.queue = shuffle(arr.map(p=>p.id));
    state.activeId = null;
    persist(); render();
  } catch (e){
    alert("Parse error: " + e);
  }
}
function exportWon(){
  const won = state.players.filter(p => p.status === "won");
  if (!won.length) { alert("No players won yet."); return; }
  const rows = won.map(p => ({
    name: p.name,
    role: p.role,
    grade: p.grade,
    rating: p.rating,
    finalBid: p.finalBid,
    alumni: p.alumni || "",
    age: p.age || "",
    category: p.category || ""
  }));
  const csv = csvExport(rows);
  const blob = new Blob([csv], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "hrb_roster.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ---------- Rendering ----------
function render(){
  if (!appMain || appMain.style.display === "none") return;

  if (remainingPointsEl) remainingPointsEl.textContent = remainingPoints();
  if (remainingSlotsEl) remainingSlotsEl.textContent = remainingSlots();
  if (guardrailEl) {
    guardrailEl.classList.toggle("danger", !guardrailOK(0));
    guardrailEl.innerHTML = `Guardrail: <b>${guardrailOK(0) ? "OK" : "At Risk"}</b>`;
  }

  if (playersCountEl) playersCountEl.textContent = `(${state.players.length})`;
  renderCompliance();
  renderPlayersList();
  renderLiveBid();
  renderSelectedList();
}

function renderCompliance(){
  if (!complianceBarEl) return;
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
  if (!playersListEl) return;
  playersListEl.innerHTML = "";

  const withScores = state.players.map(p => ({
    ...p,
    valueScore: computeValueScore(p, state.players, state.constraints)
  }));

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
        ${p.role} • Grade ${p.grade} • Rating ${p.rating} • Base ${p.base}
        ${p.is_wk ? " • WK" : ""}
        ${p.batting_hand ? " • " + p.batting_hand + "-hand" : ""}
        ${p.category ? " • " + p.category : ""}
        ${p.alumni ? " • " + p.alumni : ""}
        ${p.age ? " • Age " + p.age : ""}
      </div>
      <div class="row" style="margin-top:6px;">
        <button class="btn btn-ghost" data-action="set-active">Set Active</button>
        ${p.status === "pending" ? `<button class="btn btn-ghost" data-action="mark-lost">Mark Lost</button>` : `<button class="btn btn-ghost" data-action="reopen">Reopen</button>`}
        ${p.status === "won" ? `<span style="margin-left:auto;font-size:12px;color:#475569">Final: <b>${p.finalBid}</b></span>` : ""}
      </div>
      <div class="info-grid" style="margin-top:6px;">
        <label class="info"><div class="k">Base</div><input data-edit="base" value="${p.base}" /></label>
        <label class="info"><div class="k">Rating</div><input data-edit="rating" value="${p.rating}" /></label>
        <label class="info"><div class="k">Grade</div><input data-edit="grade" value="${p.grade}" /></label>
      </div>
    `;

    div.querySelector("[data-action='set-active']")?.addEventListener("click", () => {
      state.activeId = p.id; persist(); render();
    });
    div.querySelector("[data-action='mark-lost']")?.addEventListener("click", () => markLost(p.id));
    div.querySelector("[data-action='reopen']")?.addEventListener("click", () =>
      updatePlayer(p.id, { status:"pending", finalBid: undefined })
    );

    div.querySelector("[data-edit='base']")?.addEventListener("change", e =>
      updatePlayer(p.id, { base: toNum(e.target.value, p.base) })
    );
    div.querySelector("[data-edit='rating']")?.addEventListener("change", e =>
      updatePlayer(p.id, { rating: toNum(e.target.value, p.rating) })
    );
    div.querySelector("[data-edit='grade']")?.addEventListener("change", e =>
      updatePlayer(p.id, { grade: String(e.target.value || p.grade).toUpperCase() })
    );

    playersListEl.appendChild(div);
  });
}

function renderLiveBid() {
  if (!liveBidEl) return;
  const p = state.players.find(x => x.id === state.activeId);
  if (!p) {
    liveBidEl.innerHTML = `<div class="hint">No active player. Click <b>Next Player</b> to start.</div>`;
    return;
  }

  const score = computeValueScore(p, state.players, state.constraints);
  const tier = tierFromScore(score);

  const basicMeta = [
    p.role,
    `Grade ${p.grade}`,
    `Rating ${p.rating}`,
    p.is_wk ? "WK" : null,
    p.batting_hand ? `${p.batting_hand}-hand` : null
  ].filter(Boolean).join(" • ");

  const extraMeta = [
    p.category ? `Category: ${p.category}` : null,
    p.alumni ? `Alumni: ${p.alumni}` : null,
    p.dob ? `DOB: ${p.dob}` : null,
    (p.age ? `Age: ${p.age}` : null)
  ].filter(Boolean).join(" • ");

  liveBidEl.innerHTML = `
    <div class="item">
      <div class="title">
        <div>
          <div style="font-size:18px;font-weight:600">${p.name}</div>
          <div class="meta">${basicMeta}</div>
          ${extraMeta ? `<div class="meta" style="margin-top:2px">${extraMeta}</div>` : ``}
        </div>
        <div class="${tier.class}">
          <span>${tier.label}</span><span>•</span><span>${score.toFixed(1)}</span>
        </div>
      </div>

      <div class="info-grid" style="margin-top:8px;">
        <div class="info"><div class="k">Base</div><div class="v">${p.base}</div></div>
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

  const bidInput = document.getElementById("yourBid");
  const warn = document.getElementById("guardWarn");
  function validate(){
    const bid = toNum(bidInput.value, p.base);
    const ok = guardrailOK(bid);
    warn.textContent = ok ? "" : `Bid violates guardrail: keep ≥ ${Math.max(0, (remainingSlots()-1)*state.minBasePerPlayer)} after this pick.`;
    return ok;
  }
  validate();

  document.getElementById("btn-bid-base")?.addEventListener("click", () => {
    bidInput.value = p.base;
    validate();
  });
  document.getElementById("btn-plus10")?.addEventListener("click", () => {
    bidInput.value = String(Math.max(p.base, toNum(bidInput.value, p.base) + 10));
    validate();
  });
  document.getElementById("btn-mark-won")?.addEventListener("click", () => {
    const bid = toNum(bidInput.value, p.base);
    if (!guardrailOK(bid)) { alert("Guardrail violated. Reduce bid."); return; }
    markWon(p.id, bid);
  });
  document.getElementById("btn-pass")?.addEventListener("click", () => markLost(p.id));
  document.getElementById("btn-skip")?.addEventListener("click", () => nextPlayer());
}

function renderSelectedList(){
  const container = document.getElementById("selectedList");
  if (!container) return;

  const won = state.players
    .filter(p => p.status === "won")
    .sort((a,b) => (b.finalBid||0) - (a.finalBid||0));

  if (!won.length) {
    container.innerHTML = `<div class="hint">No players selected yet.</div>`;
    return;
  }

  container.innerHTML = won.map(p => {
    const line1 = `${p.name} — ${p.role}${p.is_wk ? " (WK)" : ""}${p.batting_hand ? ", " + p.batting_hand + "-hand" : ""}`;
    const line2 = [
      p.category ? `Category: ${p.category}` : null,
      p.alumni ? `Alumni: ${p.alumni}` : null,
      p.age ? `Age: ${p.age}` : null,
      p.grade ? `Grade: ${p.grade}` : null,
      `Bid: ${p.finalBid}`
    ].filter(Boolean).join(" • ");

    return `
      <div class="item">
        <div class="title"><div><b>${line1}</b></div></div>
        <div class="meta">${line2}</div>
      </div>
    `;
  }).join("");
}
