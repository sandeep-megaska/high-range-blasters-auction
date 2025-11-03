/* HRB Auction Assist – single-file logic focused on:
   - Enforcing per-player base_point as the starting bid
   - Guardrail: always keep 200 × remaining_slots after any HRB win
   - Top-category capacity panel (Cat1/2/3 remaining & you-can-still-afford counts)
   Author: You + ChatGPT, 2025-11-03
*/

(() => {

  // --- helpers --------------------------------------------------------------
  const $ = sel => document.querySelector(sel);
  const el = (tag, attrs={}, children=[]) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v);
    });
    children.forEach(c => n.appendChild(c));
    return n;
  };
  const csvToRows = (text) => {
    // very simple CSV splitter (assumes no quoted commas in your dataset)
    return text.trim().split(/\r?\n/).map(r => r.split(',').map(s => s.trim()));
  };
  const toInt = (v, d=0) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };

  // --- app state ------------------------------------------------------------
  const Clubs = ["HRB","ALPHA","BRAVO","CHARLIE","DELTA","EAGLES","FALCONS","ROYALS"];
  const BaseByCategory = { "cat 1":1500, "cat1":1500, "1":1500,
                           "cat 2":1000, "cat2":1000, "2":1000,
                           "cat 3":500,  "cat3":500,  "3":500,
                           "cat 4":200,  "cat4":200,  "4":200 };
  const TOURNAMENT_MIN_BASE = 200;

  const state = {
    loggedIn:false,
    squadSize:15,
    totalPoints:15000,
    players:[],           // {id,name,alumni,phone,category,base_point,performance_index,owner,final_bid}
    activeId:null,
    clubs: Object.fromEntries(Clubs.map(c => [c, { name:c, budgetLeft:15000, won:[] }])),
  };

  // budgetLeft needs to follow totalPoints if user changes settings
  function resetClubBudgets(total) {
    Clubs.forEach(c => {
      state.clubs[c].budgetLeft = total;
      state.clubs[c].won = [];
    });
  }

  // --- UI references --------------------------------------------------------
  const loginCard = $("#loginCard");
  const settingsCard = $("#settingsCard");
  const liveCard = $("#liveCard");

  const loginPass = $("#loginPass");
  const btnLogin = $("#btnLogin");

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

  const c1Left = $("#c1Left"); const c2Left = $("#c2Left"); const c3Left = $("#c3Left");
  const c1Cap = $("#c1Cap");   const c2Cap = $("#c2Cap");   const c3Cap = $("#c3Cap");
  const mixNote = $("#mixNote");
  const btnExportWon = $("#btnExportWon");
  const btnLogout = $("#btnLogout");

  // --- auth --------------------------------------------------------------
  btnLogin.addEventListener("click", () => {
    if (loginPass.value.trim() !== "sandeep") {
      alert("Wrong password. (Hint: sandeep)");
      return;
    }
    state.loggedIn = true;
    loginCard.style.display = "none";
    settingsCard.style.display = "block";
  });

  // --- CSV load -----------------------------------------------------------
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
        const tries = [key.toLowerCase(), ...alts.map(a=>a.toLowerCase())];
        for (const t of tries) {
          const i = headers.indexOf(t);
          if (i !== -1) return i;
        }
        return -1;
      };

      const iName = idx("name","player","player_name");
      const iAlum = idx("alumni","alum","alumni_name");
      const iPhone= idx("phone","mobile","contact");
      const iCat  = idx("category","cat");
      const iBase = idx("base_point","base","basepoints");
      const iPI   = idx("performance_index","pi","rank","rating");

      if (iName === -1 || iCat === -1 || iBase === -1) throw new Error("CSV must include name, category, base_point.");

      state.players = rows.slice(1).filter(r => r.length>=headers.length).map((r,idxr) => {
        const rawCat = (r[iCat]||"").toString().trim().toLowerCase();
        const baseFromCsv = toInt(r[iBase], 0);
        const catBase = BaseByCategory[rawCat] ?? 0;
        // If a row's base is missing, derive from category table; else keep the CSV value
        const base_point = baseFromCsv>0 ? baseFromCsv : (catBase>0?catBase:TOURNAMENT_MIN_BASE);
        return {
          id: "p"+(idxr+1),
          name: (r[iName]||"").trim(),
          alumni: iAlum!==-1 ? (r[iAlum]||"").trim() : "",
          phone: iPhone!==-1 ? (r[iPhone]||"").trim() : "",
          category: rawCat || "cat 4",
          base_point,
          performance_index: iPI!==-1 ? toInt(r[iPI], 0) : 0,
          owner: "", final_bid: 0
        };
      });

      // settings sync
      state.squadSize = Math.max(1, toInt(inpSquad.value, 15));
      state.totalPoints = Math.max(1, toInt(inpPoints.value, 15000));
      kSquad.textContent = state.squadSize;
      kPoints.textContent = state.totalPoints;
      resetClubBudgets(state.totalPoints);

      loadStatus.textContent = `Loaded ${state.players.length} players.`;
      btnProceed.disabled = false;
      renderPlayers();
    } catch (e) {
      console.error(e);
      loadStatus.textContent = "Error: " + e.message;
      btnProceed.disabled = true;
    }
  });

  btnProceed.addEventListener("click", () => {
    settingsCard.style.display = "none";
    liveCard.style.display = "block";
    updateTopBar();
    updateCapacity();
  });

  // --- list + search ------------------------------------------------------
  btnClearSearch.addEventListener("click", () => { search.value = ""; renderPlayers(); });
  search.addEventListener("input", renderPlayers);

  function renderPlayers() {
    if (!playersList) return;
    const q = search.value.trim().toLowerCase();
    const remain = state.players.filter(p => !p.owner && (p.name.toLowerCase().includes(q) || p.alumni.toLowerCase().includes(q)));
    playersList.innerHTML = "";
    remain.forEach(p => {
      const catLabel = (p.category||"").toUpperCase();
      const row = el("div", {class:"li"}, [
        el("div", {class:""}, [
          el("div", {class:""}, [document.createTextNode(p.name || "(no name)")]),
          el("div", {class:"tiny muted"}, [document.createTextNode((p.alumni||"").toString())]),
        ]),
        el("div", {class:"right"}, [
          el("div", {class:"pill"}, [document.createTextNode(`${catLabel} • base ${p.base_point}`)]),
          el("div", {class:"flex", style:"margin-top:6px;"}, [
            el("button", {class:"btn", onclick:()=>setActive(p.id)}, [document.createTextNode("Pick")])
          ])
        ])
      ]);
      playersList.appendChild(row);
    });
    if (!remain.length) {
      playersList.appendChild(el("div", {class:"li"}, [document.createTextNode("No remaining players match your search.")]));
    }
  }

  function setActive(id) {
    state.activeId = id;
    const p = state.players.find(x => x.id === id);
    if (!p) return;
    activeName.textContent = p.name;
    activeCat.textContent = (p.category||"").toUpperCase();
    activeBase.textContent = p.base_point;
    inpBid.value = p.base_point;
    validateBid();
  }

  // --- bidding & guardrail -------------------------------------------------
  function hrbWon(bid) {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    p.owner = "HRB";
    p.final_bid = bid;
    state.clubs["HRB"].won.push(p.id);
    state.clubs["HRB"].budgetLeft -= bid;
    state.activeId = null;
    activeName.textContent = "—";
    activeCat.textContent = "—";
    activeBase.textContent = "—";
    inpBid.value = "";
    bidHint.textContent = "Select a player to begin.";
    renderPlayers();
    renderHRB();
    updateTopBar();
    updateCapacity();
  }

  function assignOther(club, bid) {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    p.owner = club;
    p.final_bid = bid;
    state.clubs[club].won.push(p.id);
    state.clubs[club].budgetLeft -= bid;
    state.activeId = null;
    activeName.textContent = "—";
    activeCat.textContent = "—";
    activeBase.textContent = "—";
    inpBid.value = "";
    bidHint.textContent = "Select a player to begin.";
    renderPlayers();
    renderHRB();
    updateTopBar();
    updateCapacity();
  }

  function remainingSlotsHRB() {
    return state.squadSize - state.clubs["HRB"].won.length;
  }

  function guardrailNow() {
    // guardrail is 200 × remaining slots (current moment)
    return TOURNAMENT_MIN_BASE * remainingSlotsHRB();
  }

  function validateBid() {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) {
      btnHrbWon.disabled = true;
      btnAssignOther.disabled = true;
      return;
    }
    const bid = toInt(inpBid.value, 0);
    const base = p.base_point;

    // 1) start bid must be >= player's base_point
    if (!Number.isFinite(bid) || bid < base) {
      bidHint.innerHTML = `<span class="bad">Min starting bid for ${p.name} is ${base} (player base).</span>`;
      btnHrbWon.disabled = true;
      btnAssignOther.disabled = true;
      return;
    }

    // 2) guardrail check after winning: ensure we keep 200 × slots_after_win
    const slotsAfter = Math.max(0, remainingSlotsHRB() - 1);
    const mustKeep = TOURNAMENT_MIN_BASE * slotsAfter;
    const leftIfWin = state.clubs["HRB"].budgetLeft - bid;

    if (leftIfWin < mustKeep) {
      bidHint.innerHTML = `<span class="warn">Bid violates guardrail: after this win you'd keep ${leftIfWin}, but need ≥ ${mustKeep} (200 × remaining slots).</span>`;
      btnHrbWon.disabled = true;
    } else {
      bidHint.innerHTML = `<span class="ok">Ok to bid.</span>`;
      btnHrbWon.disabled = false;
    }

    // other club assignment requires a positive bid as well (we don't check their guardrail)
    btnAssignOther.disabled = selOtherClub.value==="" || bid<=0;
  }

  inpBid.addEventListener("input", validateBid);
  selOtherClub.addEventListener("change", validateBid);
  btnHrbWon.addEventListener("click", () => {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    const bid = toInt(inpBid.value, 0);
    if (bid < p.base_point) {
      alert(`Min starting bid for this player is ${p.base_point}.`);
      return;
    }
    // final guardrail recheck
    const slotsAfter = Math.max(0, remainingSlotsHRB() - 1);
    const mustKeep = TOURNAMENT_MIN_BASE * slotsAfter;
    const leftIfWin = state.clubs["HRB"].budgetLeft - bid;
    if (leftIfWin < mustKeep) {
      alert(`This would break the guardrail. Need to keep at least ${mustKeep} after this win.`);
      return;
    }
    hrbWon(bid);
  });

  btnAssignOther.addEventListener("click", () => {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    const bid = toInt(inpBid.value, 0);
    if (bid <= 0) { alert("Enter a final price to assign."); return; }
    const club = selOtherClub.value;
    if (!club) { alert("Choose a club."); return; }
    assignOther(club, bid);
  });

  // --- HRB panel + top bar -------------------------------------------------
  function renderHRB() {
    const hrb = state.clubs["HRB"];
    hrbList.innerHTML = "";
    hrb.won.slice().reverse().forEach(pid => {
      const p = state.players.find(x=>x.id===pid);
      if (!p) return;
      const row = el("div", {class:"li"}, [
        el("div", {}, [
          el("div", {}, [document.createTextNode(p.name)]),
          el("div", {class:"tiny muted"}, [document.createTextNode(`${p.alumni||''}  • ${p.phone||''}`)])
        ]),
        el("div", {class:"right"}, [
          el("span", {class:"pill"}, [document.createTextNode(`${p.category.toUpperCase()}`)]),
          el("div", {class:"tiny muted"}, [document.createTextNode(`Bid: ${p.final_bid}`)])
        ])
      ]);
      hrbList.appendChild(row);
    });
    hrbSummary.textContent = `${hrb.won.length} players`;
  }

  function updateTopBar() {
    const hrb = state.clubs["HRB"];
    const have = hrb.won.length;
    const leftSlots = state.squadSize - have;
    kHrbPlayers.textContent = `${have}/${state.squadSize}`;
    kHrbLeft.textContent = hrb.budgetLeft;
    kGuard.textContent = TOURNAMENT_MIN_BASE * leftSlots;
  }

  // --- Top-category capacity calculation -----------------------------------
  function updateCapacity() {
    const hrb = state.clubs["HRB"];
    const leftSlots = remainingSlotsHRB();

    const remaining = state.players.filter(p => !p.owner);
    const catCount = { c1:0, c2:0, c3:0 };
    remaining.forEach(p => {
      const c = (p.category||"").toLowerCase();
      if (c.includes("1")) catCount.c1++;
      else if (c.includes("2")) catCount.c2++;
      else if (c.includes("3")) catCount.c3++;
    });
    c1Left.textContent = catCount.c1;
    c2Left.textContent = catCount.c2;
    c3Left.textContent = catCount.c3;

    // Budget available for top-cats after reserving 200 × remaining slots
    const mustKeep = TOURNAMENT_MIN_BASE * leftSlots;
    const freeForAggressive = Math.max(0, hrb.budgetLeft - mustKeep);

    const capC1 = Math.min(catCount.c1, Math.floor(freeForAggressive / 1500), leftSlots);
    const capC2 = Math.min(catCount.c2, Math.floor(freeForAggressive / 1000), leftSlots);
    const capC3 = Math.min(catCount.c3, Math.floor(freeForAggressive / 500) , leftSlots);

    c1Cap.textContent = capC1;
    c2Cap.textContent = capC2;
    c3Cap.textContent = capC3;

    // Recommended mix (greedy at base, highest category first)
    let budget = freeForAggressive;
    let slots  = leftSlots;
    let r1=0,r2=0,r3=0;

    const take = (cost, limit, refSetter) => {
      if (slots<=0 || limit<=0 || budget<cost) return 0;
      const maxByBudget = Math.floor(budget/cost);
      const n = Math.max(0, Math.min(limit, maxByBudget, slots));
      budget -= n*cost; slots -= n; refSetter(n);
      return n;
    };

    // How many actually available in each cat (not just affordable)
    const a1 = Math.min(catCount.c1, leftSlots);
    const a2 = Math.min(catCount.c2, leftSlots);
    const a3 = Math.min(catCount.c3, leftSlots);

    take(1500, a1, n=>r1=n);
    take(1000, a2, n=>r2=n);
    take(500 , a3, n=>r3=n);

    mixNote.innerHTML =
      `You can still target about <b>${r1}</b> × Cat-1, <b>${r2}</b> × Cat-2, <b>${r3}</b> × Cat-3 at base with your current budget, while preserving the 200×guardrail.`;
  }

  // --- export ---------------------------------------------------------------
  btnExportWon.addEventListener("click", () => {
    const header = ["Club","Player","Alumni","Phone","Category","FinalBid"];
    const lines = [header.join(",")];
    state.players.filter(p => p.owner).forEach(p => {
      lines.push([p.owner, p.name, p.alumni||"", p.phone||"", (p.category||"").toUpperCase(), p.final_bid].join(","));
    });
    const blob = new Blob([lines.join("\n")], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = el("a", {href:url, download:"auction_wins.csv"});
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
    a.remove();
  });

  // --- logout ---------------------------------------------------------------
  btnLogout.addEventListener("click", () => {
    location.reload();
  });

  // initial
  renderPlayers();
  renderHRB();
})();
