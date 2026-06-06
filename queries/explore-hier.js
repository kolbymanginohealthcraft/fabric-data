// Throwaway: find where 'Senior Living' lives in the facility hierarchy. Read-only.
const { query, closeAll } = require("../fabric-query");
async function cols(t) {
  const r = await query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='${t}' AND TABLE_SCHEMA='dbo' ORDER BY ORDINAL_POSITION`, "silver");
  console.error(`\n=== ${t} ===\n  ` + r.recordset.map((c) => `${c.COLUMN_NAME}(${c.DATA_TYPE})`).join(", "));
}
(async () => {
  await cols("facility");
  await cols("facilityhierarchy");
  // sample facilityhierarchy
  const s = await query(`SELECT TOP 3 * FROM dbo.facilityhierarchy`, "silver");
  console.error("\nfacilityhierarchy sample:");
  for (const r of s.recordset) console.error("  " + JSON.stringify(r));
  // hunt 'senior' / 'SL' across facilityhierarchy text columns we can see
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
