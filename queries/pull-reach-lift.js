// How many MORE residents our care touches because of restorative.
//
// The slide claim is "restorative lets us touch X% more residents." The only honest form of
// that is a count of residents restorative reached who skilled therapy did NOT reach in the
// same window, over the skilled therapy population:
//
//     lift = residents with restorative and NO therapy  /  residents with therapy
//
// Note this is NOT the same as the 74% off-caseload minutes figure. Off-caseload means "no
// open therapy case on the DAY of service", so a resident with therapy in March and
// restorative in June counts as off-caseload but was still touched by therapy that window and
// therefore adds nothing to reach. This query only counts residents therapy never saw at all.
//
// CAVEAT, state it if the figure is challenged: the window bounds the therapy side too. A
// resident whose therapy episode ended in Dec 2025 counts here as restorative-only, because
// within Jan to Jul 2026 that is what they were. It is a reach claim about the period, not a
// claim that we had never treated the person.
//
// Scope: facilities that logged Nursing Restorative in the 2026 window (the "52 facilities"
// the deck cites). Rehab tech excluded, so this is restorative against skilled therapy only.
//
// Usage: node queries/pull-reach-lift.js
const { query } = require("../fabric-query");

const PERIODS = [
  { label: "Jan 1 - Jul 31, 2025", start: "2025-01-01", end: "2025-08-01" },
  { label: "Jan 1 - Jul 31, 2026", start: "2026-01-01", end: "2026-08-01" },
];

// Bronze lands NetHealth varbinary GUID Ids in two encodings and they do not join. Normalize.
const guidKey = (c) =>
  `UPPER(CASE WHEN DATALENGTH(${c}) = 36 THEN CAST(${c} AS varchar(36))` +
  ` ELSE LEFT(CONVERT(varchar(32), ${c}, 2), 8) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 9, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 13, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 17, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 21, 12) END)`;

const OUTER_START = PERIODS[0].start;
const OUTER_END = PERIODS[PERIODS.length - 1].end;
const REST_START = PERIODS[PERIODS.length - 1].start;

const sql = `
WITH Svc AS (SELECT Category, ${guidKey("Id")} AS GuidKey
             FROM PatientLevelOptionalServices.Service),
Plos AS (
  SELECT rr.Facility_ID, p.Resident_ID, CAST(p.CreatedDate AS date) AS SvcDate,
         'Nursing Restorative' AS Category
  FROM (SELECT Resident_ID, CreatedDate, ${guidKey("Service_ID")} AS GuidKey
        FROM PatientLevelOptionalServices.Instance
        WHERE CreatedDate >= '${OUTER_START}' AND CreatedDate < '${OUTER_END}') p
  JOIN Svc s ON s.GuidKey = p.GuidKey
  JOIN dbo.Resident rr ON rr.Resident_ID = p.Resident_ID
  WHERE s.Category = 'Nursing Restorative'
),
-- the 52 buildings: those running restorative in the CURRENT window
RestFac AS (SELECT DISTINCT Facility_ID FROM Plos
            WHERE SvcDate >= '${REST_START}' AND SvcDate < '${OUTER_END}'),
Ther AS (
  SELECT rr.Facility_ID, st.Resident_ID, CAST(ts.SessionDate AS date) AS SvcDate,
         'Skilled therapy' AS Category
  FROM dbo.TxSession ts
  JOIN dbo.TxTrack tt ON tt.TxTrack_ID = ts.TxTrack_ID AND ISNULL(tt.IsDeletedTrack,0)=0
  JOIN dbo.PatientCase pc ON pc.PatientCase_ID = tt.PatientCase_ID
                          AND ISNULL(pc.IsDeletedCase,0)=0
  JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
  JOIN dbo.Resident rr ON rr.Resident_ID = st.Resident_ID
  WHERE ts.SessionDate >= '${OUTER_START}' AND ts.SessionDate < '${OUTER_END}'
    AND ISNULL(ts.IsDeletedSession,0) = 0
),
All_ AS (
  SELECT Facility_ID, Resident_ID, SvcDate, Category FROM Plos
  UNION ALL
  SELECT Facility_ID, Resident_ID, SvcDate, Category FROM Ther
),
Tagged AS (
  SELECT a.Resident_ID, a.Category,
         CASE ${PERIODS.map((p) => `WHEN a.SvcDate >= '${p.start}' AND a.SvcDate < '${p.end}' THEN '${p.label}'`).join(" ")}
         END AS Period
  FROM All_ a
  WHERE a.Facility_ID IN (SELECT Facility_ID FROM RestFac)
),
-- one row per resident per period, carrying which kinds of care they received
Flags AS (
  SELECT Period, Resident_ID,
         MAX(CASE WHEN Category = 'Skilled therapy' THEN 1 ELSE 0 END) AS HasTher,
         MAX(CASE WHEN Category = 'Nursing Restorative' THEN 1 ELSE 0 END) AS HasRest
  FROM Tagged WHERE Period IS NOT NULL
  GROUP BY Period, Resident_ID
)
SELECT Period,
       SUM(HasTher) AS TherapyRes,
       SUM(HasRest) AS RestRes,
       SUM(CASE WHEN HasRest = 1 AND HasTher = 0 THEN 1 ELSE 0 END) AS RestOnlyRes,
       SUM(CASE WHEN HasRest = 1 AND HasTher = 1 THEN 1 ELSE 0 END) AS BothRes,
       COUNT(*) AS AnyCareRes
FROM Flags GROUP BY Period ORDER BY Period`;

// Same thing at monthly grain. Reuses the identical CTE chain; only the grouping key changes.
const monthlySql = sql
  .replace(
    /SELECT Period,\s+SUM\(HasTher\)[\s\S]*$/,
    `SELECT Period AS Mo,
       SUM(HasTher) AS TherapyRes,
       SUM(HasRest) AS RestRes,
       SUM(CASE WHEN HasRest = 1 AND HasTher = 0 THEN 1 ELSE 0 END) AS RestOnlyRes,
       SUM(CASE WHEN HasRest = 1 AND HasTher = 1 THEN 1 ELSE 0 END) AS BothRes,
       COUNT(*) AS AnyCareRes
FROM Flags GROUP BY Period ORDER BY Period`)
  // swap the period label for the service month, so Flags groups by month instead
  .replace(
    /CASE WHEN a\.SvcDate[\s\S]*?END AS Period/,
    "FORMAT(a.SvcDate, 'yyyy-MM') AS Period")
  .replace("WHERE a.Facility_ID IN (SELECT Facility_ID FROM RestFac)",
           `WHERE a.Facility_ID IN (SELECT Facility_ID FROM RestFac)
    AND a.SvcDate >= '${REST_START}'`);

const n = (x) => Number(x).toLocaleString();

query(sql, "bronze").then((r) => {
  console.log("\nReach lift: residents restorative touched that skilled therapy did not");
  console.log("Facilities running restorative in the 2026 window. Rehab tech excluded.\n");
  console.log("Period".padEnd(23) + "Therapy".padStart(10) + "Restor.".padStart(10) +
              "Rest only".padStart(11) + "Both".padStart(9) + "Any care".padStart(10) +
              "LIFT".padStart(9));
  console.log("-".repeat(82));
  for (const x of r.recordset) {
    const t = Number(x.TherapyRes), ro = Number(x.RestOnlyRes);
    console.log(String(x.Period).padEnd(23) + n(t).padStart(10) +
      n(x.RestRes).padStart(10) + n(ro).padStart(11) + n(x.BothRes).padStart(9) +
      n(x.AnyCareRes).padStart(10) + `+${((ro / t) * 100).toFixed(1)}%`.padStart(9));
  }
  console.log("-".repeat(82));
  console.log("LIFT = residents reached ONLY by restorative, as a % of the therapy population.");
  console.log("It is the answer to \"our care touches X% more residents\".\n");
  return query(monthlySql, "bronze");
}).then((r) => {
  // Same measure at MONTHLY grain. It runs higher than the seven-month figure, and the reason
  // is structural rather than flattering: skilled therapy is episodic, so in any single month
  // it only touches the residents whose episode is open. Over seven months most restorative
  // residents eventually appear in the therapy set too. Both numbers are true; they answer
  // different questions, and the grain has to be stated with whichever one is used.
  console.log("Same measure, MONTH BY MONTH (residents touched in that month only)\n");
  console.log("Month".padEnd(10) + "Therapy".padStart(10) + "Rest only".padStart(11) +
              "Both".padStart(9) + "Any care".padStart(10) + "LIFT".padStart(9));
  console.log("-".repeat(59));
  const live = r.recordset.filter((x) => Number(x.RestOnlyRes) + Number(x.BothRes) > 200);
  for (const x of r.recordset) {
    const t = Number(x.TherapyRes), ro = Number(x.RestOnlyRes);
    console.log(String(x.Mo).padEnd(10) + n(t).padStart(10) + n(ro).padStart(11) +
      n(x.BothRes).padStart(9) + n(x.AnyCareRes).padStart(10) +
      `+${((ro / t) * 100).toFixed(1)}%`.padStart(9));
  }
  if (live.length) {
    const t = live.reduce((a, x) => a + Number(x.TherapyRes), 0);
    const ro = live.reduce((a, x) => a + Number(x.RestOnlyRes), 0);
    console.log("-".repeat(59));
    console.log(`Average across the ${live.length} fully live months: +${((ro / t) * 100).toFixed(1)}%\n`);
  }
});
