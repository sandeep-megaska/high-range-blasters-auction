// assets/utils.js
export const STORAGE_KEY = "hrb-auction-state-v2";

// Sample with new headers: rank + rating10 (0..10, decimal)
export const SAMPLE_CSV =
`name,rank,dob,alumni,age,rating10,role,base,batting_hand,is_wk
A. Sharma,12,1993-04-21,MACE,,9.2,Batsman,,L,false
V. Menon,22,1991-10-05,TKM,,8.6,All-Rounder,,R,false
S. Thomas,36,1997-02-12,CET,,7.1,Bowler,,R,false
R. Iqbal,18,1995-08-30,NIT,,7.8,Wicket Keeper,,R,true
K. Varma,44,1999-05-09,MACE,,6.0,Batsman,,L,false
P. Nair,28,1996-01-17,TKM,,7.3,Bowler,,R,false
N. Khan,8,1992-12-01,CET,,9.0,All-Rounder,,L,false
F. Joseph,55,1998-06-03,NIT,,6.7,Batsman,,R,false
A. Rahman,40,1994-09-23,MACE,,5.9,Bowler,,R,false`;

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

function parseISODate(s) {
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

export function toNum(v, d=0){ const n = Number(v); return Number.isFinite(n) ? n : d; }
export function toBool(v, d=false){
  if (v === true || v === false) return v;
  if (!v && v !== 0) return d;
  const s = String(v).trim().toLowerCase();
  if (["true","1","yes","y"].includes(s)) return true;
  if (["false","0","no","n"].includes(s)) return false;
  return d;
}

export function categoryFromRank(rank){
  const r = toNum(rank, 9999);
  if (r >= 1 && r <= 16) return 1;
  if (r >= 17 && r <= 24) return 2;
  if (r >= 25 && r <= 32) return 3;
  if (r >= 33 && r <= 40) return 4;
  return 5;
}

export function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());

  const idx = n => headers.indexOf(n);
  const iName = idx("name");
  const iRank = idx("rank");
  const iDob = idx("dob");
  const iAlumni = idx("alumni");
  const iAge = idx("age");
  const iRating10 = idx("rating10");   // 0..10 with decimals
  const iRole = idx("role");
  const iBase = idx("base");           // optional; if blank, we’ll derive from category later
  const iHand = idx("batting_hand");
  const iWk = idx("is_wk");

  const rows = [];
  for (let i=1;i<lines.length;i++){
    const cols = splitCSVLine(lines[i]).map(c=>c.trim());
    const name = cols[iName] || "";
    if (!name) continue;

    const rank = toNum(cols[iRank], 9999);
    const category = categoryFromRank(rank);

    const dob = iDob >= 0 ? cols[iDob] : "";
    const alumni = iAlumni >= 0 ? cols[iAlumni] : "";
    const ageFromSheet = iAge >= 0 ? toNum(cols[iAge], NaN) : NaN;
    const age = Number.isFinite(ageFromSheet) ? ageFromSheet : calcAge(dob);

    const rating10 = toNum(cols[iRating10], 0); // 0..10
    const role = cols[iRole] || "-";
    const baseSheet = iBase >= 0 ? toNum(cols[iBase], 0) : 0;
    const batting_hand = (cols[iHand] || "").toUpperCase();
    const is_wk = toBool(cols[iWk], false);

    rows.push({
      id: crypto.randomUUID(),
      name, rank, category,
      dob, alumni, age,
      rating10, role,
      base: baseSheet,      // may be 0 -> we will inject from category later
      batting_hand, is_wk,
      status: "pending",
      finalBid: undefined
    });
  }
  return rows;
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
