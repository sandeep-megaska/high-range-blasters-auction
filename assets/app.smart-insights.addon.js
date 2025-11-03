/* HRB Auction Assist – Smart Insights (Category-Base Aware)
 * Drop this AFTER your main app.js (and after any previous add-ons).
 * This add-on makes the MINIMUM BID equal to the player's category/base value
 * (e.g., Cat1 = 1500, Cat2 = 1000, Cat3 = 500, Cat4 = 200) and updates guardrails,
 * suggested caps, feasibility checks, and win probability accordingly.
 */
(function(){
  if (!window || !document) return;

  // --- Safe accessors ---
  const getState = () => window.state || {};
  const $ = (id)=>document.getElementById(id);
  const toNum = (v,d=0)=>{ const n=Number(v); return Number.isFinite(n)?n:d; };

  // --- Ensure constants ---
  window.CATEGORY_BASE = window.CATEGORY_BASE || {1:1500, 2:1000, 3:500, 4:200};
  window.TARGETS = window.TARGETS || { wk:2, lhb:2, bowl:8 };

  // --- Role helpers (fallbacks if not present) ---
  if (typeof window.isBowler!=="function") {
    window.isBowler = role => /bowl/i.test(String(role||""));
  }
  if (typeof window.isWK!=="function") {
    window.isWK = (p)=>{
      const flag = String(p?.wk||"").trim().toLowerCase();
      const byFlag = flag==="y" || flag==="yes" || flag==="true" || flag==="1";
      const byRole = /wk|wicket/i.test(String(p?.skill||""));
      return byFlag || byRole;
    };
  }

  // --- Category-aware minimum for a player ---
  function minBidFor(p){
    const cat = Number(p?.category)||4;
    const baseFromCat = window.CATEGORY_BASE[cat] ?? 200;
    const baseFromSheet = toNum(p?.base_point, baseFromCat);
    return Math.max(200, baseFromSheet); // never below 200
  }

  // --- Remaining floor (sum of smallest base_points needed to fill remaining slots) ---
  function remainingFloor(excludeId=null, slotsOverride=null){
    const s = getState();
    const all = (s.players||[]).filter(p=>p.status!=="won" && (excludeId? String(p.id)!==String(excludeId):true));
    const k = Math.max(0, (slotsOverride==null? remainingSlots() : slotsOverride));
    if (k<=0) return 0;
    const bases = all.map(p=>minBidFor(p)).sort((a,b)=>a-b);
    let sum = 0;
    for (let i=0; i<Math.min(k, bases.length); i++) sum += bases[i];
    // if pool has fewer than k players, conservatively assume min 200 for missing
    if (bases.length<k) sum += (k - bases.length)*200;
    return sum;
  }

  // --- Budget helpers ---
  function remainingSlots(){
    const s=getState();
    const cap = toNum(s.playersNeeded, 15);
    const mine=(s.players||[]).filter(p=>p.owner===s.myClubSlug&&p.status==="won").length;
    return Math.max(0, cap - mine);
  }
  function remainingBudget(slug){
    const s=getState();
    const c=(s.clubs||[]).find(c=>c.slug===slug);
    return c?toNum(c.budget_left,c.starting_budget||0):0;
  }

  // --- Guardrail: ensure (1) bid >= player min AND (2) enough left to cover the floor of remaining slots ---
  window.guardrailOK = function(bid, playerOpt){
    const s = getState();
    const p = playerOpt || (s.players||[]).find(x=>String(x.id)===String(s.activePlayerId));
    if (!p) return false;
    const price = Number(bid);
    const minForP = minBidFor(p);
    if (!Number.isFinite(price) || price < minForP) return false;

    const bud = remainingBudget(s.myClubSlug);
    const remSlotsAfter = Math.max(0, remainingSlots()-1);
    const floorAfter = remainingFloor(p.id, remSlotsAfter);
    return (price <= bud) && ((bud - price) >= floorAfter);
  };

  // --- Hard cap for current action (max you can spend now respecting remaining floor) ---
  window.maxYouCanSpendNow = function(playerOpt){
    const s = getState();
    const p = playerOpt || (s.players||[]).find(x=>String(x.id)===String(s.activePlayerId));
    const bud = remainingBudget(s.myClubSlug);
    const remSlotsAfter = Math.max(0, remainingSlots()-1);
    const floorAfter = remainingFloor(p?.id, remSlotsAfter);
    return Math.max(minBidFor(p||{}), bud - floorAfter);
  };

  // --- Suggested cap updated to category bases & hard cap ---
  const _origComputePriority = window.computeBidPriority;
  window.computeBidPriority = function(p){
    const baseFn = (typeof _origComputePriority==="function") ? _origComputePriority : null;
    if (baseFn){
      // let original add-on/category logic run if already present
      return baseFn(p);
    }
    // otherwise: minimal priority based on simple PI and category
    const pi = toNum(p?.performance_index, 60);
    const cat = Number(p?.category)||4;
    const catBoost = cat===1?12: cat===2?8: cat===3?4: 0;
    return Math.max(0, Math.min(120, pi + catBoost));
  };

  window.suggestedCap = function(p){
    const s = getState();
    const bud = remainingBudget(s.myClubSlug);
    const slots = Math.max(1, remainingSlots());
    const avgPerSlot = bud / slots;
    const priority = window.computeBidPriority(p);
    const prioFactor = 0.7 + (priority/120)*0.9; // slightly more aggressive
    const basePoint = minBidFor(p);
    const baseFactor = 1 + (toNum(p.performance_index, 60))/180; // 1..~1.33
    const cat = Number(p.category)||4;
    const catWeight = cat===1?1.40: cat===2?1.22: cat===3?1.06: 0.92;

    const capByPriority = avgPerSlot * prioFactor * catWeight;
    const capByBase = basePoint * baseFactor * (cat>=3?1.0:1.12);

    const hardCap = window.maxYouCanSpendNow(p);
    const cap = Math.max(basePoint, Math.round(Math.min(hardCap, Math.max(capByBase, capByPriority))));
    return cap;
  };

  // --- Win probability: take category into account (Cat1-2 easier to push high) ---
  window.winProbabilityHeuristic = function(p, bid){
    const s = getState();
    const threats = (typeof window.threatClubs==="function")? window.threatClubs(): [];
    const bench = threats.length ? threats.reduce((acc,c)=>acc+c.perSlot,0)/threats.length : (remainingBudget(s.myClubSlug)/Math.max(1,remainingSlots()));
    const prio = window.computeBidPriority(p)/120; // 0..1
    const ratio = (toNum(bid,0)) / Math.max(1, bench);
    const cat = Number(p.category)||4;
    const catAdj = cat===1?1.08: cat===2?1.05: cat===3?1.02: 0.98;
    const score = 0.32*ratio + 0.68*prio * catAdj; // weighted
    if (score>=1.05) return {label:"High", color:"#16a34a"};
    if (score>=0.75) return {label:"Medium", color:"#f59e0b"};
    return {label:"Low", color:"#dc2626"};
  };

  // --- Patch liveBid UI hints if present ---
  const _origRenderLiveBid = window.renderLiveBid;
  window.renderLiveBid = function(){
    if (typeof _origRenderLiveBid === "function") _origRenderLiveBid();
    // augment warnings/inputs
    const s=getState();
    const p=(s.players||[]).find(x=>String(x.id)===String(s.activePlayerId));
    const warnEl = $("bidWarn");
    const input = $("bidInput");
    if (!p || !input || !warnEl) return;

    // Force input min to category base
    input.min = String(minBidFor(p));

    const check = ()=>{
      const val = Number(input.value);
      const ok = window.guardrailOK(val, p);
      const hard = window.maxYouCanSpendNow(p);
      if (!Number.isFinite(val) || val < minBidFor(p)){
        warnEl.textContent = "Enter a bid ≥ category/base: " + minBidFor(p);
      } else if (!ok){
        warnEl.textContent = "Guardrail: keep ≥ sum of minimums for remaining slots. You can spend up to " + hard + " now.";
      } else {
        warnEl.textContent = "";
      }
    };
    input.removeEventListener("__catbase_check", ()=>{}); // noop
    input.addEventListener("input", check);
    // initial
    check();
  };

  // --- Repaint insights to ensure caps & win prob cards refresh ---
  try { if (typeof window.renderLiveBid==="function") window.renderLiveBid(); } catch(e){}
})();
