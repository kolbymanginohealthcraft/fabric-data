// Discharges per Facility x destination (Bronze) -> data/discharges.csv. Feeds the Response
// Rate DENOMINATOR (planned discharges). Discharge = a PatientCase that ended (EndDate) in the
// window; destination Descrip via Lookup (Type='DISCHRGTO '). "Planned" classification is derived
// downstream (build_planned_discharges.py) to mirror the PBIP's Setting logic exactly.
// Usage: node queries/pull-discharges.js [--years N] [--out path]
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1, out = path.join(__dirname, "..", "data", "discharges.csv");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--years" && a[i + 1]) years = parseInt(a[++i], 10);
    else if (a[i] === "--out" && a[i + 1]) out = a[++i];
  }
  return { years, out };
}
function csvEscape(v) { if (v == null) return ""; const s = String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { if (!rows.length) return ""; const h = Object.keys(rows[0]); return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n"; }

const SQL = `
SELECT
    res.Facility_ID,
    ldd.Descrip                 AS DischargedTo,
    COUNT(*)                    AS n_discharges
FROM dbo.PatientCase pc
JOIN dbo.Stay stay      ON stay.Stay_ID = pc.Stay_ID
JOIN dbo.Resident res   ON res.Resident_ID = stay.Resident_ID AND res.IsDeletedResident = 0
LEFT JOIN dbo.Lookup ldd ON ldd.Lookup_ID = pc.DischargedTo_ID AND ldd.Type = 'DISCHRGTO '
WHERE pc.IsDeletedCase = 0
  AND pc.EndDate >= DATEADD(YEAR, @YEARS, GETDATE())
GROUP BY res.Facility_ID, ldd.Descrip
ORDER BY res.Facility_ID`;

(async () => {
  const { years, out } = parseArgs();
  const sql = SQL.replace("@YEARS", `-${years}`);
  console.error(`discharges pull: cases ending in last ${years}yr -> ${out}`);
  const r = await query(sql, "bronze");
  console.error(`rows: ${r.recordset.length}`);
  fs.writeFileSync(out, toCsv(r.recordset));
  console.error(`wrote ${out}`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
