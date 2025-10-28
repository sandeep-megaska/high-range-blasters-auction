// State & helpers (no framework)

export const STORAGE_KEY = "hrb-auction-state-v1";

export const SAMPLE_CSV =
`name,role,grade,rating,base,batting_hand,is_wk
A. Sharma,Batsman,A,92,120,L,false
V. Menon,All-Rounder,A,88,130,R,false
S. Thomas,Bowler,B,75,90,R,false
R. Iqbal,Wicket Keeper,B,78,95,R,true
K. Varma,Batsman,C,62,60,L,false
P. Nair,Bowler,B,73,85,R,false
N. Khan,All-Rounder,A,90,135,L,false
F. Joseph,Batsman,B,70,80,R,false
A. Rahman,Bowler,C,58,55,R,false`;

export function splitCSVLine(line){
  const out = []; let cur = ""; let inQ = false;
  for (let i=0;i<line.length;i++){
    const ch = line[i];
    if (ch === '"'){ inQ = !inQ; continue; }
    if (ch === "," && !inQ){ out.push(cur); cur=""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  const idx = n => headers.indexOf(n);
  const iName = idx("name"), iRole = idx("role"), iGrade = idx("grade");
  const iRating = idx("rating"), iBase = idx("base");
  const iHand = idx("batting_hand"), iWk = idx("is_wk");

  const rows = [];
  for (let i=1;i<lines.length;i++){
    const cols = splitCSVLine(lines[i]).map(c=>c.trim());
    const name = cols[iName] || "";
    if (!name) continue;
    const role = cols[iRole] || "-";
    const grade = (cols[iGrade] || "B").toUpperCase();
    const rating = toNum(cols[iRating], inferRatingFromGrade(grade));
    const base = toNum(cols[iBase], 50);
    const batting_hand = (cols[iHand] || "").toUpperCase(); // L or R
    const is_wk = toBool(cols[iWk], false);

    rows.push({
      id: crypto.randomUUID(),
      name, role, grade, rating, base,
      batting_hand, is_wk,
      status: "pending",
      finalBid: undefined
    });
  }
  return rows;
}

export function toNum(v, d=0){ const n = Number(v); return Number.isFinite(n) ? n : d; }
export function toBool(v, d=false){
  if (v === true || v === false) return v;
  if (!v && v !== 0) return d;
  const s = String(v).trim().toLowerCase();
  if (["true","1","yes","y"].includes(s)) return true;
  if (["false","0","no","n"].includes(s)) return false;
  return d;
}
export function inferRatingFromGrade(g){
  switch(g){
    case "A+": return 95;
    case "A": return 88;
    case "B": return 75;
    case "C": return 62;
    default: return 70;
  }
}
export function shuffle(ids){
  const a = ids.slice();
  for (let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function csvExport(rows){
  if (!rows.length) return "";
  const head = Object.keys(rows[0]);
  const body = rows.map(r => head.map(k => {
    const val = String(r[k] ?? "");
    return /[",\n]/.test(val) ? `"${val.replaceAll('"','""')}"` : val;
  }).join(","));
  return [head.join(","), ...body].join("\n");
}

