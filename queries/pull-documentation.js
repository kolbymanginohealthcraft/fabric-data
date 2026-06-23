// Documentation timeliness per therapist (recreates IT's "Documentation" sheet from Fabric).
// EXPLORATORY — not yet wired into the eval pipeline, but uses the SAME trailing
// N-complete-calendar-month window (pull-track-base.js) so it can be folded in later.
//
// Metric (best-fit reconstruction; the authoritative on-prem view was not reachable):
//   A "document" = any dbo.TxDocument the therapist authored EXCEPT discharge summaries
//                  (DocumentType <> 'DISCH'), completed, with a service date (FromDate).
//                  Includes TEN daily encounter notes (the bulk), PR, RECERT, EVAL.
//   Days Late    = CALENDAR days between FromDate (service/period date) and CompletedDate.
//   On time      = 0 BUSINESS days late (FromDate -> CompletedDate, weekends excluded).
//   Rating 1-5   = 5:100%  4:97-99.99%  3:80-96.98%  2:50-79.99%  1:0-49.99%  (% on time)
//
// Attribution: TxDocument.ModifiedBy = Silver employee.Username. TEN daily notes carry a
// NULL Person_ID, so ModifiedBy is the only field that captures them; this slightly
// over-counts for supervisors who modify staff notes, but the RATING keys off the rate,
// not the count, so ratings still reproduce ~90% exact / ~98% within one band.
// Bronze (TxDocument) and Silver (employee) are different hosts -> joined in JS.
//
// Usage: node queries/pull-documentation.js [--years N] [--out path]

const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1;
  let out = path.join(__dirname, "..", "data", "documentation.csv");
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

// % on time uses BUSINESS days (weekends excluded); the reported Days Late column is
// CALENDAR days — each matches the corresponding workbook column. Window bounds are the
// trailing N-complete-calendar-month bounds from pull-track-base.js, on FromDate.
const docSql = (years) => `DECLARE @HI date = DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
DECLARE @LO date = DATEADD(YEAR, -${years}, @HI);
SELECT ModifiedBy,
       COUNT(*)                                              AS Docs,
       AVG(CAST(DATEDIFF(day, FromDate, CompletedDate) AS float)) AS AvgCalLate,
       AVG(CASE WHEN DATEDIFF(day, FromDate, CompletedDate)
                       - (DATEDIFF(week, FromDate, CompletedDate) * 2)
                       - (CASE WHEN DATENAME(weekday, FromDate)      = 'Sunday'   THEN 1 ELSE 0 END)
                       - (CASE WHEN DATENAME(weekday, CompletedDate) = 'Saturday' THEN 1 ELSE 0 END)
                     <= 0 THEN 1.0 ELSE 0 END)               AS PctOnTime
FROM dbo.TxDocument
WHERE FromDate >= @LO AND FromDate < @HI
  AND ISNULL(IsInactive, 0) = 0
  AND DocumentType <> 'DISCH'
  AND FromDate IS NOT NULL AND CompletedDate IS NOT NULL AND ModifiedBy IS NOT NULL
GROUP BY ModifiedBy`;

const empSql = `SELECT Username, EmployeeNumber, FirstName, LastName, Status
FROM dbo.employee
WHERE Username IS NOT NULL AND EmployeeNumber IS NOT NULL`;

function docRating(pct) {
  const p = pct * 100;
  if (p >= 100) return 5;
  if (p >= 97) return 4;   // 96.99 - 99.99
  if (p >= 80) return 3;   // 80 - 96.98
  if (p >= 50) return 2;   // 50 - 79.99
  return 1;                // 0 - 49.99
}

(async () => {
  const { years, out } = parseArgs();
  console.error(`documentation pull: docs (FromDate) in trailing ${years} complete-calendar-yr(s) (excl current month)`);
  const t0 = Date.now();

  const agg = (await query(docSql(years), "bronze")).recordset;
  const emp = (await query(empSql, "silver")).recordset;
  console.error(`bronze username-aggregates: ${agg.length} | silver employees: ${emp.length} in ${Math.round((Date.now() - t0) / 1000)}s`);

  // Username -> employee (prefer Active on duplicates)
  const byUser = new Map();
  for (const e of emp) {
    const prev = byUser.get(e.Username);
    if (!prev || (e.Status === "Active" && prev.Status !== "Active")) byUser.set(e.Username, e);
  }

  // Fold username-grain up to EmployeeNumber (weighted by doc count).
  const byEmp = new Map();
  let unmatched = 0;
  for (const r of agg) {
    const e = byUser.get(r.ModifiedBy);
    if (!e) { unmatched++; continue; }
    let acc = byEmp.get(e.EmployeeNumber);
    if (!acc) {
      acc = { EmployeeNo: e.EmployeeNumber, Therapist: `${e.LastName}, ${e.FirstName}`,
              FirstName: e.FirstName, LastName: e.LastName, _docs: 0, _onTime: 0, _late: 0 };
      byEmp.set(e.EmployeeNumber, acc);
    }
    acc._docs += r.Docs;
    acc._onTime += r.PctOnTime * r.Docs;
    acc._late += r.AvgCalLate * r.Docs;
  }

  const rows = [...byEmp.values()].map((a) => {
    const pct = a._docs ? a._onTime / a._docs : 0;
    return {
      EmployeeNo: a.EmployeeNo,
      Therapist: a.Therapist,
      FirstName: a.FirstName,
      LastName: a.LastName,
      NumberOfDocuments: a._docs,
      PctOnTime: +pct.toFixed(4),
      PerformanceRating: docRating(pct),
      DaysLate: a._docs ? +(a._late / a._docs).toFixed(4) : 0,
    };
  }).sort((x, y) => x.Therapist.localeCompare(y.Therapist));

  fs.writeFileSync(out, toCsv(rows));
  console.error(`wrote ${rows.length} therapists -> ${out} (${unmatched} username-rows had no employee match)`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
