/* assets/app.js — HRB Auction Assist (clubs + pass panel + local/Supabase)
   Paste this file as-is. It works with or without Supabase.
   If you want Supabase, set window.ENV = { SUPABASE_URL, SUPABASE_ANON_KEY } in index.html
   and load the UMD: <script src="https://unpkg.com/@supabase/supabase-js@2"></script> BEFORE this module.
*/

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

/* ===========================
   Players helpers
=========================== */
function setActivePlayer(id) {
  state.activeId = id;
  persist();
  render();
}

async function markWon(id, bid) {
  const winningBid = Math.max(0, toNum(bid, 0));
  state.players = state.players.map(p => p.id === id ? { ...p, status: "won", owner: state.myClubSlug, finalBid: winningBid } : p);
  state.log.push({ type: "won", id, bid: winningBid });
  state.activeId = null;
  persist();
  try {
    const hrb = (state.clubs || []).find(c => c.slug === state.myClubSlug);
    if (hrb?.id && sb) {
      await updateBudgetDB(hrb.id, -winningBid);
      state.clubs = await fetchClubs();
      persist();
    }
  } catch (e) {
    console.warn("updateBudgetDB(HRB) failed:", e);
  }
  render();
}

/* ===========================
   Rendering
=========================== */
function renderPlayersList() {
  const root = $("playersList");
  if (!root) return;
  const items = (state.players || []).map(p => {
    const ownerName = p.owner ? ((state.clubs || []).find(c => c.slug === p.owner)?.name || p.owner) : "";
    return `
      <div class="card" style="padding:10px;margin-bottom:8px">
        <div class="row" style="justify-content:space-between;gap:8px">
          <div>
            <div><b>${p.name || "-"}</b></div>
            <div class="meta">Cat ${p.category ?? "-"} · Rank ${p.rank ?? "-"} · ${p.role || ""}</div>
          </div>
          <div class="meta">
            Base: <b>${p.base ?? "-"}</b><br/>
            ${p.status === "won" ? `Won by <b>${ownerName}</b> @ <b>${p.finalBid ?? "-"}</b>` : (p.status === "lost" ? `Passed` : ``)}
          </div>
        </div>
        <div class="row" style="gap:6px;margin-top:8px">
          <button class="btn" data-action="start" data-id="${p.id}">Start Bid</button>
        </div>
      </div>
    `;
  }).join("");
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

  live.innerHTML = `
    <div class="card" style="padding:12px">
      <div class="row" style="justify-content:space-between;gap:8px">
        <div>
          <div class="title"><b>${p.name || "-"}</b></div>
          <div class="meta">Cat ${p.category ?? "-"} · Rank ${p.rank ?? "-"} · ${p.role || ""}</div>
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

function parseCSVPlayers(raw) {
  const rows = splitCsv(raw).filter(r => r.some(c => String(c).trim() !== ""));
  if (!rows.length) return [];

  // Find header row: first row that contains at least 2 of the known columns
  const headerRowIdx = rows.findIndex(r => {
    const h = r.map(normalizeHeader);
    const known = ["name","player name","player","category","cat","rank","#","base","base value","seed","seed base","role","playing role","type"];
    const hits = h.filter(x => known.includes(x)).length;
    return hits >= 2;
  });

  // If a header exists, use it
  if (headerRowIdx >= 0) {
    const header = rows[headerRowIdx].map(normalizeHeader);
    const body = rows.slice(headerRowIdx + 1);

    // Index helpers: try several aliases
    const idxOf = (names) => {
      for (const n of names) {
        const i = header.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };

    const nameI = idxOf(["name","player name","player"]);
    const catI  = idxOf(["category","cat","category no"]);
    const baseI = idxOf(["base","base value","seed","seed base","seed base value"]);
    const rankI = idxOf(["rank","#","s no","s. no","s. no."]);
    const roleI = idxOf(["role","playing role","type"]);

    const players = [];
    body.forEach((cols, i) => {
      const name = (cols[nameI] || "").trim();
      if (!name) return;
      const p = {
        id: String(players.length + 1),
        name,
        base: Number(cols[baseI]) || 500,
        category: (cols[catI] || "").toString().trim(),
        rank: Number(cols[rankI]) || (players.length + 1),
        role: (cols[roleI] || "").toString().trim(),
        status: "new",
      };
      players.push(p);
    });
    if (players.length) return players;
    // fallthrough to loose mode if header produced nothing
  }

  // Fallback: parse free-form “Bidded …” or serial lines
  const players = rows.map((r, i) => {
    const line = r.join(" ").trim();
    let name =
      (line.match(/bidded\s+([^,0-9][^,]+)/i)?.[1] || "") ||
      (line.match(/^\s*\d+\s*[\.\-]?\s*([A-Za-z][A-Za-z\s.'-]{2,})/)?.[1] || "");
    name = name.trim();
    if (!name) name = `Player ${i + 1}`;

    const nums = [...line.matchAll(/(\d{3,4})/g)].map(m => Number(m[1]));
    const base = nums.length ? nums[nums.length - 1] : 500;

    return {
      id: String(i + 1),
      name,
      base,
      category: "",
      rank: i + 1,
      role: "",
      status: "new",
    };
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
      } catch (e) {
        console.error("Fetch CSV failed:", e);
        setMsg("Fetch failed. Ensure the sheet is 'Published to the web' and URL ends with output=csv.");
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

/* ===========================
   Boot
=========================== */
async function boot() {
  load();
  await ensureMyClubSeeded();
  wireCreateClubUI();
  wireCsvImportUI();
  // (Do NOT call "wireStartBidUI?.()"; that syntax throws if not defined)
  render();
}

// Expose for index.html safe-loader
window.boot = window.boot || boot;
window.render = window.render || render;

document.addEventListener("DOMContentLoaded", () => { boot(); });
