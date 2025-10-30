/* assets/app.js — HRB Auction Assist (clubs + pass panel + local/Supabase)
   Paste this file as-is. It works with or without Supabase.
   If you want Supabase, set window.ENV = { SUPABASE_URL, SUPABASE_ANON_KEY } in index.html
   and load the UMD: <script src="https://unpkg.com/@supabase/supabase-js@2"></script> BEFORE this module.
*/
// ===== HRB rules (tweak anytime) =====
const RULES = {
  minWK: 2,              // need at least 2 wicket keepers
  minRightBat: 2,        // need at least 2 right-hand batters
  ratingThresholds: {    // interpret your sheet's rating (e.g., 1–10)
    must: 9,             // >= 9  → Must bid
    try:  7              // 7–8.9 → Try
  }
};

// interpret batting-hand strings
function isRightHand(battingHand) {
  const s = (battingHand || "").toLowerCase();
  return /right/.test(s) || /\brhb\b/.test(s) || s === "r";
}

// current HRB roster needs (based on already won players)
function rosterNeeds() {
  const mine = (state.players || []).filter(p => p.status === "won" && p.owner === state.myClubSlug);
  const wkHave = mine.filter(p => p.is_wk).length;
  const rhHave = mine.filter(p => isRightHand(p.batting_hand)).length;
  return {
    wkNeed: Math.max(0, RULES.minWK - wkHave),
    rhNeed: Math.max(0, RULES.minRightBat - rhHave)
  };
}

function classifyPriority(rating) {
  if (rating == null) return "—";
  if (rating >= RULES.ratingThresholds.must) return "must"; // Must bid
  if (rating >= RULES.ratingThresholds.try)  return "try";  // Try
  return "last";                                           // Last preference
}

function priorityBadge(priority) {
  const map = { must: "#166534", try: "#1d4ed8", last: "#6b7280", "—": "#6b7280" };
  const label = { must: "Must bid", try: "Try", last: "Last pref.", "—": "No rating" }[priority] || priority;
  const bg = map[priority] || "#6b7280";
  return `<span style="display:inline-block;padding:2px 6px;border-radius:999px;font-size:12px;color:#fff;background:${bg}">${label}</span>`;
}

/* ===========================
   State & Persistence
=========================== */
const DEFAULT_CONSTRAINTS = {}; // keep for compatibility if you use it elsewhere

let state = {
  // players & auction
  players: [],           // [{id,name,base,category,rank,role,status,finalBid,owner}]
  queue: [],
  totalPoints: 15000,
  playersNeeded: 15,
  minBasePerPlayer: 500,
  activeId: null,
  log: [],
  constraints: DEFAULT_CONSTRAINTS,

  // categories (editable in settings UI if you add it)
  catBase: { c1:1500, c2:1200, c3:900, c4:700, c5:500 },

  // setup/auth (no-op by default)
  auth: { loggedIn: true },
  setup: { done: true },

  // clubs
  myClubSlug: "high-range-blasters",
  clubs: [] // [{id,slug,name,logo_url,starting_budget,budget_left}]
};

function persist() {
  try { localStorage.setItem("hrb-auction-state", JSON.stringify(state)); } catch {}
}
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem("hrb-auction-state") || "{}");
    if (saved && typeof saved === "object") {
      state = { ...state, ...saved };
    }
  } catch {}
}

/* ===========================
   Utilities
=========================== */
function $(id) { return document.getElementById(id); }

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function toNum(v, fallback=0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : Number(fallback) || 0;
}

function findPlayerById(id) {
  return (state.players || []).find(p => String(p.id) === String(id));
}

function getClubBySlug(slug) {
  return (state.clubs || []).find(c => c.slug === slug);
}

// Try locating a club by slug first, then by display name (case-insensitive)
function findClubByInput(input) {
  const s = (input || "").trim();
  if (!s) return null;
  const lc = s.toLowerCase();
  return getClubBySlug(s) ||
         (state.clubs || []).find(c => c.name?.toLowerCase() === lc);
}

function remainingPlayers() {
  return (state.players || []).filter(p => p.status !== "won" && p.status !== "lost");
}

function clearPicker() {
  const input = document.getElementById("startName");
  if (input) input.value = "";
}

function afterAssignmentRefresh() {
  persist();
  render();
  clearPicker();
  const passPanel = document.getElementById("passPanel");
  if (passPanel) passPanel.style.display = "none";
}






function remainingSlots() {
  const my = clubStats(state.myClubSlug);
  const taken = my.count;
  return Math.max(0, (state.playersNeeded || 15) - taken);
}

function guardrailOK(bid) {
  const slotsLeft = remainingSlots();
  const my = clubStats(state.myClubSlug);
  const start = my.club ? (my.club.starting_budget ?? 15000) : (state.totalPoints || 15000);
  const spent = my.spend;
  const budgetLeft = Math.max(0, (typeof my.budgetLeft === "number" ? my.budgetLeft : start - spent));
  const reserve = Math.max(0, (slotsLeft - 1) * (state.minBasePerPlayer || 500));
  return bid <= Math.max(0, budgetLeft - reserve);
}

/* ===========================
   Supabase (optional)
=========================== */
function supabaseAvailable() {
  return !!(window.ENV?.SUPABASE_URL && window.ENV?.SUPABASE_ANON_KEY && window.supabase?.createClient);
}

let sb = null;
if (supabaseAvailable()) {
  sb = window.supabase.createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY);
}

// DB helpers (no-ops if Supabase not present)
async function fetchClubs() {
  if (!sb) return state.clubs || [];
  const { data, error } = await sb.from("clubs").select("*").order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function createClubDB({ slug, name, logo_url, starting_budget }) {
  if (!sb) return; // local fallback used elsewhere
  const { error } = await sb.from("clubs").insert({
    slug, name, logo_url: logo_url || null,
    starting_budget: starting_budget ?? 15000,
    budget_left: starting_budget ?? 15000
  });
  if (error) throw error;
}
async function updateBudgetDB(club_id, delta) {
  if (!sb) return;
  const { error } = await sb.rpc("adjust_budget", { p_club_id: club_id, p_delta: delta });
  if (error) throw error;
}

/* ===========================
   Clubs core
=========================== */
function getOtherClubs() {
  const all = Array.isArray(state.clubs) ? state.clubs : [];
  return all.filter(c => c.slug !== state.myClubSlug);
}

function clubStats(slug) {
  const club = (state.clubs || []).find(c => c.slug === slug);
  if (!club) return { club: null, count: 0, spend: 0, budgetLeft: 0, players: [] };
  const players = (state.players || []).filter(p => p.status === "won" && p.owner === slug);
  const spend = players.reduce((s, p) => s + (toNum(p.finalBid, 0)), 0);
  const dbLeft = (typeof club.budget_left === "number") ? club.budget_left : null;
  const start = toNum(club.starting_budget ?? state.totalPoints, state.totalPoints);
  const derivedLeft = Math.max(0, start - spend);
  return { club, count: players.length, spend, budgetLeft: dbLeft ?? derivedLeft, players };
}

async function ensureMyClubSeeded() {
  // load from DB if possible
  try {
    state.clubs = await fetchClubs();
  } catch (e) {
    console.warn("fetchClubs failed:", e);
    state.clubs = state.clubs || [];
  }
  const hrbSlug = state.myClubSlug;
  const found = state.clubs.find(c => c.slug === hrbSlug);
  if (!found) {
    const start = state.totalPoints || 15000;
    if (sb) {
      try {
        await createClubDB({ slug: hrbSlug, name: "High Range Blasters", logo_url: "./assets/hrb.svg", starting_budget: start });
        state.clubs = await fetchClubs();
      } catch (e) {
        console.warn("createClubDB failed, falling back local:", e);
        state.clubs.push({ id: "local-hrb", slug: hrbSlug, name: "High Range Blasters", logo_url: "./assets/hrb.svg", starting_budget: start, budget_left: start });
      }
    } else {
      // local fallback
      state.clubs.push({ id: "local-hrb", slug: hrbSlug, name: "High Range Blasters", logo_url: "./assets/hrb.svg", starting_budget: start, budget_left: start });
    }
  }
  persist();
}

async function addClubLocal({ name, logo_url, starting_budget }) {
  if (!state.clubs) state.clubs = [];
  const slug = slugify(name);
  if (!slug) throw new Error("Club name required.");
  if (state.clubs.some(c => c.slug === slug)) throw new Error("A club with this name already exists.");
  const start = toNum(starting_budget, 15000);
  state.clubs.push({
    id: `local-${Date.now()}`,
    slug,
    name: name.trim(),
    logo_url: logo_url || null,
    starting_budget: start,
    budget_left: start
  });
  persist();
}

async function addClubAndRefresh({ name, logo_url, starting_budget }) {
  const slug = slugify(name);
  if (!slug) throw new Error("Club name required.");

  const start = toNum(starting_budget, 15000);
  if (sb) {
    await createClubDB({ slug, name: name.trim(), logo_url: (logo_url || null), starting_budget: start });
    state.clubs = await fetchClubs();
    persist();
  } else {
    await addClubLocal({ name, logo_url, starting_budget: start });
  }
}
// --- Google Sheets URL normalizer (accepts /edit, /view, share links) ---
function normalizeGsheetsCsvUrl(url) {
  // already a published CSV
  if (/[\?&]output=csv\b/i.test(url)) return url;

  // /gviz/tq works for most sheets even if not "published to web"
  // e.g. https://docs.google.com/spreadsheets/d/<ID>/edit#gid=<GID>
  const m = url.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)/i);
  if (!m) return url; // not a sheets URL
  const id = m[1];

  // Try to extract gid
  const gidMatch = url.match(/[?#&]gid=(\d+)/i);
  const gid = gidMatch ? gidMatch[1] : null;

  // Build a gviz CSV URL
  const base = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
  return gid ? `${base}&gid=${gid}` : base;
}

/* ===========================
   Players helpers
=========================== */
function setActivePlayer(id) {
  state.activeId = id;
  persist();
  render();
}

// HRB (my club) wins
async function markWon(playerId, finalBid) {
  const p = findPlayerById(playerId);
  if (!p) { alert("Player not found."); return; }
  const price = Number(finalBid);
  if (!Number.isFinite(price) || price < 0) { alert("Enter a valid final bid."); return; }

  p.status   = "won";
  p.owner    = state.myClubSlug;       // your club slug (e.g., 'hrb')
  p.finalBid = price;

  // Optional: deduct from my club budget if you track it
  const me = getClubBySlug(state.myClubSlug);
  if (me && typeof me.budget === "number") {
    me.budget = Math.max(0, me.budget - price);
  }

  afterAssignmentRefresh();
}


/* ===========================
   Rendering
=========================== */


function renderPlayersList() {
  const listEl   = document.getElementById("playersList");
  const countEl  = document.getElementById("playersCount");
  if (!listEl) return;

  const remain = remainingPlayers();

  // Count label: "90 left" etc.
  if (countEl) countEl.textContent = `(${remain.length} left)`;

  const items = remain.map(p => {
    const ownerName = p.owner ? ((state.clubs || []).find(c => c.slug === p.owner)?.name || p.owner) : "";
    // compact meta (no base unless present)
    const bits = [];
    if (p.rating != null) bits.push(`Rating ${p.rating}`);
    if (p.category)       bits.push(`Cat ${p.category}`);
    if (p.role)           bits.push(p.role);
    if (p.alumni)         bits.push(p.alumni);
    const meta = bits.join(" · ");

    return `
      <div class="card" style="padding:10px;margin-bottom:8px">
        <div><b>${p.name || "-"}</b></div>
        <div class="meta">${meta}</div>
        <!-- No Start Bid button here by design -->
      </div>
    `;
  }).join("");

  listEl.innerHTML = items || `<div class="hint">No remaining players.</div>`;
}

  root.innerHTML = items || `<div class="hint">Import players to begin.</div>`;

  // wire
  root.querySelectorAll("[data-action='start']").forEach(btn => {
    btn.addEventListener("click", () => setActivePlayer(btn.getAttribute("data-id")));
  });

  // count
  const pc = $("playersCount");
  if (pc) pc.textContent = state.players?.length ? `(${state.players.length})` : "";
}

function renderOtherClubsPanel() {
  const root = $("otherClubsPanel");
  if (!root) return;
  const others = getOtherClubs();
  const blocks = others.map(c => {
    const stats = clubStats(c.slug);
    const list = stats.players.length
      ? stats.players.map(p => `
          <div class="item" style="padding:6px 0;border-bottom:1px solid #f3f4f6">
            <div><b>${p.name}</b></div>
            <div class="meta">#${p.rank ?? "-"} · Cat ${p.category ?? "-"} · ${p.role ?? ""}</div>
            <div class="meta">Bid: <b>${p.finalBid ?? "-"}</b></div>
          </div>
        `).join("")
      : `<div class="hint">No players yet.</div>`;
    return `
      <div class="card" style="padding:12px">
        <div class="row">
          ${c.logo_url ? `<img src="${c.logo_url}" alt="${c.name}" style="width:36px;height:36px;border-radius:999px;object-fit:cover;margin-right:8px;" />`
                        : `<div style="width:36px;height:36px;border-radius:999px;background:#e5e7eb;margin-right:8px;"></div>`}
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

async function wirePassPanelForPlayer(p) {
  const passPanel = $("passPanel");
  const passClubInput = $("passClubInput");   // <input list="clubNames">
  const passBidAmount = $("passBidAmount");
  const passPanelMsg = $("passPanelMsg");
  const datalist = $("clubNames");            // <datalist id="clubNames">
  if (!passPanel || !passClubInput || !passBidAmount || !datalist) return;

  // ensure clubs available
  try {
    if ((!state.clubs || !state.clubs.length) && sb) {
      state.clubs = await fetchClubs();
      persist();
    }
  } catch (e) {
    console.warn("fetchClubs failed:", e);
  }

  const others = getOtherClubs();
  passPanel.style.display = "";
  passBidAmount.value = String(p.base || 0);
  passPanelMsg.textContent = "";

  if (!others.length) {
    datalist.innerHTML = "";
    passPanelMsg.textContent = "No other clubs found. Create clubs first in the Add Club section.";
    return;
  }

  // Fill the datalist for type-to-search
  datalist.innerHTML = others.map(c => `<option value="${c.name}"></option>`).join("");

  // Rebind Assign button (drop old listeners)
  const assignBtn = $("btn-assign-to-club");
  if (!assignBtn) return;
  assignBtn.replaceWith(assignBtn.cloneNode(true));
  const freshAssign = $("btn-assign-to-club");
  freshAssign.addEventListener("click", async () => {
    passPanelMsg.textContent = "";

    const typed = (passClubInput.value || "").trim().toLowerCase();
    let club = null;
    if (typed) {
      club = others.find(c => (c.name || "").toLowerCase() === typed) ||
             others.find(c => (c.name || "").toLowerCase().startsWith(typed));
    }
    if (!club) { passPanelMsg.textContent = "Pick a valid club from the list (start typing)."; return; }

    const winningBid = Math.max(0, toNum(passBidAmount.value, p.base));

    // local update
    state.players = state.players.map(x =>
      x.id === p.id ? ({ ...x, status: "won", owner: club.slug, finalBid: winningBid }) : x
    );
    state.log.push({ type: "lost", id: p.id, owner: club.slug, bid: winningBid });
    state.activeId = null;
    persist();

    // db budget adjust + refresh clubs
    try {
      if (club.id && sb) await updateBudgetDB(club.id, -winningBid);
      if (sb) { state.clubs = await fetchClubs(); persist(); }
    } catch (e) {
      console.warn("updateBudgetDB/fetchClubs failed:", e);
    }

    render();
  });
}


async function renderLiveBid(){
  const live = $("liveBid");
  if (!live) return;

  const p = (state.players || []).find(x => x.id === state.activeId);
  if (!p) {
    live.innerHTML = `<div class="hint">Pick a player via <b>Start Bid</b> above.</div>`;
    if ($("passPanel")) $("passPanel").style.display = "none";
    return;
  }
// --- NEW advice panel (safe strings) ---
const pr = classifyPriority(p.rating);
const need = rosterNeeds();

const adviceParts = [];
if (pr === "must")      adviceParts.push("High rating – recommended to bid.");
else if (pr === "try")  adviceParts.push("Good rating – consider bidding.");
else                    adviceParts.push("Low priority – bid only if price is right.");

if (p.is_wk && need.wkNeed > 0) adviceParts.push(`Team still needs WKs (${need.wkNeed} remaining).`);
if (isRightHand(p.batting_hand) && need.rhNeed > 0) adviceParts.push(`Team needs Right-hand batters (${need.rhNeed} remaining).`);

const adviceHTML =
  `<div class="card" style="margin-top:8px;padding:10px;background:#f8fafc;border-left:4px solid #0ea5e9">
     <div class="row" style="gap:8px;align-items:center">
       ${priorityBadge(pr)}
       <span>${adviceParts.join(" ")}</span>
     </div>
   </div>`;

live.insertAdjacentHTML("beforeend", adviceHTML);

  live.innerHTML = `
    <div class="card" style="padding:12px">
      <div class="row" style="justify-content:space-between;gap:8px">
        <div>
          <div class="title"><b>${p.name || "-"}</b></div>
          <div class="meta">Cat ${p.category ?? "-"} · ${p.role || ""}</div>

        </div>
        <div class="meta">Base: <b>${p.base ?? "-"}</b></div>
      </div>
      <div class="row" style="gap:6px;margin-top:8px">
        <input id="bidInput" type="number" placeholder="${p.base ?? 0}" style="min-width:140px" />
        <button class="btn" id="btn-bid-base">Base</button>
        <button class="btn" id="btn-plus10">+10</button>
        <button class="btn primary" id="btn-mark-won">Mark Won</button>
        <button class="btn" id="btn-pass">Pass</button>
      </div>
      <div id="bidWarn" class="hint" style="margin-top:6px"></div>
    </div>
  `;

  const bidInput = $("bidInput");
  const warn = $("bidWarn");

  function validate(){
    const bid = toNum(bidInput.value, p.base);
    const ok = guardrailOK(bid);
    warn.textContent = ok ? "" : `Warning: this bid risks future slots — keep ≥ ${Math.max(0,(remainingSlots()-1)*state.minBasePerPlayer)}`;
    return ok;
  }
  validate();

  $("btn-bid-base")?.addEventListener("click", ()=>{ bidInput.value = p.base; validate(); });
  $("btn-plus10")?.addEventListener("click", ()=>{ bidInput.value = String(Math.max(p.base, toNum(bidInput.value, p.base)+10)); validate(); });
  $("btn-mark-won")?.addEventListener("click", ()=>{
    const bid = toNum(bidInput.value, p.base);
    if (!guardrailOK(bid)) { alert("Guardrail violated. Reduce bid."); return; }
    markWon(p.id, bid);
  });
  $("btn-pass")?.addEventListener("click", () => {
    const passPanel = $("passPanel");
    if (passPanel) passPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }, { once: true });

  await wirePassPanelForPlayer(p);
}

function render() {
  renderPlayersList();
  renderOtherClubsPanel();
  renderLiveBid();
}

/* ===========================
   Create Club UI wiring
=========================== */
function wireCreateClubUI() {
  const btn = $("btnCreateClub");
  const nameEl = $("clubName");
  const logoEl = $("clubLogo");
  const budgetEl = $("clubBudget");
  const msgEl = $("clubCreateMsg");
  if (!btn || !nameEl || !budgetEl) return;

  btn.onclick = null;
  btn.addEventListener("click", async () => {
    msgEl.textContent = "";
    const name = (nameEl.value || "").trim();
    const logo = (logoEl?.value || "").trim();
    const budget = (budgetEl.value || "").trim();
    if (!name) { msgEl.textContent = "Enter a club name."; return; }

    try {
      await addClubAndRefresh({ name, logo_url: logo, starting_budget: budget });
      nameEl.value = ""; if (logoEl) logoEl.value = ""; budgetEl.value = "";
      msgEl.textContent = "Club created.";
      renderOtherClubsPanel();
    } catch (e) {
      console.error("create club failed:", e);
      msgEl.textContent = "Error: " + (e?.message || e);
    }
  });
}
// --- CSV parsing helpers (robust; quoted fields & flexible headers) ---
function splitCsv(text) {
  const rows = [];
  let cur = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i+1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { cur.push(field); field = ""; }
      else if (ch === '\n' || ch === '\r') {
        // end of row; also skip \r\n double-count
        if (field.length || cur.length) { cur.push(field); rows.push(cur); }
        field = ""; cur = [];
        if (ch === '\r' && next === '\n') i++;
      } else field += ch;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[._-]+/g, " ");
}

// STRICT parser — reads only what the sheet provides.
// Expected headers (case/spacing doesn’t matter):
//   Name / Player Name
//   Rank
//   Category (optional)
//   Role (optional)
//   Bid / Start Bid / Seed (optional)  <-- if missing, we leave it empty
// STRICT parser — your sheet is the source of truth.
// Recognized headers (case/spacing doesn't matter):
//   Name / Player Name (required)
//   Rating / Rank / Rating10 / Grade (we store in .rating)
//   Role / Playing Role / Type (optional)
//   Batting Hand / Batting_Hand / Hand (optional; "Right Hand Bat", "RHB", "Right")
//   WK / Wicket Keeper / Is_WK (optional; yes/true/1 = keeper)
//   Base / Seed / Start Bid (optional; if absent -> base=null)
// STRICT parser — your CSV is the source of truth.
// Recognized headers (case/spacing doesn't matter):
//   Name / Player Name (required)
//   Rating / Rank / Rating10 / Grade (stored as .rating for priority)
//   Alumni / College / Institute (optional; shown in type-ahead)
//   Role / Playing Role / Type (optional)
//   Batting Hand / Batting_Hand / Hand (optional; "Right", "RHB")
//   WK / Wicket Keeper / Is_WK (optional; yes/true/1)
//   Base / Seed / Start Bid (optional; if absent -> base=null)
//   Category / Cat (optional)
function parseCSVPlayers(raw) {
  const rows = splitCsv(raw).filter(r => r.some(c => String(c).trim() !== ""));
  if (!rows.length) return [];

  const headerRowIdx = rows.findIndex(r => {
    const h = r.map(normalizeHeader);
    return h.includes("name") || h.includes("player name") || h.includes("player");
  });
  if (headerRowIdx < 0) return [];

  const header = rows[headerRowIdx].map(normalizeHeader);
  const body   = rows.slice(headerRowIdx + 1);

  const idx = (...aliases) => {
    for (const a of aliases) {
      const i = header.indexOf(a);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iName   = idx("name","player name","player");
  const iRate   = idx("rating","rank","rating10","grade");
  const iAlmn   = idx("alumni","college","institute");
  const iRole   = idx("role","playing role","type");
  const iHand   = idx("batting hand","batting_hand","hand");
  const iWK     = idx("wk","wicket keeper","is_wk","keeper");
  const iBase   = idx("base","seed","start bid","seed base","base value");
  const iCat    = idx("category","cat");

  const yes = (v) => /^(true|yes|y|1)$/i.test(String(v || "").trim());

  const players = [];
  body.forEach((cols) => {
    const name = (cols[iName] || "").trim();
    if (!name) return;

    const ratingRaw = iRate >= 0 ? String(cols[iRate]).trim() : "";
    const rating = ratingRaw === "" ? null : Number(ratingRaw);

    const alumni = iAlmn >= 0 ? String(cols[iAlmn]).trim() : "";
    const role   = iRole >= 0 ? String(cols[iRole]).trim()   : "";
    const hand   = iHand >= 0 ? String(cols[iHand]).trim()   : "";
    const isWK   = iWK  >= 0 ? yes(cols[iWK]) : /wk|keeper/i.test(role);
    const base   = (iBase >= 0 && String(cols[iBase]).trim() !== "") ? Number(cols[iBase]) : null;
    const cat    = iCat >= 0 ? String(cols[iCat]).trim() : "";

    players.push({
      id: String(players.length + 1),
      name,
      rating,               // priority badge uses this
      alumni,               // shown in picker
      role,
      batting_hand: hand,
      is_wk: !!isWK,
      base,                 // will be ignored/displayed only if present
      category: cat,
      status: "new"         // new | won | lost
    });
  });

  return players;
}


/* ===========================
   CSV Import (URL + Paste)
=========================== */
function wireCsvImportUI() {
  const urlEl   = document.getElementById("csvUrl");
  const pasteEl = document.getElementById("csvPaste");
  const msgEl   = document.getElementById("importMsg");

  const btnFetch      = document.getElementById("btn-fetch");
  const btnImport     = document.getElementById("btn-import");
  const btnClearUrl   = document.getElementById("btn-clear-url");
  const btnClearPaste = document.getElementById("btn-clear-paste");

  const setMsg = (t) => { if (msgEl) msgEl.textContent = t; };

  // Fetch CSV from Google Sheets (published-to-web CSV)
  // Fetch CSV from Google Sheets (published-to-web OR normal share link)
// Fetch CSV from Google Sheets (published-to-web OR normal share link)
if (btnFetch && urlEl) {
  btnFetch.onclick = null;
  btnFetch.addEventListener("click", async () => {
    try {
      setMsg("");
      const rawUrl = (urlEl.value || "").trim();
      if (!rawUrl) { setMsg("Enter a Google Sheet URL"); return; }
      const url = normalizeGsheetsCsvUrl(rawUrl);
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      if (pasteEl) pasteEl.value = text;
      setMsg("Fetched CSV — click Import to load players.");
    } catch (e) {
      console.error("Fetch CSV failed:", e);
      setMsg("Fetch failed. If the sheet is private, either publish to web (CSV) or paste the CSV.");
    }
  });
}



  // Import from textarea using robust parser
  if (btnImport && pasteEl) {
    btnImport.onclick = null;
    btnImport.addEventListener("click", () => {
      try {
        setMsg("");
        const raw = (pasteEl.value || "").trim();
        if (!raw) { setMsg("Paste CSV data first or use Fetch CSV."); return; }

        const players = parseCSVPlayers(raw);
        if (!players.length) { setMsg("No players detected. Check header row or paste raw lines."); return; }

        state.players = players;
        // Keep your configured totals if already set; otherwise default
        state.playersNeeded    = state.playersNeeded || 15;
        state.totalPoints      = state.totalPoints   || 15000;
        state.minBasePerPlayer = state.minBasePerPlayer || 500;
        persist();

        render();
        setMsg(`Imported ${players.length} players.`);
        document.getElementById("playersList")?.scrollIntoView({ behavior:"smooth", block:"start" });
      } catch (e) {
        console.error("Import failed:", e);
        setMsg("Import failed. See console for details.");
      }
    });
  }

  // Clear helpers
  if (btnClearUrl && urlEl) {
    btnClearUrl.onclick = null;
    btnClearUrl.addEventListener("click", () => { urlEl.value = ""; setMsg(""); });
  }
  if (btnClearPaste && pasteEl) {
    btnClearPaste.onclick = null;
    btnClearPaste.addEventListener("click", () => { pasteEl.value = ""; setMsg(""); });
  }
}
function wireStartBidUI() {
  const input   = document.getElementById("startName");
  const results = document.getElementById("startResults");
  const btnSet  = document.getElementById("btn-start-bid");
  if (!input || !results || !btnSet) return;

  let highlight = -1, currentList = [];

  function closeMenu(){ results.style.display = "none"; results.innerHTML = ""; highlight = -1; currentList = []; }
  function showMenu(html){ results.innerHTML = html; results.style.display = "block"; }

  function filterPlayers(q) {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const remain = (state.players || []).filter(p => p.status === "new"); // only remaining
    const scored = remain.map(p => {
      const combo = `${p.name} ${p.alumni || ""}`.toLowerCase();
      let score = -1;
      if (combo.startsWith(s)) score = 2;
      else if (combo.includes(s)) score = 1;
      return { p, score };
    }).filter(x => x.score >= 0);
    scored.sort((a,b) => {
      if (b.score !== a.score) return b.score - a.score;
      // secondary by rating desc if available
      const ra = (a.p.rating ?? -1), rb = (b.p.rating ?? -1);
      if (rb !== ra) return rb - ra;
      return a.p.name.localeCompare(b.p.name);
    });
    return scored.slice(0, 12).map(x => x.p);
  }

  function renderMenu(list){
    if (!list.length) { closeMenu(); return; }
    const html = list.map((p, i) => `
      <div class="ta-item" data-i="${i}" style="padding:6px 8px;cursor:pointer">
        <div><b>${p.name}</b></div>
        <div class="meta">${p.alumni ? p.alumni : ""}</div>
      </div>
    `).join("");
    showMenu(html);
    Array.from(results.querySelectorAll(".ta-item")).forEach(el=>{
      el.addEventListener("mouseenter", ()=>{ highlight = Number(el.dataset.i); });
      el.addEventListener("mouseleave", ()=>{ highlight = -1; });
      el.addEventListener("click", ()=> choose(Number(el.dataset.i)));
    });
  }

  function choose(idx){
    const p = currentList[idx];
    if (!p) return;
    input.value = `${p.name}`;        // only name in input
    setActivePlayer(p.id);            // seed/base is NOT touched
    closeMenu();
  }

  input.addEventListener("input", () => { currentList = filterPlayers(input.value || ""); renderMenu(currentList); });
  input.addEventListener("keydown", (e) => {
    if (results.style.display !== "block") return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlight = Math.min(currentList.length-1, highlight+1); }
    if (e.key === "ArrowUp")   { e.preventDefault(); highlight = Math.max(0, highlight-1); }
    if (e.key === "Enter")     { e.preventDefault(); choose(highlight >= 0 ? highlight : 0); }
  });
  document.addEventListener("click", (e)=>{ if (!results.contains(e.target) && e.target !== input) closeMenu(); });
  btnSet.onclick = () => {
    const list = filterPlayers(input.value || "");
    if (list.length) { setActivePlayer(list[0].id); closeMenu(); }
  };
}
  input.addEventListener("input", () => {
    const q = input.value || "";
    currentList = filterPlayers(q);
    renderMenu(currentList);
  });

  input.addEventListener("keydown", (e) => {
    if (results.style.display !== "block") return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlight = Math.min(currentList.length-1, highlight+1); }
    if (e.key === "ArrowUp")   { e.preventDefault(); highlight = Math.max(0, highlight-1); }
    if (e.key === "Enter")     { e.preventDefault(); choose(highlight >= 0 ? highlight : 0); }
  });

  document.addEventListener("click", (e)=>{
    if (!results.contains(e.target) && e.target !== input) closeMenu();
  });

  btnSet.onclick = () => {
    const q = (input.value || "").trim().toLowerCase();
    if (!q) return;
    const list = filterPlayers(q);
    if (list.length) {
      if (seedEl) seedEl.value = list[0].base ?? "";
      setActivePlayer(list[0].id);
      closeMenu();
    }
  };
}

/* ===========================
   Boot
=========================== */
async function boot() {
  load();
  await ensureMyClubSeeded();
  wireCreateClubUI();
  wireCsvImportUI();
  wireStartBidUI();           // <-- add this
  render();
}


// Expose for index.html safe-loader
window.boot = window.boot || boot;
window.render = window.render || render;

document.addEventListener("DOMContentLoaded", () => { boot(); });
