// Does the restorative model intersect iSNP? Martha + Leslie co-present on iSNP AND the
// model of care, so this decides how relevant "restorative is additive" is to that panel.
//
// iSNP cohort = residents with ANY iSNP payer enrollment: Payer_ID 550 (iSNP, Medicare Part B),
// 1389 (ISNP-B Ancil, Managed Care Part B), 1390 (ISNP-A Ancil, Managed Care Part A).
// Enrollment is resident-level and long-lived (it is a plan, not a stay), so a resident-level
// flag is the right grain. It is EVER-ENROLLED, not "enrolled on the service date" -- stated
// as such wherever reported.
//
// Scope: the facilities that actually document restorative (usage-defined). See
// pull-total-care.js for why that scope is the honest one.
//
// Usage: node queries/pull-isnp-restorative.js [startDate] [endDate]
const { query } = require("../fabric-query");

const START = process.argv[2] || "2026-01-01";
const END = process.argv[3] || "2026-08-01";
const ISNP = "550,1389,1390";

// Bronze lands NetHealth varbinary GUID Ids in two encodings (16-byte binary vs 36-byte ASCII
// text) and they do not join. Normalize. See the fabric-workflow skill pitfalls log.
const guidKey = (c) =>
  `UPPER(CASE WHEN DATALENGTH(${c}) = 36 THEN CAST(${c} AS varchar(36))` +
  ` ELSE LEFT(CONVERT(varchar(32), ${c}, 2), 8) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 9, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 13, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 17, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 21, 12) END)`;

const sql = `
WITH Isnp AS (   -- residents ever enrolled in an iSNP plan
  SELECT DISTINCT rp.Resident_ID
  FROM dbo.ResidentPayer rp
  JOIN dbo.PayerPayerType ppt ON ppt.PayerPayerType_ID = rp.PayerPayerType_ID
  WHERE ppt.Payer_ID IN (${ISNP})
),
Svc AS (SELECT Category, ${guidKey("Id")} AS GuidKey FROM PatientLevelOptionalServices.Service),
Rest AS (
  SELECT rr.Facility_ID, p.Resident_ID, CAST(p.CreatedDate AS date) AS SvcDate, p.Duration
  FROM (
    SELECT Resident_ID, CreatedDate, Duration, ${guidKey("Service_ID")} AS GuidKey
    FROM PatientLevelOptionalServices.Instance
    WHERE CreatedDate >= '${START}' AND CreatedDate < '${END}'
  ) p
  JOIN Svc s ON s.GuidKey = p.GuidKey
  JOIN dbo.Resident rr ON rr.Resident_ID = p.Resident_ID
  WHERE s.Category = 'Nursing Restorative'
),
RestFac AS (SELECT DISTINCT Facility_ID FROM Rest),
Ther AS (
  SELECT rr.Facility_ID, st.Resident_ID, m.Duration
  FROM dbo.TxMinute m
  JOIN dbo.TxSession ts ON ts.TxSession_ID = m.TxSession_ID AND ISNULL(ts.IsDeletedSession,0)=0
  JOIN dbo.TxTrack tt ON tt.TxTrack_ID = ts.TxTrack_ID AND ISNULL(tt.IsDeletedTrack,0)=0
  JOIN dbo.PatientCase pc ON pc.PatientCase_ID = tt.PatientCase_ID AND ISNULL(pc.IsDeletedCase,0)=0
  JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
  JOIN dbo.Resident rr ON rr.Resident_ID = st.Resident_ID
  WHERE ts.SessionDate >= '${START}' AND ts.SessionDate < '${END}'
    AND rr.Facility_ID IN (SELECT Facility_ID FROM RestFac)
),
Cases AS (
  SELECT st.Resident_ID, CAST(pc.StartDate AS date) AS S,
         CAST(ISNULL(pc.EndDate,'2099-12-31') AS date) AS E
  FROM dbo.PatientCase pc JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
  WHERE ISNULL(pc.IsDeletedCase,0)=0
),
-- classify BEFORE grouping: an EXISTS in a GROUP BY list is rejected outright
RestTagged AS (
  SELECT r.Resident_ID, r.Duration,
         CASE WHEN i.Resident_ID IS NULL THEN 'not iSNP' ELSE 'iSNP' END AS Cohort,
         CASE WHEN EXISTS (SELECT 1 FROM Cases c WHERE c.Resident_ID = r.Resident_ID
                            AND r.SvcDate BETWEEN c.S AND c.E)
              THEN 'on caseload' ELSE 'off caseload' END AS Bucket
  FROM Rest r LEFT JOIN Isnp i ON i.Resident_ID = r.Resident_ID
)
-- A. restorative minutes + residents, iSNP vs not, split by on/off therapy caseload
SELECT 'A. restorative by iSNP x caseload' AS Section, Cohort, Bucket,
       COUNT(DISTINCT Resident_ID) AS Residents,
       SUM(CAST(Duration AS bigint)) AS Minutes
FROM RestTagged
GROUP BY Cohort, Bucket

UNION ALL
-- B. therapy minutes in the same facilities, iSNP vs not (denominator for share-of-care)
SELECT 'B. therapy by iSNP', CASE WHEN i.Resident_ID IS NULL THEN 'not iSNP' ELSE 'iSNP' END,
       'therapy', COUNT(DISTINCT t.Resident_ID), SUM(CAST(t.Duration AS bigint))
FROM Ther t LEFT JOIN Isnp i ON i.Resident_ID = t.Resident_ID
GROUP BY CASE WHEN i.Resident_ID IS NULL THEN 'not iSNP' ELSE 'iSNP' END

UNION ALL
-- C. how concentrated: facilities with restorative, split by whether they run iSNP at all
SELECT 'C. facility overlap',
       CASE WHEN fi.Facility_ID IS NULL THEN 'restorative, no iSNP residents'
            ELSE 'restorative + iSNP' END,
       'facilities', COUNT(DISTINCT rf.Facility_ID), 0
FROM RestFac rf
LEFT JOIN (SELECT DISTINCT rr.Facility_ID FROM dbo.Resident rr
           JOIN Isnp i ON i.Resident_ID = rr.Resident_ID) fi ON fi.Facility_ID = rf.Facility_ID
GROUP BY CASE WHEN fi.Facility_ID IS NULL THEN 'restorative, no iSNP residents'
              ELSE 'restorative + iSNP' END
ORDER BY Section, Cohort, Bucket`;

const n = (x) => Number(x).toLocaleString();

query(sql, "bronze").then((r) => {
  const rows = r.recordset;
  console.log(`\niSNP x restorative — ${START} to ${END}`);
  console.log(`iSNP = residents EVER enrolled in Payer_ID ${ISNP}\n`);
  let sec = null;
  for (const x of rows) {
    if (x.Section !== sec) { sec = x.Section; console.log(`\n=== ${sec} ===`); }
    console.log(`  ${x.Cohort.padEnd(34)}${x.Bucket.padEnd(14)}` +
      `${n(x.Residents).padStart(9)} res  ${n(x.Minutes).padStart(12)} min`);
  }
  // share of care inside the restorative facilities, by cohort
  const get = (s, c) => rows.filter((x) => x.Section.startsWith(s) && x.Cohort === c)
    .reduce((a, x) => a + Number(x.Minutes), 0);
  console.log(`\n=== share of total care minutes that is restorative ===`);
  for (const c of ["iSNP", "not iSNP"]) {
    const rest = get("A", c), ther = get("B", c);
    console.log(`  ${c.padEnd(12)} restorative ${n(rest).padStart(11)} / total ` +
      `${n(rest + ther).padStart(12)} = ${((rest / (rest + ther)) * 100).toFixed(1)}%`);
  }
  console.log();
});
