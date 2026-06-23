// Discharges per Facility x DISCIPLINE x destination (Bronze) -> data/discharges.csv. Feeds the
// Response Rate DENOMINATOR (planned discharges), which is discipline-specific: a discharged patient
// counts toward each discipline they RECEIVED (via a TxTrack in that discipline), so PT+OT patients
// land in both PT and OT — matching the discipline-specific survey numerator (Did you receive X?=Yes).
// This stops e.g. Speech being measured against patients who never got speech. n_discharges =
// COUNT(DISTINCT PatientCase_ID) so multiple tracks of one discipline don't double-count a patient.
// Discharge = a PatientCase that ended (EndDate) in the window; destination Descrip via Lookup
// (Type='DISCHRGTO '). "Planned" classification is derived downstream (build_planned_discharges.py).
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
    trk.Discipline,
    ldd.Descrip                       AS DischargedTo,
    COUNT(DISTINCT pc.PatientCase_ID) AS n_discharges
FROM dbo.PatientCase pc
JOIN dbo.Stay stay      ON stay.Stay_ID = pc.Stay_ID
JOIN dbo.Resident res   ON res.Resident_ID = stay.Resident_ID AND res.IsDeletedResident = 0
JOIN dbo.TxTrack trk    ON trk.PatientCase_ID = pc.PatientCase_ID AND trk.IsDeletedTrack = 0
                          AND trk.Discipline IN ('PT','OT','ST')
LEFT JOIN dbo.Lookup ldd ON ldd.Lookup_ID = pc.DischargedTo_ID AND ldd.Type = 'DISCHRGTO '
WHERE pc.IsDeletedCase = 0
  AND pc.EndDate >= DATEADD(YEAR, @YEARS, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
  AND pc.EndDate <  DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
GROUP BY res.Facility_ID, trk.Discipline, ldd.Descrip
ORDER BY res.Facility_ID, trk.Discipline`;

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
