// Per-(track × Section GG item) native 6-point eval/discharge scores — the comparable
// unit for the predictability analysis (docs/care-delivery-optimization-framework.md).
//
// Emits one row per (TxTrack_ID, LibraryItem_ID) with Eval and Disch on the native CMS
// GG scale (6=Independent .. 1=Dependent; non-performance codes excluded). Window =
// scorecard trailing-12-mo (rolls on the 10th). Fact = Bronze.
//
// Output: data/gg-item-track.csv. Read-only.
// Usage: node queries/pull-gg-item-track.js [--years N] [--out path]
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

const REPO_ROOT = path.join(__dirname, "..");
const CROSSWALK_CSV = path.join(REPO_ROOT, "data", "Outcomes Crosswalk.csv");

function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1, out = path.join(REPO_ROOT, "data", "gg-item-track.csv");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--years" && a[i + 1]) years = parseInt(a[++i], 10);
    else if (a[i] === "--out" && a[i + 1]) out = a[++i];
  }
  return { years, out };
}
function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"' && text[i+1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else { if (c === '"') q = true; else if (c === ",") { row.push(field); field = ""; }
           else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; } else if (c === "\r") {} else field += c; } }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function readCsvObjects(fp) {
  const rows = parseCsv(fs.readFileSync(fp, "utf8")).filter((r) => r.some((c) => c !== ""));
  const h = rows[0].map((x) => x.trim());
  return rows.slice(1).map((r) => { const o = {}; h.forEach((k, i) => (o[k] = r[i] ?? "")); return o; });
}
function csvEscape(v) { if (v == null) return ""; const s = String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { if (!rows.length) return ""; const h = Object.keys(rows[0]); return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n"; }

const ggIds = readCsvObjects(CROSSWALK_CSV).filter((r) => /^\((a|b)\)/.test(r.Family)).map((r) => parseInt(r.LibraryItem_ID, 10));

const SQL = `
WITH Scored AS (
  SELECT trk.TxTrack_ID, item.LibraryItem_ID, doc.DocumentType,
         CASE item.LibraryScaleValue_ID
           WHEN 15096 THEN 6 WHEN 15097 THEN 5 WHEN 15098 THEN 4
           WHEN 15099 THEN 3 WHEN 15100 THEN 2 WHEN 15101 THEN 1 END AS gg
  FROM dbo.TxDocumentItem item
  JOIN dbo.TxDocument doc ON doc.TxDocument_ID = item.TxDocument_ID
  JOIN dbo.TxTrack  trk  ON trk.TxTrack_ID = doc.TxTrack_ID
  WHERE doc.DocumentType IN ('EVAL','DISCH') AND doc.IsInactive = 0 AND trk.IsDeletedTrack = 0
    AND item.LibraryItem_ID IN (${ggIds.join(",")})
    AND item.LibraryScaleValue_ID BETWEEN 15096 AND 15101
    AND trk.EndDate >= DATEADD(YEAR, @YEARS, DATEADD(MONTH, CASE WHEN DAY(GETDATE()) >= 10 THEN 0 ELSE -1 END, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)))
    AND trk.EndDate <  DATEADD(MONTH, CASE WHEN DAY(GETDATE()) >= 10 THEN 0 ELSE -1 END, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
)
SELECT TxTrack_ID, LibraryItem_ID,
       AVG(CASE WHEN DocumentType='EVAL'  THEN CAST(gg AS FLOAT) END) AS Eval,
       AVG(CASE WHEN DocumentType='DISCH' THEN CAST(gg AS FLOAT) END) AS Disch
FROM Scored
GROUP BY TxTrack_ID, LibraryItem_ID
HAVING AVG(CASE WHEN DocumentType='EVAL' THEN CAST(gg AS FLOAT) END) IS NOT NULL
   AND AVG(CASE WHEN DocumentType='DISCH' THEN CAST(gg AS FLOAT) END) IS NOT NULL`;

(async () => {
  const { years, out } = parseArgs();
  console.error(`gg-item-track pull: ${ggIds.length} GG items, trailing ${years}yr (Bronze, eval+disch matched) -> ${out}`);
  const t0 = Date.now();
  const res = (await query(SQL.replace("@YEARS", `-${years}`), "bronze")).recordset;
  console.error(`rows: ${res.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  const rows = res.map((r) => ({ TxTrack_ID: r.TxTrack_ID, LibraryItem_ID: r.LibraryItem_ID,
    Eval: +r.Eval.toFixed(3), Disch: +r.Disch.toFixed(3) }));
  fs.writeFileSync(out, toCsv(rows));
  console.error(`wrote ${out}`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
