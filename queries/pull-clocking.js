// Clocking timeliness per therapist (recreates IT's "Clocked" sheet from Fabric).
// EXPLORATORY — not yet wired into the eval pipeline, but uses the SAME trailing
// N-complete-calendar-month window (pull-track-base.js) so it can be folded in later.
//
// Metric (matches the on-prem NHReplication.dbo.vw_LateClocker the PBIX reads):
//   NumberOfDaysLate = BUSINESS days between LaborDate (work date) and CreatedDate
//                      (when the labor entry was clocked) — weekends AND the
//                      US-federal holidays in HOLIDAYS[] below are excluded.
//   On time          = 0 business days late.
//   Rating           = Pass if % on time >= 92.8%, else Fail.
//
// Source = Bronze dbo.Labor (the conformed Silver `labor` DROPS CreatedDate, so the
// raw Bronze table is required). Identity (EmployeeNumber, name) is joined in JS from
// Silver dbo.employee on NetHealthId = Labor.Person_ID — Bronze and Silver are on
// different endpoint hosts, so they CANNOT be joined in one query (see fabric-workflow).
//
// Usage: node queries/pull-clocking.js [--years N] [--out path]

const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

// US federal holidays (observed). Only dates that fall on a weekday and land between a
// LaborDate and its CreatedDate ever matter, so a few years' coverage is plenty. Edit
// this list if Aegis observes a different calendar — it's the one real assumption here.
const HOLIDAYS = [
  // 2024
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-05-27", "2024-06-19", "2024-07-04",
  "2024-09-02", "2024-10-14", "2024-11-11", "2024-11-28", "2024-12-25",
  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-05-26", "2025-06-19", "2025-07-04",
  "2025-09-01", "2025-10-13", "2025-11-11", "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03",
  "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-18", "2027-07-05",
  "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24",
];

function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1;
  let out = path.join(__dirname, "..", "data", "clocking.csv");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--years" && a[i + 1]) years = parseInt(a[++i], 10);
    else if (a[i] === "--out" && a[i + 1]) out = a[++i];
  }
  return { years, out };
}

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

// Trailing N COMPLETE calendar months, identical bounds to pull-track-base.js:
//   lower = first-of-current-month, N years back (inclusive)
//   upper = first-of-current-month (exclusive)  -> excludes the partial current month
function boundsCte(years) {
  return `DECLARE @HI date = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
DECLARE @LO date = DATEADD(YEAR, -${years}, @HI);`;
}

function holCte() {
  const vals = HOLIDAYS.map((d) => `('${d}')`).join(", ");
  return `hol AS (SELECT CAST(d AS date) AS HolDate FROM (VALUES ${vals}) AS t(d))`;
}

const clockSql = (years) => `${boundsCte(years)}
;WITH ${holCte()},
base AS (
  SELECT Person_ID, LaborDate, CreatedDate,
         DATEDIFF(day, LaborDate, CreatedDate)
           - (DATEDIFF(week, LaborDate, CreatedDate) * 2)
           - (CASE WHEN DATENAME(weekday, LaborDate)  = 'Sunday'   THEN 1 ELSE 0 END)
           - (CASE WHEN DATENAME(weekday, CreatedDate) = 'Saturday' THEN 1 ELSE 0 END) AS WkLate
  FROM dbo.Labor
  WHERE LaborDate >= @LO AND LaborDate < @HI
    AND ISNULL(IsInactive, 0) = 0 AND Person_ID IS NOT NULL AND CreatedDate IS NOT NULL
),
adj AS (
  SELECT Person_ID,
         b.WkLate - (SELECT COUNT(*) FROM hol h
                     WHERE h.HolDate > b.LaborDate AND h.HolDate <= b.CreatedDate
                       AND DATENAME(weekday, h.HolDate) NOT IN ('Saturday', 'Sunday')) AS BizLate
  FROM base b
)
SELECT Person_ID,
       COUNT(*)                                            AS Entries,
       AVG(CAST(BizLate AS float))                         AS AvgDaysLate,
       AVG(CASE WHEN BizLate <= 0 THEN 1.0 ELSE 0 END)     AS PctOnTime
FROM adj
GROUP BY Person_ID`;

const empSql = `SELECT NetHealthId, EmployeeNumber, FirstName, LastName, Status
FROM dbo.employee
WHERE NetHealthId IS NOT NULL AND EmployeeNumber IS NOT NULL`;

(async () => {
  const { years, out } = parseArgs();
  console.error(`clocking pull: labor in trailing ${years} complete-calendar-yr(s) (excl current month)`);
  const t0 = Date.now();

  const agg = (await query(clockSql(years), "bronze")).recordset;
  const emp = (await query(empSql, "silver")).recordset;
  console.error(`bronze person-aggregates: ${agg.length} | silver employees: ${emp.length} in ${Math.round((Date.now() - t0) / 1000)}s`);

  // NetHealthId -> employee (prefer an Active record if a NetHealthId has duplicates)
  const byNh = new Map();
  for (const e of emp) {
    const prev = byNh.get(e.NetHealthId);
    if (!prev || (e.Status === "Active" && prev.Status !== "Active")) byNh.set(e.NetHealthId, e);
  }

  // Fold person-grain aggregates up to EmployeeNumber (weighted by entry count), so a
  // shared/duplicate NetHealthId doesn't split a therapist into two rows.
  const byEmp = new Map();
  let unmatched = 0;
  for (const r of agg) {
    const e = byNh.get(r.Person_ID);
    if (!e) { unmatched++; continue; }
    let acc = byEmp.get(e.EmployeeNumber);
    if (!acc) {
      acc = { EmployeeId: e.EmployeeNumber, Therapist: `${e.LastName}, ${e.FirstName}`,
              FirstName: e.FirstName, LastName: e.LastName, _entries: 0, _onTime: 0, _late: 0 };
      byEmp.set(e.EmployeeNumber, acc);
    }
    acc._entries += r.Entries;
    acc._onTime += r.PctOnTime * r.Entries;
    acc._late += r.AvgDaysLate * r.Entries;
  }

  const rows = [...byEmp.values()].map((a) => {
    const pct = a._entries ? a._onTime / a._entries : 0;
    return {
      EmployeeId: a.EmployeeId,
      Therapist: a.Therapist,
      FirstName: a.FirstName,
      LastName: a.LastName,
      AvgDaysLate: a._entries ? +(a._late / a._entries).toFixed(4) : 0,
      PctOnTime: +pct.toFixed(4),
      Entries: a._entries,
      PerformancePlanRating: pct >= 0.928 ? "Pass" : "Fail",
    };
  }).sort((x, y) => x.Therapist.localeCompare(y.Therapist));

  fs.writeFileSync(out, toCsv(rows));
  console.error(`wrote ${rows.length} therapists -> ${out} (${unmatched} person-rows had no employee match)`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
