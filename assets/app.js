/* HRB Auction Assist (stable, role-aware, persistent)
   - Clubs: your canonical 8
   - Left list limited to 3, full other-clubs view (rich headers)
   - Base-point start + 200×guardrail
   - Smart Advisor with rival/scarcity/soft+hard caps
   - Role minima: WK≥2, LHB≥2, BOWL≥8 + top-bar status
   - Session persistence via localStorage
*/

(() => {
  // ---------- utils ----------
  const $ = sel => document.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "onclick") n.onclick = v;
      else n.setAttribute(k, v);
    });
    children.forEach(c => n.appendChild(c));
    return n;
  };
  const csvToRows = (text) =>
    text.trim().split(/\r?\n/).map(r => r.split(",").map(s => s.trim()));
  const toInt = (v, d = 0) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };

  // ---------- clubs ----------
  const MY_CLUB = "High Range Blasters";
  const DEFAULT_CLUBS = [
    { name: "High Range Blasters",  slug: "high-range-blasters",  logo_url: "" },
    { name: "Black Panthers",       slug: "black-panthers",       logo_url: "" },
    { name: "White Elephants",      slug: "white-elephants",      logo_url: "" },
    { name: "Kerala Tuskers",       slug: "kerala-tuskers",       logo_url: "" },
    { name: "Warbow Wolverines",    slug: "warbow-wolverines",    logo_url: "" },
    { name: "Venad Warriers",       slug: "venad-warriers",       logo_url: "" },
    { name: "Thiruvalla Warriers",  slug: "thiruvalla-warriers",  logo_url: "" },
    { name: "God's Own XI",         slug: "gods-own-xi",          logo_url: "" }
  ];
  const CLUB_NAMES = DEFAULT_CLUBS.map(c => c.name);

  // ---------- categories / base ----------
  const BaseByCategory = {
    "cat 1": 1500, "cat1": 1500, "1": 1500,
    "cat 2": 1000, "cat2": 1000, "2": 1000,
    "cat 3":  500, "cat3":  500, "3":  500,
    "cat 4":  200, "cat4":  200, "4":  200
  };
  const TOURNAMENT_MIN_BASE = 200;

  // ---------- persistence ----------
  const STORAGE_KEY = "hrbAuctionState_v2";
  function saveState() {
    try {
      const out = {
        loggedIn: state.loggedIn,
        squadSize: state.squadSize,
        totalPoints: state.totalPoints,
        players: state.players.map(p => ({
          id: p.id, name: p.name, alumni: p.alumni, phone: p.phone,
          category: p.category, base_point: p.base_point,
          performance_index: p.performance_index,
          owner: p.owner, final_bid: p.final_bid,
          wk: p.wk || "", batting_type: p.batting_type || "", skill: p.skill || "",
           player_rating: p.player_rating ?? 0 
        })),
        clubs: Object.fromEntries(Object.keys(state.clubs).map(k => [
          k,
          { name: state.clubs[k].name, budgetLeft: state.clubs[k].budgetLeft, won: [...state.clubs[k].won] }
        ])),
        activeId: state.activeId || null
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch (e) { console.warn("saveState failed:", e); }
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.players) || !s.clubs) return null;
      return s;
    } catch (e) {
      console.warn("loadState failed:", e);
      return null;
    }
  }
  function applyLoadedState(s) {
    try {
      state.loggedIn = !!s.loggedIn;
      state.squadSize = s.squadSize || 15;
      state.totalPoints = s.totalPoints || 15000;
      Object.keys(state.clubs).forEach(c => {
        state.clubs[c].budgetLeft = (s.clubs[c]?.budgetLeft ?? state.totalPoints);
        state.clubs[c].won = Array.isArray(s.clubs[c]?.won) ? [...s.clubs[c].won] : [];
      });
      state.players = s.players.map(p => ({ ...p }));
      state.activeId = s.activeId && state.players.find(x => x.id === s.activeId) ? s.activeId : null;
    } catch (e) { console.warn("applyLoadedState failed:", e); }
  }

  // ---------- state ----------
  const state = {
    loggedIn: false,
    squadSize: 15,
    totalPoints: 15000,
    players: [], // {id,name,alumni,phone,category,base_point,performance_index,owner,final_bid,wk,batting_type,skill}
    activeId: null,
    clubs: Object.fromEntries(CLUB_NAMES.map(c => [c, { name: c, budgetLeft: 15000, won: [] }]))
  };
  function resetClubBudgets(total) {
    CLUB_NAMES.forEach(c => {
      state.clubs[c].budgetLeft = total;
      state.clubs[c].won = [];
    });
  }

  // ---------- UI refs ----------
  const loginCard = $("#loginCard");
  const settingsCard = $("#settingsCard");
  const liveCard = $("#liveCard");
  const loginPass = $("#loginPass");
  const btnLogin = $("#btnLogin");
const kRating = $("#kRating");

  const csvUrl = $("#csvUrl");
  const csvPaste = $("#csvPaste");
  const inpSquad = $("#inpSquad");
  const inpPoints = $("#inpPoints");
  const btnLoadCsv = $("#btnLoadCsv");
  const btnProceed = $("#btnProceed");
  const loadStatus = $("#loadStatus");
  const kSquad = $("#kSquad");
  const kPoints = $("#kPoints");

  const playersList = $("#playersList");
  const search = $("#search");
  const btnClearSearch = $("#btnClearSearch");

  const activeName = $("#activeName");
  const activeCat = $("#activeCat");
  const activeBase = $("#activeBase");
  const inpBid = $("#inpBid");
  const bidHint = $("#bidHint");
  const btnHrbWon = $("#btnHrbWon");
  const selOtherClub = $("#selOtherClub");
  const btnAssignOther = $("#btnAssignOther");

  const kHrbPlayers = $("#kHrbPlayers");
  const kHrbLeft = $("#kHrbLeft");
  const kGuard = $("#kGuard");
  const hrbList = $("#hrbList");
  const hrbSummary = $("#hrbSummary");

  const c1Left = $("#c1Left"), c2Left = $("#c2Left"), c3Left = $("#c3Left");
  const c1Cap = $("#c1Cap"), c2Cap = $("#c2Cap"), c3Cap = $("#c3Cap");
  const mixNote = $("#mixNote");
  const btnExportWon = $("#btnExportWon");
  const btnLogout = $("#btnLogout");
  const otherClubs = $("#otherClubs");
  const advisorBox = $("#advisorBox");

  // role top bar refs (added in HTML)
  const kWK = $("#kWK"), kLHB = $("#kLHB"), kBOWL = $("#kBOWL");
  const kRoleBox = $("#kRoleBox");

  // ---------- helpers ----------
  function populateOtherClubSelect() {
    selOtherClub.innerHTML = "";
    selOtherClub.appendChild(
      el("option", { value: "" }, [document.createTextNode("Assign to other club…")])
    );
    DEFAULT_CLUBS.filter(c => c.name !== MY_CLUB).forEach(c => {
      selOtherClub.appendChild(el("option", { value: c.name }, [document.createTextNode(c.name)]));
    });
  }

  // role predicates
  function isWK(p) {
    const v = (p.wk || "").toLowerCase();
    return v === "y" || v === "yes" || v === "true" || v === "wk" || v === "1";
  }
  function isLHB(p) {
    const v = (p.batting_type || "").toLowerCase();
    return v.includes("left") || v.includes("lhb");
  }
 function isBowler(p) {
  // Normalize and match common variants:
  // "bowler", "bowling all rounder", "bowling all-rounder", "all-rounder (bowling)", etc.
  const v = (p.skill || "").toLowerCase();
  return /\bbowler\b/.test(v) ||
         /bowling\s*all[-\s]?rounder/.test(v) ||
         /all[-\s]?rounder.*bowling/.test(v);
}
  function countHRBRoles() {
    const ids = state.clubs[MY_CLUB].won;
    let wk = 0, lhb = 0, bowl = 0;
    ids.forEach(pid => {
      const p = state.players.find(x=>x.id===pid);
      if (!p) return;
      if (isWK(p)) wk++;
      if (isLHB(p)) lhb++;
      if (isBowler(p)) bowl++;
    });
    return { wk, lhb, bowl };
  }

  // ---------- auth ----------
  btnLogin.addEventListener("click", () => {
    if (loginPass.value.trim() !== "sandeep") {
      alert("Wrong password. (Hint: sandeep)");
      return;
    }
    state.loggedIn = true;
    loginCard.style.display = "none";
    settingsCard.style.display = "block";
    populateOtherClubSelect();
    saveState();
  });

  // ---------- CSV load ----------
  btnLoadCsv.addEventListener("click", async () => {
    loadStatus.textContent = "Loading…";
    try {
      let csvText = csvPaste.value.trim();
      if (!csvText && csvUrl.value.trim()) {
        const r = await fetch(csvUrl.value.trim());
        if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
        csvText = await r.text();
      }
      if (!csvText) {
        loadStatus.textContent = "Paste CSV or provide a CSV URL.";
        return;
      }

      const rows = csvToRows(csvText);
      if (rows.length < 2) throw new Error("No data rows found.");

      const headers = rows[0].map(h => h.toLowerCase());
      const idx = (key, ...alts) => {
        const tries = [key.toLowerCase(), ...alts.map(a => a.toLowerCase())];
        for (const t of tries) {
          const i = headers.indexOf(t);
          if (i !== -1) return i;
        }
        return -1;
      };

      const iName = idx("name", "player", "player_name");
      const iAlum = idx("alumni", "alum", "alumni_name");
      const iPhone = idx("phone", "mobile", "contact", "phone number", "phone_no");
      const iCat = idx("category", "cat");
      const iBase = idx("base_point", "base", "basepoints", "base point");
      const iPI = idx("performance_index", "pi", "rank", "rating");

      // NEW role columns
      const iWK   = idx("wk","wicketkeeper","wicket_keeper","is_wk","keeper");
      const iBat  = idx("batting_type","batting","battingtype","bat");
      const iSkill= idx("skill","role","primary_skill","speciality");
       const iRating = idx("player_rating","rating","rate","score");

      if (iName === -1 || iCat === -1 || iBase === -1) {
        throw new Error("CSV must include name, category, base_point.");
      }

      state.players = rows
        .slice(1)
        .filter(r => r.length >= headers.length)
        .map((r, idxr) => {
          const rawCat = (r[iCat] || "").toString().trim().toLowerCase();
          const baseFromCsv = toInt(r[iBase], 0);
          const catBase = BaseByCategory[rawCat] ?? 0;
          const base_point = baseFromCsv > 0 ? baseFromCsv : (catBase > 0 ? catBase : TOURNAMENT_MIN_BASE);
         const ratingRaw = iRating !== -1 ? toInt(r[iRating], 0) : 0;
const player_rating = Math.max(0, Math.min(10, ratingRaw));
          const wkRaw    = iWK   !== -1 ? String(r[iWK]).trim()    : "";
          const batRaw   = iBat  !== -1 ? String(r[iBat]).trim()   : "";
          const skillRaw = iSkill!== -1 ? String(r[iSkill]).trim() : "";

          return {
            id: "p" + (idxr + 1),
            name: (r[iName] || "").trim(),
            alumni: iAlum !== -1 ? (r[iAlum] || "").trim() : "",
            phone: iPhone !== -1 ? (r[iPhone] || "").trim() : "",
            category: rawCat || "cat 4",
            base_point,
            performance_index: iPI !== -1 ? toInt(r[iPI], 0) : 0,
            owner: "",
            final_bid: 0,
            wk: wkRaw.toLowerCase(),
            batting_type: batRaw.toLowerCase(),
            skill: skillRaw.toLowerCase(),
             player_rating
          };
        });

      state.squadSize = Math.max(1, toInt(inpSquad.value, 15));
      state.totalPoints = Math.max(1, toInt(inpPoints.value, 15000));
      kSquad.textContent = state.squadSize;
      kPoints.textContent = state.totalPoints;
      resetClubBudgets(state.totalPoints);

      loadStatus.textContent = `Loaded ${state.players.length} players.`;
      btnProceed.disabled = false;
      renderPlayers();
      saveState();
    } catch (e) {
      console.error(e);
      loadStatus.textContent = "Error: " + e.message;
      btnProceed.disabled = true;
    }
  });

  btnProceed.addEventListener("click", () => {
    settingsCard.style.display = "none";
    liveCard.style.display = "block";
    updateTopBar(); updateCapacity(); renderHRB(); renderOtherClubs();
    renderAdvisor();
    saveState();
  });

  // ---------- list + search ----------
  btnClearSearch.addEventListener("click", () => {
    search.value = "";
    renderPlayers();
  });
  search.addEventListener("input", renderPlayers);

  function renderPlayers() {
    const q = search.value.trim().toLowerCase();
    const remainAll = state.players.filter(
      p => !p.owner && (p.name.toLowerCase().includes(q) || p.alumni.toLowerCase().includes(q))
    );

    const MAX_VISIBLE = 3;
    const remain = remainAll.slice(0, MAX_VISIBLE);
    const hiddenCount = Math.max(0, remainAll.length - remain.length);

    playersList.innerHTML = "";
    remain.forEach(p => {
      const catLabel = (p.category || "").toUpperCase();
      const row = el("div", { class: "li selectable", onclick: () => setActive(p.id) }, [
        el("div", {}, [
          el("div", {}, [document.createTextNode(p.name || "(no name)")]),
          el("div", { class: "tiny muted" }, [document.createTextNode((p.alumni || "").toString())])
        ]),
        el("div", { class: "right" }, [
          el("div", { class: "pill" }, [document.createTextNode(`${catLabel} • base ${p.base_point}`)]),
          el("div", { class: "flex", style: "margin-top:6px;" }, [
            el("button", {
              class: "btn",
              onclick: (ev) => { ev.stopPropagation(); setActive(p.id); }
            }, [document.createTextNode("Pick")])
          ])
        ])
      ]);
      if (p.id === state.activeId) row.classList.add("active");
      playersList.appendChild(row);
    });

    if (hiddenCount > 0) {
      playersList.appendChild(
        el("div", { class: "li" }, [
          el("div", { class: "tiny muted" }, [
            document.createTextNode(`…and ${hiddenCount} more not shown`)
          ])
        ])
      );
    }

    if (!remainAll.length) {
      playersList.appendChild(
        el("div", { class: "li" }, [document.createTextNode("No remaining players match your search.")])
      );
    }
  }

  function setActive(id) {
    state.activeId = id;
    const p = state.players.find(x => x.id === id);
    if (!p) return;
    activeName.textContent = p.name;
    activeCat.textContent = (p.category || "").toUpperCase();
    activeBase.textContent = p.base_point;
     kRating && (kRating.textContent = (p.player_rating ?? 0));

    inpBid.value = p.base_point;
    validateBid();
    renderAdvisor();

    // highlight row
    [...playersList.querySelectorAll(".li")].forEach(x => x.classList.remove("active"));
    const activeRow = [...playersList.children].find(n => {
      const name = n.querySelector(":scope > div:first-child > div:first-child");
      return name && name.textContent === p.name;
    });
    if (activeRow) activeRow.classList.add("active");
  }

  // ---------- bidding & guardrail ----------
  function remainingSlotsHRB() {
    return state.squadSize - state.clubs[MY_CLUB].won.length;
  }
  function validateBid() {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) {
      btnHrbWon.disabled = true;
      btnAssignOther.disabled = true;
      bidHint.textContent = "Select a player to begin.";
      renderAdvisor();
      return;
    }
    const bid = toInt(inpBid.value, 0);
    const base = p.base_point;

    if (!Number.isFinite(bid) || bid < base) {
      bidHint.innerHTML = `<span class="bad">Min starting bid for ${p.name} is ${base} (player base).</span>`;
      btnHrbWon.disabled = true;
      btnAssignOther.disabled = (selOtherClub.value === "" || bid < base);
      renderAdvisor();
      return;
    }

    const slotsAfter = Math.max(0, remainingSlotsHRB() - 1);
    const mustKeep = TOURNAMENT_MIN_BASE * slotsAfter;
    const leftIfWin = state.clubs[MY_CLUB].budgetLeft - bid;

    if (leftIfWin < mustKeep) {
      bidHint.innerHTML = `<span class="warn">Bid violates guardrail: after this win you'd keep ${leftIfWin}, but need ≥ ${mustKeep}.</span>`;
      btnHrbWon.disabled = true;
    } else {
      bidHint.innerHTML = `<span class="ok">Ok to bid.</span>`;
      btnHrbWon.disabled = false;
    }

    btnAssignOther.disabled = (selOtherClub.value === "" || bid < base);
    renderAdvisor();
  }

  inpBid.addEventListener("input", validateBid);
  selOtherClub.addEventListener("change", validateBid);

  function hrbWon(bid) {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    p.owner = MY_CLUB;
    p.final_bid = bid;
    state.clubs[MY_CLUB].won.push(p.id);
    state.clubs[MY_CLUB].budgetLeft -= bid;
    clearActive();
    refreshAll();
    saveState();
    renderAdvisor();
  }

  function assignOther(club, bid) {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    p.owner = club;
    p.final_bid = bid;
    state.clubs[club].won.push(p.id);
    state.clubs[club].budgetLeft -= bid;
    clearActive();
    refreshAll();
    saveState();
    renderAdvisor();
  }

  function clearActive() {
    state.activeId = null;
    activeName.textContent = "—";
    activeCat.textContent = "—";
    activeBase.textContent = "—";
     kRating && (kRating.textContent = "—");

    inpBid.value = "";
    bidHint.textContent = "Select a player to begin.";
  }

  $("#btnHrbWon").addEventListener("click", () => {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    const bid = toInt(inpBid.value, 0);
    if (bid < p.base_point) {
      alert(`Min starting bid is ${p.base_point}.`);
      return;
    }
    const slotsAfter = Math.max(0, remainingSlotsHRB() - 1);
    const mustKeep = TOURNAMENT_MIN_BASE * slotsAfter;
    const leftIfWin = state.clubs[MY_CLUB].budgetLeft - bid;
    if (leftIfWin < mustKeep) {
      alert(`This breaks guardrail. Need ≥ ${mustKeep} left after the win.`);
      return;
    }
    hrbWon(bid);
  });

  $("#btnAssignOther").addEventListener("click", () => {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    const bid = toInt(inpBid.value, 0);
    const club = selOtherClub.value;
    if (!club) {
      alert("Choose a club.");
      return;
    }
    if (bid < p.base_point) {
      alert(`Final price must be ≥ player base (${p.base_point}).`);
      return;
    }
    assignOther(club, bid);
  });

  // ---------- HRB panel + top bar ----------
  function renderHRB() {
    const hrb = state.clubs[MY_CLUB];
    hrbList.innerHTML = "";
    hrb.won.slice().reverse().forEach(pid => {
      const p = state.players.find(x => x.id === pid);
      if (!p) return;
      const row = el("div", { class: "li" }, [
        el("div", {}, [
          el("div", {}, [document.createTextNode(p.name)]),
          el("div", { class: "tiny muted" }, [document.createTextNode(`${p.alumni || ""}  • ${p.phone || ""}`)])
        ]),
        el("div", { class: "right" }, [
          el("span", { class: "pill" }, [document.createTextNode(`${(p.category || "").toUpperCase()}`)]),
          el("div", { class: "tiny muted" }, [document.createTextNode(`Bid: ${p.final_bid}`)])
        ])
      ]);
      hrbList.appendChild(row);
    });
    hrbSummary.textContent = `${hrb.won.length} players`;
  }

  function updateTopBar() {
    const hrb = state.clubs[MY_CLUB];
    const have = hrb.won.length;
    const leftSlots = state.squadSize - have;

    kHrbPlayers.textContent = `${have}/${state.squadSize}`;
    kHrbLeft.textContent = hrb.budgetLeft;
    kGuard.textContent = TOURNAMENT_MIN_BASE * leftSlots;

    // role counts + subtle cue
    const { wk, lhb, bowl } = countHRBRoles();
    if (kWK)  kWK.textContent = wk;
    if (kLHB) kLHB.textContent = lhb;
    if (kBOWL) kBOWL.textContent = bowl;

    if (kRoleBox) {
      const ok = (wk >= 2) && (lhb >= 2) && (bowl >= 8);
      kRoleBox.style.borderColor = ok ? "#b7ebc6" : "#fde68a";
      kRoleBox.style.boxShadow = ok ? "0 0 0 2px rgba(16,185,129,.12)" : "0 0 0 2px rgba(245,158,11,.10)";
    }
  }

  // ---------- capacity strip ----------
  function updateCapacity() {
    const hrb = state.clubs[MY_CLUB];
    const leftSlots = remainingSlotsHRB();
    const remaining = state.players.filter(p => !p.owner);
    const catCount = { c1: 0, c2: 0, c3: 0 };
    remaining.forEach(p => {
      const c = (p.category || "").toLowerCase();
      if (c.includes("1")) catCount.c1++;
      else if (c.includes("2")) catCount.c2++;
      else if (c.includes("3")) catCount.c3++;
    });
    c1Left.textContent = catCount.c1;
    c2Left.textContent = catCount.c2;
    c3Left.textContent = catCount.c3;

    const mustKeep = TOURNAMENT_MIN_BASE * leftSlots;
    const free = Math.max(0, hrb.budgetLeft - mustKeep);

    const capC1 = Math.min(catCount.c1, Math.floor(free / 1500), leftSlots);
    const capC2 = Math.min(catCount.c2, Math.floor(free / 1000), leftSlots);
    const capC3 = Math.min(catCount.c3, Math.floor(free / 500),  leftSlots);
    c1Cap.textContent = capC1;
    c2Cap.textContent = capC2;
    c3Cap.textContent = capC3;

    let budget = free, slots = leftSlots, r1 = 0, r2 = 0, r3 = 0;
    const take = (cost, avail, set) => {
      if (slots <= 0 || avail <= 0 || budget < cost) return;
      const n = Math.min(avail, Math.floor(budget / cost), slots);
      budget -= n * cost; slots -= n; set(n);
    };
    take(1500, Math.min(catCount.c1, leftSlots), n => (r1 = n));
    take(1000, Math.min(catCount.c2, leftSlots), n => (r2 = n));
    take(500,  Math.min(catCount.c3, leftSlots), n => (r3 = n));
    mixNote.innerHTML = `You can still target about <b>${r1}</b> × Cat-1, <b>${r2}</b> × Cat-2, <b>${r3}</b> × Cat-3 at base while preserving the guardrail.`;
  }

  // ---------- Smart Advisor ----------
  function countTopCatsRemaining() {
    const left = state.players.filter(p => !p.owner);
    const count = { c1:0, c2:0, c3:0 };
    left.forEach(p => {
      const c = (p.category||"").toLowerCase();
      if (c.includes("1")) count.c1++;
      else if (c.includes("2")) count.c2++;
      else if (c.includes("3")) count.c3++;
    });
    return count;
  }
  function rivalsSnapshot() {
    let top = null;
    Object.keys(state.clubs).forEach(name => {
      if (name === MY_CLUB) return;
      const club = state.clubs[name];
      const have = club.won.length;
      const leftSlots = Math.max(0, state.squadSize - have);
      const avgPerSlot = leftSlots > 0 ? Math.round(club.budgetLeft / leftSlots) : 0;
      const spent = Math.max(0, state.totalPoints - club.budgetLeft);
      if (!top || avgPerSlot > top.avgPerSlot) {
        top = { name, avgPerSlot, leftSlots, pointsLeft: club.budgetLeft, have, spent };
      }
    });
    return top;
  }
  function hrbVelocity() {
    const ids = state.clubs[MY_CLUB].won.slice(-3);
    const last = ids.map(pid => state.players.find(x=>x.id===pid)).filter(Boolean);
    const spent3 = last.reduce((s,p)=>s + (p.final_bid||0), 0);
    const avg3 = last.length ? Math.round(spent3 / last.length) : 0;
    return { count: last.length, avgLast3: avg3 };
  }
  function freeAfterGuardrailIfWin() {
    const slotsAfter = Math.max(0, remainingSlotsHRB() - 1);
    const mustKeep = TOURNAMENT_MIN_BASE * slotsAfter;
    return state.clubs[MY_CLUB].budgetLeft - mustKeep;
  }
  function computeAdvice() {
    const msgs = [];
    const p = state.players.find(x => x.id === state.activeId);
    const hrb = state.clubs[MY_CLUB];
    const slots = remainingSlotsHRB();
    const rolesNow = countHRBRoles();

    const avgPerSlotNow = slots > 0 ? Math.round(hrb.budgetLeft / slots) : 0;

    if (!p) {
      msgs.push({ level:"info", text:`Pick a player to begin. HRB points left: ${hrb.budgetLeft}. Slots left: ${slots}. Avg/slot: ${avgPerSlotNow}.` });
      const cats = countTopCatsRemaining();
      msgs.push({ level:"info", text:`Top-cat market: C1 ${cats.c1}, C2 ${cats.c2}, C3 ${cats.c3} remaining.` });
      const rv = rivalsSnapshot();
      if (rv) msgs.push({ level:"info", text:`Rival watch: ${rv.name} has ${rv.pointsLeft} pts, ${rv.leftSlots} slots, ~${rv.avgPerSlot} per slot.` });
      if (rolesNow.wk<2 || rolesNow.lhb<2 || rolesNow.bowl<8) {
        msgs.push({ level:"warn", text:`Role needs pending → WK ${rolesNow.wk}/2, LHB ${rolesNow.lhb}/2, BOWL ${rolesNow.bowl}/8.` });
      }
      return msgs;
    }

    const base = p.base_point || TOURNAMENT_MIN_BASE;
    const bid = toInt(inpBid.value, 0);
const rating = p.player_rating ?? 0;
if (rating >= 6) {
  // Strong nudge; still respect guardrail and base logic shown below.
  msgs.push({ level:"ok", text:`Must-bid candidate: ${p.name} rated ${rating}/10.` });
}

    if (!Number.isFinite(bid) || bid < base) {
      msgs.push({ level:"bad", text:`Min starting bid for ${p.name} is ${base} (player base).` });
    }

    const hardCapNow = freeAfterGuardrailIfWin();
    const safeCap = Math.min(hardCapNow, Math.round(avgPerSlotNow * 1.5));
    const slotsAfter = Math.max(0, slots - 1);
    const leftIfWin = hrb.budgetLeft - bid;
    const mustKeepAfter = TOURNAMENT_MIN_BASE * slotsAfter;

    if (bid > hardCapNow) {
      msgs.push({ level:"bad", text:`Bid exceeds hard cap ${hardCapNow}. Keep ≥ ${mustKeepAfter} for ${slotsAfter} slots.` });
    } else if (leftIfWin < mustKeepAfter) {
      msgs.push({ level:"warn", text:`This bid leaves ${leftIfWin} < guardrail ${mustKeepAfter}. Reduce bid or skip.` });
    } else {
      msgs.push({ level:"ok", text:`Within guardrail. Hard cap: ${hardCapNow}. Suggested soft cap: ~${safeCap}.` });
    }

    const cats = countTopCatsRemaining();
    const catKey = (p.category||"").toLowerCase();
    if (catKey.includes("1") && cats.c1 <= Math.max(3, slots)) {
      msgs.push({ level:"warn", text:`Scarcity: only ${cats.c1} Cat-1 remain. If ${p.name} fits HRB needs, prioritize.` });
    } else if (catKey.includes("2") && cats.c2 <= Math.max(4, Math.ceil(slots*1.2))) {
      msgs.push({ level:"info", text:`Market tightness: ${cats.c2} Cat-2 remain. Consider a firm stance.` });
    } else if (catKey.includes("3") && cats.c3 <= Math.max(5, Math.ceil(slots*1.5))) {
      msgs.push({ level:"info", text:`Cat-3 remaining: ${cats.c3}. Balance value vs. depth.` });
    }

    const mustKeepNow = TOURNAMENT_MIN_BASE * slots;
    const freeForAggressive = Math.max(0, hrb.budgetLeft - mustKeepNow);
    const capC1 = Math.floor(freeForAggressive / 1500);
    const capC2 = Math.floor(freeForAggressive / 1000);
    const capC3 = Math.floor(freeForAggressive / 500);
    msgs.push({ level:"info", text:`At base (keeping guardrail): C1 ${Math.min(capC1, cats.c1, slots)}, C2 ${Math.min(capC2, cats.c2, slots)}, C3 ${Math.min(capC3, cats.c3, slots)}.` });

    const rv = rivalsSnapshot();
    if (rv) {
      msgs.push({ level:"info", text:`Rival watch: ${rv.name} ~${rv.avgPerSlot}/slot with ${rv.pointsLeft} pts. Expect push near ${Math.min((rv.avgPerSlot*1.2)|0, hardCapNow)}.` });
    }

    const vel = hrbVelocity();
    if (vel.count >= 2 && vel.avgLast3 > avgPerSlotNow * 1.3) {
      msgs.push({ level:"warn", text:`Your last wins avg ~${vel.avgLast3}, above current avg/slot ${avgPerSlotNow}. Risk of late squeeze — tighten bids.` });
    }

    const needWK = Math.max(0, 2 - rolesNow.wk);
    const needLHB = Math.max(0, 2 - rolesNow.lhb);
    const needBOWL = Math.max(0, 8 - rolesNow.bowl);
    if (needWK || needLHB || needBOWL) {
      msgs.push({ level:"warn", text:`Role needs pending → WK ${rolesNow.wk}/2, LHB ${rolesNow.lhb}/2, BOWL ${rolesNow.bowl}/8.` });
      const flags = [];
      if (needWK && isWK(p)) flags.push("WK");
      if (needLHB && isLHB(p)) flags.push("LHB");
      if (needBOWL && isBowler(p)) flags.push("BOWL");
      if (flags.length) msgs.push({ level:"ok", text:`${p.name} fits ${flags.join(" & ")} need(s). Prioritize if budget allows.` });
      if (slots <= 5) msgs.push({ level:"warn", text:`Only ${slots} slots left. Secure missing roles soon to avoid forced picks later.` });
    }

    let step = 25;
    if (catKey.includes("1") || catKey.includes("2")) step = 50;
    const next = Math.min(hardCapNow, Math.max(base, bid + step));
    msgs.push({ level:"ok", text:`Suggested next bid: ${next} (step ${step}). Keep hard cap ${hardCapNow}, soft ~${safeCap}.` });

    msgs.push({ level:"info", text:`HRB: ${hrb.budgetLeft} pts, ${slots} slots → ~${avgPerSlotNow}/slot. If you win at ${bid}, left ${leftIfWin} → ~${slotsAfter>0?Math.round(leftIfWin/slotsAfter):0}/slot.` });
    return msgs;
  }
  function renderAdvisor() {
    if (!advisorBox) return;
    const msgs = computeAdvice();
    advisorBox.innerHTML = "";
    msgs.forEach(m => {
      const cls = ["advice", m.level].join(" ");
      advisorBox.appendChild(el("div", { class: cls }, [ document.createTextNode(m.text) ]));
    });
  }

  // ---------- other clubs (rich headers) ----------
  function renderOtherClubs() {
    otherClubs.innerHTML = "";

    const totalPts = state.totalPoints;

    CLUB_NAMES.filter(c => c !== MY_CLUB).forEach(c => {
      const club = state.clubs[c];
      const have = club.won.length;
      const leftSlots = Math.max(0, state.squadSize - have);
      const spent = Math.max(0, totalPts - club.budgetLeft);
      const avgWin = have > 0 ? Math.round(spent / have) : 0;
      const avgPerSlot = leftSlots > 0 ? Math.round(club.budgetLeft / leftSlots) : 0;

      const last3 = club.won.slice(-3).map(pid => state.players.find(x => x.id === pid)).filter(Boolean);
      const chips = el("div", { class: "chips" });
      last3.slice().reverse().forEach(p => {
        chips.appendChild(el("div", { class: "chip" }, [
          document.createTextNode(`${p.name} — ${p.final_bid}`)
        ]));
      });

      // ---- FULL PLAYER LIST (compact: one line "name  —  bid") ----
const list = el("div", { class: "list other-compact" });
club.won.slice().reverse().forEach(pid => {
  const p = state.players.find(x => x.id === pid); if (!p) return;
  list.appendChild(
    el("div", {
      class: "li",
      style: "display:flex;justify-content:space-between;align-items:center;"
    }, [
     // --el("div", { class: "tiny" }, [ document.createTextNode(p.name) ]), { class: "tiny muted" }, [ document.createTextNode(String(p.final_bid))
      el("div" ])
    ])
  );
});

      const header = el("div", { class: "titlebar club-header" }, [
        el("div", {}, [document.createTextNode(c)]),
        el("div", { class: "titlebar-right" }, [
          document.createTextNode(`Players ${have}/${state.squadSize} • Points Left ${club.budgetLeft} • Avg/slot ${avgPerSlot}`)
        ])
      ]);
      const sub = el("div", { class: "titlebar-sub" }, [
        document.createTextNode(`Spent ${spent} • Avg win ${avgWin}`)
      ]);

      const card = el("div", { class: "card stack" }, [header, sub, chips, list]);
      otherClubs.appendChild(card);
    });
  }

  // ---------- export & logout ----------
  btnExportWon.addEventListener("click", () => {
    const header = ["Club", "Player", "Alumni", "Phone", "Category", "FinalBid"];
    const lines = [header.join(",")];
    state.players.filter(p => p.owner).forEach(p => {
      lines.push([p.owner, p.name, p.alumni || "", p.phone || "", (p.category || "").toUpperCase(), p.final_bid].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "auction_wins.csv" });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    a.remove();
  });

  btnLogout.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  // ---------- refresh helpers ----------
  function refreshAll() {
    renderPlayers();
    renderHRB();
    updateTopBar();
    updateCapacity();
    renderOtherClubs();
  }

  // ---------- init ----------
  populateOtherClubSelect();

  const restored = loadState();
  if (restored && restored.players && Object.keys(restored.clubs||{}).length) {
    applyLoadedState(restored);

    if (state.loggedIn) {
      if (state.players.length > 0) {
        loginCard.style.display = "none";
        settingsCard.style.display = "none";
        liveCard.style.display = "block";
        refreshAll();
        if (state.activeId) setActive(state.activeId);
        renderAdvisor();
      } else {
        loginCard.style.display = "none";
        settingsCard.style.display = "block";
        renderPlayers();
      }
    } else {
      renderPlayers();
    }
  } else {
    renderPlayers();
    renderHRB();
  }
})();
