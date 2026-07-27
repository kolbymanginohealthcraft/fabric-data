// Total Care Through Transitions: total care minutes split three ways.
//
//   1. Therapy                        - all treatment minutes
//   2. Restorative, not on a case     - restorative delivered while the resident had NO open
//                                       therapy case on that date (the "between episodes" touch)
//   3. Restorative, during a case     - restorative delivered while a therapy case was open
//
// Grain is the individual service DATE, not the month: a resident with therapy Jun 1-10 and
// restorative Jun 20 is "not on a case", which a monthly roll-up would wrongly call concurrent.
//
// Minutes partition cleanly and sum to total care minutes. Resident counts are distinct WITHIN
// each bucket and can overlap across buckets (a resident may get restorative both during and
// between episodes), so they deliberately do not sum -- an unduplicated total is printed instead.
//
// Reported under two facility scopes, because the framing changes the story completely:
//   ALL          - every facility with activity in the period
//   RESTORATIVE  - only facilities that logged restorative in the period
// CAVEAT: the RESTORATIVE scope is USAGE-defined, not contract-defined. It means "logged
// restorative activity", not "has a restorative program". A contracted facility that logged
// nothing in the window is excluded. A contract-based cohort needs Salesforce (Aegis_Contract
// service lines); NetHealth has no program flag. Also note NetHealth carries separate facility
// records per service line for the same building (e.g. "Wichita Presbyterian Manor", "... -
// EnerG", "... HAP"), so facility COUNTS are service-line records, not physical sites.
// Resident-level minutes are unaffected: verified by re-resolving identity across facility
// records via SSN, which moved 0 restorative services between buckets.
//
// Usage: node queries/pull-total-care.js [startDate] [endDate]
const { query } = require("../fabric-query");

const START = process.argv[2] || "2026-01-01";
const END = process.argv[3] || "2026-08-01";

// Bronze lands NetHealth GUID varbinary Ids in two encodings (16-byte binary vs the 36-byte
// ASCII text of the GUID string) and they do not join. Normalize both sides. See the
// fabric-workflow skill pitfalls log.
const guidKey = (c) =>
  `UPPER(CASE WHEN DATALENGTH(${c}) = 36 THEN CAST(${c} AS varchar(36))` +
  ` ELSE LEFT(CONVERT(varchar(32), ${c}, 2), 8) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 9, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 13, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 17, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 21, 12) END)`;

const sql = `
WITH Svc AS (
  SELECT Category, ${guidKey("Id")} AS GuidKey
  FROM PatientLevelOptionalServices.Service
),
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
-- Usage-defined restorative cohort: facilities that logged restorative in this period.
RestFacilities AS (SELECT DISTINCT Facility_ID FROM Rest),
-- Every therapy case the resident has ever had, so a restorative service on any date can be
-- tested against it. Open cases (null EndDate) run to a sentinel.
Cases AS (
  SELECT st.Resident_ID, CAST(pc.StartDate AS date) AS StartDate,
         CAST(ISNULL(pc.EndDate, '2099-12-31') AS date) AS EndDate
  FROM dbo.PatientCase pc
  JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
  WHERE ISNULL(pc.IsDeletedCase, 0) = 0
),
RestTagged AS (
  SELECT r.Facility_ID, r.Resident_ID, r.SvcDate, r.Duration,
    CASE WHEN EXISTS (
      SELECT 1 FROM Cases c
      WHERE c.Resident_ID = r.Resident_ID AND r.SvcDate BETWEEN c.StartDate AND c.EndDate
    ) THEN '3. Restorative, during a case' ELSE '2. Restorative, not on a case' END AS Bucket
  FROM Rest r
),
Ther AS (
  SELECT rr.Facility_ID, st.Resident_ID, CAST(ts.SessionDate AS date) AS SvcDate, m.Duration,
         '1. Therapy' AS Bucket
  FROM dbo.TxMinute m
  JOIN dbo.TxSession ts ON ts.TxSession_ID = m.TxSession_ID AND ISNULL(ts.IsDeletedSession, 0) = 0
  JOIN dbo.TxTrack tt ON tt.TxTrack_ID = ts.TxTrack_ID AND ISNULL(tt.IsDeletedTrack, 0) = 0
  JOIN dbo.PatientCase pc ON pc.PatientCase_ID = tt.PatientCase_ID AND ISNULL(pc.IsDeletedCase, 0) = 0
  JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
  JOIN dbo.Resident rr ON rr.Resident_ID = st.Resident_ID
  WHERE ts.SessionDate >= '${START}' AND ts.SessionDate < '${END}'
),
All_ AS (
  SELECT Facility_ID, Resident_ID, SvcDate, Duration, Bucket FROM RestTagged
  UNION ALL
  SELECT Facility_ID, Resident_ID, SvcDate, Duration, Bucket FROM Ther
),
Scoped AS (
  SELECT a.*, 'A. All facilities' AS Scope FROM All_ a
  UNION ALL
  SELECT a.*, 'B. Restorative-program facilities' AS Scope
  FROM All_ a WHERE a.Facility_ID IN (SELECT Facility_ID FROM RestFacilities)
)
SELECT Scope, FORMAT(SvcDate, 'yyyy-MM') AS Mo, Bucket,
       COUNT(DISTINCT Facility_ID) AS Facilities,
       COUNT(DISTINCT Resident_ID) AS Residents,
       COUNT(*) AS Services,
       SUM(CAST(Duration AS bigint)) AS Minutes
FROM Scoped
GROUP BY Scope, FORMAT(SvcDate, 'yyyy-MM'), Bucket
ORDER BY Scope, Mo, Bucket`;

const n = (x) => Number(x).toLocaleString();

query(sql, "bronze").then((r) => {
  const rows = r.recordset;
  const scopes = [...new Set(rows.map((x) => x.Scope))].sort();
  const buckets = [...new Set(rows.map((x) => x.Bucket))].sort();

  console.log(`\nTotal Care Through Transitions — ${START} to ${END}`);
  console.log(`Restorative split by whether a therapy case was open on the service date.`);

  for (const sc of scopes) {
    const scRows = rows.filter((x) => x.Scope === sc);
    const total = scRows.reduce((a, x) => a + Number(x.Minutes), 0);
    const facilities = Math.max(...scRows.map((x) => Number(x.Facilities)));

    console.log(`\n\n=== ${sc} (max ${n(facilities)} in any month) ===\n`);
    console.log(
      "Bucket".padEnd(32) + "Services".padStart(12) + "Minutes".padStart(14) + "Share".padStart(9)
    );
    console.log("-".repeat(67));
    for (const b of buckets) {
      const sub = scRows.filter((x) => x.Bucket === b);
      if (!sub.length) continue;
      const min = sub.reduce((a, x) => a + Number(x.Minutes), 0);
      const svc = sub.reduce((a, x) => a + Number(x.Services), 0);
      console.log(
        b.padEnd(32) + n(svc).padStart(12) + n(min).padStart(14) +
          ((min / total) * 100).toFixed(1).padStart(8) + "%"
      );
    }
    console.log("-".repeat(67));
    console.log("TOTAL CARE MINUTES".padEnd(32) + n(total).padStart(26));

    // Monthly restorative detail: the during-vs-between story over time.
    console.log(`\n  Monthly restorative residents (between / during):`);
    const months = [...new Set(scRows.map((x) => x.Mo))].sort();
    for (const mo of months) {
      const btw = scRows.find((x) => x.Mo === mo && x.Bucket.startsWith("2"));
      const dur = scRows.find((x) => x.Mo === mo && x.Bucket.startsWith("3"));
      console.log(
        `  ${mo}` + n(btw ? btw.Residents : 0).padStart(10) +
          n(dur ? dur.Residents : 0).padStart(10)
      );
    }
  }
  console.log();
});
