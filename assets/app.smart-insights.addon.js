/* HRB Auction Assist – Smart Insights Add-on
 * Drop this AFTER your main app.js. It overrides a few functions and adds helpers.
 * No HTML changes required.
 */

(function(){
  if (!window || !document) return;

  // --- Safe getters from your app state ---
  const getState = () => window.state || (window.__hrb_state__ || {});
  const toNum = (v,d=0)=>{ const n=Number(v); return Number.isFinite(n)?n:d; };

  // --- Ensure the few helpers/constants exist ---
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
  if (!window.CATEGORY_BASE) {
    window.CATEGORY_BASE = {1:1500, 2:1000, 3:500, 4:200};
  }
  if (!window.TARGETS) {
    window.TARGETS = { wk:2, lhb:2, bowl:8 };
  }

  // --- Utility mirrors (use your app’s originals if present) ---
  const minBase = () => {
    const s=getState();
    const DEFAULT_MIN_BASE = 200;
    return Number(s?.minBasePerPlayer)>0 ? Number(s.minBasePerPlayer) : DEFAULT_MIN_BASE;
  };
  const remainingSlots = ()=>{
    const s=getState();
    const DEFAULT_PLAYERS_CAP = 15;
    const mine=(s.players||[]).filter(p=>p.owner===s.myClubSlug&&p.status==="won").length;
    return Math.max(0,(s.playersNeeded||DEFAULT_PLAYERS_CAP)-mine);
  };
  const remainingBudget = (slug)=>{
    const s=getState();
    const c=(s.clubs||[]).find(c=>c.slug===slug);
    return c?toNum(c.budget_left,c.starting_budget||0):0;
  };
  const maxYouCanSpendNow = ()=>{
    const s=getState();
    const bud = remainingBudget(s.myClubSlug);
    const floor = minBase() * Math.max(0, remainingSlots()-1);
    return Math.max(minBase(), bud - floor);
  };

  // --- Performance helpers (reuse app functions if available) ---
  const computePerformanceIndex = window.computePerformanceIndex || function(p){
    const v = Number(p?.performance_index);
    if (Number.isFinite(v)) return Math.max(0, Math.min(100, v));
    // Fallback rough calc
    const norm=(x,a,b)=>{ if(x==null) return 0; const n=(Number(x)-a)/(b-a||1); return Math.max(0,Math.min(1,n)); };
    const bat = 0.35*norm(p.bat_avg,10,45) + 0.30*norm(p.strike_rate,70,180) + 0.35*norm(p.runs,100,1200);
    const bowl = 0.55*norm(p.wickets,0,50) + 0.45*(1-norm(p.eco_rate,4.5,9.5));
    const pi = 100*(0.55*bat + 0.45*bowl);
    return Math.round(Math.max(0,Math.min(100,pi)));
  };

  // === OVERRIDE: computeBidPriority (add category bias) ===
  window.computeBidPriority = function(p){
    const pi = computePerformanceIndex(p);
    const fullAvail = /both|two\s*days|day\s*1\s*and\s*2|sat|sun/i.test(String(p.availability||""));
    const wkBoost = window.isWK(p) ? 6 : 0;
    const leftBoost = /left/i.test(String(p.batting_type||p.batting||"")) ? 4 : 0;
    const cat = Number(p.category)||4;
    const catBoost = cat===1?12: cat===2?8: cat===3?4: 0;  // <- category emphasis
    const roleAdj = /all/i.test(String(p.skill||"")) ? 1.05 : 1.0;
    const base = pi + wkBoost + leftBoost + catBoost + (fullAvail?8:-10);
    return Math.round(Math.max(0, Math.min(120, base * roleAdj)));
  };

  // === OVERRIDE: suggestedCap (category-aware + hardCap protection) ===
  window.suggestedCap = function(p){
    const s = getState();
    const budget = remainingBudget(s.myClubSlug);
    const slots = Math.max(1, remainingSlots());
    const avgPerSlot = budget / slots;

    const priority = window.computeBidPriority(p);   // 0..120
    const prioFactor = 0.6 + (priority/120)*0.9;     // 0.6..1.5

    const basePoint = toNum(p.base_point, toNum(p.base, minBase()));
    const baseFactor = 1 + computePerformanceIndex(p)/200; // 1..1.5

    const cat = Number(p.category)||4;
    const catWeight = cat===1?1.35: cat===2?1.2: cat===3?1.05: 0.9;

    const capByPriority = avgPerSlot * prioFactor * catWeight;
    const capByBase = basePoint * baseFactor * (cat>=3?1.0:1.1);

    const hardCap = maxYouCanSpendNow();
    const cap = Math.max(minBase(), Math.round(Math.min(hardCap, Math.max(capByBase, capByPriority))));
    return cap;
  };

  // === Helpers for strategy cards ===
  function countRemaining(fn){ 
    const s=getState(); 
    return (s.players||[]).filter(p=>p.status!=="won").filter(fn).length; 
  }
  function remainingTopCats(){
    const s=getState();
    return (s.players||[]).filter(p=>p.status!=="won" && [1,2,3].includes(Number(p.category)||99));
  }
  function nextTopList(n=5){
    return remainingTopCats().sort((a,b)=>{
      const ca=Number(a.category)||9, cb=Number(b.category)||9;
      if (ca!==cb) return ca-cb;
      const pa=window.computeBidPriority(a), pb=window.computeBidPriority(b);
      return pb-pa;
    }).slice(0,n);
  }
  function constraintsStatus(){
    const s=getState();
    const mine=(s.players||[]).filter(p=>p.owner===s.myClubSlug&&p.status==="won");
    const wk = mine.filter(p=>window.isWK(p)).length;
    const lhb= mine.filter(p=>/left/i.test(String(p.batting_type||p.batting||""))).length;
    const bowl= mine.filter(p=>window.isBowler(p.skill)||/all/i.test(String(p.skill||""))).length;
    const slots = remainingSlots();
    const need = { wk: Math.max(0, window.TARGETS.wk - wk),
                   lhb: Math.max(0, window.TARGETS.lhb - lhb),
                   bowl: Math.max(0, window.TARGETS.bowl - bowl) };
    const avail = {
      wk: countRemaining(p=>window.isWK(p)),
      lhb: countRemaining(p=>/left/i.test(String(p.batting_type||p.batting||""))),
      bowl: countRemaining(p=>window.isBowler(p.skill)||/all/i.test(String(p.skill||"")))
    };
    return { wk, lhb, bowl, need, avail, slots };
  }
  function budgetPlanForTopCats(sample=5){
    const list = nextTopList(sample);
    if(!list.length){ return {medianBase:0, estSpend:0}; }
    const bases = list.map(p=> toNum(p.base_point, window.CATEGORY_BASE[Number(p.category)||4]||minBase()) ).sort((a,b)=>a-b);
    const mid = bases[Math.floor(bases.length/2)];
    const buffer = 1.2; // 20% over base
    const estSpend = Math.round(mid * buffer * Math.min(sample, remainingSlots()));
    return { medianBase: mid, buffer, estSpend };
  }
  function marketPulse(){
    const s=getState();
    const rem=(s.players||[]).filter(p=>p.status!=="won");
    const count = (pred)=>rem.filter(pred).length;
    return {
      total: rem.length,
      bowlers: count(p=>window.isBowler(p.skill)||/all/i.test(String(p.skill||""))),
      wks: count(p=>window.isWK(p)),
      lefties: count(p=>/left/i.test(String(p.batting_type||p.batting||""))),
      bothDays: count(p=>/(both\s*days|two\s*days|day\s*1\s*and\s*2|sat|sun)/i.test(String(p.availability||"")))
    };
  }

  // === OVERRIDE: renderInsights (injects new strategy panels) ===
  window.renderInsights = function(p, whatIf=null){
    const root = document.getElementById("insightsContent");
    if(!root){ return; }
    if(!p){ root.innerHTML = `<div class="hint">Pick a player to see live insights.</div>`; return; }

    const cap = window.suggestedCap(p);
    const safe = Math.max(minBase(), Math.round(cap*0.85));
    const stretch = Math.round(cap*1.15);
    const hardCap = Math.round(maxYouCanSpendNow());

    const bidForProb = toNum(whatIf, cap);
    const winProb = (typeof window.winProbabilityHeuristic==="function")
      ? window.winProbabilityHeuristic(p, bidForProb)
      : {label:"—", color:"#6b7280"};

    const pulse = marketPulse();
    const threats = (typeof window.threatClubs==="function") ? window.threatClubs() : [];

    const cons = constraintsStatus();
    const needTxt = (label, need, avail) => {
      const ok = avail >= need && cons.slots >= need;
      const col = ok ? "#16a34a" : "#dc2626";
      return '<div>'+label+': need <b>'+need+'</b>, avail <b>'+avail+'</b> (slots '+cons.slots+') <span style="color:'+col+'">• '+(ok?'feasible':'at risk')+'</span></div>';
    };
    const upcoming = nextTopList(5);
    const budgetTop = budgetPlanForTopCats(5);

    const scarcity = [];
    if (pulse.wks<=2) scarcity.push("Wicket-keepers scarce");
    if (pulse.bowlers<=10) scarcity.push("Specialist bowlers running low");
    if (pulse.lefties<=6) scarcity.push("Left-handers scarce");
    if (pulse.bothDays <= Math.round(pulse.total*0.25)) scarcity.push("Two-day availability is rare");

    const preMap = getState().preselectedByClub || {};
    const whoPreselected = Object.entries(preMap).filter(([slug,map])=>{
      return map && typeof map==="object" && Object.keys(map).some(n=>n===String(p.name||"").toLowerCase());
    }).map(([slug])=> (getState().clubs||[]).find(c=>c.slug===slug)?.name).filter(Boolean);

    const cat = Number(p.category)||4;
    const catLabel = cat===1?"Category 1 (Top)": cat===2?"Category 2": cat===3?"Category 3": "Category 4";

    root.innerHTML = [
      '<div class="row" style="flex-wrap:wrap; gap:10px;">',
        '<div class="card" style="padding:10px; flex:1; min-width:220px;">',
          '<div><b>Price band</b> <span class="hint">('+catLabel+')</span></div>',
          '<div class="hint">Safe ~ Stretch ~ Hard Cap</div>',
          '<div style="margin-top:4px; font-size:14px;">'+safe+' – '+stretch+' (you can go up to <b>'+hardCap+'</b>)</div>',
        '</div>',
        '<div class="card" style="padding:10px; flex:1; min-width:220px;">',
          '<div><b>Win probability</b></div>',
          '<div class="hint">at bid = '+bidForProb+'</div>',
          '<div style="margin-top:4px; font-size:14px; color:'+winProb.color+'"><b>'+winProb.label+'</b></div>',
        '</div>',
        '<div class="card" style="padding:10px; flex:1; min-width:260px;">',
          '<div><b>Threat clubs (budget/slot)</b></div>',
          '<div style="margin-top:4px; font-size:13px;">'+(threats.length? threats.map(t=>'<div>'+t.name+': <b>'+Math.round(t.perSlot)+'</b> (left '+t.slots+' slots, '+t.budgetLeft+' pts)</div>').join('') : "<div class=\"hint\">No threats</div>")+'</div>',
        '</div>',
      '</div>',

      '<div class="row" style="flex-wrap:wrap; gap:10px; margin-top:10px;">',
        '<div class="card" style="padding:10px; flex:1; min-width:260px;">',
          '<div><b>Constraint feasibility</b> <span class="hint">(targets: WK 2, LHB 2, Bowl 8)</span></div>',
          '<div style="margin-top:4px; font-size:13px;">',
            needTxt("Wicket-keepers", cons.need.wk, cons.avail.wk),
            needTxt("Left-hand batters", cons.need.lhb, cons.avail.lhb),
            needTxt("Bowlers", cons.need.bowl, cons.avail.bowl),
          '</div>',
        '</div>',
        '<div class="card" style="padding:10px; flex:1; min-width:260px;">',
          '<div><b>Upcoming top players</b> <span class="hint">(Cat 1–3)</span></div>',
          '<div style="margin-top:4px; font-size:13px;">'+(upcoming.length? upcoming.map(u=>'<div>&bull; '+u.name+' <span class="hint">(Cat '+u.category+', Base '+toNum(u.base_point, window.CATEGORY_BASE[Number(u.category)||4]||minBase())+', PI '+computePerformanceIndex(u)+')</span></div>').join('') : "<div class=\"hint\">No top-category players left.</div>")+'</div>',
        '</div>',
        '<div class="card" style="padding:10px; flex:1; min-width:260px;">',
          '<div><b>Budget vs top-cats</b></div>',
          '<div class="hint">Assuming median base × 1.2 for next '+Math.min(5, cons.slots)+' picks</div>',
          '<div style="margin-top:4px; font-size:13px;">Median base: <b>'+budgetTop.medianBase+'</b> · Est. spend: <b>'+budgetTop.estSpend+'</b></div>',
          '<div style="margin-top:4px; font-size:13px;">Your remaining: <b>'+remainingBudget(getState().myClubSlug)+'</b></div>',
        '</div>',
      '</div>',

      '<div class="row" style="flex-wrap:wrap; gap:10px; margin-top:10px;">',
        '<div class="card" style="padding:10px; flex:1; min-width:240px;">',
          '<div><b>Role & availability pulse</b></div>',
          '<div class="hint">Remaining pool</div>',
          '<div style="margin-top:4px; font-size:13px;">WK: <b>'+pulse.wks+'</b> · Bowlers: <b>'+pulse.bowlers+'</b> · Left-handers: <b>'+pulse.lefties+'</b> · Both-days: <b>'+pulse.bothDays+'</b></div>',
        '</div>',
        '<div class="card" style="padding:10px; flex:1; min-width:240px;">',
          '<div><b>Scarcity alerts</b></div>',
          '<div style="margin-top:4px; font-size:13px;">'+(scarcity.length? scarcity.map(s=>'<div>&bull; '+s+'</div>').join('') : '<div class="hint">No strong scarcity signals yet.</div>')+'</div>',
        '</div>',
        '<div class="card" style="padding:10px; flex:1; min-width:240px;">',
          '<div><b>Marked by rivals</b></div>',
          '<div style="margin-top:4px; font-size:13px;">'+(whoPreselected.length? whoPreselected.map(n=>'<div>&bull; '+n+'</div>').join('') : '<div class="hint">No rival preselect found for this player.</div>')+'</div>',
        '</div>',
      '</div>'
    ].join('');
  };

  // Repaint insights (if a player is already active)
  try { if (typeof window.renderLiveBid==="function") window.renderLiveBid(); } catch(e){}
})();
