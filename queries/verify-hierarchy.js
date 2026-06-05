// Verify the hierarchy level-shift hypothesis: old Division→Region→Area == Silver Region→Area→District.
// Pulls the same facilities (division 8450) from both sources and aligns their hierarchy labels by id.

const { query, closeAll } = require("../fabric-query");

(async () => {
  const oldRows = (await query(`
    SELECT f.Facility_ID, fh.DivisionName, fh.RegionName AS OldRegionName, fh.AreaName AS OldAreaName
    FROM PatientInfo.Facility f
    JOIN BINetHealthGeneralLakehouse.FacilityInfo.FacilityHierarchy fh ON f.Facility_ID = fh.Facility_ID
    WHERE fh.DivisionCode = '8450'`, "patient")).recordset;

  const newRows = (await query(`
    SELECT f.NetHealthId, fh.RegionName AS SilverRegionName, fh.AreaName AS SilverAreaName, fh.DistrictName AS SilverDistrictName
    FROM dbo.facility f
    JOIN dbo.facilityhierarchy fh ON f.FacilityNumber = fh.FacilityNumber
    WHERE fh.RegionNumber = '08450'`, "silver")).recordset;

  const newById = new Map(newRows.map((r) => [r.NetHealthId, r]));

  const sample = [];
  for (const o of oldRows) {
    const n = newById.get(o.Facility_ID);
    if (!n) continue;
    sample.push({
      id: o.Facility_ID,
      old_Division: o.DivisionName, old_Region: o.OldRegionName, old_Area: o.OldAreaName,
      silver_Region: n.SilverRegionName, silver_Area: n.SilverAreaName, silver_District: n.SilverDistrictName,
    });
    if (sample.length >= 12) break;
  }

  console.log(JSON.stringify(sample, null, 2));
  await closeAll();
})().catch((e) => { console.error("Verify failed:", e.message); process.exit(1); });
