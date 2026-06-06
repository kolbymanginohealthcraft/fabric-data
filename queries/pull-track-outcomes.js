// Injects Outcomes Crosswalk + Custom Scales into track-outcomes.sql and runs it (Bronze).
// Output: track-outcomes.csv — one row per (Track × crosswalked Item) measurement, UNGATED
// (includes invalid/disregarded), with raw components for downstream valid/gain derivation.
// Usage: node queries/pull-track-outcomes.js [--years N] [--out path]
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

const REPO_ROOT = path.join(__dirname, "..");
const CROSSWALK_CSV = path.join(REPO_ROOT, "Outcomes Crosswalk.csv");
const SCALES_CSV    = path.join(REPO_ROOT, "Outcomes Custom Scales.csv");
const SQL_TEMPLATE  = path.join(__dirname, "track-outcomes.sql");

function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1, out = path.join(REPO_ROOT, "track-outcomes.csv");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--years" && a[i + 1]) years = parseInt(a[++i], 10);
    else if (a[i] === "--out" && a[i + 1]) out = a[++i];
  }
  return { years, out };
}
function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else { if (c === '"') q = true; else if (c === ",") { row.push(field); field = ""; }
           else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
           else if (c === "\r") {} else field += c; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function readCsvObjects(fp) {
  const rows = parseCsv(fs.readFileSync(fp, "utf8")).filter((r) => r.some((c) => c !== ""));
  const h = rows[0].map((x) => x.trim());
  return rows.slice(1).map((r) => { const o = {}; h.forEach((k, i) => o[k] = r[i] ?? ""); return o; });
}
function sqlStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function sqlInt(s) { const n = parseInt(s, 10); if (!Number.isFinite(n)) throw new Error(`int? ${s}`); return String(n); }
function sqlPct(s) { if (s == null || String(s).trim() === "") return "NULL"; const n = parseFloat(String(s).replace("%", "")); return Number.isFinite(n) ? (n / 100).toFixed(6) : "NULL"; }
function sqlBool(b) { return b ? "1" : "0"; }
const CHUNK = 1000;
function valuesCte(tuples, cols) {
  const out = [];
  for (let i = 0; i < tuples.length; i += CHUNK) out.push(tuples.slice(i, i + CHUNK));
  return out.map((c) => `SELECT * FROM (VALUES\n        ${c.join(",\n        ")}\n    ) AS v(${cols})`).join("\n    UNION ALL\n    ");
}
function crosswalkCte() {
  return valuesCte(readCsvObjects(CROSSWALK_CSV).map((r) =>
    `(${sqlInt(r.LibraryItem_ID)}, ${sqlStr(r.Family)}, ${sqlStr(r.Group)}, ${sqlStr(r.Name)})`),
    "LibraryItem_ID, Family, Grp, OutcomeName");
}
function scalesCte() {
  return valuesCte(readCsvObjects(SCALES_CSV).map((r) =>
    `(${sqlInt(r["Library Scale Value"])}, ${sqlPct(r.Points)}, ${sqlBool((r["Response Type"] || "").trim() === "N/A")})`),
    "LibraryScaleValue_ID, Points, IsNA");
}
function csvEscape(v) { if (v == null) return ""; const s = String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { if (!rows.length) return ""; const h = Object.keys(rows[0]); return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n"; }

(async () => {
  const { years, out } = parseArgs();
  const sql = fs.readFileSync(SQL_TEMPLATE, "utf8")
    .replace(/__CROSSWALK_CTE_BODY__/g, crosswalkCte())
    .replace(/__SCALES_CTE_BODY__/g, scalesCte())
    .replace(/__YEARS__/g, `-${years}`);
  if (process.env.DUMP_SQL) { fs.writeFileSync(path.join(__dirname, ".rendered-track-outcomes.sql"), sql); console.error("dumped"); return; }
  console.error(`track-outcomes pull: last ${years}yr (ungated) -> ${out}`);
  const t0 = Date.now();
  const r = await query(sql, "bronze");
  console.error(`rows: ${r.recordset.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  fs.writeFileSync(out, toCsv(r.recordset));
  console.error(`wrote ${out}`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
