// Detect when the restorative model of care actually went live at each facility, from the
// shape of its own PLOS Nursing Restorative volume, and emit data/restorative-golive.csv.
//
// WHY DETECT RATHER THAN ASK: there is no clean rollout date. Dawn's recollection (7 Touchstone
// buildings first, remaining ~14 six months later) does not match the data -- 42 of 53 facilities
// jump to plateau in Nov 2025 together. A single company-wide cutoff would put some buildings
// months into the model and others barely started on the same side of the line.
//
// METHOD: a facility is live in the first month it reaches >= 50% of its own plateau (median of
// its non-zero months) AND holds >= 50% the following month. The month it first shows ANY volume
// is treated as ramp and belongs to NEITHER window -- partial implementation should not pollute
// pre or post.
//
//   PreEndMonth   = month before first activity   (pre  = episodes ENDING on/before its last day)
//   PostStartMonth = go-live + 1                  (post = episodes BEGINNING on/after its 1st day)
//
// RIGHT-CENSORING: post episodes must have room to finish. Track LOS in these facilities runs
// median 17d / p90 65d / p95 86d, so cap post episode START dates ~90 days before the data cutoff
// or long episodes drop out and post silently skews short. This script reports the cap; it does
// not apply it (that belongs to the analysis that consumes this table).
//
// CAVEAT that no date detection can fix: Dawn confirmed Touchstone delivered restorative BEFORE
// PLOS tracking existed, so "pre" means no *recorded* restorative, not none. Biases toward the
// null, so an equal-or-better result survives it. Cross-check against Brad's answer on when PLOS
// collection started at Touchstone.
//
// Usage: node queries/pull-restorative-golive.js
const fs = require("fs");
const path = require("path");
const { query } = require("../fabric-query");

const OUT = path.join(__dirname, "..", "data", "restorative-golive.csv");
const THRESHOLD = 0.5;   // fraction of plateau that counts as "live"
const MIN_POST_MONTHS = 3; // below this, post is too thin to carry outcomes

const guidKey = (c) =>
  `UPPER(CASE WHEN DATALENGTH(${c}) = 36 THEN CAST(${c} AS varchar(36))` +
  ` ELSE LEFT(CONVERT(varchar(32), ${c}, 2), 8) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 9, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 13, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 17, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 21, 12) END)`;

const sql = `
WITH Svc AS (SELECT Category, ${guidKey("Id")} AS GuidKey FROM PatientLevelOptionalServices.Service),
R AS (
  SELECT rr.Facility_ID, FORMAT(p.CreatedDate,'yyyy-MM') AS Mo, p.Resident_ID, p.Duration
  FROM (SELECT Resident_ID, CreatedDate, Duration, ${guidKey("Service_ID")} AS GuidKey
        FROM PatientLevelOptionalServices.Instance) p
  JOIN Svc s ON s.GuidKey = p.GuidKey
  JOIN dbo.Resident rr ON rr.Resident_ID = p.Resident_ID
  WHERE s.Category = 'Nursing Restorative'
)
SELECT R.Facility_ID, f.Name, R.Mo,
       COUNT(DISTINCT R.Resident_ID) AS Residents,
       SUM(CAST(R.Duration AS bigint)) AS Minutes
FROM R JOIN dbo.Facility f ON f.Facility_ID = R.Facility_ID
GROUP BY R.Facility_ID, f.Name, R.Mo
ORDER BY f.Name, R.Mo`;

const addMonths = (mo, n) => {
  const [y, m] = mo.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthEnd = (mo) => {
  const [y, m] = mo.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
};

query(sql, "bronze").then((r) => {
  const rows = r.recordset;
  const months = [...new Set(rows.map((x) => x.Mo))].sort();
  const dataEnd = months[months.length - 1];

  const byFac = new Map();
  for (const x of rows) {
    if (!byFac.has(x.Facility_ID)) byFac.set(x.Facility_ID, { name: x.Name, series: new Map() });
    byFac.get(x.Facility_ID).series.set(x.Mo, Number(x.Minutes));
  }

  const out = [];
  for (const [fid, { name, series }] of byFac) {
    const vals = months.map((m) => series.get(m) || 0);
    const nz = vals.filter((v) => v > 0).sort((a, b) => a - b);
    const plateau = nz[Math.floor(nz.length / 2)];
    const thresh = plateau * THRESHOLD;

    let live = null;
    for (let i = 0; i < vals.length; i++) {
      if (vals[i] >= thresh && (vals[i + 1] ?? 0) >= thresh) { live = months[i]; break; }
    }
    const firstIdx = vals.findIndex((v) => v > 0);
    const firstAny = months[firstIdx];

    let status, postStart = "", preEnd = "";
    if (!live) {
      status = "never_implemented";
    } else {
      postStart = addMonths(live, 1);
      preEnd = addMonths(firstAny, -1);
      const postMonths = months.filter((m) => m >= postStart).length;
      status = postMonths < MIN_POST_MONTHS ? "post_too_thin" : "implemented";
    }

    const num = (name.match(/^\s*(\d+)/) || [])[1] || "";
    out.push({
      FacilityId: fid,
      FacilityNumber: num,
      FacilityName: name.replace(/^\s*\d+\s*-\s*/, "").trim(),
      Status: status,
      FirstActivityMonth: firstAny,
      GoLiveMonth: live || "",
      PreEndDate: preEnd ? monthEnd(preEnd) : "",
      PostStartDate: postStart ? postStart + "-01" : "",
      PlateauMinutes: plateau,
      ActiveMonths: nz.length,
    });
  }
  out.sort((a, b) => (a.GoLiveMonth || "9999").localeCompare(b.GoLiveMonth || "9999") ||
                     a.FacilityName.localeCompare(b.FacilityName));

  const cols = Object.keys(out[0]);
  const esc = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  fs.writeFileSync(OUT, [cols.join(","), ...out.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n");

  const counts = {};
  for (const f of out) counts[f.Status] = (counts[f.Status] || 0) + 1;
  const cohorts = {};
  for (const f of out) if (f.GoLiveMonth) cohorts[f.GoLiveMonth] = (cohorts[f.GoLiveMonth] || 0) + 1;

  console.log(`\nWrote ${out.length} facilities -> ${path.relative(process.cwd(), OUT)}`);
  console.log(`Restorative data runs ${months[0]} .. ${dataEnd}\n`);
  console.log("Go-live cohorts:");
  for (const [k, v] of Object.entries(cohorts).sort()) console.log(`  ${k}   ${String(v).padStart(3)}`);
  console.log("\nStatus:");
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(20)} ${String(v).padStart(3)}`);
  console.log(`\nPost episode START dates should be capped ~90 days before the data cutoff`);
  console.log(`(p95 track LOS = 86 days) or long episodes drop out and post skews short.`);
});
