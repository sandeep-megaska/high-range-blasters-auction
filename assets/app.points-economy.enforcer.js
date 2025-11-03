/* HRB — Hard Safety Net & UI glue (external) */
(function(){
  if (!window || !document) return;
  const $=id=>document.getElementById(id);
  const toNum=(v,d=0)=>{ const n=Number(v); return Number.isFinite(n)?n:d; };
  const getState=()=>window.state||{};
  const minBase=()=>200;
  function playerBase(p){ return Math.max(minBase(), toNum(p && p.base_point, minBase())); }

  function enforceRosterIntegrity(opts={silent:false}){
    const s=getState(); const fixes=[];
    (s.players||[]).forEach(p=>{
      if (p.status==="won"){
        const base = playerBase(p);
        const bid  = toNum(p.finalBid,0);
        if (bid<base){ fixes.push({name:p.name, bid, base, owner:p.owner}); p.status="open"; p.owner=null; p.finalBid=null; }
      }
    });
    if (fixes.length && !opts.silent){
      const lines = fixes.map(f=>`• ${f.name}: bid ${f.bid} < base ${f.base} (owner: ${f.owner||"-"})`);
      alert("⚠️ Invalid wins detected (below base_point). Reverted.\n\n"+lines.join("\n"));
    }
  }
  const _persist = window.persist || function(){};
  window.persist = function(){ try{enforceRosterIntegrity({silent:true});}catch(e){} return _persist.apply(this, arguments); };
  const _render  = window.render || function(){};
  window.render  = function(){ try{enforceRosterIntegrity({silent:true});}catch(e){} return _render.apply(this, arguments); };

  function glue(){
    const pBtn = $("btn-mark-won"), input=$("bidInput"), warn=$("bidWarn");
    if (!pBtn || !input) return;
    function getActivePlayer(){
      const s=getState(); const id=s.activePlayerId;
      return id==null? null : (s.players||[]).find(p=>String(p.id)===String(id))||null;
    }
    function refresh(){
      const p=getActivePlayer();
      if (!p){ pBtn.disabled=true; if(warn) warn.textContent="Select a player to bid."; return; }
      input.min = String(playerBase(p));
      if (Number(input.value||0) < playerBase(p)) input.value = String(playerBase(p));
      const val=Number(input.value||0);
      const guard = (typeof window.guardrailOK==="function") ? !!window.guardrailOK(val) : true;
      const ok = (val>=playerBase(p)) && guard;
      pBtn.disabled = !ok;
      if (!ok){
        if (val<playerBase(p)) warn.textContent=`Enter a bid ≥ base point: ${playerBase(p)}`;
        else warn.textContent="Guardrail: reduce bid to keep enough points for remaining slots.";
      } else warn.textContent="";
    }
    input.addEventListener("input", refresh);
    const obs=new MutationObserver(refresh);
    obs.observe(document.body, {childList:true, subtree:true});
    refresh();
  }

  if (document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded", glue);
  } else {
    glue();
  }
})();
