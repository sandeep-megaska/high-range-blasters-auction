/* assets/app.js — HRB Auction Assist (hard-coded clubs, per-club preselected, CSV mapping, must-bid flag) */

/* ===========================
   Double-load guard
=========================== */
if (window.__HRB_APP_LOADED__) {
  console.warn("app.js loaded twice; ignoring second load");
  throw new Error("DUP_LOAD");
}
window.__HRB_APP_LOADED__ = true;

/* ===========================
   Tiny Diagnostics
=========================== */
(function () {
  const bar = document.createElement("div");
  bar.id = "diag";
  bar.style.cssText =
    "position:fixed;left:10px;bottom:10px;z-index:99999;background:#111;color:#fff;padding:6px 10px;border-radius:8px;font:12px/1.4 system-ui";
  bar.textContent = "⏳ loading app.js...";
  document.addEventListener("DOMContentLoaded", () => (bar.textContent = "✅ DOM ready, booting..."));
  window.addEventListener("error", (e) => (bar.textContent = "❌ JS error: " + e.message));
  document.body.appendChild(bar);
  window.__diag = (msg) => (bar.textContent = "ℹ️ " + msg);
})();

/* ===========================
   Config / Constants
=========================== */
const DEFAULT_PLAYERS_CAP = 15;
const DEFAULT_TOTAL_POINTS = 15000;
const DEFAULT_MIN_BASE = 250;
const MUST_BID_RATING = 8; // rating >= 8 => Must Bid (tweak if needed)
const DEFAULT_CLUBS = [
  { name: "High Range Blasters", slug: "high-range-blasters", logo_url: "./assets/highrange.svg" }, // HRB (ours)
  { name: "Black Panthers", slug: "black-panthers", logo_url: "" },
  { name: "White Elephants", slug: "white-elephants", logo_url: "" },
  { name: "Kerala Tuskers", slug: "kerala-tuskers", logo_url: "" },
  { name: "Warbow Wolverines", slug: "warbow-wolverines", logo_url: "" },
  { name: "Venad Warriers", slug: "venad-warriers", logo_url: "" },
  { name: "Thiruvalla Warriers", slug: "thiruvalla-warriers", logo_url: "" },
  { name: "God's Own XI", slug: "gods-own-xi", logo_url: "" },
];

/* ===========================
   State & Persistence
=========================== */
let state = {
  players: [], // {id,name,alumni,phone,role,batting_hand,is_wk,rating,category,base,status,finalBid,owner,dob,skill,batting,bowling,availability}
  auth: { loggedIn: false, user: null },
  playersNeeded: DEFAULT_PLAYERS_CAP,
  totalPoints: DEFAULT_TOTAL_POINTS,
  minBasePerPlayer: DEFAULT_MIN_BASE,
  categoryBase: { c1: null, c2: null, c3: null, c4: null, c5: null },
  preselectedMap: {},                 // legacy (HRB-only). kept for backward compat, but we’ll move to:
  preselectedByClub: {},              // { slug: { playerNameLower: price, ... }, ... }
  myClubSlug: "high-range-blasters",
  clubs: [],                          // {id,slug,name,logo_url,starting_budget,budget_left}
  activePlayerId: null,
};

function factoryState() {
  return {
    players: [],
    auth: { loggedIn: false, user: null },
    playersNeeded: DEFAULT_PLAYERS_CAP,
    totalPoints: DEFAULT_TOTAL_POINTS,
    minBasePerPlayer: DEFAULT_MIN_BASE,
    categoryBase: { c1: null, c2: null, c3: null, c4: null, c5: null },
    preselectedMap: {},
    preselectedByClub: {},
    myClubSlug: "high-range-blasters",
    clubs: [],
    activePlayerId: null,
  };
}

// persistence
function persist() {
  try { localStorage.setItem("hrb-auction-state", JSON.stringify(state)); } catch {}
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem("hrb-auction-state") || "{}");
    if (s && typeof s === "object") {
      state = { ...state, ...s };
      state.categoryBase = { c1:null,c2:null,c3:null,c4:null,c5:null, ...(s.categoryBase||{}) };
      state.preselectedMap = s.preselectedMap || {};
      state.preselectedByClub = s.preselectedByClub || {};
    }
  } catch {}
}

/* ===========================
   Utils
=========================== */
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function toNum(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function normalizeHeader(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }
function show(el, on = true) { if (!el) return; el.style.display = on ? "block" : "none"; }
function availabilityIsBothDays(av) {
  const s = String(av || "").toLowerCase();
  if (!s) return false;
  // heuristics: contains "both", "two days", "sat & sun", "day 1 and day 2"
  return /(both|two\s*days|sat\s*&\s*sun|day\s*1\s*and\s*day\s*2)/i.test(s);
}

/* ===========================
   Clubs (hard-coded)
=========================== */
function ensureDefaultClubsSeeded() {
  if (!state.clubs) state.clubs = [];
  const have = new Set(state.clubs.map((c) => c.slug));
  DEFAULT_CLUBS.forEach((def) => {
    if (!have.has(def.slug)) {
      state.clubs.push({
        id: `local-${def.slug}`,
        slug: def.slug,
        name: def.name,
        logo_url: def.logo_url || "",
        starting_budget: state.totalPoints || DEFAULT_TOTAL_POINTS,
        budget_left: state.totalPoints || DEFAULT_TOTAL_POINTS,
      });
    } else {
      // sync starting budget if totalPoints changed
      const c = state.clubs.find((x) => x.slug === def.slug);
      if (c && toNum(c.starting_budget) !== toNum(state.totalPoints)) {
        const spent = (state.players || [])
          .filter((p) => p.owner === def.slug && p.status === "won")
          .reduce((s, p) => s + toNum(p.finalBid, 0), 0);
        c.starting_budget = toNum(state.totalPoints, DEFAULT_TOTAL_POINTS);
        c.budget_left = Math.max(0, c.starting_budget - spent);
      }
    }
  });
  persist();
}
function myClub() {
  return (state.clubs || []).find((c) => c.slug === state.myClubSlug) || null;
}
function getOtherClubs() {
  return (state.clubs || []).filter((c) => c.slug !== state.myClubSlug);
}
function clubStats(slug) {
  const players = (state.players || []).filter((p) => p.owner === slug && p.status === "won");
  const spend = players.reduce((s, p) => s + toNum(p.finalBid, 0), 0);
  const c = (state.clubs || []).find((c) => c.slug === slug);
  const budgetLeft = c ? Math.max(0, toNum(c.starting_budget, 0) - spend) : 0;
  const cap = state.playersNeeded || DEFAULT_PLAYERS_CAP;
  const balancePlayers = Math.max(0, cap - players.length);
  return { players, count: players.length, spend, budgetLeft, balancePlayers };
}

/* ===========================
   Roster / Budget helpers
=========================== */
function remainingSlots() {
  const mine = (state.players || []).filter((p) => p.owner === state.myClubSlug && p.status === "won").length;
  return Math.max(0, (state.playersNeeded || DEFAULT_PLAYERS_CAP) - mine);
}
function remainingBudget(clubSlug) {
  const c = (state.clubs || []).find((c) => c.slug === clubSlug);
  if (!c) return 0;
  return toNum(c.budget_left, c.starting_budget || 0);
}
function guardrailOK(bid) {
  const rem = remainingSlots();
  const floor = state.minBasePerPlayer || DEFAULT_MIN_BASE;
  const bud = remainingBudget(state.myClubSlug);
  return bid <= bud && bud - bid >= (rem - 1) * floor;
}

/* ===========================
   CSV parsing (maps TEC headers)
=========================== */
function splitCsv(text) {
  const rows = [], row = [], pushRow = () => rows.push(row.splice(0, row.length));
  let cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i + 1];
    if (inQ) {
      if (ch === '"' && nx === '"') { cell += '"'; i++; continue; }
      if (ch === '"') { inQ = false; continue; }
      cell += ch; continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === ",") { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); cell = ""; pushRow(); continue; }
    cell += ch;
  }
  row.push(cell); pushRow(); return rows;
}
function parseCSVPlayers(raw) {
  const rows = splitCsv(raw).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!rows.length) return [];
  const headerIdx = rows.findIndex((r) => {
    const h = r.map(normalizeHeader);
    return h.includes("name") || h.includes("player name") || h.includes("player");
  });
  if (headerIdx < 0) return [];
  const header = rows[headerIdx].map(normalizeHeader);
  const body = rows.slice(headerIdx + 1);

  const idx = (...aliases) => {
    for (const a of aliases) { const i = header.indexOf(a); if (i >= 0) return i; }
    return -1;
  };
  const iName  = idx("name", "player name", "player");
  const iRate  = idx("rating", "rank", "rating10", "grade");
  const iAlmNm = idx("alumni member name", "alumni name", "member name");
  const iAlmn  = idx("alumni", "college", "institute");
  const iDob   = idx("dob", "date of birth");
  const iSkill = idx("skill", "playing role", "role");
  const iBat   = idx("batting", "batting hand");
  const iBowl  = idx("bowling");
  const iAvail = idx("availability");
  const iPhone = idx("player contact number", "phone", "mobile", "whatsapp");

  const yes = (v) => /^(true|yes|y|1)$/i.test(String(v || "").trim());

  const players = [];
  body.forEach((cols, i) => {
    const name = (cols[iName] || "").trim();
    if (!name) return;

    const ratingRaw = iRate >= 0 ? String(cols[iRate]).trim() : "";
    const rating = ratingRaw === "" ? null : Number(ratingRaw);

    const alumniMember = iAlmNm >= 0 ? String(cols[iAlmNm]).trim() : "";
    const alumni = iAlmn >= 0 ? String(cols[iAlmn]).trim() : alumniMember; // prefer alumni; fallback to member name

    const dob = iDob >= 0 ? String(cols[iDob]).trim() : "";
    const skill = iSkill >= 0 ? String(cols[iSkill]).trim() : "";
    const batting = iBat >= 0 ? String(cols[iBat]).trim() : "";
    const bowling = iBowl >= 0 ? String(cols[iBowl]).trim() : "";
    const availability = iAvail >= 0 ? String(cols[iAvail]).trim() : "";
    const phone = iPhone >= 0 ? String(cols[iPhone]).trim() : "";

    const is_wk = /wk|keeper/i.test(skill) || /wk/i.test(batting);

    players.push({
      id: String(i + 1),
      name,
      alumni,
      phone,
      role: skill,                   // we’ll treat "skill" as the primary role field
      batting_hand: batting,
      is_wk: Boolean(is_wk),
      rating,
      category: null,                // not used in TEC sheet
      base: null,                    // base will be seeded from categoryBase if we later add categories
      status: "new",
      dob,
      skill,
      batting,
      bowling,
      availability,
    });
  });
  return players;
}

/* ===========================
   Preselected application (all clubs)
=========================== */
function parsePreselectedText(txt, fallback) {
  const out = {};
  const raw = String(txt || "").trim();
  if (!raw) return out;
  if (raw.includes("=")) {
    raw.split(";").forEach((part) => {
      const s = part.trim();
      if (!s) return;
      const [name, val] = s.split("=").map((x) => x.trim());
      if (name) out[name.toLowerCase()] = toNum(val, 0);
    });
  } else {
    out[raw.toLowerCase()] = toNum(fallback, 0);
  }
  return out;
}
function applyPreselectedForClub(clubSlug) {
  const map = (state.preselectedByClub || {})[clubSlug] || {};
  const names = Object.keys(map);
  if (!names.length) return 0;
  let spent = 0;
  (state.players || []).forEach((p) => {
    const key = (p.name || "").toLowerCase();
    if (!map[key]) return;
    if (p.status === "won" && p.owner === clubSlug) return; // already applied
    p.status = "won";
    p.owner = clubSlug;
    p.finalBid = toNum(map[key], 0);
    spent += p.finalBid;
  });
  return spent;
}
function recomputeBudgetsFromWins() {
  (state.clubs || []).forEach((c) => {
    const spent = (state.players || [])
      .filter((p) => p.owner === c.slug && p.status === "won")
      .reduce((s, p) => s + toNum(p.finalBid, 0), 0);
    c.starting_budget = toNum(state.totalPoints, DEFAULT_TOTAL_POINTS);
    c.budget_left = Math.max(0, c.starting_budget - spent);
  });
}
function applyPreselectedAllClubs() {
  (state.clubs || []).forEach((c) => applyPreselectedForClub(c.slug));
  recomputeBudgetsFromWins();
  persist();
}

/* ===========================
   Live bid / mutations
=========================== */
function setActivePlayer(id) { state.activePlayerId = id || null; persist(); renderLiveBid(); }
function getActivePlayer() { return (state.players || []).find((p) => p.id === state.activePlayerId) || null; }
function markWon(playerId, price) {
  const p = (state.players || []).find((x) => x.id === playerId);
  if (!p) return;
  const bid = toNum(price, p.base || 0);
  if (!guardrailOK(bid)) { alert("Guardrail violated. Reduce bid."); return; }
  p.status = "won"; p.finalBid = bid; p.owner = state.myClubSlug;
  recomputeBudgetsFromWins(); persist(); render();
}
function assignToClubByNameOrSlug(playerId, clubText, price) {
  const clubs = state.clubs || [];
  let club = clubs.find((c) => c.slug === clubText);
  if (!club) {
    const name = String(clubText || "").trim().toLowerCase();
    club = clubs.find((c) => (c.name || "").toLowerCase() === name) ||
           clubs.find((c) => (c.name || "").toLowerCase().startsWith(name));
  }
  const msg = $("passPanelMsg");
  if (!club) { if (msg) msg.textContent = "Pick a valid club from the list."; return; }

  const p = (state.players || []).find((x) => x.id === playerId);
  if (!p) return;
  const bid = Math.max(0, toNum(price, p.base || 0));

  p.status = "won"; p.finalBid = bid; p.owner = club.slug;
  recomputeBudgetsFromWins(); persist(); render();
}

/* ===========================
   Minimal row + flags
=========================== */
function miniRow(p) {
  const alumni = p.alumni || "";
  const phone = p.phone || "";
  const sep = alumni && phone ? " · " : "";
  return `
    <div class="mini-row" style="padding:6px 0;border-bottom:1px solid #eef1f4">
      <div style="font-size:14px;font-weight:700">${p.name || "-"}</div>
      <div style="font-size:12px;color:#6b7280">${alumni}${sep}${phone}</div>
    </div>
  `;
}

/* ===========================
   Compliance (WK, LHB, Bowl)
=========================== */
function isLeftHand(battingHand) { return /left/i.test(String(battingHand || "")); }
function isBowler(role) { return /bowl/i.test(String(role || "")); }
function complianceForMySquad() {
  const mine = (state.players || []).filter((p) => p.owner === state.myClubSlug && p.status === "won");
  const wk = mine.filter((p) => p.is_wk).length;
  const lhb = mine.filter((p) => isLeftHand(p.batting_hand)).length;
  const bowl = mine.filter((p) => isBowler(p.role) || /all/i.test(p.role)).length;
  return { wk, lhb, bowl };
}
function renderComplianceBar() {
  const root = $("complianceBar"); if (!root) return;
  const { wk, lhb, bowl } = complianceForMySquad();
  const need = { wk: 2, lhb: 2, bowl: 8 };
  const ok = (cur, req) => `<b style="color:${cur >= req ? "#16a34a" : "#dc2626"}">${cur}/${req}</b>`;
  root.innerHTML = `
    <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <span>WK: ${ok(wk, need.wk)}</span>
      <span>Left-hand batters: ${ok(lhb, need.lhb)}</span>
      <span>Bowlers: ${ok(bowl, need.bowl)}</span>
    </div>
  `;
}

/* ===========================
   Renderers
=========================== */
function renderPlayersList() {
  const root = $("playersList"); const counter = $("playersCount"); if (!root) return;
  const remaining = (state.players || []).filter((p) => p.status !== "won");
  if (counter) counter.textContent = `(${remaining.length})`;

  root.innerHTML = remaining.length
    ? remaining.map((p) => {
        const must = Number(p.rating || 0) >= MUST_BID_RATING;
        const lowAvail = !availabilityIsBothDays(p.availability);
        const tags = [
          must ? `<span style="background:#fde68a;color:#7c2d12;padding:2px 6px;border-radius:999px;font-size:11px;">Must Bid</span>` : "",
          lowAvail ? `<span style="background:#fee2e2;color:#7f1d1d;padding:2px 6px;border-radius:999px;font-size:11px;">Low availability</span>` : ""
        ].filter(Boolean).join(" ");
        return `
        <div class="item" style="padding:10px;border-bottom:1px solid #eee;${lowAvail ? 'opacity:.85;' : ''}">
          <div class="row" style="display:flex;justify-content:space-between;gap:8px">
            <div>
              <div style="display:flex;gap:8px;align-items:center;"><b>${p.name}</b> ${tags}</div>
              <div class="meta" style="color:#6b7280">
                ${p.alumni || ""}${p.alumni && p.phone ? " · " : ""}${p.phone || ""}
                ${p.skill ? " · "+p.skill : ""}${p.batting ? " · "+p.batting : ""}${p.bowling ? " · "+p.bowling : ""}
                ${Number.isFinite(p.rating) ? " · Rating:"+p.rating : ""}
              </div>
            </div>
            <button class="btn btn-ghost" data-id="${p.id}" data-action="pick">Pick</button>
          </div>
        </div>`;
      }).join("")
    : `<div class="hint">Import players to begin.</div>`;

  root.querySelectorAll("[data-action='pick']").forEach((btn) => {
    btn.addEventListener("click", () => setActivePlayer(btn.getAttribute("data-id")));
  });
}

function renderSelectedSquad() {
  const root = $("selectedList"); if (!root) return;
  const stats = clubStats(state.myClubSlug);
  const header = `
    <div class="row" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div class="meta">Players: <b>${stats.count}</b></div>
    </div>`;
  root.innerHTML = stats.players.length ? header + stats.players.map(miniRow).join("") : header + `<div class="hint">No players won yet.</div>`;
}

function renderOtherClubsPanel() {
  const root = $("otherClubsPanel"); if (!root) return;
  const others = (state.clubs || []).filter((c) => c.slug !== state.myClubSlug);
  if (!others.length) { root.innerHTML = `<div class="hint">Clubs seeded automatically.</div>`; return; }
  root.innerHTML = others.map((c) => {
    const stats = clubStats(c.slug);
    const list = stats.players.length ? stats.players.map(miniRow).join("") : `<div class="hint">No players yet.</div>`;
    return `
      <div class="club-box" style="padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:10px;background:#fff">
        <div class="club-head" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          ${c.logo_url ? `<img src="${c.logo_url}" alt="${c.name}" style="width:24px;height:24px;border-radius:999px;object-fit:cover">` : ""}
          <div style="font-size:14px;"><b>${c.name}</b></div>
          <div style="margin-left:auto;font-size:12px;color:#374151;">Balance players: <b>${stats.balancePlayers}</b></div>
        </div>
        <div style="font-size:12px;color:#374151;margin-bottom:6px;">Balance points: <b>${stats.budgetLeft}</b></div>
        <div class="club-list" style="max-height:220px;overflow:auto">${list}</div>
      </div>`;
  }).join("");
}

function renderLiveBid() {
  const live = $("liveBid"); if (!live) return;
  const p = getActivePlayer();
  if (!p) { live.innerHTML = `<div class="hint">No active player. Use the Name picker or click Pick on the list.</div>`; return; }

  const must = Number(p.rating || 0) >= MUST_BID_RATING;
  const lowAvail = !availabilityIsBothDays(p.availability);
  const flags = [
    must ? `<span style="background:#fde68a;color:#7c2d12;padding:2px 8px;border-radius:999px;font-size:12px;">Must Bid</span>` : "",
    lowAvail ? `<span style="background:#fee2e2;color:#7f1d1d;padding:2px 8px;border-radius:999px;font-size:12px;">Low availability</span>` : ""
  ].filter(Boolean).join(" ");

  live.innerHTML = `
    <div class="card" style="padding:12px">
      <div style="display:flex;gap:8px;align-items:center;">
        <div style="font-size:18px;font-weight:700">${p.name}</div>
        ${flags}
      </div>
      <div class="meta" style="color:#6b7280">
        ${p.alumni || ""}${p.alumni && p.phone ? " · " : ""}${p.phone || ""}
        ${p.skill ? " · "+p.skill : ""}${p.batting ? " · "+p.batting : ""}${p.bowling ? " · "+p.bowling : ""}
        ${Number.isFinite(p.rating) ? " · Rating:"+p.rating : ""}${p.availability ? " · "+p.availability : ""}
      </div>
      <div class="row" style="display:flex;gap:8px;margin-top:10px;align-items:flex-end;flex-wrap:wrap">
        <label style="flex:0 1 180px">Bid Amount
          <input id="bidInput" type="number" placeholder="e.g. 900" />
        </label>
        <button id="btn-mark-won" class="btn" disabled>HRB Won</button>
        <button id="btn-pass" class="btn btn-ghost">Pass / Assign</button>
      </div>
      <div id="bidWarn" class="hint" style="margin-top:6px;color:#dc2626"></div>
    </div>`;

  const bidEl = $("bidInput"); const wonBtn = $("btn-mark-won"); const warnEl = $("bidWarn");
  const validate = () => {
    const price = Number(bidEl.value);
    if (!Number.isFinite(price) || price < 0) { warnEl.textContent = price ? "Enter a valid amount." : ""; wonBtn.disabled = true; return false; }
    const ok = guardrailOK(price); wonBtn.disabled = !ok;
    const floor = Math.max(0, (remainingSlots() - 1) * (state.minBasePerPlayer || DEFAULT_MIN_BASE));
    warnEl.textContent = ok ? "" : `Guardrail: keep ≥ ${floor} for remaining slots.`; return ok;
  };
  bidEl.addEventListener("input", validate); validate();
  wonBtn.addEventListener("click", () => { if (!validate()) return; markWon(p.id, Number(bidEl.value)); });
  $("btn-pass")?.addEventListener("click", () => {
    const passPanel = $("passPanel"); if (passPanel) {
      passPanel.style.display = "block"; passPanel.scrollIntoView({ behavior: "smooth", block: "center" });
      wirePassPanelForPlayer(p);
    }
  });
}

function updateHeaderStats() {
  const c = myClub(); const remainingPts = c ? toNum(c.budget_left, c.starting_budget || 0) : 0;
  const remSlots = remainingSlots(); const guardEl = $("guardrail");
  if ($("remainingPoints")) $("remainingPoints").textContent = remainingPts;
  if ($("remainingSlots")) $("remainingSlots").textContent = remSlots;
  if (guardEl) guardEl.innerHTML = `Guardrail (min per slot): <b>${state.minBasePerPlayer || DEFAULT_MIN_BASE}</b>`;
}
function render() { renderPlayersList(); renderOtherClubsPanel(); renderLiveBid(); renderSelectedSquad(); renderComplianceBar(); updateHeaderStats(); }

/* ===========================
   Pass / Assign Panel
=========================== */
function wirePassPanelForPlayer(p) {
  const input = $("passClubInput"); const list = $("clubNames"); const amt = $("passBidAmount"); const msg = $("passPanelMsg"); const btn = $("btn-assign-to-club");
  if (!list) return;
  const others = (state.clubs || []).filter(c => true); // allow assigning to any club incl. HRB if needed
  list.innerHTML = others.map((c) => `<option value="${c.name}"></option>`).join("");
  if (amt) amt.value = $("bidInput")?.value || "";
  if (btn) { btn.onclick = null; btn.addEventListener("click", () => {
    if (msg) msg.textContent = ""; const clubText = (input?.value || "").trim(); const price = amt?.value || "";
    assignToClubByNameOrSlug(p.id, clubText, price);
  });}
}

/* ===========================
   Import / Export wiring
=========================== */
function wireCsvImportUI() {
  const urlEl = $("csvUrl"), pasteEl = $("csvPaste");
  const btnFetch = $("btn-fetch"), btnImport = $("btn-import");
  const btnClearUrl = $("btn-clear-url"), btnClearPaste = $("btn-clear-paste");
  const setMsg = (t) => { const m = $("importMsg"); if (m) m.textContent = t; };

  if (btnFetch && urlEl) {
    btnFetch.onclick = null;
    btnFetch.addEventListener("click", async () => {
      try {
        setMsg("");
        const url = (urlEl.value || "").trim();
        if (!url) { setMsg("Enter a Google Sheet CSV URL"); return; }
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        if (pasteEl) pasteEl.value = text;
        setMsg("Fetched CSV — click Import to load players.");
      } catch (e) { console.error(e); setMsg("Fetch failed. Ensure sheet is 'Published to the web' and URL ends with output=csv."); }
    });
  }

  if (btnImport && pasteEl) {
    btnImport.onclick = null;
    btnImport.addEventListener("click", () => {
      try {
        setMsg("");
        const raw = pasteEl.value || "";
        if (!raw.trim()) { setMsg("Paste CSV first or use Fetch CSV."); return; }

        let players = parseCSVPlayers(raw);
        if (!players.length) {
          const rows = splitCsv(raw);
          players = rows.map((r, i) => {
            const name = String(r[0] || "").trim(); if (!name) return null;
            return { id: String(i + 1), name, alumni: String(r[1] || "").trim(), phone: String(r[2] || "").trim(), status: "new" };
          }).filter(Boolean);
        }

        players = players.map((p) => ({ ...p, status: p.status === "won" ? "won" : "new" }));
        state.players = players; state.playersNeeded = state.playersNeeded || DEFAULT_PLAYERS_CAP;

        // Apply all preselected (for every club)
        applyPreselectedAllClubs();

        persist(); render();
        setMsg(`Imported ${players.length} players.`);
        $("playersList")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) { console.error(e); setMsg("Import failed. Check console."); }
    });
  }

  if (btnClearUrl && urlEl) {
    btnClearUrl.onclick = null; btnClearUrl.addEventListener("click", () => { urlEl.value = ""; const m = $("importMsg"); if (m) m.textContent = ""; });
  }
  if (btnClearPaste && pasteEl) {
    btnClearPaste.onclick = null; btnClearPaste.addEventListener("click", () => { pasteEl.value = ""; const m = $("importMsg"); if (m) m.textContent = ""; });
  }
}

function exportWonCSV() {
  const won = (state.players || []).filter((p) => p.status === "won");
  const rows = [["Club", "Player Name", "Alumni", "Phone"]];
  won.forEach((p) => {
    const club = (state.clubs || []).find((c) => c.slug === p.owner);
    rows.push([club ? club.name : p.owner || "", p.name || "", p.alumni || "", p.phone || ""]);
  });
  const csv = rows.map((r) => r.map((v) => {
    const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = "auction-won-contacts.csv"; document.body.appendChild(a); a.click();
  URL.revokeObjectURL(url); a.remove();
}
function wireExportButton() { const btn = $("btn-export"); if (!btn) return; btn.onclick = null; btn.addEventListener("click", exportWonCSV); }

/* ===========================
   Settings UI (per-club preselected)
=========================== */
function renderClubPreselectedPanel() {
  const root = $("clubPreselectedPanel"); if (!root) return;
  const clubs = state.clubs || [];
  const lines = clubs.map((c) => {
    const val = Object.entries(state.preselectedByClub?.[c.slug] || {})
      .map(([n, v]) => `${n}=${v}`).join("; ");
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
function collectClubPreselectedFromUI() {
  const out = {};
  (state.clubs || []).forEach((c) => {
    const el = $(`pre_${c.slug}`);
    const txt = el ? el.value : "";
    out[c.slug] = parsePreselectedText(txt, 0);
  });
  return out;
}

/* ===========================
   Login + Settings
=========================== */
function wireLoginUI() {
  const view = $("loginView");
  const btn = $("btn-login");
  const u = $("loginUser");
  const p = $("loginPass");
  const err = $("loginError");
  if (!view || !btn) return;

  show(view, !state.auth.loggedIn);
  show($("settingsView"), false);
  show($("appMain"), state.auth.loggedIn);

  btn.onclick = null;
  btn.addEventListener("click", async (ev) => {
    try {
      ev.preventDefault();
      const user = (u?.value || "").trim();
      const pass = p?.value || "";
      if (user.toLowerCase() !== "hrb" || pass !== "sandeep") {
        if (err) err.textContent = "Invalid credentials.";
        return;
      }
      state.auth.loggedIn = true; state.auth.user = "HRB";
      ensureDefaultClubsSeeded();
      persist();

      show(view, false);
      show($("appMain"), false);
      show($("settingsView"), true);

      $("cfgPlayersCap") && ($("cfgPlayersCap").value = state.playersNeeded);
      $("cfgTotalPoints") && ($("cfgTotalPoints").value = state.totalPoints);
      $("cfgGuardMin") && ($("cfgGuardMin").value = state.minBasePerPlayer || DEFAULT_MIN_BASE);

      renderClubPreselectedPanel();
      console.info("[HRB] login OK → settingsView shown");
    } catch (e) { console.error(e); if (err) err.textContent = "Login error. See console."; }
  });
}

function recomputeAvailableScorePreview() {
  const total = toNum($("cfgTotalPoints")?.value, state.totalPoints || DEFAULT_TOTAL_POINTS);
  // We only show HRB preview here; other clubs’ previews can be read in the cards after import.
  const hrbMap = parsePreselectedText($("cfgPreName")?.value, toNum($("cfgPreBid")?.value, 0));
  const preSum = Object.values(hrbMap).reduce((s, v) => s + toNum(v, 0), 0);
  const out = Math.max(0, total - preSum);
  if ($("cfgAvailableScore")) $("cfgAvailableScore").textContent = out;
}

function wireSettingsUI() {
  const view = $("settingsView"); if (!view) return;

  ["cfgTotalPoints", "cfgPreName", "cfgPreBid"].forEach((id) => {
    const el = $(id); if (el) el.addEventListener("input", recomputeAvailableScorePreview);
  });
  recomputeAvailableScorePreview();

  const btn = $("btn-save-settings");
  const err = $("settingsError");
  btn.onclick = null;
  btn.addEventListener("click", async () => {
    try {
      if (err) err.textContent = "";

      const playersCap = toNum($("cfgPlayersCap")?.value, DEFAULT_PLAYERS_CAP);
      const totalPts = toNum($("cfgTotalPoints")?.value, DEFAULT_TOTAL_POINTS);
      const guardMin = toNum($("cfgGuardMin")?.value, state.minBasePerPlayer || DEFAULT_MIN_BASE);

      // save core settings
      state.playersNeeded = playersCap;
      state.totalPoints = totalPts;
      state.minBasePerPlayer = guardMin;

      // seed all clubs (updates budgets to new total)
      ensureDefaultClubsSeeded();

      // collect per-club preselected from the dynamic panel
      state.preselectedByClub = collectClubPreselectedFromUI();

      // also keep HRB legacy field if you want (optional)
      state.preselectedMap = parsePreselectedText($("cfgPreName")?.value, toNum($("cfgPreBid")?.value, 0));

      // if players already imported, apply preselected now; else it will apply immediately after you import
      applyPreselectedAllClubs();

      persist();

      show(view, false);
      show($("appMain"), true);
      render();
      $("appMain").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      console.error(e);
      if (err) err.textContent = "Failed to save settings. Check console.";
    }
  });
}

/* ===========================
   Top controls (only logout/reset/export relevant now)
=========================== */
function wireTopControls() {
  const btnLogout = $("btn-logout");
  const btnReset = $("btn-reset");
  if (btnLogout) {
    show(btnLogout, true);
    btnLogout.onclick = null;
    btnLogout.addEventListener("click", async () => {
      // full factory reset
      localStorage.removeItem("hrb-auction-state");
      state = factoryState();
      ensureDefaultClubsSeeded();
      persist();
      show($("appMain"), false);
      show($("settingsView"), false);
      show($("loginView"), true);
      $("loginUser")?.focus();
      console.info("[HRB] full reset → loginView shown");
    });
  }
  if (btnReset) {
    btnReset.onclick = null;
    btnReset.addEventListener("click", () => {
      if (!confirm("Clear local session (players, clubs, settings)?")) return;
      localStorage.removeItem("hrb-auction-state"); location.reload();
    });
  }
}

/* ===========================
   Boot
=========================== */
function boot() {
  window.__diag && __diag("boot() start");
  load();
  ensureDefaultClubsSeeded();
  wireLoginUI();
  wireSettingsUI();
  wireCsvImportUI();
  wireExportButton();
  wireTopControls();
  // If already logged in, go straight to app
  if (state.auth.loggedIn) { show($("loginView"), false); show($("settingsView"), false); show($("appMain"), true); }
  render();
  window.__diag && __diag("boot() done");
}
document.addEventListener("DOMContentLoaded", boot);

/* ===========================
   Failsafe visibility
=========================== */
(function ensureVisible() {
  const login = document.getElementById("loginView");
  const settings = document.getElementById("settingsView");
  const app = document.getElementById("appMain");
  const allHidden = [login, settings, app].every((el) => !el || getComputedStyle(el).display === "none");
  if (allHidden) {
    let st = {};
    try { st = JSON.parse(localStorage.getItem("hrb-auction-state") || "{}"); } catch {}
    const loggedIn = !!(st.auth && st.auth.loggedIn);
    if (login) login.style.display = loggedIn ? "none" : "block";
    if (settings) settings.style.display = loggedIn ? "block" : "none";
    if (app) app.style.display = loggedIn ? "block" : "none";
    console.warn("[HRB] All views were hidden; applied failsafe.");
  }
})();
