// Monthly restorative reach: residents, facilities and minutes per month.
//
// This is the source for the "residents receiving restorative each month" chart on the
// Total Care Through Transitions slide, so it needs to stay reproducible.
//
// The series shows the rollout as a hard step rather than a ramp: Mar-Sep 2025 is the pilot
// (27-73 residents in 1-2 buildings), then Oct 2025 jumps to 912 residents across 41
// buildings and keeps climbing to 1,569 across 52 by Jul 2026. Still growing, which is a
// more useful point than the step itself.
//
// Usage: node queries/pull-restorative-monthly.js [startDate] [endDate]
const { query } = require("../fabric-query");

const START = process.argv[2] || "2025-01-01";
const END = process.argv[3] || "2026-08-01";

// Bronze lands NetHealth varbinary GUID Ids in two encodings (16-byte binary vs the 36-byte
// ASCII text of the GUID string) and they do not join. Normalize both sides.
// See the fabric-workflow skill pitfalls log.
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
Plos AS (
  SELECT rr.Facility_ID, p.Resident_ID, CAST(p.CreatedDate AS date) AS D, p.Duration
  FROM (SELECT Resident_ID, CreatedDate, Duration, ${guidKey("Service_ID")} AS GuidKey
        FROM PatientLevelOptionalServices.Instance
        WHERE CreatedDate >= '${START}' AND CreatedDate < '${END}') p
  JOIN Svc s ON s.GuidKey = p.GuidKey
  JOIN dbo.Resident rr ON rr.Resident_ID = p.Resident_ID
  WHERE s.Category = 'Nursing Restorative'
)
SELECT FORMAT(D, 'yyyy-MM') AS Mo,
       COUNT(DISTINCT Resident_ID) AS Residents,
       COUNT(DISTINCT Facility_ID) AS Facilities,
       SUM(CAST(Duration AS bigint)) AS Minutes
FROM Plos
GROUP BY FORMAT(D, 'yyyy-MM')
ORDER BY Mo`;

const n = (x) => Number(x).toLocaleString();

query(sql, "bronze").then((r) => {
  const rows = r.recordset;
  console.log(`\nNursing Restorative by month, ${START} to ${END}\n`);
  console.log("Month".padEnd(10) + "Residents".padStart(11) + "Facilities".padStart(12) +
              "Minutes".padStart(12));
  console.log("-".repeat(45));
  for (const x of rows) {
    console.log(String(x.Mo).padEnd(10) + n(x.Residents).padStart(11) +
                n(x.Facilities).padStart(12) + n(x.Minutes).padStart(12));
  }
  console.log("\nCSV (chart input):");
  console.log("Mo,Residents,Facilities,Minutes");
  for (const x of rows) {
    console.log(`${x.Mo},${x.Residents},${x.Facilities},${x.Minutes}`);
  }
});
