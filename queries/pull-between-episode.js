// BETWEEN-EPISODE MAINTENANCE: the data for measuring what restorative actually does.
//
// Every outcome analysis so far measured restorative INSIDE a therapy episode, which is the one
// place restorative is not trying to do anything. Its actual job is holding function in the gap
// BETWEEN episodes, and that gap is measurable after all: two consecutive therapy episodes give
// us bookends. Discharge score of episode 1 and evaluation score of episode 2 bracket the
// interval, and restorative delivered inside that interval is the intervention.
//
//     episode 1 ......... DISCH  |  <-- the gap: restorative lives here -->  |  EVAL ......... episode 2
//
// Two questions this enables:
//   H-A  does restorative in the gap DELAY the next episode?
//   H-B  do they START the next episode at a higher functional level than they otherwise would?
//
// H-B is the stronger test. H-A carries a surveillance-bias risk in the opposite direction
// (someone seeing a resident 3x a week is MORE likely to spot decline and trigger a referral),
// so a null or negative there is not evidence against maintenance.
//
// This pulls the two things the scratchpad does not already have:
//   1. track roster WITH Resident_ID (tb.csv has dates and scores but no resident key)
//   2. restorative services at resident-and-date grain, so each service lands in a gap
// Scores come from the existing to.csv (queries/track-outcomes.sql), joined on TxTrack_ID.
//
// Usage: node queries/pull-between-episode.js [outDir]
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

const OUTDIR = process.argv[2] || path.join(__dirname, "..", "data");
// Wide enough that a gap can have an episode on both sides inside the window.
const START = "2024-10-01";
const END = "2026-08-01";

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  if (!rows.length) return "";
  const h = Object.keys(rows[0]);
  return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n";
}

// Bronze lands NetHealth varbinary GUID Ids in two encodings and they do not join. Normalize.
const guidKey = (c) =>
  `UPPER(CASE WHEN DATALENGTH(${c}) = 36 THEN CAST(${c} AS varchar(36))` +
  ` ELSE LEFT(CONVERT(varchar(32), ${c}, 2), 8) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 9, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 13, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 17, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 21, 12) END)`;

// --- 1. every track with its resident, in the restorative-running facilities ---------------
const trackSql = `
WITH Svc AS (SELECT Category, ${guidKey("Id")} AS GuidKey
             FROM PatientLevelOptionalServices.Service),
Plos AS (
  SELECT rr.Facility_ID
  FROM (SELECT Resident_ID, ${guidKey("Service_ID")} AS GuidKey
        FROM PatientLevelOptionalServices.Instance
        WHERE CreatedDate >= '${START}' AND CreatedDate < '${END}') p
  JOIN Svc s ON s.GuidKey = p.GuidKey
  JOIN dbo.Resident rr ON rr.Resident_ID = p.Resident_ID
  WHERE s.Category = 'Nursing Restorative'
),
RestFac AS (SELECT DISTINCT Facility_ID FROM Plos)
-- Emit dates as ISO STRINGS, never as date/datetime. The mssql driver hands back JS Date
-- objects which stringify to local-time longhand ("Sun May 17 2026 19:00:00 GMT-0500"), and a
-- bare CAST(x AS date) is read as UTC midnight and then rendered in Central, shifting every
-- date back one day. CONVERT(...,23) sidesteps the whole round trip.
SELECT tt.TxTrack_ID, st.Resident_ID, rr.Facility_ID, tt.Discipline,
       CONVERT(varchar(10), tt.StartDate, 23) AS TrackStart,
       CONVERT(varchar(10), tt.EndDate, 23) AS TrackEnd,
       CASE WHEN st.DischargeDate IS NULL THEN 1 ELSE 0 END AS StayOpen
FROM dbo.TxTrack tt
JOIN dbo.PatientCase pc ON pc.PatientCase_ID = tt.PatientCase_ID
                        AND ISNULL(pc.IsDeletedCase,0) = 0
JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
JOIN dbo.Resident rr ON rr.Resident_ID = st.Resident_ID
WHERE ISNULL(tt.IsDeletedTrack,0) = 0
  AND tt.StartDate >= '${START}' AND tt.StartDate < '${END}'
  AND tt.EndDate IS NOT NULL
  AND rr.Facility_ID IN (SELECT Facility_ID FROM RestFac)`;

// --- 2. restorative at resident-and-date grain ---------------------------------------------
const restSql = `
WITH Svc AS (SELECT Category, ${guidKey("Id")} AS GuidKey
             FROM PatientLevelOptionalServices.Service)
SELECT p.Resident_ID, CONVERT(varchar(10), p.CreatedDate, 23) AS SvcDate,
       SUM(CAST(p.Duration AS bigint)) AS Minutes
FROM (SELECT Resident_ID, CreatedDate, Duration, ${guidKey("Service_ID")} AS GuidKey
      FROM PatientLevelOptionalServices.Instance
      WHERE CreatedDate >= '${START}' AND CreatedDate < '${END}') p
JOIN Svc s ON s.GuidKey = p.GuidKey
WHERE s.Category = 'Nursing Restorative'
GROUP BY p.Resident_ID, CONVERT(varchar(10), p.CreatedDate, 23)`;

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });

  const t = await query(trackSql, "bronze");
  const tp = path.join(OUTDIR, "be-tracks.csv");
  fs.writeFileSync(tp, toCsv(t.recordset));
  const res = new Set(t.recordset.map((r) => r.Resident_ID));
  console.log(`tracks           ${t.recordset.length.toLocaleString()} rows -> ${tp}`);
  console.log(`  distinct residents ${res.size.toLocaleString()}`);

  const r = await query(restSql, "bronze");
  const rp = path.join(OUTDIR, "be-restorative.csv");
  fs.writeFileSync(rp, toCsv(r.recordset));
  console.log(`restorative      ${r.recordset.length.toLocaleString()} resident-days -> ${rp}`);

  await closeAll();
})();
