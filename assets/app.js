/* assets/app.js — HRB Auction Assist (login + settings + guardrails + compliance)
   Works with a plain <script src="./assets/app.js"></script> in index.html
   Baseline taken from your previous version.
*/

/* ===========================
   Tiny Diagnostics
=========================== */
(function () {
  const bar = document.createElement("div");
  bar.id = "diag";
  bar.style.cssText =
    "position:fixed;left:10px;bottom:10px;z-index:99999;background:#111;color:#fff;padding:6px 10px;border-radius:8px;font:12px/1.4 system-ui";
  bar.textContent = "⏳ loading app.js...";
  document.addEventListener(
    "DOMContentLoaded",
    () => (bar.textContent = "✅ DOM ready, booting...")
  );
  window.addEventListener("error", (e) => {
    bar.textContent = "❌ JS error: " + e.message;
  });
  document.body.appendChild(bar);
  window.__diag = (msg) => {
    bar.textContent = "ℹ️ " + msg;
  };
})();

/* ===========================
   State & Persistence
=========================== */
let state = {
  // players loaded from CSV
  players: [], // {id,name,alumni,phone,role,batting_hand,is_wk,rating,category,base,status,finalBid,owner}

  // simple navigation / auth
  auth: { loggedIn: false, user: null },

  // settings
  playersNeeded: 15,
  totalPoints: 15000,
  minBasePerPlayer: 250, // ✅ your guardrail default
  categoryBase: { c1: null, c2: null, c3: null, c4: null, c5: null },

  // preselected (HRB): map name -> price
  preselectedMap: {},

  // clubs
  myClubSlug: "high-range-blasters",
  clubs: [], // {id,slug,name,logo_url,starting_budget,budget_left}

  // live bid
  activePlayerId: null,
};

function persist() {
  try {
    localStorage.setItem("hrb-auction-state", JSON.stringify(state));
  } catch {}
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem("hrb-auction-state") || "{}");
    if (s && typeof s === "object") {
      // shallow merge; keep defaults for anything missing
      state = { ...state, ...s };
      // ensure structures exist
      state.categoryBase = { c1: null, c2: null, c3: null, c4: null, c5: null, ...(s.categoryBase||{}) };
      state.preselectedMap = s.preselectedMap || {};
    }
  } catch {}
}

/* ===========================
   Utils
=========================== */
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function normalizeHeader(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function show(el, on = true) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}
function isHidden(el){ return !el || el.offsetParent === null; }

/* ===========================
   Roster / Budget helpers
=========================== */
function myClub() {
  return (state.clubs || []).find((c) => c.slug === state.myClubSlug) || null;
}
function remainingSlots() {
  const mine = (state.players || []).filter(
    (p) => p.owner === state.myClubSlug && p.status === "won"
  ).length;
  return Math.max(0, (state.playersNeeded || 15) - mine);
}
function remainingBudget(clubSlug) {
  const c = (state.clubs || []).find((c) => c.slug === clubSlug);
  if (!c) return 0;
  return toNum(c.budget_left, c.starting_budget || 0);
}
function guardrailOK(bid) {
  const rem = remainingSlots();
  const floor = state.minBasePerPlayer || 250;
  const bud = remainingBudget(state.myClubSlug);
  return bid <= bud && (bud - bid) >= (rem - 1) * floor;
}

/* ===========================
   Supabase (optional)
=========================== */
function supabaseAvailable() {
  return !!(
    window.ENV?.SUPABASE_URL &&
    window.ENV?.SUPABASE_ANON_KEY &&
    window.supabase?.createClient
  );
}
let sb = null;
if (supabaseAvailable())
  sb = window.supabase.createClient(
    window.ENV.SUPABASE_URL,
    window.ENV.SUPABASE_ANON_KEY
  );

/* ===========================
   Clubs
=========================== */
async function ensureMyClubSeeded() {
  if (!state.clubs) state.clubs = [];
  if (!state.clubs.some((c) => c.slug === state.myClubSlug)) {
    const start = state.totalPoints || 15000;
    state.clubs.push({
      id: `local-${Date.now()}`,
      slug: state.myClubSlug,
      name: "High Range Blasters",
      logo_url: "./assets/highrange.svg",
      starting_budget: start,
      budget_left: start,
    });
    persist();
  } else {
    // sync starting_budget with totalPoints if changed in settings
    const c = myClub();
    if (c && toNum(c.starting_budget) !== toNum(state.totalPoints)) {
      const spent = (state.players||[])
        .filter(p => p.owner===state.myClubSlug && p.status==="won")
        .reduce((s,p)=> s+toNum(p.finalBid,0), 0);
      c.starting_budget = toNum(state.totalPoints, 15000);
      c.budget_left = Math.max(0, c.starting_budget - spent);
      persist();
    }
  }
}
function getOtherClubs() {
  return (state.clubs || []).filter((c) => c.slug !== state.myClubSlug);
}
async function addClubLocal({ name, logo_url, starting_budget }) {
  const slug = slugify(name);
  if (!slug) throw new Error("Enter club name");
  if ((state.clubs || []).some((c) => c.slug === slug))
    throw new Error("Club already exists");
  const start = toNum(starting_budget, 15000);
  state.clubs.push({
    id: `local-${Date.now()}`,
    slug,
    name: name.trim(),
    logo_url: logo_url || "",
    starting_budget: start,
    budget_left: start,
  });
  persist();
}
function clubStats(slug) {
  const players = (state.players || []).filter(
    (p) => p.owner === slug && p.status === "won"
  );
  const spend = players.reduce((s, p) => s + toNum(p.finalBid, 0), 0);
  const c = (state.clubs || []).find((c) => c.slug === slug);
  const budgetLeft = c ? Math.max(0, toNum(c.starting_budget, 0) - spend) : 0;
  return { players, count: players.length, spend, budgetLeft };
}

/* ===========================
   CSV parsing
=========================== */
function splitCsv(text) {
  const rows = [],
    row = [],
    pushRow = () => {
      rows.push(row.splice(0, row.length));
    };
  let cell = "",
    inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i],
      nx = text[i + 1];
    if (inQ) {
      if (ch === '"' && nx === '"') {
        cell += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQ = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"') {
      inQ = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      pushRow();
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  pushRow();
  return rows;
}
function parseCSVPlayers(raw) {
  const rows = splitCsv(raw).filter((r) =>
    r.some((c) => String(c).trim() !== "")
  );
  if (!rows.length) return [];
  const headerIdx = rows.findIndex((r) => {
    const h = r.map(normalizeHeader);
    return h.includes("name") || h.includes("player name") || h.includes("player");
  });
  if (headerIdx < 0) return [];
  const header = rows[headerIdx].map(normalizeHeader);
  const body = rows.slice(headerIdx + 1);

  const idx = (...aliases) => {
    for (const a of aliases) {
      const i = header.indexOf(a);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iName = idx("name", "player name", "player");
  const iRate = idx("rating", "rank", "rating10", "grade");
  const iAlmn = idx("alumni", "college", "institute");
  const iRole = idx("role", "playing role", "type");
  const iHand = idx("batting hand", "batting_hand", "hand");
  const iWK = idx("wk", "wicket keeper", "is_wk", "keeper");
  const iBase = idx("base", "seed", "start bid", "seed base", "base value");
  const iCat = idx("category", "cat");
  const iPhone = idx(
    "phone",
    "phone number",
    "mobile",
    "mobile number",
    "contact",
    "whatsapp",
    "whatsapp number",
    "ph"
  );

  const yes = (v) => /^(true|yes|y|1)$/i.test(String(v || "").trim());

  const players = [];
  body.forEach((cols, i) => {
    const name = (cols[iName] || "").trim();
    if (!name) return;
    const ratingRaw = iRate >= 0 ? String(cols[iRate]).trim() : "";
    const rating = ratingRaw === "" ? null : Number(ratingRaw);
    const alumni = iAlmn >= 0 ? String(cols[iAlmn]).trim() : "";
    const role = iRole >= 0 ? String(cols[iRole]).trim() : "";
    const hand = iHand >= 0 ? String(cols[iHand]).trim() : "";
    const is_wk = iWK >= 0 ? yes(cols[iWK]) : /wk|keeper/i.test(role);
    const base =
      iBase >= 0 && String(cols[iBase]).trim() !== ""
        ? Number(cols[iBase])
        : null;
    const category = iCat >= 0 ? String(cols[iCat]).trim() : "";
    const phone = iPhone >= 0 ? String(cols[iPhone]).trim() : "";
    players.push({
      id: String(i + 1),
      name,
      alumni,
      phone,
      role,
      batting_hand: hand,
      is_wk: Boolean(is_wk),
      rating,
      category: category || null,
      base: base == null ? null : base,
      status: "new",
    });
  });
  return players;
}

/* ===========================
   Live bid / mutations
=========================== */
function setActivePlayer(id) {
  state.activePlayerId = id || null;
  persist();
  renderLiveBid();
}
function getActivePlayer() {
  return (state.players || []).find((p) => p.id === state.activePlayerId) || null;
}
function markWon(playerId, price) {
  const p = (state.players || []).find((x) => x.id === playerId);
  if (!p) return;
  const bid = toNum(price, p.base || 0);
  if (!guardrailOK(bid)) {
    alert("Guardrail violated. Reduce bid.");
    return;
  }
  p.status = "won";
  p.finalBid = bid;
  p.owner = state.myClubSlug;

  const c = myClub();
  if (c) {
    c.budget_left = Math.max(
      0,
      toNum(c.budget_left, c.starting_budget || 0) - bid
    );
  }
  persist();
  render();
}
function assignToClubByNameOrSlug(playerId, clubText, price) {
  const others = getOtherClubs();
  let club = others.find((c) => c.slug === clubText);
  if (!club) {
    const name = String(clubText || "").trim().toLowerCase();
    club =
      others.find((c) => (c.name || "").toLowerCase() === name) ||
      others.find((c) => (c.name || "").toLowerCase().startsWith(name));
  }
  const msg = $("passPanelMsg");
  if (!club) {
    if (msg) msg.textContent = "Pick a valid club from the list.";
    return;
  }

  const p = (state.players || []).find((x) => x.id === playerId);
  if (!p) return;
  const bid = Math.max(0, toNum(price, p.base || 0));

  p.status = "won";
  p.finalBid = bid;
  p.owner = club.slug;
  club.budget_left = Math.max(
    0,
    toNum(club.budget_left, club.starting_budget || 0) - bid
  );

  persist();
  render();
}

/* ===========================
   Minimal item row
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
function isLeftHand(battingHand) {
  return /left/i.test(String(battingHand || ""));
}
function isBowler(role) {
  return /bowl/i.test(String(role || "")); // covers "Bowler", "Allrounder (Bowling)", etc.
}
function complianceForMySquad() {
  const mine = (state.players || []).filter(
    (p) => p.owner === state.myClubSlug && p.status === "won"
  );
  const wk = mine.filter((p) => p.is_wk).length;
  const lhb = mine.filter((p) => isLeftHand(p.batting_hand)).length;
  const bowl = mine.filter((p) => isBowler(p.role) || /all/i.test(p.role)).length;
  return { wk, lhb, bowl };
}
function renderComplianceBar() {
  const root = $("complianceBar");
  if (!root) return;
  const { wk, lhb, bowl } = complianceForMySquad();
  const need = { wk: 2, lhb: 2, bowl: 8 };
  const ok = (cur, req) =>
    `<b style="color:${cur >= req ? "#16a34a" : "#dc2626"}">${cur}/${req}</b>`;
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
  const root = $("playersList");
  const counter = $("playersCount");
  if (!root) return;

  const remaining = (state.players || []).filter((p) => p.status !== "won");
  if (counter) counter.textContent = `(${remaining.length})`;

  root.innerHTML = remaining.length
    ? remaining
        .map(
          (p) => `
        <div class="item" style="padding:10px;border-bottom:1px solid #eee">
          <div class="row" style="display:flex;justify-content:space-between;gap:8px">
            <div>
              <div><b>${p.name}</b></div>
              <div class="meta" style="color:#6b7280">${p.alumni || ""}${
            p.alumni && p.phone ? " · " : ""
          }${p.phone || ""}</div>
            </div>
            <button class="btn btn-ghost" data-id="${p.id}" data-action="pick">Pick</button>
          </div>
        </div>
      `
        )
        .join("")
    : `<div class="hint">Import players to begin.</div>`;

  root.querySelectorAll("[data-action='pick']").forEach((btn) => {
    btn.addEventListener("click", () => setActivePlayer(btn.getAttribute("data-id")));
  });
}

function renderSelectedSquad() {
  const root = $("selectedList");
  if (!root) return;
  const stats = clubStats(state.myClubSlug);
  const header = `
    <div class="row" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div class="meta">Players: <b>${stats.count}</b></div>
    </div>
  `;
  root.innerHTML = stats.players.length
    ? header + stats.players.map(miniRow).join("")
    : header + `<div class="hint">No players won yet.</div>`;
}

function renderOtherClubsPanel() {
  const root = $("otherClubsPanel");
  if (!root) return;
  const others = getOtherClubs();
  if (!others.length) {
    root.innerHTML = `<div class="hint">Add clubs to see their squads.</div>`;
    return;
  }
  root.innerHTML = others
    .map((c) => {
      const stats = clubStats(c.slug);
      const list = stats.players.length
        ? stats.players.map(miniRow).join("")
        : `<div class="hint">No players yet.</div>`;
      return `
      <div class="club-box" style="padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:10px;background:#fff">
        <div class="club-head" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          ${c.logo_url ? `<img src="${c.logo_url}" alt="${c.name}" style="width:24px;height:24px;border-radius:999px;object-fit:cover">` : ""}
          <div style="font-size:14px"><b>${c.name}</b></div>
          <div style="margin-left:auto;font-size:12px;color:#6b7280">Players: ${stats.count}</div>
        </div>
        <div class="club-list" style="max-height:220px;overflow:auto">${list}</div>
      </div>
    `;
    })
    .join("");
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
      <div class="meta" style="color:#6b7280">${p.alumni || ""}${
    p.alumni && p.phone ? " · " : ""
  }${p.phone || ""}</div>
      <div class="row" style="display:flex;gap:8px;margin-top:10px;align-items:flex-end;flex-wrap:wrap">
        <label style="flex:0 1 180px">Bid Amount
          <input id="bidInput" type="number" placeholder="e.g. 900" />
        </label>
        <button id="btn-mark-won" class="btn" disabled>HRB Won</button>
        <button id="btn-pass" class="btn btn-ghost">Pass / Assign</button>
      </div>
      <div id="bidWarn" class="hint" style="margin-top:6px;color:#dc2626"></div>
    </div>
  `;

  const bidEl = $("bidInput");
  const wonBtn = $("btn-mark-won");
  const warnEl = $("bidWarn");

  const validate = () => {
    const price = Number(bidEl.value);
    if (!Number.isFinite(price) || price < 0) {
      warnEl.textContent = price ? "Enter a valid positive amount." : "";
      wonBtn.disabled = true;
      return false;
    }
    const ok = guardrailOK(price);
    wonBtn.disabled = !ok;
    const floor = Math.max(
      0,
      (remainingSlots() - 1) * (state.minBasePerPlayer || 250)
    );
    warnEl.textContent = ok ? "" : `Guardrail: keep ≥ ${floor} for remaining slots.`;
    return ok;
  };
  bidEl.addEventListener("input", validate);
  validate();

  wonBtn.addEventListener("click", () => {
    if (!validate()) return;
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

function updateHeaderStats() {
  // top-left controls panel fields & guardrail summary
  const c = myClub();
  const remainingPts = c ? toNum(c.budget_left, c.starting_budget || 0) : 0;
  const remSlots = remainingSlots();
  const guardEl = $("guardrail");
  if ($("remainingPoints")) $("remainingPoints").textContent = remainingPts;
  if ($("remainingSlots")) $("remainingSlots").textContent = remSlots;
  if (guardEl)
    guardEl.innerHTML =
      `Guardrail (min per slot): <b>${state.minBasePerPlayer || 250}</b>`;
}

function render() {
  renderPlayersList();
  renderOtherClubsPanel();
  renderLiveBid();
  renderSelectedSquad();
  renderComplianceBar();
  updateHeaderStats();
}

/* ===========================
   Pass / Assign Panel
=========================== */
function wirePassPanelForPlayer(p) {
  const input = $("passClubInput");
  const list = $("clubNames");
  const amt = $("passBidAmount");
  const msg = $("passPanelMsg");
  const btn = $("btn-assign-to-club");

  if (!list) return;
  const others = getOtherClubs();
  list.innerHTML = others.map((c) => `<option value="${c.name}"></option>`).join("");

  if (amt) amt.value = $("bidInput")?.value || "";

  if (btn) {
    btn.onclick = null;
    btn.addEventListener("click", () => {
      if (msg) msg.textContent = "";
      const clubText = (input?.value || "").trim();
      const price = amt?.value || "";
      assignToClubByNameOrSlug(p.id, clubText, price);
    });
  }
}

/* ===========================
   Import / Export wiring
=========================== */
function wireCsvImportUI() {
  const urlEl = $("csvUrl");
  const pasteEl = $("csvPaste");
  const btnFetch = $("btn-fetch");
  const btnImport = $("btn-import");
  const btnClearUrl = $("btn-clear-url");
  const btnClearPaste = $("btn-clear-paste");
  const setMsg = (t) => {
    const m = $("importMsg");
    if (m) m.textContent = t;
  };

  if (btnFetch && urlEl) {
    btnFetch.onclick = null;
    btnFetch.addEventListener("click", async () => {
      try {
        setMsg("");
        const url = (urlEl.value || "").trim();
        if (!url) {
          setMsg("Enter a Google Sheet CSV URL");
          return;
        }
        const resp = await fetch(url, { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        if (pasteEl) pasteEl.value = text;
        setMsg("Fetched CSV — click Import to load players.");
      } catch (e) {
        console.error(e);
        setMsg(
          "Fetch failed. Ensure sheet is 'Published to the web' and URL ends with output=csv."
        );
      }
    });
  }

  if (btnImport && pasteEl) {
    btnImport.onclick = null;
    btnImport.addEventListener("click", () => {
      try {
        setMsg("");
        const raw = pasteEl.value || "";
        if (!raw.trim()) {
          setMsg("Paste CSV first or use Fetch CSV.");
          return;
        }

        let players = parseCSVPlayers(raw);
        if (!players.length) {
          // fallback: simple rows → name, alumni?, phone?
          const rows = splitCsv(raw);
          players = rows
            .map((r, i) => {
              const name = String(r[0] || "").trim();
              if (!name) return null;
              return {
                id: String(i + 1),
                name,
                alumni: String(r[1] || "").trim(),
                phone: String(r[2] || "").trim(),
                status: "new",
              };
            })
            .filter(Boolean);
        }

        // normalize statuses
        players = players.map((p) => ({ ...p, status: p.status === "won" ? "won" : "new" }));

        state.players = players;
        state.playersNeeded = state.playersNeeded || 15;

        // auto-apply preselected to HRB
        applyPreselectedToRoster();

        persist();
        render();
        setMsg(`Imported ${players.length} players.`);
        $("playersList")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {
        console.error(e);
        setMsg("Import failed. Check console.");
      }
    });
  }

  if (btnClearUrl && urlEl) {
    btnClearUrl.onclick = null;
    btnClearUrl.addEventListener("click", () => {
      urlEl.value = "";
      const m = $("importMsg");
      if (m) m.textContent = "";
    });
  }
  if (btnClearPaste && pasteEl) {
    btnClearPaste.onclick = null;
    btnClearPaste.addEventListener("click", () => {
      pasteEl.value = "";
      const m = $("importMsg");
      if (m) m.textContent = "";
    });
  }
}

function exportWonCSV() {
  const won = (state.players || []).filter((p) => p.status === "won");
  const rows = [["Club", "Player Name", "Alumni", "Phone"]];
  won.forEach((p) => {
    const club = (state.clubs || []).find((c) => c.slug === p.owner);
    rows.push([club ? club.name : p.owner || "", p.name || "", p.alumni || "", p.phone || ""]);
  });
  const csv = rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
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
  const nameEl = $("clubName"),
    logoEl = $("clubLogo"),
    budEl = $("clubBudget");
  const btn = $("btnCreateClub"),
    msg = $("clubCreateMsg");
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
      if (msg) msg.textContent = "Club created.";
      renderOtherClubsPanel();
    } catch (e) {
      if (msg) msg.textContent = e.message || "Create failed.";
    }
  });
}

/* ===========================
   Start Bid (typeahead)
=========================== */
function wireStartBidUI() {
  const input = $("startName"),
    menu = $("startResults"),
    btn = $("btn-start-bid"),
    seed = $("seedBase");
  if (!input || !menu || !btn) return;

  function candidates(q) {
    q = (q || "").trim().toLowerCase();
    if (q.length < 2) return [];
    return (state.players || [])
      .filter((p) => p.status !== "won")
      .filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.alumni || "").toLowerCase().includes(q)
      )
      .slice(0, 10);
  }

  input.addEventListener("input", () => {
    const list = candidates(input.value);
    if (!list.length) {
      menu.style.display = "none";
      menu.innerHTML = "";
      return;
    }
    menu.style.display = "block";
    menu.innerHTML = list
      .map((p) => `<div class="ta-item" data-id="${p.id}">${p.name}${
        p.alumni ? " · " + p.alumni : ""
      }</div>`)
      .join("");
    $$(".ta-item", menu).forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id");
        setActivePlayer(id);
        menu.style.display = "none";
        if (seed) {
          const player = state.players.find((x) => x.id === id);
          // prefer CSV base; otherwise use category base fallback if present
          let base = Number.isFinite(player?.base) ? player.base : null;
          if (base == null && player?.category) {
            const cat = String(player.category).trim();
            const map = { c1: state.categoryBase.c1, c2: state.categoryBase.c2, c3: state.categoryBase.c3, c4: state.categoryBase.c4, c5: state.categoryBase.c5 };
            const byName =
              /1/i.test(cat) ? map.c1 :
              /2/i.test(cat) ? map.c2 :
              /3/i.test(cat) ? map.c3 :
              /4/i.test(cat) ? map.c4 :
              /5/i.test(cat) ? map.c5 : null;
            base = Number.isFinite(byName) ? byName : null;
          }
          seed.value = Number.isFinite(base) ? base : "";
        }
      });
    });
  });

  btn.addEventListener("click", () => {
    const q = (input.value || "").trim().toLowerCase();
    if (!q) return;
    const rem = (state.players || []).filter((p) => p.status !== "won");
    const exact =
      rem.find(
        (p) =>
          (p.name || "").toLowerCase() === q ||
          (((p.name || "") + " " + (p.alumni || "")).toLowerCase() === q)
      ) || rem.find((p) => (p.name || "").toLowerCase().startsWith(q));
    if (exact) {
      setActivePlayer(exact.id);
      if (seed) {
        let base = Number.isFinite(exact.base) ? exact.base : null;
        if (base == null && exact.category) {
          const map = state.categoryBase;
          const cat = String(exact.category).trim();
          const byName =
            /1/i.test(cat) ? map.c1 :
            /2/i.test(cat) ? map.c2 :
            /3/i.test(cat) ? map.c3 :
            /4/i.test(cat) ? map.c4 :
            /5/i.test(cat) ? map.c5 : null;
          base = Number.isFinite(byName) ? byName : null;
        }
        seed.value = Number.isFinite(base) ? base : "";
      }
    }
  });
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

  // show login if not logged in
  show(view, !state.auth.loggedIn);
  show($("settingsView"), false);
  show($("appMain"), state.auth.loggedIn);

  btn.onclick = null;
  btn.addEventListener("click", () => {
    const user = (u?.value || "").trim();
    const pass = p?.value || "";
    if (user.toLowerCase() === "hrb" && pass === "sandeep") {
      state.auth.loggedIn = true;
      state.auth.user = "HRB";
      persist();
      show(view, false);
      show($("settingsView"), true);
      show($("appMain"), false);
      $("cfgPlayersCap").value = state.playersNeeded;
      $("cfgTotalPoints").value = state.totalPoints;
      $("cfgGuardMin").value = state.minBasePerPlayer || 250;
    } else {
      if (err) err.textContent = "Invalid credentials.";
    }
  });
}

function parsePreselectedText(txt, fallbackSingleBid) {
  // Accept "Name=1200; Name2=900"  OR just "Name" + single bid field
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
    // single name
    out[raw.toLowerCase()] = toNum(fallbackSingleBid, 0);
  }
  return out;
}

function applyPreselectedToRoster() {
  const map = state.preselectedMap || {};
  const names = Object.keys(map);
  if (!names.length) return;

  const c = myClub();
  if (!c) return;

  let newlySpent = 0;
  (state.players || []).forEach((p) => {
    const key = (p.name || "").toLowerCase();
    if (!map[key]) return;
    if (p.status === "won" && p.owner === state.myClubSlug) return; // already applied
    p.status = "won";
    p.owner = state.myClubSlug;
    p.finalBid = toNum(map[key], 0);
    newlySpent += toNum(map[key], 0);
  });

  // adjust HRB budget (starting_budget already synced in ensureMyClubSeeded)
  const spentExisting = (state.players || [])
    .filter((p) => p.owner === state.myClubSlug && p.status === "won")
    .reduce((s, p) => s + toNum(p.finalBid, 0), 0);
  c.budget_left = Math.max(0, toNum(c.starting_budget, 0) - spentExisting);

  persist();
}

function recomputeAvailableScorePreview() {
  const total = toNum($("cfgTotalPoints")?.value, state.totalPoints || 15000);
  const pre = parsePreselectedText(
    $("cfgPreName")?.value,
    toNum($("cfgPreBid")?.value, 0)
  );
  const preSum = Object.values(pre).reduce((s, v) => s + toNum(v, 0), 0);
  const out = Math.max(0, total - preSum);
  if ($("cfgAvailableScore")) $("cfgAvailableScore").textContent = out;
}

function wireSettingsUI() {
  const view = $("settingsView");
  if (!view) return;

  // live preview of available score after preselected
  ["cfgTotalPoints", "cfgPreName", "cfgPreBid"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("input", recomputeAvailableScorePreview);
  });
  recomputeAvailableScorePreview();

  const btn = $("btn-save-settings");
  const err = $("settingsError");
  btn.onclick = null;
  btn.addEventListener("click", async () => {
    try {
      if (err) err.textContent = "";

      const playersCap = toNum($("cfgPlayersCap")?.value, 15);
      const totalPts = toNum($("cfgTotalPoints")?.value, 15000);

      const c1 = toNum($("cfgBaseC1")?.value, NaN);
      const c2 = toNum($("cfgBaseC2")?.value, NaN);
      const c3 = toNum($("cfgBaseC3")?.value, NaN);
      const c4 = toNum($("cfgBaseC4")?.value, NaN);
      const c5 = toNum($("cfgBaseC5")?.value, NaN);

      const guardMin = toNum(
        $("cfgGuardMin")?.value,
        Number.isFinite(c5) ? c5 : state.minBasePerPlayer || 250
      );

      const preMap = parsePreselectedText(
        $("cfgPreName")?.value,
        toNum($("cfgPreBid")?.value, 0)
      );

      // save to state
      state.playersNeeded = playersCap;
      state.totalPoints = totalPts;
      state.minBasePerPlayer = guardMin;
      state.categoryBase = {
        c1: Number.isFinite(c1) ? c1 : null,
        c2: Number.isFinite(c2) ? c2 : null,
        c3: Number.isFinite(c3) ? c3 : null,
        c4: Number.isFinite(c4) ? c4 : null,
        c5: Number.isFinite(c5) ? c5 : null,
      };
      state.preselectedMap = preMap;

      // ensure HRB exists & sync budgets
      await ensureMyClubSeeded();

      // recompute HRB budget after preselected (will be applied after import too)
      const c = myClub();
      if (c) {
        const preSum = Object.values(preMap).reduce((s, v) => s + toNum(v, 0), 0);
        c.starting_budget = totalPts;
        // If players already imported, apply now; else this will reflect once import happens.
        applyPreselectedToRoster();
      }

      persist();

      // navigate to main app
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
   Top control inputs + buttons
=========================== */
function wireTopControls() {
  const tot = $("totalPoints");
  const cap = $("playersNeeded");
  const min = $("minBasePerPlayer");
  const btnShuffle = $("btn-shuffle");
  const btnNext = $("btn-next");
  const btnUndo = $("btn-undo");
  const btnReset = $("btn-reset");
  const btnLogout = $("btn-logout");

  if (tot) {
    tot.value = state.totalPoints;
    tot.addEventListener("input", async () => {
      state.totalPoints = toNum(tot.value, 15000);
      await ensureMyClubSeeded();
      persist();
      render();
    });
  }
  if (cap) {
    cap.value = state.playersNeeded;
    cap.addEventListener("input", () => {
      state.playersNeeded = toNum(cap.value, 15);
      persist();
      render();
    });
  }
  if (min) {
    min.value = state.minBasePerPlayer || 250;
    min.addEventListener("input", () => {
      state.minBasePerPlayer = toNum(min.value, 250);
      persist();
      render();
    });
  }

  if (btnShuffle)
    btnShuffle.addEventListener("click", () => {
      // simple shuffle of remaining players -> queue not used elsewhere
      const rem = (state.players || []).filter((p) => p.status !== "won");
      for (let i = rem.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rem[i], rem[j]] = [rem[j], rem[i]];
      }
      // set first as active
      const first = rem[0];
      if (first) setActivePlayer(first.id);
    });

  if (btnNext)
    btnNext.addEventListener("click", () => {
      const rem = (state.players || []).filter((p) => p.status !== "won");
      if (!rem.length) return;
      const idx = rem.findIndex((x) => x.id === state.activePlayerId);
      const next = idx >= 0 ? rem[(idx + 1) % rem.length] : rem[0];
      setActivePlayer(next.id);
    });

  if (btnUndo)
    btnUndo.addEventListener("click", () => {
      // undo last HRB win
      const hrbWins = (state.players || [])
        .filter((p) => p.owner === state.myClubSlug && p.status === "won")
        .sort((a, b) => (b.finalBidTs || 0) - (a.finalBidTs || 0));
      const last = hrbWins[0];
      if (!last) return;
      const c = myClub();
      if (c) {
        c.budget_left = Math.max(0, toNum(c.budget_left, 0) + toNum(last.finalBid, 0));
      }
      last.status = "new";
      last.owner = null;
      last.finalBid = null;
      persist();
      render();
    });

  if (btnReset)
    btnReset.addEventListener("click", () => {
      if (!confirm("Clear local session (players, clubs, settings)?")) return;
      localStorage.removeItem("hrb-auction-state");
      location.reload();
    });

  if (btnLogout) {
    show(btnLogout, true);
    btnLogout.addEventListener("click", () => {
      state.auth = { loggedIn: false, user: null };
      persist();
      show($("appMain"), false);
      show($("settingsView"), false);
      show($("loginView"), true);
      $("loginUser")?.focus();
    });
  }
}

/* ===========================
   Boot
=========================== */
async function boot() {
  window.__diag && __diag("boot() start");
  load();
  await ensureMyClubSeeded();
  wireLoginUI();        // new
  wireSettingsUI();     // new
  wireCreateClubUI();
  wireCsvImportUI();
  wireStartBidUI();
  wireExportButton();
  wireTopControls();    // new
  if (state.auth.loggedIn) {
    // if user is already logged in from past session, jump to app or settings
    show($("loginView"), false);
    show($("settingsView"), false);
    show($("appMain"), true);
  }
  render();
  window.__diag && __diag("boot() done");
}
document.addEventListener("DOMContentLoaded", boot);
