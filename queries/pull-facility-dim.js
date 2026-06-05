// Pulls the facility dimension from Silver: Facility_ID → division (+ name).
// Keyed by NetHealthId, which equals the Bronze Resident.Facility_ID emitted by
// outcomes-core (and the People Dashboard side), so the consumer joins on Facility_ID.
//
// DivisionCode is Silver's facilityhierarchy.RegionNumber — i.e. the old curated
// "DivisionCode", zero-padded to 5 chars ('08450' = 8450 Contract Rehab, '05500' =
// 5500 Senior Living, '06500' = 6500 HAP, '05555' = 5555 Closed). The consumer maps
// these (padded) to ServiceLine, combined with PlaceOfResidenceUsage='HHA' → Home Health.
// See migration-crosswalk.md for the Division=RegionNumber + level-shift detail.
//
// Usage: node queries/pull-facility-dim.js [--out path]

const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

function parseArgs() {
  const args = process.argv.slice(2);
  let outPath = path.join(__dirname, "..", "facility-dim.csv");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) outPath = args[++i];
  }
  return { outPath };
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\n") + "\n";
}

const SQL = `
SELECT
    f.NetHealthId        AS Facility_ID,
    f.Name               AS FacilityName,
    fh.RegionNumber      AS DivisionCode,
    fh.RegionName        AS DivisionName
FROM dbo.facility f
LEFT JOIN dbo.facilityhierarchy fh ON f.FacilityNumber = fh.FacilityNumber
`;

(async () => {
  const { outPath } = parseArgs();
  console.error(`Running facility dim pull (Silver) → ${outPath}`);
  const result = await query(SQL, "silver");
  const rows = result.recordset;
  console.error(`Query returned ${rows.length} facilities`);
  fs.writeFileSync(outPath, toCsv(rows));
  console.error(`Wrote CSV → ${outPath}`);
  await closeAll();
})().catch((err) => {
  console.error("Pull failed:", err.message);
  process.exit(1);
});
