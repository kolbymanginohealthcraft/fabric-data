// Restorative minutes per month, split by whether the resident was on a therapy caseload
// that day. This is the proof of the continuity claim: most restorative care goes to
// residents who are NOT on caseload, i.e. people we would otherwise not be touching.
//
// Source for the on/off caseload chart on the Total Care Through Transitions slide.
//
// Grain is the individual service DATE, not the month. A resident with therapy Jun 1-10 and
// restorative Jun 20 is "not on caseload" for that service; a monthly roll-up would wrongly
// call it concurrent and overstate the on-caseload share by roughly half.
//
// MINUTES partition cleanly and can be stacked. RESIDENT counts are distinct within each
// bucket and overlap across them (a resident can receive restorative both on and off
// caseload in the same month), so resident counts must NOT be stacked or summed.
//
// Usage: node queries/pull-restorative-caseload-split.js [startDate] [endDate]
const { query } = require("../fabric-query");

const START = process.argv[2] || "2025-10-01";
const END = process.argv[3] || "2026-08-01";

// Bronze lands NetHealth varbinary GUID Ids in two encodings and they do not join. Normalize.
const guidKey = (c) =>
  `UPPER(CASE WHEN DATALENGTH(${c}) = 36 THEN CAST(${c} AS varchar(36))` +
  ` ELSE LEFT(CONVERT(varchar(32), ${c}, 2), 8) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 9, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 13, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 17, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 21, 12) END)`;

const sql = `
WITH Svc AS (SELECT Category, ${guidKey("Id")} AS GuidKey
             FROM PatientLevelOptionalServices.Service),
Rest AS (
  SELECT rr.Facility_ID, p.Resident_ID, CAST(p.CreatedDate AS date) AS SvcDate, p.Duration
  FROM (SELECT Resident_ID, CreatedDate, Duration, ${guidKey("Service_ID")} AS GuidKey
        FROM PatientLevelOptionalServices.Instance
        WHERE CreatedDate >= '${START}' AND CreatedDate < '${END}') p
  JOIN Svc s ON s.GuidKey = p.GuidKey
  JOIN dbo.Resident rr ON rr.Resident_ID = p.Resident_ID
  WHERE s.Category = 'Nursing Restorative'
),
Cases AS (
  SELECT st.Resident_ID, CAST(pc.StartDate AS date) AS S,
         CAST(ISNULL(pc.EndDate, '2099-12-31') AS date) AS E
  FROM dbo.PatientCase pc
  JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
  WHERE ISNULL(pc.IsDeletedCase, 0) = 0
),
-- classify BEFORE grouping: an EXISTS in a GROUP BY list is rejected outright
Tagged AS (
  SELECT r.Resident_ID, r.Duration, FORMAT(r.SvcDate, 'yyyy-MM') AS Mo,
         CASE WHEN EXISTS (SELECT 1 FROM Cases c
                           WHERE c.Resident_ID = r.Resident_ID
                             AND r.SvcDate BETWEEN c.S AND c.E)
              THEN 'on caseload' ELSE 'not on caseload' END AS Bucket
  FROM Rest r
)
SELECT Mo, Bucket,
       COUNT(DISTINCT Resident_ID) AS Residents,
       SUM(CAST(Duration AS bigint)) AS Minutes
FROM Tagged
GROUP BY Mo, Bucket
ORDER BY Mo, Bucket`;

const n = (x) => Number(x).toLocaleString();

query(sql, "bronze").then((r) => {
  const rows = r.recordset;
  const months = [...new Set(rows.map((x) => x.Mo))].sort();
  const get = (mo, b) => rows.find((x) => x.Mo === mo && x.Bucket === b);

  console.log(`\nRestorative minutes by month, on vs off therapy caseload`);
  console.log(`${START} to ${END}. Minutes partition; resident counts overlap.\n`);
  console.log("Month".padEnd(9) + "Off-caseload".padStart(14) + "On-caseload".padStart(13) +
              "Off %".padStart(8) + "  (off res / on res)");
  console.log("-".repeat(64));
  let tOff = 0, tOn = 0;
  for (const mo of months) {
    const off = get(mo, "not on caseload"), on = get(mo, "on caseload");
    const ov = off ? Number(off.Minutes) : 0, nv = on ? Number(on.Minutes) : 0;
    tOff += ov; tOn += nv;
    console.log(String(mo).padEnd(9) + n(ov).padStart(14) + n(nv).padStart(13) +
      `${((ov / (ov + nv)) * 100).toFixed(1)}%`.padStart(8) +
      `   ${off ? off.Residents : 0} / ${on ? on.Residents : 0}`);
  }
  console.log("-".repeat(64));
  console.log("TOTAL".padEnd(9) + n(tOff).padStart(14) + n(tOn).padStart(13) +
    `${((tOff / (tOff + tOn)) * 100).toFixed(1)}%`.padStart(8));

  console.log("\nCSV (chart input, minutes):");
  console.log("Mo,OffCaseload,OnCaseload");
  for (const mo of months) {
    const off = get(mo, "not on caseload"), on = get(mo, "on caseload");
    console.log(`${mo},${off ? off.Minutes : 0},${on ? on.Minutes : 0}`);
  }
});
