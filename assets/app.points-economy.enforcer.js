/* HRB Auction Assistant — Points Economy Enforcer
 * Load AFTER app.js
 * - Enforces per-player base_point (cannot win/assign below it)
 * - Guardrail: protects budget so you can still fill remaining slots at base
 * - Hooks the "HRB Won" button id=#btn-mark-won
 * - Monkey-patches markWon / assignToClubByNameOrSlug if present
 */
(function(){
  if (!window || !document) return;

  const $ = (id)=>document.getElementById(id);
  const toNum = (v,d=0)=>{ const n=Number(v); return Number.isFinite(n)?n:d; };
  const getState = ()=> window.state || {};
  const minBase = ()=> 200;

  const getActivePlayer = ()=>{
    const s=getState();
    const id=s.activePlayerId;
    if (id==null) return null;
    return (s.players||[]).find(p=>String(p.id)===String(id))||null;
  };

  // --- Base-point helpers ---
  function minBidFor(p){
    return Math.max(minBase(), toNum(p && p.base_point, minBase()));
  }

  function remainingSlots(){
    const s=getState();
    const cap = toNum(s.playersNeeded, 15);
    const mine=(s.players||[]).filter(p=>p.owner===s.myClubSlug&&p.status==="won").length;
    return Math.max(0, cap - mine);
  }

  function remainingBudget(slug){
    const s=getState();
    const c=(s.clubs||[]).find(c=>c.slug===slug);
    return c?toNum(c.budget_left, c.starting_budget||0):0;
  }

  function remainingFloor(excludeId=null, slotsOverride=null){
    const s=getState();
    const pool=(s.players||[]).filter(p=>p.status!=="won" && (excludeId? String(p.id)!==String(excludeId):true));
    const k=Math.max(0, (slotsOverride==null? remainingSlots(): slotsOverride));
    if (k<=0) return 0;
    const bases=pool.map(p=>minBidFor(p)).sort((a,b)=>a-b);
    let sum=0;
    for (let i=0;i<Math.min(k,bases.length);i++) sum+=bases[i];
    if (bases.length<k) sum+=(k-bases.length)*minBase();
    return sum;
  }

  // --- Public guardrails ---
  function validateBidAgainstBase(p, bidValue){
    const bid = Number(bidValue||0);
    if (!p) return false;
    return bid >= minBidFor(p);
  }

  // Replace/define guardrailOK to use base_point floors
  window.guardrailOK = function(bid){
    const s=getState();
    const p=getActivePlayer();
    const price = Number(bid||0);
    if (!p || !Number.isFinite(price)) return false;
    if (!validateBidAgainstBase(p, price)) return false;

    const bud = remainingBudget(s.myClubSlug);
    const remSlotsAfter = Math.max(0, remainingSlots()-1);
    const floorAfter = remainingFloor(p.id, remSlotsAfter);
    return (price <= bud) && ((bud - price) >= floorAfter);
  };

  // Max you can safely spend right now, respecting remaining floor
  window.maxYouCanSpendNow = function(playerOpt){
    const s=getState();
    const p=playerOpt || getActivePlayer();
    const bud = remainingBudget(s.myClubSlug);
    const remSlotsAfter = Math.max(0, remainingSlots()-1);
    const floorAfter = remainingFloor(p && p.id, remSlotsAfter);
    return Math.max(minBidFor(p||{}), bud - floorAfter);
  };

  // --- Monkey-patch core functions (so nothing can bypass base) ---
  const _markWon = window.markWon;
  window.markWon = function(playerId, price){
    const s=getState();
    const p=(s.players||[]).find(x=>x.id===playerId) || getActivePlayer();
    const bid=Number(price||0);
    if (!p){ console.warn("[enforcer] no player"); return; }
    if (!validateBidAgainstBase(p, bid)){
      alert(`⚠️ Bid cannot be less than base point (${p.base_point}).`);
      return;
    }
    if (!window.guardrailOK(bid)){
      alert(`⚠️ Guardrail: this bid would leave insufficient points to fill remaining slots at base.`);
      return;
    }
    if (typeof _markWon === "function"){
      return _markWon(playerId, bid);
    }
    // Fallback behaviour if app didn't define markWon:
    p.status="won"; p.finalBid=bid; p.owner=s.myClubSlug;
    if (typeof window.recomputeBudgetsFromWins==="function") window.recomputeBudgetsFromWins();
    if (typeof window.persist==="function") window.persist();
    if (typeof window.render==="function") window.render();
  };

  const _assign = window.assignToClubByNameOrSlug;
  window.assignToClubByNameOrSlug = function(playerId, clubText, price){
    const s=getState();
    const p=(s.players||[]).find(x=>x.id===playerId) || getActivePlayer();
    const bid=Number(price||0);
    if (!p){ console.warn("[enforcer] no player"); return; }
    if (!validateBidAgainstBase(p, bid)){
      alert(`⚠️ Bid cannot be less than base point (${p.base_point}).`);
      return;
    }
    if (typeof _assign === "function"){
      return _assign(playerId, clubText, bid);
    }
    // Fallback: assign directly
    const club=(s.clubs||[]).find(c=> c.slug===String(clubText).toLowerCase().replace(/\s+/g,"-") || c.name===clubText);
    if (!club){ alert("Club not found"); return; }
    p.status="won"; p.finalBid=bid; p.owner=club.slug;
    if (typeof window.recomputeBudgetsFromWins==="function") window.recomputeBudgetsFromWins();
    if (typeof window.persist==="function") window.persist();
    if (typeof window.render==="function") window.render();
  };

  // --- Hook the HRB Won button (#btn-mark-won) safely ---
  function attachButton(){
    const btn = document.getElementById("btn-mark-won");
    const bidInput = document.getElementById("bidInput");
    const warnEl = document.getElementById("bidWarn");
    const p=getActivePlayer();
    if (!btn || !bidInput) return;

    // Force input min to player's base in UI
    if (p) bidInput.min = String(minBidFor(p));

    function check(){
      const val = Number(bidInput.value||0);
      const player = getActivePlayer();
      if (!player) return;
      if (warnEl){
        if (!validateBidAgainstBase(player, val)){
          warnEl.textContent = "Enter a bid ≥ base point: " + minBidFor(player);
        } else if (!window.guardrailOK(val)){
          warnEl.textContent = "Guardrail: this bid would leave insufficient points to complete the squad.";
        } else {
          warnEl.textContent = "";
        }
      }
    }
    bidInput.addEventListener("input", check);

    btn.addEventListener("click", function(ev){
      ev.preventDefault();
      const player = getActivePlayer();
      if (!player) return;
      const val = Number(bidInput.value||0);
      if (!validateBidAgainstBase(player, val)){
        alert(`⚠️ Bid cannot be less than base point (${player.base_point}).`);
        return;
      }
      if (!window.guardrailOK(val)){
        const maxNow = window.maxYouCanSpendNow(player);
        alert(`⚠️ Guardrail: reduce bid.\nYou can safely spend up to ${maxNow} now.`);
        return;
      }
      // Call the patched core:
      window.markWon(player.id, val);
    }, { passive:false });
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", attachButton);
  } else {
    attachButton();
  }
})();
// --- Glue to keep UI and guards in sync ---
// Enable HRB Won only when a player is active and input is valid.
(function(){
  const $ = (id)=>document.getElementById(id);
  const getState = ()=> window.state || {};
  const toNum = (v,d=0)=>{ const n=Number(v); return Number.isFinite(n)?n:d; };
  const minBase = ()=>200;

  function getActivePlayer(){
    const s=getState();
    const id=s.activePlayerId;
    if (id==null) return null;
    return (s.players||[]).find(p=>String(p.id)===String(id))||null;
  }
  function minBidFor(p){ return Math.max(minBase(), toNum(p && p.base_point, minBase())); }

  const bidInput = $("bidInput");
  const btnWon   = $("btn-mark-won");
  const warnEl   = $("bidWarn");

  if (!bidInput || !btnWon) return;

  function refreshForActive(){
    const p = getActivePlayer();
    if (!p){
      btnWon.disabled = true;
      if (warnEl) warnEl.textContent = "Select a player to bid.";
      return;
    }
    // keep UI min aligned to player's base
    bidInput.min = String(minBidFor(p));
    // auto-fill to base if empty or below base
    const v = Number(bidInput.value || 0);
    if (!Number.isFinite(v) || v < minBidFor(p)) {
      bidInput.value = String(minBidFor(p));
    }
    // evaluate once
    runValidation();
  }

  function runValidation(){
    const p = getActivePlayer();
    if (!p){ btnWon.disabled = true; return; }
    const val = Number(bidInput.value||0);
    let ok = true;
    if (val < minBidFor(p)) ok = false;
    // use patched guardrailOK if present
    if (ok && typeof window.guardrailOK === "function") {
      ok = !!window.guardrailOK(val);
    }
    btnWon.disabled = !ok;
    if (warnEl){
      if (val < minBidFor(p)){
        warnEl.textContent = "Enter a bid ≥ base point: " + minBidFor(p);
      } else if (!ok){
        const maxNow = (typeof window.maxYouCanSpendNow==="function") ? window.maxYouCanSpendNow(p) : val;
        warnEl.textContent = "Guardrail: reduce bid. You can safely spend up to " + maxNow + " now.";
      } else {
        warnEl.textContent = "";
      }
    }
  }

  // React to typing and to any app-driven re-render
  bidInput.addEventListener("input", runValidation);

  // Observe DOM & state changes: when lists re-render or selection changes
  const obs = new MutationObserver(()=>{ refreshForActive(); });
  obs.observe(document.body, { childList:true, subtree:true });

  // If your app emits events on selection, hook them too
  window.addEventListener("hrb:active-player-changed", refreshForActive);
  window.addEventListener("hrb:render", refreshForActive);

  // Initial pass
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshForActive);
  } else {
    refreshForActive();
  }
})();
