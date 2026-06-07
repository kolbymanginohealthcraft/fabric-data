// Eval-document author per track (Bronze) -> registered-therapist credit source.
// Registered clinicians get FULL credit for tracks they EVALUATED; the evaluator is the
// author (Person_ID) of the track's EVAL document. Verified ~1:1 track:eval, 100% of
// authors registered. Output: eval-author.csv (TxTrack_ID, AuthorPerson_ID).
// Usage: node queries/pull-eval-author.js [--years N] [--out path]
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1, out = path.join(__dirname, "..", "data", "eval-author.csv");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--years" && a[i + 1]) years = parseInt(a[++i], 10);
    else if (a[i] === "--out" && a[i + 1]) out = a[++i];
  }
  return { years, out };
}
function csvEscape(v) { if (v == null) return ""; const s = String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { if (!rows.length) return ""; const h = Object.keys(rows[0]); return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n"; }

// One EVAL doc per track (1:1). If a track somehow has >1, take the earliest CompletedDate.
const SQL = `
WITH ranked AS (
  SELECT d.TxTrack_ID, d.Person_ID AS AuthorPerson_ID,
         ROW_NUMBER() OVER (PARTITION BY d.TxTrack_ID
                            ORDER BY d.CompletedDate, d.TxDocument_ID) AS rn
  FROM dbo.TxDocument d
  JOIN dbo.TxTrack trk ON trk.TxTrack_ID = d.TxTrack_ID
  WHERE d.DocumentType = 'EVAL' AND d.IsInactive = 0
    AND trk.IsDeletedTrack = 0
    AND trk.EndDate >= DATEADD(YEAR, @YEARS, GETDATE())
)
SELECT TxTrack_ID, AuthorPerson_ID FROM ranked WHERE rn = 1 ORDER BY TxTrack_ID`;

(async () => {
  const { years, out } = parseArgs();
  const sql = SQL.replace("@YEARS", `-${years}`);
  console.error(`eval-author pull: last ${years}yr -> ${out}`);
  const t0 = Date.now();
  const r = await query(sql, "bronze");
  console.error(`rows: ${r.recordset.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  fs.writeFileSync(out, toCsv(r.recordset));
  console.error(`wrote ${out}`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
