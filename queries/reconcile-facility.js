// One-off reconciliation: why does the 3-division facility count differ between
// old aegisdataprod (1174) and Silver (1126)? Diffs the two ID sets and checks
// where the "old-only" facilities landed in Silver's hierarchy.
//
// Old join key = Facility_ID (int). Silver facility.NetHealthId is the same NetHealth
// id; Silver joins facility↔hierarchy on FacilityNumber (varchar).

const { query, closeAll } = require("../fabric-query");

const DIVS_OLD = ["8450", "5500", "6500"];
const DIVS_NEW = ["08450", "05500", "06500"];

(async () => {
  // 1) OLD: Facility_IDs in the 3 live divisions (aegisdataprod)
  const oldSql = `
    SELECT f.Facility_ID
    FROM PatientInfo.Facility f
    JOIN BINetHealthGeneralLakehouse.FacilityInfo.FacilityHierarchy fh
      ON f.Facility_ID = fh.Facility_ID
    WHERE fh.DivisionCode IN ('${DIVS_OLD.join("','")}')`;
  const oldRows = (await query(oldSql, "patient")).recordset;
  const oldSet = new Set(oldRows.map((r) => r.Facility_ID));

  // 2) SILVER: every matched facility with its RegionNumber (=division)
  const silverSql = `
    SELECT f.NetHealthId, fh.RegionNumber, fh.RegionName
    FROM dbo.facility f
    JOIN dbo.facilityhierarchy fh ON f.FacilityNumber = fh.FacilityNumber`;
  const silverRows = (await query(silverSql, "silver")).recordset;
  const silverRegionById = new Map(silverRows.map((r) => [r.NetHealthId, r]));
  const silver3Div = new Set(
    silverRows.filter((r) => DIVS_NEW.includes(r.RegionNumber)).map((r) => r.NetHealthId)
  );

  // 3) Diff
  const oldOnly = [...oldSet].filter((id) => !silver3Div.has(id));
  const newOnly = [...silver3Div].filter((id) => !oldSet.has(id));

  // 4) Where did the old-only facilities go in Silver?
  const landing = {};
  let absentFromSilver = 0;
  for (const id of oldOnly) {
    const s = silverRegionById.get(id);
    if (!s) { absentFromSilver++; continue; }
    const key = `${s.RegionNumber} ${s.RegionName}`;
    landing[key] = (landing[key] || 0) + 1;
  }

  console.log(JSON.stringify({
    oldCount: oldSet.size,
    silver3DivCount: silver3Div.size,
    oldOnly: oldOnly.length,
    newOnly: newOnly.length,
    oldOnly_absentFromSilverHierarchy: absentFromSilver,
    oldOnly_landedInSilverRegion: landing,
    newOnly_sampleIds: newOnly.slice(0, 10),
  }, null, 2));

  await closeAll();
})().catch((e) => { console.error("Reconcile failed:", e.message); process.exit(1); });
