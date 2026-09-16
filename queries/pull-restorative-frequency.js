// How OFTEN restorative touches a resident, not just whether it did.
//
// The slide says we touch 23% more residents "in a typical month". That figure is a PRESENCE
// measure: residents with any restorative in a month and no therapy that month, over the
// therapy population. Presence alone does not license the word "often" -- one 30-minute visit
// in July would satisfy it. This query supplies the frequency evidence that does:
//
//   1. days per resident per month           -- how often within a month
//   2. months per resident out of 7          -- whether it persists across months
//   3. share of residents seen in 4+ months  -- is the recurring pattern the norm or the tail
//
// Scope: facilities running Nursing Restorative in the window. Rehab tech excluded.
//
// Usage: node queries/pull-restorative-frequency.js [startDate] [endDate]
const { query } = require("../fabric-query");

const START = process.argv[2] || "2026-01-01";
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
  SELECT p.Resident_ID, CAST(p.CreatedDate AS date) AS SvcDate,
         FORMAT(p.CreatedDate, 'yyyy-MM') AS Mo, p.Duration
  FROM (SELECT Resident_ID, CreatedDate, Duration, ${guidKey("Service_ID")} AS GuidKey
        FROM PatientLevelOptionalServices.Instance
        WHERE CreatedDate >= '${START}' AND CreatedDate < '${END}') p
  JOIN Svc s ON s.GuidKey = p.GuidKey
  WHERE s.Category = 'Nursing Restorative'
),
-- one row per resident-month: how many distinct days and minutes in that month
ResMonth AS (
  SELECT Resident_ID, Mo, COUNT(DISTINCT SvcDate) AS Days,
         SUM(CAST(Duration AS bigint)) AS Minutes
  FROM Rest GROUP BY Resident_ID, Mo
),
-- one row per resident: how many months they appear in at all
ResSpan AS (
  SELECT Resident_ID, COUNT(*) AS Months, SUM(Days) AS TotDays, SUM(Minutes) AS TotMinutes
  FROM ResMonth GROUP BY Resident_ID
)
SELECT
  (SELECT COUNT(*) FROM ResSpan) AS Residents,
  (SELECT COUNT(*) FROM ResMonth) AS ResidentMonths,
  (SELECT AVG(CAST(Days AS float)) FROM ResMonth) AS AvgDaysPerResMonth,
  (SELECT AVG(CAST(Minutes AS float)) FROM ResMonth) AS AvgMinPerResMonth,
  (SELECT AVG(CAST(Months AS float)) FROM ResSpan) AS AvgMonthsPerRes,
  (SELECT AVG(CAST(TotDays AS float)) FROM ResSpan) AS AvgTotDays,
  (SELECT AVG(CAST(TotMinutes AS float)) / 60 FROM ResSpan) AS AvgTotHours,
  (SELECT COUNT(*) FROM ResSpan WHERE Months = 1) AS One,
  (SELECT COUNT(*) FROM ResSpan WHERE Months BETWEEN 2 AND 3) AS TwoThree,
  (SELECT COUNT(*) FROM ResSpan WHERE Months >= 4) AS FourPlus,
  (SELECT COUNT(*) FROM ResMonth WHERE Days = 1) AS OneDayMonths,
  (SELECT COUNT(*) FROM ResMonth WHERE Days >= 4) AS FourDayMonths`;

const f = (x, d = 1) => Number(x).toFixed(d);
const n = (x) => Number(x).toLocaleString();

query(sql, "bronze").then((r) => {
  const x = r.recordset[0];
  const res = Number(x.Residents), rm = Number(x.ResidentMonths);
  console.log(`\nHow often restorative touches a resident, ${START} to ${END}\n`);
  console.log(`residents receiving restorative      ${n(res)}`);
  console.log(`resident-months of care              ${n(rm)}\n`);
  console.log(`WITHIN a month:`);
  console.log(`  days of care per resident-month    ${f(x.AvgDaysPerResMonth)}`);
  console.log(`  minutes per resident-month         ${f(x.AvgMinPerResMonth, 0)}`);
  console.log(`  resident-months with only 1 day    ${n(x.OneDayMonths)}` +
              `  (${f((Number(x.OneDayMonths) / rm) * 100)}%)`);
  console.log(`  resident-months with 4+ days       ${n(x.FourDayMonths)}` +
              `  (${f((Number(x.FourDayMonths) / rm) * 100)}%)\n`);
  console.log(`ACROSS months (7 possible):`);
  console.log(`  months per resident                ${f(x.AvgMonthsPerRes)}`);
  console.log(`  total days per resident            ${f(x.AvgTotDays)}`);
  console.log(`  total hours per resident           ${f(x.AvgTotHours)}`);
  console.log(`  seen in 1 month only               ${n(x.One)}` +
              `  (${f((Number(x.One) / res) * 100)}%)`);
  console.log(`  seen in 2 to 3 months              ${n(x.TwoThree)}` +
              `  (${f((Number(x.TwoThree) / res) * 100)}%)`);
  console.log(`  seen in 4+ months                  ${n(x.FourPlus)}` +
              `  (${f((Number(x.FourPlus) / res) * 100)}%)\n`);
  console.log(`Read: "often" is defensible only if days-per-resident-month is well above 1`);
  console.log(`and a large share of residents recur across several months.\n`);
});
