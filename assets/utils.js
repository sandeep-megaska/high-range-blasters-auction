// State & helpers (no framework)

export const STORAGE_KEY = "hrb-auction-state-v1";

export const SAMPLE_CSV =
`name,dob,alumni,age,category,role,grade,rating,base,batting_hand,is_wk
A. Sharma,1993-04-21,MACE, ,Batsman,Batsman,A,92,120,L,false
V. Menon,1991-10-05,TKM, ,All-Rounder,All-Rounder,A,88,130,R,false
S. Thomas,1997-02-12,CET, ,Bowler,Bowler,B,75,90,R,false
R. Iqbal,1995-08-30,NIT, ,WK,Wicket Keeper,B,78,95,R,true
K. Varma,1999-05-09,MACE, ,Batsman,Batsman,C,62,60,L,false
P. Nair,1996-01-17,TKM, ,Bowler,Bowler,B,73,85,R,false
N. Khan,1992-12-01,CET, ,All-Rounder,All-Rounder,A,90,135,L,false
F. Joseph,1998-06-03,NIT, ,Batsman,Batsman,B,70,80,R,false
A. Rahman,1994-09-23,MACE, ,Bowler,Bowler,C,58,55,R,false`;


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
  const iName = idx("name");
  const iDob = idx("dob");
  const iAlumni = idx("alumni");
  const iAge = idx("age");           // optional; if blank, we compute
  const iCategory = idx("category"); // text like bat, bowler, batting allrounder, wk, etc.
  const iRole = idx("role");
  const iGrade = idx("grade");
  const iRating = idx("rating");
  const iBase = idx("base");
  const iHand = idx("batting_hand");
  const iWk = idx("is_wk");

  const rows = [];
  for (let i=1;i<lines.length;i++){
    const cols = splitCSVLine(lines[i]).map(c=>c.trim());
    const name = cols[iName] || "";
    if (!name) continue;

    const dob = iDob >= 0 ? cols[iDob] : "";
    const alumni = iAlumni >= 0 ? cols[iAlumni] : "";
    const category = iCategory >= 0 ? cols[iCategory] : ""; // free text category
    const ageFromSheet = iAge >= 0 ? toNum(cols[iAge], NaN) : NaN;
    const age = Number.isFinite(ageFromSheet) ? ageFromSheet : calcAge(dob);

    const role = cols[iRole] || "-";
    const grade = (cols[iGrade] || "B").toUpperCase();
    const rating = toNum(cols[iRating], inferRatingFromGrade(grade));
    const base = toNum(cols[iBase], 50);
    const batting_hand = (cols[iHand] || "").toUpperCase(); // L or R
    const is_wk = toBool(cols[iWk], false);

    rows.push({
      id: crypto.randomUUID(),
      name, dob, alumni, age, category,
      role, grade, rating, base,
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
function parseISODate(s) {
  // Accepts YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY
  if (!s) return null;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(t + "T00:00:00Z");
  if (/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(t)) {
    const [d, m, y] = t.replace(/-/g,"/").split("/").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}
export function calcAge(dobStr) {
  const d = parseISODate(dobStr);
  if (!d) return "";
  const today = new Date();
  let age = today.getUTCFullYear() - d.getUTCFullYear();
  const m = today.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

