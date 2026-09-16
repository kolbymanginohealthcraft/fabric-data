// Total care minutes on DAWN'S definition, year over year.
//
// Dawn's definition of total care (2026-07-27 call): restorative + rehab tech + skilled
// therapy. EXCLUDE screens and wellness (wellness is private-pay, therapist-delivered,
// noisier). pull-total-care.js only counted Nursing Restorative, so its 17% UNDERSTATES
// total care against Dawn's own definition. This closes that gap and adds the prior-year
// comparison she asked for (Jan 1 forward, same period both years -- explicitly not Nov 1,
// since Nov/Dec 2025 volume was too low).
//
// Scope: facilities that logged restorative in EITHER year, so the denominator is stable
// across the comparison instead of shifting with the program rollout.
//
// Usage: node queries/pull-total-care-yoy.js
const { query } = require("../fabric-query");

const PERIODS = [
  { label: "Jan 1 - Jul 31, 2025", start: "2025-01-01", end: "2025-08-01" },
  { label: "Jan 1 - Jul 31, 2026", start: "2026-01-01", end: "2026-08-01" },
];
const CATS = ["Nursing Restorative", "Rehab Tech"];

// Bronze lands NetHealth varbinary GUID Ids in two encodings and they do not join. Normalize.
const guidKey = (c) =>
  `UPPER(CASE WHEN DATALENGTH(${c}) = 36 THEN CAST(${c} AS varchar(36))` +
  ` ELSE LEFT(CONVERT(varchar(32), ${c}, 2), 8) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 9, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 13, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 17, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 21, 12) END)`;

const catList = CATS.map((c) => `'${c}'`).join(",");
const OUTER_START = PERIODS[0].start;
const OUTER_END = PERIODS[PERIODS.length - 1].end;

const sql = `
WITH Svc AS (SELECT Category, ${guidKey("Id")} AS GuidKey
             FROM PatientLevelOptionalServices.Service),
Plos AS (
  SELECT rr.Facility_ID, p.Resident_ID, CAST(p.CreatedDate AS date) AS SvcDate,
         p.Duration, s.Category
  FROM (SELECT Resident_ID, CreatedDate, Duration, ${guidKey("Service_ID")} AS GuidKey
        FROM PatientLevelOptionalServices.Instance
        WHERE CreatedDate >= '${OUTER_START}' AND CreatedDate < '${OUTER_END}') p
  JOIN Svc s ON s.GuidKey = p.GuidKey
  JOIN dbo.Resident rr ON rr.Resident_ID = p.Resident_ID
  WHERE s.Category IN (${catList})
),
-- facilities that ran restorative in EITHER year: a stable denominator across the comparison
RestFac AS (SELECT DISTINCT Facility_ID FROM Plos WHERE Category = 'Nursing Restorative'),
Ther AS (
  SELECT rr.Facility_ID, st.Resident_ID, CAST(ts.SessionDate AS date) AS SvcDate,
         m.Duration, 'Skilled therapy' AS Category
  FROM dbo.TxMinute m
  JOIN dbo.TxSession ts ON ts.TxSession_ID = m.TxSession_ID AND ISNULL(ts.IsDeletedSession,0)=0
  JOIN dbo.TxTrack tt ON tt.TxTrack_ID = ts.TxTrack_ID AND ISNULL(tt.IsDeletedTrack,0)=0
  JOIN dbo.PatientCase pc ON pc.PatientCase_ID = tt.PatientCase_ID
                          AND ISNULL(pc.IsDeletedCase,0)=0
  JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
  JOIN dbo.Resident rr ON rr.Resident_ID = st.Resident_ID
  WHERE ts.SessionDate >= '${OUTER_START}' AND ts.SessionDate < '${OUTER_END}'
),
All_ AS (
  SELECT Facility_ID, Resident_ID, SvcDate, Duration, Category FROM Plos
  UNION ALL
  SELECT Facility_ID, Resident_ID, SvcDate, Duration, Category FROM Ther
),
Tagged AS (
  SELECT a.*, CASE ${PERIODS.map((p) => `WHEN a.SvcDate >= '${p.start}' AND a.SvcDate < '${p.end}' THEN '${p.label}'`).join(" ")}
              END AS Period
  FROM All_ a
  WHERE a.Facility_ID IN (SELECT Facility_ID FROM RestFac)
)
SELECT Period, Category,
       COUNT(DISTINCT Facility_ID) AS Facilities,
       COUNT(DISTINCT Resident_ID) AS Residents,
       SUM(CAST(Duration AS bigint)) AS Minutes
FROM Tagged WHERE Period IS NOT NULL
GROUP BY Period, Category ORDER BY Period, Category`;

const n = (x) => Number(x).toLocaleString();

query(sql, "bronze").then((r) => {
  const rows = r.recordset;
  console.log("\nTotal care minutes on Dawn's definition (restorative + rehab tech + skilled)");
  console.log("Scope: facilities that ran restorative in either year. Screens/wellness excluded.\n");

  const totals = {};
  for (const p of PERIODS) {
    const sub = rows.filter((x) => x.Period === p.label);
    if (!sub.length) continue;
    const tot = sub.reduce((a, x) => a + Number(x.Minutes), 0);
    totals[p.label] = { tot, sub };
    console.log(`=== ${p.label} ===`);
    console.log("Category".padEnd(22) + "Residents".padStart(11) + "Minutes".padStart(14) +
                "Share".padStart(9));
    console.log("-".repeat(56));
    for (const x of sub.sort((a, b) => Number(b.Minutes) - Number(a.Minutes)))
      console.log(String(x.Category).padEnd(22) + n(x.Residents).padStart(11) +
        n(x.Minutes).padStart(14) + ((Number(x.Minutes) / tot) * 100).toFixed(1).padStart(8) + "%");
    console.log("-".repeat(56));
    console.log("TOTAL CARE".padEnd(22) + n(tot).padStart(25));
    const nonSkilled = sub.filter((x) => x.Category !== "Skilled therapy")
      .reduce((a, x) => a + Number(x.Minutes), 0);
    console.log(`  non-skilled (restorative + rehab tech) = ` +
      `${((nonSkilled / tot) * 100).toFixed(1)}%\n`);
  }

  // year over year per category
  const [y1, y2] = PERIODS.map((p) => p.label);
  if (totals[y1] && totals[y2]) {
    console.log("=== year over year ===");
    const cats = [...new Set(rows.map((x) => x.Category))];
    for (const c of cats) {
      const a = totals[y1].sub.find((x) => x.Category === c);
      const b = totals[y2].sub.find((x) => x.Category === c);
      if (!a || !b) continue;
      const av = Number(a.Minutes), bv = Number(b.Minutes);
      console.log(`  ${String(c).padEnd(22)}${n(av).padStart(13)} -> ${n(bv).padStart(13)}` +
        `  ${(((bv / av) - 1) * 100 >= 0 ? "+" : "")}${(((bv / av) - 1) * 100).toFixed(1)}%`);
    }
    const t1 = totals[y1].tot, t2 = totals[y2].tot;
    console.log(`  ${"TOTAL CARE".padEnd(22)}${n(t1).padStart(13)} -> ${n(t2).padStart(13)}` +
      `  ${(((t2 / t1) - 1) * 100 >= 0 ? "+" : "")}${(((t2 / t1) - 1) * 100).toFixed(1)}%`);
  }
  console.log();
});
