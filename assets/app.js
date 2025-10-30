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

  // categories (editable in settings if you have a UI)
  catBase: { c1:1500, c2:1200, c3:900, c4:700, c5:500 },

  // setup/auth (no-op by default)
  auth: { loggedIn: true },
  setup: { done: true },

  // clubs
  myClubSlug: "high-range-blasters",
  clubs: [] // [{id,slug,name,logo_url,starting_budget,budget_left}]
};

function persist() {
  try {
    localStorage.setItem("hrb-auction-state", JSON.stringify(state));
  } catch {}
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
  // very simple guard: keep at least minBasePerPlayer for each remaining slot (except the current)
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
function goToBid() {
  const live = document.getElementById("liveBid");
  if (live) live.scrollIntoView({ behavior: "smooth", block: "start" });
}

function wireGoToBid() {
  const btn = document.getElementById("btnGoToBid");
  if (!btn) return;
  btn.onclick = null;
  btn.addEventListener("click", goToBid);
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
  const passClubInput = $("passClubInput");
  const passClubSelect = $("passClubSelect");
  const passBidAmount = $("passBidAmount");
  const passPanelMsg = $("passPanelMsg");
  const datalist = $("clubNames");
  if (!passPanel || !passClubInput || !passClubSelect || !passBidAmount || !datalist) return;

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
    passClubSelect.innerHTML = `<option value="">-- no clubs yet --</option>`;
    passPanelMsg.textContent = "No other clubs found. Create clubs first in the Add Club section.";
    return;
  }

  datalist.innerHTML = others.map(c => `<option value="${c.name}"></option>`).join("");
  passClubSelect.innerHTML = `<option value="">-- choose club --</option>` +
    others.map(c => `<option value="${c.slug}">${c.name}</option>`).join("");

  // Assign (attach once per render)
  const assignBtn = $("btn-assign-to-club");
  assignBtn?.replaceWith(assignBtn.cloneNode(true)); // drop previous listeners
  const freshAssign = $("btn-assign-to-club");
  freshAssign?.addEventListener("click", async () => {
    passPanelMsg.textContent = "";

    let club = null;
    if (passClubSelect.value) {
      club = others.find(c => c.slug === passClubSelect.value);
    } else if (passClubInput.value.trim()) {
      const name = passClubInput.value.trim().toLowerCase();
      club = others.find(c => (c.name || "").toLowerCase() === name) ||
             others.find(c => (c.name || "").toLowerCase().startsWith(name));
    }
    if (!club) { passPanelMsg.textContent = "Pick a valid club using dropdown or start typing the club name."; return; }

    const winningBid = Math.max(0, toNum(passBidAmount.value, p.base));

    // local update
    state.players = state.players.map(x =>
      x.id === p.id ? ({ ...x, status: "won", owner: club.slug, finalBid: winningBid }) : x
    );
    state.log.push({ type: "lost", id: p.id, owner: club.slug, bid: winningBid });
    state.activeId = null;
    persist();

    // db budget adjust
    try {
      if (club.id && sb) {
        await updateBudgetDB(club.id, -winningBid);
      }
      if (sb) {
        state.clubs = await fetchClubs();
        persist();
      }
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
  if (!p) { live.innerHTML = `<div class="hint">Pick a player via <b>Start Bid</b> above.</div>`; $("passPanel")?.style && ( $("passPanel").style.display = "none"); return; }

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

/* ===========================
   Demo: minimal import helpers
=========================== */
/* If you already have an Import section that populates state.players, keep it.
   Below is an optional, simple CSV URL importer. Put your CSV URL into #csvUrl and click #btnImportCsv
   (columns: id,name,base,category,rank,role)
*/
function wireCsvImportUI() {
  const urlEl = $("csvUrl");
  const btn = $("btnImportCsv");
  const msg = $("importMsg");
  if (!btn || !urlEl) return;
  btn.onclick = null;
  btn.addEventListener("click", async () => {
    msg && (msg.textContent = "");
    const url = (urlEl.value || "").trim();
    if (!url) { msg && (msg.textContent = "Enter CSV URL"); return; }
    try {
      const resp = await fetch(url);
      const txt = await resp.text();
      const rows = txt.trim().split(/\r?\n/);
      const header = rows.shift().split(",");
      const idx = (name) => header.findIndex(h => h.trim().toLowerCase() === name);
      const idI = idx("id"), nameI = idx("name"), baseI = idx("base"), catI = idx("category"), rankI = idx("rank"), roleI = idx("role");
      state.players = rows.map((r, i) => {
        const cols = r.split(",");
        return {
          id: cols[idI] || String(i+1),
          name: cols[nameI] || `Player ${i+1}`,
          base: toNum(cols[baseI], 500),
          category: cols[catI] || "",
          rank: toNum(cols[rankI], i+1),
          role: cols[roleI] || "",
          status: "new"
        };
      });
      persist();
      render();
      msg && (msg.textContent = "Players imported.");
    } catch (e) {
      console.error(e);
      msg && (msg.textContent = "Failed to import CSV.");
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
  render();
}

document.addEventListener("DOMContentLoaded", () => { boot(); });
