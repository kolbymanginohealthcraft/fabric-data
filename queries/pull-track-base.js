// Track-grain base universe (Bronze): one row per discharged track in the window, with the
// per-track cohort/scorecard dimensions + stay classification. This is the DENOMINATOR universe
// for % Discharges-with-Outcome (includes tracks with zero outcomes). Per-outcome scoring
// (gain/valid) comes from pull-track-outcomes.js; Library (aegisdataprod) + ServiceLine (Silver
// facility-dim) + hours (Silver minutes) are joined downstream in /evaluation/.
//
// Stay (payer-derived, validated 2026-06-06): primary payer over the track's dates via
//   CasePayerSet -> ResidentPayerSequence(Seq=1) -> ResidentPayer -> PayerPayerType -> PayerType.
//   Short = PayerType 1,6 ; Long = 2,7 ; else Excluded. >1 stay-category covering the track = Changed.
//
// Usage: node queries/pull-track-base.js [--years N] [--out path]
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1, out = path.join(__dirname, "..", "data", "track-base.csv");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--years" && a[i + 1]) years = parseInt(a[++i], 10);
    else if (a[i] === "--out" && a[i + 1]) out = a[++i];
  }
  return { years, out };
}
function csvEscape(v) { if (v == null) return ""; const s = String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { if (!rows.length) return ""; const h = Object.keys(rows[0]); return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n"; }

const SQL = `
WITH track AS (
  SELECT TxTrack_ID, PatientCase_ID, Discipline, StartDate, EndDate
  FROM dbo.TxTrack
  WHERE IsDeletedTrack = 0
    AND EndDate >= DATEADD(YEAR, @YEARS, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
    AND EndDate <  DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
),
tp AS (  -- track x distinct covering PRIMARY payer type
  SELECT t.TxTrack_ID, pt.PayerType_ID
  FROM track t
  JOIN dbo.CasePayerSet cps ON cps.PatientCase_ID = t.PatientCase_ID
       AND (cps.Discipline = t.Discipline OR cps.Discipline IS NULL)
       AND cps.FromDate <= t.EndDate AND (cps.ThruDate >= t.StartDate OR cps.ThruDate IS NULL)
  JOIN dbo.ResidentPayerSequence seq ON seq.ResidentPayerSet_ID = cps.ResidentPayerSet_ID AND seq.Sequence = 1
  JOIN dbo.ResidentPayer rp ON rp.ResidentPayer_ID = seq.ResidentPayer_ID
  JOIN dbo.PayerPayerType ppt ON ppt.PayerPayerType_ID = rp.PayerPayerType_ID
  JOIN dbo.PayerType pt ON pt.PayerType_ID = ppt.PayerType_ID
  GROUP BY t.TxTrack_ID, pt.PayerType_ID
),
stay AS (
  SELECT TxTrack_ID,
    COUNT(DISTINCT CASE WHEN PayerType_ID IN (1,6) THEN 'S'
                        WHEN PayerType_ID IN (2,7) THEN 'L' ELSE 'X' END) AS ncat,
    MAX(CASE WHEN PayerType_ID IN (1,6) THEN 1 ELSE 0 END) AS hasS,
    MAX(CASE WHEN PayerType_ID IN (2,7) THEN 1 ELSE 0 END) AS hasL
  FROM tp GROUP BY TxTrack_ID
),
disch AS (  -- tracks that have a DISCH document
  SELECT DISTINCT TxTrack_ID FROM dbo.TxDocument WHERE DocumentType = 'DISCH' AND IsInactive = 0
)
SELECT
  t.TxTrack_ID,
  t.PatientCase_ID,
  t.Discipline,
  res.Facility_ID,
  isrc.Abbrev                       AS Residence,
  CASE WHEN s.TxTrack_ID IS NULL THEN 'NoPayer'
       WHEN s.ncat > 1 THEN 'Changed'
       WHEN s.hasS = 1 THEN 'Short'
       WHEN s.hasL = 1 THEN 'Long'
       ELSE 'Excluded' END          AS Stay,
  CASE WHEN d.TxTrack_ID IS NULL THEN 0 ELSE 1 END AS HasDischDoc,
  t.StartDate                       AS TrackStartDate,
  t.EndDate                         AS TrackEndDate
FROM track t
JOIN dbo.PatientCase pc ON pc.PatientCase_ID = t.PatientCase_ID AND pc.IsDeletedCase = 0
JOIN dbo.Stay stay2     ON stay2.Stay_ID = pc.Stay_ID
JOIN dbo.Resident res   ON res.Resident_ID = stay2.Resident_ID AND res.IsDeletedResident = 0
LEFT JOIN dbo.IntakeSource isrc ON isrc.IntakeSource_ID = stay2.IntakeSource_ID
LEFT JOIN stay s        ON s.TxTrack_ID = t.TxTrack_ID
LEFT JOIN disch d       ON d.TxTrack_ID = t.TxTrack_ID
ORDER BY t.TxTrack_ID`;

(async () => {
  const { years, out } = parseArgs();
  const sql = SQL.replace("@YEARS", `-${years}`);
  console.error(`track-base pull: tracks ending in last ${years}yr -> ${out}`);
  const t0 = Date.now();
  const r = await query(sql, "bronze");
  console.error(`rows: ${r.recordset.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  fs.writeFileSync(out, toCsv(r.recordset));
  console.error(`wrote ${out}`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
