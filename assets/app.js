/* assets/app.js — HRB Auction Assist (clean build, no ellipses)
   Works standalone with localStorage. Supabase is optional.
*/

/* ===========================
   State & Persistence
=========================== */
let state = {
  // players
  players: [],            // {id,name,alumni,phone,role,batting_hand,is_wk,rating,category,base,status,finalBid,owner}
  queue: [],              // ids for quick next/prev if you ever use it

  // guardrails/budget
  totalPoints: 15000,
  playersNeeded: 15,
  minBasePerPlayer: 500,  // guardrail floor per remaining slot

  // clubs
  myClubSlug: "high-range-blasters",
  clubs: [],              // {id,slug,name,logo_url,starting_budget,budget_left}

  // ui
  activePlayerId: null
};

function persist() {
  try { localStorage.setItem("hrb-auction-state", JSON.stringify(state)); } catch {}
}
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem("hrb-auction-state") || "{}");
    if (saved && typeof saved === "object") state = { ...state, ...saved };
  } catch {}
}

/* ===========================
   Utilities
=========================== */
const $  = (id) => document.getElementById(id);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
function toNum(v, def=0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function remainingSlots() {
  const mine = (state.players || []).filter(p => p.owner === state.myClubSlug && p.status === "won").length;
  return Math.max(0, (state.playersNeeded || 15) - mine);
}
function remainingBudget(clubSlug) {
  const club = (state.clubs || []).find(c => c.slug === clubSlug);
  if (!club) return 0;
  return toNum(club.budget_left, club.starting_budget || 0);
}
function guardrailOK(bid) {
  const rem = remainingSlots();
  const floor = state.minBasePerPlayer || 500;
  const budget = remainingBudget(state.myClubSlug);
  // Keep both: enough to fill future slots AND within our budget.
  return bid <= budget && budget - bid >= (rem - 1) * floor;
}
function normalizeHeader(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
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

// clubs table helpers (no-ops if Supabase missing). You can wire these later.
async function fetchClubs() {
  if (!sb) return state.clubs || [];
  const { data, error } = await sb.from("clubs").select("*").order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}
async function createClubDB(payload) {
  if (!sb) return null;
  const { error } = await sb.from("clubs").insert(payload);
  if (error) throw error;
  return true;
}
async function updateClubBudget(slug, budget_left) {
  if (!sb) return null;
  const { error } = await sb.from("clubs").update({ budget_left }).eq("slug", slug);
  if (error) throw error;
  return true;
}

/* ===========================
   Clubs: local helpers
=========================== */
async function ensureMyClubSeeded() {
  if (!state.clubs) state.clubs = [];
  const exists = state.clubs.some(c => c.slug === state.myClubSlug);
  if (!exists) {
    const start = state.totalPoints || 15000;
    const hrb = { id: `local-${Date.now()}`, slug: state.myClubSlug, name: "High Range Blasters", logo_url: "./assets/highrange.svg", starting_budget: start, budget_left: start };
    state.clubs.push(hrb);
    persist();
  }
}
function getOtherClubs() {
  return (state.clubs || []).filter(c => c.slug !== state.myClubSlug);
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
    logo_url: logo_url || "",
    starting_budget: start,
    budget_left: start
  });
  persist();
}
function clubStats(slug) {
  const players = (state.players || []).filter(p => p.owner === slug && p.status === "won");
  const spend = players.reduce((s, p) => s + toNum(p.finalBid, 0), 0);
  const c = (state.clubs || []).find(c => c.slug === slug);
  const budgetLeft = c ? toNum(c.starting_budget, 0) - spend : 0;
  return { players, count: players.length, spend, budgetLeft };
}

/* ===========================
   CSV parsing
=========================== */
function splitCsv(text) {
  // simple CSV splitter (handles quotes)
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i=0; i<text.length; i++) {
    const ch = text[i], nx = text[i+1];
    if (inQ) {
      if (ch === '"' && nx === '"') { cell += '"'; i++; continue; }
      if (ch === '"') { inQ = false; continue; }
      cell += ch;
      continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === ",") { row.push(cell); cell=""; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row=[]; cell=""; continue; }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

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

  const iName  = idx("name","player name","player");
  const iRate  = idx("rating","rank","rating10","grade");
  const iAlmn  = idx("alumni","college","institute");
  const iRole  = idx("role","playing role","type");
  const iHand  = idx("batting hand","batting_hand","hand");
  const iWK    = idx("wk","wicket keeper","is_wk","keeper");
  const iBase  = idx("base","seed","start bid","seed base","base value");
  const iCat   = idx("category","cat");
  // phone capture (covers common headings)
  const iPhone = idx("phone","phone number","mobile","mobile number","contact","whatsapp","whatsapp number","ph");

  const yes = (v) => /^(true|yes|y|1)$/i.test(String(v || "").trim());

  const players = [];
  body.forEach((cols, rowIdx) => {
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
    const phone  = iPhone >= 0 ? String(cols[iPhone]).trim() : "";

    players.push({
      id: String(rowIdx + 1),
      name,
      alumni,
      phone,
      role,
      batting_hand: hand,
      is_wk: !!isWK,
      rating,
      category: cat || null,
      base: base == null ? null : base,
      status: "new"
    });
  });

  return players;
}

/* ===========================
   Players & Bid Flow
=========================== */
function setActivePlayer(id) {
  state.activePlayerId = id || null;
  persist();
  renderLiveBid();
}
function getActivePlayer() {
  return (state.players || []).find(p => p.id === state.activePlayerId) || null;
}

function markWon(playerId, price) {
  const p = (state.players || []).find(x => x.id === playerId);
  if (!p) return;
  const bid = toNum(price, p.base || 0);
  if (!guardrailOK(bid)) {
    alert("Guardrail violated. Reduce bid.");
    return;
  }
  p.status = "won";
  p.finalBid = bid;
  p.owner = state.myClubSlug;

  // adjust HRB budget
  const c = (state.clubs || []).find(c => c.slug === state.myClubSlug);
  if (c) {
    c.budget_left = toNum(c.budget_left, c.starting_budget || 0) - bid;
    if (c.budget_left < 0) c.budget_left = 0;
  }
  persist();
  render();
}

function assignToClubByNameOrSlug(playerId, clubText, price) {
  const others = getOtherClubs();
  let club = others.find(c => c.slug === clubText);
  if (!club) {
    const name = String(clubText || "").trim().toLowerCase();
    club = others.find(c => (c.name || "").toLowerCase() === name) ||
           others.find(c => (c.name || "").toLowerCase().startsWith(name));
  }
  if (!club) {
    const msg = $("passPanelMsg");
    if (msg) msg.textContent = "Pick a valid club from the list or start typing its name.";
    return;
  }
  const p = (state.players || []).find(x => x.id === playerId);
  if (!p) return;

  const bid = Math.max(0, toNum(price, p.base || 0));
  p.status = "won";
  p.finalBid = bid;
  p.owner = club.slug;

  club.budget_left = toNum(club.budget_left, club.starting_budget || 0) - bid;
  if (club.budget_left < 0) club.budget_left = 0;

  persist();
  render();
}

/* ===========================
   Renderers
=========================== */
function renderPlayersList() {
  const root = $("playersList");
  const counter = $("playersCount");
  if (!root) return;

  // show only remaining players (not yet assigned to any club)
  const remaining = (state.players || []).filter(p => p.status !== "won");
  if (counter) counter.textContent = `(${remaining.length})`;

  const cards = remaining.map(p => `
    <div class="item" style="padding:10px;border-bottom:1px solid #eee">
      <div class="row" style="justify-content:space-between;gap:8px">
        <div>
          <div><b>${p.name}</b></div>
          <div class="meta">${p.alumni || ""}${p.alumni && p.phone ? " · " : ""}${p.phone || ""}</div>
        </div>
        <button class="btn btn-ghost" data-id="${p.id}" data-action="pick">Pick</button>
      </div>
    </div>
  `).join("");

  root.innerHTML = cards || `<div class="hint">Import players to begin.</div>`;

  root.querySelectorAll("[data-action='pick']").forEach(btn => {
    btn.addEventListener("click", () => setActivePlayer(btn.getAttribute("data-id")));
  });
}

function renderSelectedSquad() {
  const root = $("selectedList");
  if (!root) return;

  const stats = clubStats(state.myClubSlug);
  const header = `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
      <div class="meta">Players: <b>${stats.count}</b></div>
    </div>
  `;

  if (!stats.players.length) {
    root.innerHTML = header + `<div class="hint">No players won yet.</div>`;
    return;
  }

  const list = stats.players.map(p => `
    <div class="card" style="padding:8px;margin-bottom:6px">
      <div><b>${p.name || "-"}</b></div>
      <div class="meta">${p.alumni || ""}${p.alumni && p.phone ? " · " : ""}${p.phone || ""}</div>
    </div>
  `).join("");

  root.innerHTML = header + list;
}

function renderOtherClubsPanel() {
  const root = $("otherClubsPanel");
  if (!root) return;

  const blocks = getOtherClubs().map(c => {
    const stats = clubStats(c.slug);
    const list = stats.players.length
      ? stats.players.map(p => `
          <div class="item" style="padding:6px 0;border-bottom:1px solid #f3f4f6">
            <div><b>${p.name || "-"}</b></div>
            <div class="meta">${p.alumni || ""}${p.alumni && p.phone ? " · " : ""}${p.phone || ""}</div>
          </div>
        `).join("")
      : `<div class="hint">No players yet.</div>`;

    return `
      <div class="card" style="padding:12px">
        <div class="row" style="gap:8px;align-items:center">
          ${c.logo_url ? `<img src="${c.logo_url}" alt="${c.name}" style="width:28px;height:28px;border-radius:999px;object-fit:cover" />` : ""}
          <div><b>${c.name}</b></div>
        </div>
        <div style="margin-top:10px;max-height:220px;overflow:auto">${list}</div>
      </div>
    `;
  }).join("");

  root.innerHTML = blocks || `<div class="hint">Add clubs to see their squads.</div>`;
}

function renderLiveBid() {
  const live = $("liveBid");
  if (!live) return;

  const p = getActivePlayer();
  if (!p) {
    live.innerHTML = `<div class="hint">No active player. Use the Name picker or click Pick on the list.</div>`;
    return;
  }

  live.innerHTML = `
    <div class="card" style="padding:12px">
      <div style="font-size:18px;font-weight:700">${p.name}</div>
      <div class="meta">${p.alumni || ""}${p.alumni && p.phone ? " · " : ""}${p.phone || ""}</div>

      <div class="row" style="gap:8px;margin-top:10px;align-items:flex-end;flex-wrap:wrap">
        <label style="flex:0 1 180px">Bid Amount
          <input id="bidInput" type="number" placeholder="e.g. 900" />
        </label>
        <button id="btn-mark-won" class="btn" disabled>HRB Won</button>
        <button id="btn-pass" class="btn btn-ghost">Pass / Assign</button>
      </div>
      <div id="bidWarn" class="hint" style="margin-top:6px;color:#dc2626"></div>
    </div>
  `;

  const bidEl  = $("bidInput");
  const wonBtn = $("btn-mark-won");
  const warnEl = $("bidWarn");

  // live guardrail validation
  const validateBid = () => {
    const price = Number(bidEl.value);
    if (!Number.isFinite(price) || price < 0) {
      warnEl.textContent = price ? "Enter a valid positive amount." : "";
      wonBtn.disabled = true;
      return false;
    }
    const ok = guardrailOK(price);
    wonBtn.disabled = !ok;
    const floor = Math.max(0, (remainingSlots()-1) * (state.minBasePerPlayer || 500));
    warnEl.textContent = ok ? "" : `Guardrail: risky bid. Keep ≥ ${floor} for remaining slots.`;
    return ok;
  };
  bidEl.addEventListener("input", validateBid);
  validateBid();

  wonBtn.addEventListener("click", () => {
    if (!validateBid()) return;
    markWon(p.id, Number(bidEl.value));
  });

  $("btn-pass")?.addEventListener("click", () => {
    const passPanel = $("passPanel");
    if (passPanel) {
      passPanel.style.display = "block";
      passPanel.scrollIntoView({ behavior: "smooth", block: "center" });
      wirePassPanelForPlayer(p);
    }
  });
}

function render() {
  renderPlayersList();
  renderOtherClubsPanel();
  renderLiveBid();
  renderSelectedSquad();
}

/* ===========================
   Pass / Assign Panel
=========================== */
function wirePassPanelForPlayer(p) {
  const passClubInput = $("passClubInput");
  const datalist = $("clubNames");
  const passClubSelect = $("passClubSelect"); // optional (not in your HTML by default)
  const passBidAmount = $("passBidAmount");
  const passPanelMsg = $("passPanelMsg");

  const others = getOtherClubs();
  if (!datalist) return;
  datalist.innerHTML = others.map(c => `<option value="${c.name}"></option>`).join("");

  // pre-fill price from bid input if present
  if (passBidAmount) passBidAmount.value = $("bidInput")?.value || "";

  const assignBtn = $("btn-assign-to-club");
  if (!assignBtn) return;
  assignBtn.onclick = null;
  assignBtn.addEventListener("click", () => {
    if (passPanelMsg) passPanelMsg.textContent = "";
    const typed = (passClubInput?.value || "").trim() || (passClubSelect?.value || "");
    const price = passBidAmount?.value || "";
    assignToClubByNameOrSlug(p.id, typed, price);
  });
}

/* ===========================
   CSV Import / Export
=========================== */
function wireCsvImportUI() {
  const urlEl = $("csvUrl");
  const pasteEl = $("csvPaste");
  const btnFetch = $("btn-fetch");
  const btnImport = $("btn-import");
  const btnClearUrl = $("btn-clear-url");
  const btnClearPaste = $("btn-clear-paste");
  const msgEl = $("importMsg"); // optional

  const setMsg = (t) => { if (msgEl) msgEl.textContent = t; };

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

  if (btnImport && pasteEl) {
    btnImport.onclick = null;
    btnImport.addEventListener("click", () => {
      try {
        setMsg("");
        const raw = pasteEl.value || "";
        if (!raw.trim()) { setMsg("Paste CSV first or use Fetch CSV."); return; }

        let players = parseCSVPlayers(raw);

        // Fallback if no headers found (treat as simple list: name[,alumni][,phone])
        if (!players.length) {
          const rows = splitCsv(raw);
          players = rows
            .map((r, i) => {
              const name = String(r[0] || "").trim();
              if (!name) return null;
              const alumni = String(r[1] || "").trim();
              const phone  = String(r[2] || "").trim();
              return { id:String(i+1), name, alumni, phone, status:"new" };
            })
            .filter(Boolean);
        }

        state.players = players;
        // Keep queue optional
        state.queue = players.map(p => p.id);

        // Ensure defaults
        state.playersNeeded = state.playersNeeded || 15;
        state.totalPoints = state.totalPoints || 15000;
        state.minBasePerPlayer = state.minBasePerPlayer || 500;

        persist();
        render();
        setMsg(`Imported ${players.length} players.`);
        $("playersList")?.scrollIntoView({ behavior:"smooth", block:"start" });
      } catch (e) {
        console.error("Import failed:", e);
        setMsg("Import failed. Check console for details.");
      }
    });
  }

  if (btnClearUrl && urlEl) {
    btnClearUrl.onclick = null;
    btnClearUrl.addEventListener("click", () => { urlEl.value = ""; if (msgEl) msgEl.textContent=""; });
  }
  if (btnClearPaste && pasteEl) {
    btnClearPaste.onclick = null;
    btnClearPaste.addEventListener("click", () => { pasteEl.value = ""; if (msgEl) msgEl.textContent=""; });
  }
}

function exportWonCSV() {
  const won = (state.players || []).filter(p => p.status === "won");
  const rows = [["Club","Player Name","Alumni","Phone"]];
  won.forEach(p => {
    const club = (state.clubs || []).find(c => c.slug === p.owner);
    rows.push([ club ? club.name : (p.owner || ""), p.name || "", p.alumni || "", p.phone || "" ]);
  });
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(",")).join("\n");

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "auction-won-contacts.csv";
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

function wireExportButton() {
  const btn = $("btn-export");
  if (!btn) return;
  btn.onclick = null;
  btn.addEventListener("click", exportWonCSV);
}

/* ===========================
   Create Club UI
=========================== */
function wireCreateClubUI() {
  const nameEl = $("clubName");
  const logoEl = $("clubLogo");
  const budEl  = $("clubBudget");
  const btn = $("btnCreateClub");
  const msg = $("clubCreateMsg");

  if (!btn) return;
  btn.onclick = null;
  btn.addEventListener("click", async () => {
    try {
      if (msg) msg.textContent = "";
      const name = (nameEl?.value || "").trim();
      const logo = (logoEl?.value || "").trim();
      const start = toNum(budEl?.value, state.totalPoints || 15000);
      if (!name) throw new Error("Enter club name");

      await addClubLocal({ name, logo_url: logo, starting_budget: start });
      if (sb) { try { await createClubDB({ slug: slugify(name), name, logo_url: logo, starting_budget: start }); } catch(e) { console.warn("Supabase create club failed:", e); } }
      if (msg) msg.textContent = "Club created.";
      renderOtherClubsPanel();
    } catch (e) {
      if (msg) msg.textContent = e.message || "Create failed.";
    }
  });
}

/* ===========================
   Start Bid UI: name picker
=========================== */
function wireStartBidUI() {
  const input = $("startName");
  const menu  = $("startResults");
  const btn   = $("btn-start-bid");
  const seed  = $("seedBase");

  if (!input || !menu || !btn) return;

  function filter(q) {
    q = (q || "").trim().toLowerCase();
    if (q.length < 2) return [];
    const cand = (state.players || []).filter(p => p.status !== "won");
    // match on name or alumni
    return cand.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.alumni || "").toLowerCase().includes(q)
    ).slice(0, 10);
  }

  input.addEventListener("input", () => {
    const q = input.value;
    const list = filter(q);
    if (!list.length) {
      menu.style.display = "none";
      menu.innerHTML = "";
      return;
    }
    menu.style.display = "block";
    menu.innerHTML = list.map(p => `
      <div class="ta-item" data-id="${p.id}">${p.name}${p.alumni ? " · " + p.alumni : ""}</div>
    `).join("");

    $$(".ta-item", menu).forEach(el => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id");
        setActivePlayer(id);
        menu.style.display = "none";
        // prefill base if CSV has it; otherwise leave as blank for manual entry
        if (seed) {
          const player = state.players.find(x => x.id === id);
          seed.value = player && Number.isFinite(player.base) ? player.base : "";
        }
      });
    });
  });

  btn.addEventListener("click", () => {
    // allow manual set by typing full/unique name then pressing Set Active
    const q = (input.value || "").trim().toLowerCase();
    if (!q) return;
    const cand = (state.players || []).filter(p => p.status !== "won");
    const exact = cand.find(p =>
      (p.name || "").toLowerCase() === q ||
      ((p.name || "").toLowerCase() + " " + (p.alumni || "").toLowerCase()) === q
    ) || cand.find(p => (p.name || "").toLowerCase().startsWith(q));
    if (exact) {
      setActivePlayer(exact.id);
      if (seed) seed.value = Number.isFinite(exact.base) ? exact.base : "";
    }
  });
}

/* ===========================
   Boot
=========================== */
async function boot() {
  load();
  await ensureMyClubSeeded();
  wireCreateClubUI();
  wireCsvImportUI();
  wireStartBidUI();
  wireExportButton();
  render();
}

document.addEventListener("DOMContentLoaded", boot);
