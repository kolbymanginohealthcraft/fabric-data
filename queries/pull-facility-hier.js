// Facility hierarchy (Silver) -> facility-hier.csv: code -> District/Area/Region.
// Lets a manager's HomeLocation map to a District or Area as a territory grouping
// (alternative to org-chart inversion). Usage: node queries/pull-facility-hier.js
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");
function csvEscape(v) { if (v == null) return ""; const s = String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { if (!rows.length) return ""; const h = Object.keys(rows[0]); return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n"; }
const SQL = `
SELECT
    RIGHT('00000' + LTRIM(RTRIM(FacilityNumber)), 5) AS code,
    DistrictNumber, DistrictName, AreaNumber, AreaName, RegionNumber, RegionName, Closed
FROM dbo.facilityhierarchy`;
(async () => {
  const out = path.join(__dirname, "..", "data", "facility-hier.csv");
  const r = await query(SQL, "silver");
  console.error(`facility-hier rows: ${r.recordset.length}`);
  fs.writeFileSync(out, toCsv(r.recordset));
  console.error(`wrote ${out}`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
