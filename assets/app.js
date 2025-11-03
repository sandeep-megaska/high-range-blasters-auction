/* HRB Auction Assist — Clubs updated to your canonical list.
   - Start bid >= player's base_point (1500/1000/500/200 by cat)
   - Guardrail: keep 200 × remaining_slots after any HRB win
   - Top-category capacity strip
   - Live snapshot for other clubs
*/

(() => {
  const $ = sel => document.querySelector(sel);
  const el = (tag, attrs={}, children=[]) => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'onclick') n.onclick = v;
      else n.setAttribute(k, v);
    });
    children.forEach(c => n.appendChild(c));
    return n;
  };
  const csvToRows = (text) => text.trim().split(/\r?\n/).map(r => r.split(',').map(s => s.trim()));
  const toInt = (v, d=0) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : d;
  };

  // === Clubs ================================================================
  const MY_CLUB = "High Range Blasters";   // HRB
  const MY_CLUB_SHORT = "HRB";

  const DEFAULT_CLUBS = [
    { name: "High Range Blasters",  slug: "high-range-blasters",  logo_url: "" },
    { name: "Black Panthers",       slug: "black-panthers",       logo_url: "" },
    { name: "White Elephants",      slug: "white-elephants",      logo_url: "" },
    { name: "Kerala Tuskers",       slug: "kerala-tuskers",       logo_url: "" },
    { name: "Warbow Wolverines",    slug: "warbow-wolverines",    logo_url: "" },
    { name: "Venad Warriers",       slug: "venad-warriers",       logo_url: "" },
    { name: "Thiruvalla Warriers",  slug: "thiruvalla-warriers",  logo_url: "" },
    { name: "God's Own XI",         slug: "gods-own-xi",          logo_url: "" },
  ];
  const CLUB_NAMES = DEFAULT_CLUBS.map(c=>c.name);

  // === Categories / base points ============================================
  const BaseByCategory = {
    "cat 1":1500,"cat1":1500,"1":1500,
    "cat 2":1000,"cat2":1000,"2":1000,
    "cat 3":500 ,"cat3":500 ,"3":500,
    "cat 4":200 ,"cat4":200 ,"4":200
  };
  const TOURNAMENT_MIN_BASE = 200;

  // === State ================================================================
  const state = {
    loggedIn:false,
    squadSize:15,
    totalPoints:15000,
    players:[],           // {id,name,alumni,phone,category,base_point,performance_index,owner,final_bid}
    activeId:null,
    clubs: Object.fromEntries(CLUB_NAMES.map(c => [c, { name:c, budgetLeft:15000, won:[] }]))
  };
  function resetClubBudgets(total) {
    CLUB_NAMES.forEach(c => { state.clubs[c].budgetLeft = total; state.clubs[c].won = []; });
  }

  // === UI refs ==============================================================
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

  const c1Left = $("#c1Left"), c2Left = $("#c2Left"), c3Left = $("#c3Left");
  const c1Cap = $("#c1Cap"), c2Cap = $("#c2Cap"), c3Cap = $("#c3Cap");
  const mixNote = $("#mixNote");
  const btnExportWon = $("#btnExportWon");
  const btnLogout = $("#btnLogout");
  const otherClubs = $("#otherClubs");

  // Inject other-club options (excluding my club)
  function populateOtherClubSelect() {
    selOtherClub.innerHTML = "";
    selOtherClub.appendChild(el("option", {value:""}, [document.createTextNode("Assign to other club…")]));
    DEFAULT_CLUBS.filter(c=>c.name!==MY_CLUB).forEach(c=>{
      selOtherClub.appendChild(el("option", {value:c.name}, [document.createTextNode(c.name)]));
    });
  }

  // === Auth =================================================================
  btnLogin.addEventListener("click", () => {
    if (loginPass.value.trim() !== "sandeep") { alert("Wrong password. (Hint: sandeep)"); return; }
    state.loggedIn = true;
    loginCard.style.display = "none";
    settingsCard.style.display = "block";
    populateOtherClubSelect();
  });

  // === CSV load =============================================================
  btnLoadCsv.addEventListener("click", async () => {
    loadStatus.textContent = "Loading…";
    try {
      let csvText = csvPaste.value.trim();
      if (!csvText && csvUrl.value.trim()) {
        const r = await fetch(csvUrl.value.trim());
        if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
        csvText = await r.text();
      }
      if (!csvText) { loadStatus.textContent = "Paste CSV or provide a CSV URL."; return; }

      const rows = csvToRows(csvText);
      if (rows.length < 2) throw new Error("No data rows found.");

      const headers = rows[0].map(h => h.toLowerCase());
      const idx = (key, ...alts) => {
        const tries = [key.toLowerCase(), ...alts.map(a=>a.toLowerCase())];
        for (const t of tries) { const i = headers.indexOf(t); if (i !== -1) return i; }
        return -1;
      };

      const iName = idx("name","player","player_name");
      const iAlum = idx("alumni","alum","alumni_name");
      const iPhone= idx("phone","mobile","contact","phone number","phone_no");
      const iCat  = idx("category","cat");
      const iBase = idx("base_point","base","basepoints","base point");
      const iPI   = idx("performance_index","pi","rank","rating");

      if (iName === -1 || iCat === -1 || iBase === -1) throw new Error("CSV must include name, category, base_point.");

      state.players = rows.slice(1).filter(r => r.length>=headers.length).map((r,idxr) => {
        const rawCat = (r[iCat]||"").toString().trim().toLowerCase();
        const baseFromCsv = toInt(r[iBase], 0);
        const catBase = BaseByCategory[rawCat] ?? 0;
        const base_point = baseFromCsv>0 ? baseFromCsv : (catBase>0?catBase:TOURNAMENT_MIN_BASE);
        return {
          id: "p"+(idxr+1),
          name: (r[iName]||"").trim(),
          alumni: iAlum!==-1 ? (r[iAlum]||"").trim() : "",
          phone:  iPhone!==-1 ? (r[iPhone]||"").trim() : "",
          category: rawCat || "cat 4",
          base_point,
          performance_index: iPI!==-1 ? toInt(r[iPI], 0) : 0,
          owner: "", final_bid: 0
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
  });

  // === List + search ========================================================
  btnClearSearch.addEventListener("click", () => { search.value = ""; renderPlayers(); });
  search.addEventListener("input", renderPlayers);

  function renderPlayers() {
    const q = search.value.trim().toLowerCase();
    const remain = state.players.filter(p => !p.owner && (p.name.toLowerCase().includes(q) || p.alumni.toLowerCase().includes(q)));
    playersList.innerHTML = "";
    remain.forEach(p => {
      const catLabel = (p.category||"").toUpperCase();
      const row = el("div", {class:"li selectable", onclick:()=>setActive(p.id)}, [
        el("div", {}, [
          el("div", {}, [document.createTextNode(p.name || "(no name)")]),
          el("div", {class:"tiny muted"}, [document.createTextNode((p.alumni||"").toString())]),
        ]),
        el("div", {class:"right"}, [
          el("div", {class:"pill"}, [document.createTextNode(`${catLabel} • base ${p.base_point}`)]),
          el("div", {class:"flex", style:"margin-top:6px;"}, [
            el("button", {class:"btn", onclick:(ev)=>{ev.stopPropagation(); setActive(p.id);}}, [document.createTextNode("Pick")])
          ])
        ])
      ]);
      if (p.id === state.activeId) row.classList.add("active");
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
    // highlight active row
    [...playersList.querySelectorAll('.li')].forEach(x=>x.classList.remove('active'));
    const activeRow = [...playersList.children].find(n => {
      const name = n.querySelector(':scope > div:first-child > div:first-child');
      return name && name.textContent === p.name;
    });
    if (activeRow) activeRow.classList.add('active');
  }

  // === Bidding & guardrail ==================================================
  function remainingSlotsHRB() { return state.squadSize - state.clubs[MY_CLUB].won.length; }
  function guardrailNow() { return TOURNAMENT_MIN_BASE * remainingSlotsHRB(); }

  function validateBid() {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) { btnHrbWon.disabled = true; btnAssignOther.disabled = true; bidHint.textContent = "Select a player to begin."; return; }
    const bid = toInt(inpBid.value, 0);
    const base = p.base_point;

    if (!Number.isFinite(bid) || bid < base) {
      bidHint.innerHTML = `<span class="bad">Min starting bid for ${p.name} is ${base} (player base).</span>`;
      btnHrbWon.disabled = true;
      btnAssignOther.disabled = (selOtherClub.value==="" || bid<base);
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

    // For assigning to other clubs, require ≥ base and a club chosen
    btnAssignOther.disabled = (selOtherClub.value==="" || bid<base);
  }

  inpBid.addEventListener("input", validateBid);
  selOtherClub.addEventListener("change", validateBid);

  function hrbWon(bid) {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    p.owner = MY_CLUB; p.final_bid = bid;
    state.clubs[MY_CLUB].won.push(p.id);
    state.clubs[MY_CLUB].budgetLeft -= bid;
    clearActive();
    refreshAll();
  }

  function assignOther(club, bid) {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    p.owner = club; p.final_bid = bid;
    state.clubs[club].won.push(p.id);
    state.clubs[club].budgetLeft -= bid;
    clearActive();
    refreshAll();
  }

  function clearActive() {
    state.activeId = null;
    activeName.textContent = "—"; activeCat.textContent = "—"; activeBase.textContent = "—";
    inpBid.value = ""; bidHint.textContent = "Select a player to begin.";
  }

  $("#btnHrbWon").addEventListener("click", () => {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    const bid = toInt(inpBid.value, 0);
    if (bid < p.base_point) { alert(`Min starting bid is ${p.base_point}.`); return; }
    const slotsAfter = Math.max(0, remainingSlotsHRB() - 1);
    const mustKeep = TOURNAMENT_MIN_BASE * slotsAfter;
    const leftIfWin = state.clubs[MY_CLUB].budgetLeft - bid;
    if (leftIfWin < mustKeep) { alert(`This breaks guardrail. Need ≥ ${mustKeep} left after the win.`); return; }
    hrbWon(bid);
  });

  $("#btnAssignOther").addEventListener("click", () => {
    const p = state.players.find(x => x.id === state.activeId);
    if (!p) return;
    const bid = toInt(inpBid.value, 0);
    const club = selOtherClub.value;
    if (!club) { alert("Choose a club."); return; }
    if (bid < p.base_point) { alert(`Final price must be ≥ player base (${p.base_point}).`); return; }
    assignOther(club, bid);
  });

  // keyboard: Enter = try HRB win if valid
  inpBid.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !btnHrbWon.disabled) btnHrbWon.click();
  });

  // === HRB panel + topbar ===================================================
  function renderHRB() {
    const hrb = state.clubs[MY_CLUB];
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
          el("span", {class:"pill"}, [document.createTextNode(`${(p.category||'').toUpperCase()}`)]),
          el("div", {class:"tiny muted"}, [document.createTextNode(`Bid: ${p.final_bid}`)])
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
  }

  // === Capacity (Cat1/2/3) ==================================================
  function updateCapacity() {
    const hrb = state.clubs[MY_CLUB];
    const leftSlots = remainingSlotsHRB();
    const remaining = state.players.filter(p => !p.owner);
    const catCount = { c1:0, c2:0, c3:0 };
    remaining.forEach(p => {
      const c = (p.category||"").toLowerCase();
      if (c.includes("1")) catCount.c1++;
      else if (c.includes("2")) catCount.c2++;
      else if (c.includes("3")) catCount.c3++;
    });
    c1Left.textContent = catCount.c1; c2Left.textContent = catCount.c2; c3Left.textContent = catCount.c3;

    const mustKeep = TOURNAMENT_MIN_BASE * leftSlots;
    const free = Math.max(0, hrb.budgetLeft - mustKeep);

    const capC1 = Math.min(catCount.c1, Math.floor(free / 1500), leftSlots);
    const capC2 = Math.min(catCount.c2, Math.floor(free / 1000), leftSlots);
    const capC3 = Math.min(catCount.c3, Math.floor(free / 500) , leftSlots);
    c1Cap.textContent = capC1; c2Cap.textContent = capC2; c3Cap.textContent = capC3;

    // greedy mix
    let budget = free, slots = leftSlots, r1=0,r2=0,r3=0;
    const take = (cost, avail, ref) => {
      if (slots<=0 || avail<=0 || budget<cost) return;
      const n = Math.min(avail, Math.floor(budget/cost), slots);
      budget -= n*cost; slots -= n; ref(n);
    };
    take(1500, Math.min(catCount.c1,leftSlots), n=>r1=n);
    take(1000, Math.min(catCount.c2,leftSlots), n=>r2=n);
    take(500 , Math.min(catCount.c3,leftSlots), n=>r3=n);
    mixNote.innerHTML = `You can still target about <b>${r1}</b> × Cat-1, <b>${r2}</b> × Cat-2, <b>${r3}</b> × Cat-3 at base while preserving the guardrail.`;
  }

  // === Other clubs live cards ===============================================
  function renderOtherClubs() {
  otherClubs.innerHTML = "";

  // Show each club in its own card, same visual structure as HRB Selected Squad
  CLUB_NAMES.filter(c => c !== MY_CLUB).forEach(c => {
    const club = state.clubs[c];
    const have = club.won.length;
    const leftSlots = state.squadSize - have;

    // Build the minimal player list (same as HRB list style)
    const list = el("div", { class: "list" });
    club.won.slice().reverse().forEach(pid => {
      const p = state.players.find(x => x.id === pid);
      if (!p) return;

      list.appendChild(
        el("div", { class: "li" }, [
          el("div", {}, [
            el("div", {}, [document.createTextNode(p.name)]),
            el("div", { class: "tiny muted" }, [
              document.createTextNode(`${p.alumni || ""}  • ${p.phone || ""}`)
            ])
          ]),
          el("div", { class: "right" }, [
            el("span", { class: "pill" }, [
              document.createTextNode(`${(p.category || "").toUpperCase()}`)
            ]),
            el("div", { class: "tiny muted" }, [
              document.createTextNode(`Bid: ${p.final_bid}`)
            ])
          ])
        ])
      );
    });

    // Header matches HRB card style: title on left, tiny status on right
    const header = el("div", { class: "titlebar" }, [
      el("div", {}, [document.createTextNode(c)]),
      el("div", { class: "titlebar-right" }, [
        document.createTextNode(`Players ${have}/${state.squadSize} • Points Left ${club.budgetLeft}`)
      ])
    ]);

    const card = el("div", { class: "card stack" }, [header, list]);
    otherClubs.appendChild(card);
  });
}

    // Header matches HRB card style: title on left, tiny status on right
    const header = el("div", { class: "titlebar" }, [
      el("div", {}, [document.createTextNode(c)]),
      el("div", { class: "titlebar-right" }, [
        document.createTextNode(`Players ${have}/${state.squadSize} • Points Left ${club.budgetLeft}`)
      ])
    ]);

    const card = el("div", { class: "card stack" }, [header, list]);
    otherClubs.appendChild(card);
  });
}

      const card = el("div", {class:"card stack"}, [
        el("div", {class:"titlebar"}, [
          el("div", {}, [document.createTextNode(c)]),
          el("div", {class:"kpi"}, [
            el("div", {class:"box"}, [el("div",{class:"tiny muted"},[document.createTextNode("Players")]), el("div",{class:"n"},[document.createTextNode(`${have}/${state.squadSize}`)])]),
            el("div", {class:"box"}, [el("div",{class:"tiny muted"},[document.createTextNode("Points Left")]), el("div",{class:"n"},[document.createTextNode(club.budgetLeft)])]),
          ])
        ]),
        list
      ]);
      otherClubs.appendChild(card);
    });
  }

  // === Export & logout =======================================================
  btnExportWon.addEventListener("click", () => {
    const header = ["Club","Player","Alumni","Phone","Category","FinalBid"];
    const lines = [header.join(",")];
    state.players.filter(p => p.owner).forEach(p => {
      lines.push([p.owner, p.name, p.alumni||"", p.phone||"", (p.category||"").toUpperCase(), p.final_bid].join(","));
    });
    const blob = new Blob([lines.join("\n")], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = el("a", {href:url, download:"auction_wins.csv"});
    document.body.appendChild(a); a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1200); a.remove();
  });

  btnLogout.addEventListener("click", () => location.reload());

  // === Refresh helpers =======================================================
  function refreshAll() {
    renderPlayers(); renderHRB(); updateTopBar(); updateCapacity(); renderOtherClubs();
  }

  // initial
  populateOtherClubSelect();
  renderPlayers(); renderHRB();
})();
