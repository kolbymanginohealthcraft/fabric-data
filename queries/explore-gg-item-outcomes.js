// FRESH item-level outcomes — Section GG, native 6-point scale (NO blending).
//
// The care-delivery-optimization premise (docs/care-delivery-optimization-framework.md):
// our blended 0-100% scale fuses unlike assessments, so a "40% gain" isn't comparable
// across patients. The fix is to measure each LIBRARY ITEM on its own native scale.
//
// This is the first cut: the Section GG items (crosswalk families (a) Mobility +
// (b) Self-Care) all share the CMS 6-point scale (LibraryScale 1360):
//   6 Independent · 5 Setup · 4 Supervision · 3 Partial/mod · 2 Substantial/max · 1 Dependent
//   (non-performance codes Refused/N-A/Environmental/Medical-Safety have NumValue<=0 -> excluded)
// So a per-item gain = DISCH - EVAL on a clean 1..6 scale, comparable across every patient
// assessed on that item, with a well-established MCID of ~1 point.
//
// Fact (TxDocumentItem/TxDocument/TxTrack) = Bronze. Item id->name labels come from the
// curated Outcomes Crosswalk.csv (families a & b). Window = the scorecard trailing-12-mo
// (rolls on the 10th), matching track-outcomes.sql.
//
// Output: data/gg-item-outcomes.csv (one row per Section GG item) + console summary.
// Read-only. Usage: node queries/explore-gg-item-outcomes.js [--years N] [--out path]
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

const REPO_ROOT = path.join(__dirname, "..");
const CROSSWALK_CSV = path.join(REPO_ROOT, "data", "Outcomes Crosswalk.csv");

function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1, out = path.join(REPO_ROOT, "data", "gg-item-outcomes.csv");
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
  return rows.slice(1).map((r) => { const o = {}; h.forEach((k, i) => (o[k] = r[i] ?? "")); return o; });
}
function csvEscape(v) { if (v == null) return ""; const s = String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { if (!rows.length) return ""; const h = Object.keys(rows[0]); return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n"; }

// Section GG items = crosswalk families (a) Mobility + (b) Self Care.
const gg = readCsvObjects(CROSSWALK_CSV).filter((r) => /^\((a|b)\)/.test(r.Family));
const ggMap = new Map(gg.map((r) => [parseInt(r.LibraryItem_ID, 10), r]));
const ggIds = [...ggMap.keys()];

const SQL = `
WITH Scored AS (
  SELECT trk.TxTrack_ID, item.LibraryItem_ID, doc.DocumentType,
         CASE item.LibraryScaleValue_ID
           WHEN 15096 THEN 6 WHEN 15097 THEN 5 WHEN 15098 THEN 4
           WHEN 15099 THEN 3 WHEN 15100 THEN 2 WHEN 15101 THEN 1 END AS gg
  FROM dbo.TxDocumentItem item
  JOIN dbo.TxDocument doc ON doc.TxDocument_ID = item.TxDocument_ID
  JOIN dbo.TxTrack  trk  ON trk.TxTrack_ID = doc.TxTrack_ID
  WHERE doc.DocumentType IN ('EVAL','DISCH') AND doc.IsInactive = 0
    AND trk.IsDeletedTrack = 0
    AND item.LibraryItem_ID IN (${ggIds.join(",")})
    AND item.LibraryScaleValue_ID BETWEEN 15096 AND 15101   -- performance levels only
    AND trk.EndDate >= DATEADD(YEAR, @YEARS, DATEADD(MONTH, CASE WHEN DAY(GETDATE()) >= 10 THEN 0 ELSE -1 END, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)))
    AND trk.EndDate <  DATEADD(MONTH, CASE WHEN DAY(GETDATE()) >= 10 THEN 0 ELSE -1 END, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
),
PerTrackItem AS (
  SELECT TxTrack_ID, LibraryItem_ID,
         AVG(CASE WHEN DocumentType='EVAL'  THEN CAST(gg AS FLOAT) END) AS Eval,
         AVG(CASE WHEN DocumentType='DISCH' THEN CAST(gg AS FLOAT) END) AS Disch
  FROM Scored GROUP BY TxTrack_ID, LibraryItem_ID
)
SELECT LibraryItem_ID,
  SUM(CASE WHEN Eval IS NOT NULL THEN 1 ELSE 0 END)  AS n_eval,
  SUM(CASE WHEN Disch IS NOT NULL THEN 1 ELSE 0 END) AS n_disch,
  SUM(CASE WHEN Eval IS NOT NULL AND Disch IS NOT NULL THEN 1 ELSE 0 END) AS n_both,
  AVG(CASE WHEN Eval IS NOT NULL AND Disch IS NOT NULL THEN Eval END)        AS mean_eval,
  AVG(CASE WHEN Eval IS NOT NULL AND Disch IS NOT NULL THEN Disch END)       AS mean_disch,
  AVG(CASE WHEN Eval IS NOT NULL AND Disch IS NOT NULL THEN Disch - Eval END) AS mean_change,
  AVG(CASE WHEN Eval IS NOT NULL AND Disch IS NOT NULL THEN CASE WHEN Disch-Eval >= 1 THEN 1.0 ELSE 0.0 END END) AS pct_gain_ge1_mcid
FROM PerTrackItem
GROUP BY LibraryItem_ID`;

(async () => {
  const { years, out } = parseArgs();
  console.error(`GG item-level outcomes: ${ggIds.length} items, trailing ${years}yr window (Bronze) -> ${out}`);
  const t0 = Date.now();
  const res = (await query(SQL.replace("@YEARS", `-${years}`), "bronze")).recordset;
  console.error(`bronze rows: ${res.length} in ${Math.round((Date.now() - t0) / 1000)}s\n`);

  const rows = res.map((r) => {
    const m = ggMap.get(r.LibraryItem_ID) || {};
    return {
      Family: m.Family || "", Group: m.Group || "", Name: m.Name || "",
      LibraryItem_ID: r.LibraryItem_ID,
      n_both: r.n_both, n_eval: r.n_eval, n_disch: r.n_disch,
      mean_eval: r.mean_eval == null ? null : +r.mean_eval.toFixed(2),
      mean_disch: r.mean_disch == null ? null : +r.mean_disch.toFixed(2),
      mean_change: r.mean_change == null ? null : +r.mean_change.toFixed(2),
      pct_gain_ge1_mcid: r.pct_gain_ge1_mcid == null ? null : +(100 * r.pct_gain_ge1_mcid).toFixed(1),
    };
  }).sort((a, b) => b.n_both - a.n_both);
  fs.writeFileSync(out, toCsv(rows));
  console.error(`wrote ${out} (${rows.length} items)\n`);

  const w = rows.filter((r) => r.n_both >= 200);
  const hdr = `${"Item".padEnd(34)}${"n".padStart(7)}${"eval".padStart(7)}${"disch".padStart(7)}${"Δ".padStart(7)}${"%≥MCID".padStart(8)}`;
  console.error("=== Section GG item-level outcomes (native 6-pt scale, n>=200), best Δ first ===");
  console.error(hdr); console.error("-".repeat(hdr.length));
  for (const r of [...w].sort((a, b) => b.mean_change - a.mean_change)) {
    const nm = (r.Group.replace(/^[A-Z-]+: /, "") + " / " + r.Name.replace(/^[A-Z]+\. /, "")).slice(0, 33);
    console.error(`${nm.padEnd(34)}${String(r.n_both).padStart(7)}${String(r.mean_eval).padStart(7)}${String(r.mean_disch).padStart(7)}${String(r.mean_change).padStart(7)}${(r.pct_gain_ge1_mcid + "%").padStart(8)}`);
  }
  const tot = w.reduce((s, r) => s + r.n_both, 0);
  console.error(`\n${w.length} items with n>=200; ${tot.toLocaleString()} track-item pairs. Full set -> ${path.basename(out)}`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
