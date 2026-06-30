// Per-track patient/clinical attributes for the predictability analysis.
// One row per TxTrack (scorecard trailing-12-mo window): demographics + primary medical
// diagnosis, keyed by TxTrack_ID so it joins to gg-item-track.csv and tracks.csv.
//
//   TxTrack -> PatientCase -> Stay -> Resident   (age from DOB@TrackStart, gender)
//   primary MEDICAL diagnosis via TxDiagnosis (DisplayOrder) -> DiagnosisCode.Code
//
// Payer is intentionally NOT here yet (5-table CasePayerSet hop; separate enrichment).
// Fact = Bronze. Output: data/track-attributes.csv. Read-only.
// Usage: node queries/pull-track-attributes.js [--years N] [--out path]
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

const REPO_ROOT = path.join(__dirname, "..");
function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1, out = path.join(REPO_ROOT, "data", "track-attributes.csv");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--years" && a[i + 1]) years = parseInt(a[++i], 10);
    else if (a[i] === "--out" && a[i + 1]) out = a[++i];
  }
  return { years, out };
}
function csvEscape(v) { if (v == null) return ""; const s = String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { if (!rows.length) return ""; const h = Object.keys(rows[0]); return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n"; }

const SQL = `
SELECT trk.TxTrack_ID, trk.PatientCase_ID, trk.Discipline,
       CONVERT(varchar(10), trk.StartDate, 23) AS TrackStart,
       CONVERT(varchar(10), trk.EndDate, 23)   AS TrackEnd,
       res.Gender,
       CONVERT(varchar(10), TRY_CONVERT(date, res.DOB), 23) AS DOB,
       dx.Code AS PrimaryDxCode
FROM dbo.TxTrack trk
JOIN dbo.PatientCase pc ON pc.PatientCase_ID = trk.PatientCase_ID
JOIN dbo.Stay  stay     ON stay.Stay_ID = pc.Stay_ID
JOIN dbo.Resident res   ON res.Resident_ID = stay.Resident_ID
OUTER APPLY (
  SELECT TOP 1 dc.Code
  FROM dbo.TxDiagnosis td
  JOIN dbo.TxDocument d2     ON d2.TxDocument_ID = td.TxDocument_ID
  JOIN dbo.DiagnosisCode dc  ON dc.DiagnosisCode_ID = td.DiagnosisCode_ID
  WHERE d2.TxTrack_ID = trk.TxTrack_ID
    AND td.DiagnosisType = 'MEDICAL' AND td.IsInactive = 0
    AND dc.Code IS NOT NULL
  ORDER BY td.DisplayOrder, td.TxDiagnosis_ID
) dx
WHERE trk.IsDeletedTrack = 0
  AND trk.EndDate >= DATEADD(YEAR, @YEARS, DATEADD(MONTH, CASE WHEN DAY(GETDATE()) >= 10 THEN 0 ELSE -1 END, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)))
  AND trk.EndDate <  DATEADD(MONTH, CASE WHEN DAY(GETDATE()) >= 10 THEN 0 ELSE -1 END, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))`;

(async () => {
  const { years, out } = parseArgs();
  console.error(`track-attributes pull: trailing ${years}yr (Bronze) -> ${out}`);
  const t0 = Date.now();
  const rows = (await query(SQL.replace("@YEARS", `-${years}`), "bronze")).recordset;
  console.error(`rows: ${rows.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  fs.writeFileSync(out, toCsv(rows));
  console.error(`wrote ${out}`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
