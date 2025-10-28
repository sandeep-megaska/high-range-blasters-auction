// Roster constraints & value/tier logic

// Default constraints (you can also load from Supabase)
export const DEFAULT_CONSTRAINTS = [
  { role: "Batsman", batting_hand: "L", min_count: 2 },          // at least 2 left-hand batsmen
  { role: "Wicket Keeper", is_wk: true, min_count: 2 }           // at least 2 wicket keepers
];

export function evaluateRosterCompliance(players, constraints){
  const won = players.filter(p => p.status === "won");
  const matches = (p, c) => {
    if (c.role && (p.role||"").toLowerCase() !== c.role.toLowerCase()) return false;
    if (c.batting_hand && (p.batting_hand||"").toUpperCase() !== c.batting_hand.toUpperCase()) return false;
    if (typeof c.is_wk === "boolean" && !!p.is_wk !== c.is_wk) return false;
    return true;
  };
  const results = constraints.map(c => {
    const count = won.filter(p => matches(p, c)).length;
    const minOk = count >= (c.min_count || 0);
    const maxOk = typeof c.max_count === "number" ? count <= c.max_count : true;
    return { ...c, count, ok: minOk && maxOk };
  });
  const allMinOk = results.every(r => r.count >= (r.min_count || 0));
  const allMaxOk = results.every(r => typeof r.max_count === "number" ? r.count <= r.max_count : true);
  return { results, allMinOk, allMaxOk };
}

export function computeValueScore(player, players, constraints){
  // Core value ~ rating / base^0.85
  const core = player.rating / Math.pow(Math.max(player.base, 1), 0.85);

  // Scarcity: fewer pending in same role => boost
  const pendingSameRole = players.filter(p => p.status === "pending" && p.role === player.role).length;
  const scarcityBoost = pendingSameRole ? 0 : 5;

  // Unmet minimum constraints boost if player matches an unmet rule
  const won = players.filter(p => p.status === "won");
  const matches = (p, c) => {
    if (c.role && (p.role||"").toLowerCase() !== c.role.toLowerCase()) return false;
    if (c.batting_hand && (p.batting_hand||"").toUpperCase() !== c.batting_hand.toUpperCase()) return false;
    if (typeof c.is_wk === "boolean" && !!p.is_wk !== c.is_wk) return false;
    return true;
  };
  let unmetBoost = 0;
  constraints
    .filter(c => (c.min_count || 0) > 0)
    .forEach(c => {
      const have = won.filter(w => matches(w, c)).length;
      if (have < (c.min_count || 0) && matches(player, c)) unmetBoost += 8;
    });

  return Math.round((core + scarcityBoost + unmetBoost) * 10) / 10;
}

export function tierFromScore(score){
  if (score >= 2.2) return { label: "Must Bid", class: "pill must" };
  if (score >= 1.8) return { label: "Strong", class: "pill strong" };
  if (score >= 1.4) return { label: "Consider", class: "pill consider" };
  return { label: "Pass", class: "pill pass" };
}

