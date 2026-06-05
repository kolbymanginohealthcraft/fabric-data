// Pulls one row per track-with-outcomes for cohort-dimension analysis.
// Writes a CSV of Track, Discipline, Libraries, Residence, ServiceLine, Facility dimensions.
// Default time window: last 1 year by TxTrack.EndDate. Override with --years N.

const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

const CROSSWALK_IDS = [
  919, 961, 3922, 5401, 5480, 5482, 5526, 5788, 5800, 6477, 6482, 6486, 6801,
  6946, 7368, 7371, 7373, 7374, 7375, 7376, 7379, 7386, 7387, 7388, 7389, 7390,
  7408, 7511, 7514, 7521, 7522, 7523, 7524, 7525, 7526, 7528, 7529, 7562, 7572,
  7659, 7672, 7673, 7674, 7675, 7678, 7690, 7753, 7754, 7755, 7756, 7757, 7758,
  7759, 7760, 7761, 7762, 7763, 7764, 7765, 7766, 7767, 7769, 7771, 7780, 7781,
  7782, 7783, 7784, 7785, 7786, 7918, 7936, 8067, 8167, 8170, 8298, 8300, 8305,
  8308, 8481, 10164, 10166, 10175, 10193, 10195, 10208, 10217, 10223, 10227,
  10234, 10509, 10510, 10511, 10512, 10513, 10631, 10639, 10649, 10675, 10681,
  10682, 10721, 10722, 10734, 10735, 10744, 10745, 10750, 10751, 10752, 10754,
  10756, 10757, 10758, 10783, 10785, 10787, 10788, 10789, 10790, 10810, 10812,
  10827, 10955, 10956, 10980, 10983, 10993, 10994, 11000, 11006, 11007, 11023,
  11030, 11031, 11059, 11060, 11061, 11062, 11063, 11066, 11067, 11068, 11069,
  11070, 11071, 11080, 11081,
];

function parseArgs() {
  const args = process.argv.slice(2);
  let years = 1;
  let outPath = path.join(__dirname, "..", "track-cohort-dimensions.csv");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--years" && args[i + 1]) {
      years = parseInt(args[++i], 10);
    } else if (args[i] === "--out" && args[i + 1]) {
      outPath = args[++i];
    }
  }
  return { years, outPath };
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
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

const cwValues = CROSSWALK_IDS.map((id) => `(${id})`).join(",");

const SQL = `
WITH cw AS (SELECT id FROM (VALUES ${cwValues}) AS x(id)),
recent_tracks AS (
  SELECT TxTrack_ID, PatientCase_ID, Discipline
  FROM PatientInfo.TxTrack
  WHERE EndDate >= DATEADD(YEAR, @YEARS, GETDATE())
),
base AS (
  SELECT rt.PatientCase_ID, rt.TxTrack_ID, item.LibraryItem_ID, li.VersionName, doc.DocumentType
  FROM recent_tracks rt
  JOIN NetHealthDocumentation.TxDocument doc ON doc.TxTrack_ID = rt.TxTrack_ID
  JOIN NetHealthDocumentation.TxDocumentItem item ON item.TxDocument_ID = doc.TxDocument_ID
  JOIN NetHealthDocumentation.LibraryItem li ON li.LibraryItem_ID = item.LibraryItem_ID
  JOIN cw ON cw.id = item.LibraryItem_ID
  WHERE doc.DocumentType IN ('EVAL','DISCH')
    AND item.LibraryScaleValue_ID IS NOT NULL
),
pairs AS (
  SELECT PatientCase_ID, TxTrack_ID, LibraryItem_ID, VersionName
  FROM base
  GROUP BY PatientCase_ID, TxTrack_ID, LibraryItem_ID, VersionName
  HAVING MAX(CASE WHEN DocumentType='EVAL' THEN 1 ELSE 0 END)=1
     AND MAX(CASE WHEN DocumentType='DISCH' THEN 1 ELSE 0 END)=1
),
track_libs AS (
  SELECT PatientCase_ID, TxTrack_ID,
    COUNT(*) AS OutcomeCount,
    MAX(CASE WHEN VersionName LIKE '%OP%' OR VersionName LIKE '%GP%' THEN 1 ELSE 0 END) AS HasOP,
    MAX(CASE WHEN NOT (VersionName LIKE '%OP%' OR VersionName LIKE '%GP%') THEN 1 ELSE 0 END) AS HasSNF
  FROM pairs
  GROUP BY PatientCase_ID, TxTrack_ID
)
SELECT
  tl.TxTrack_ID,
  tl.PatientCase_ID,
  trk.Discipline,
  tl.OutcomeCount,
  CASE
    WHEN tl.HasSNF=1 AND tl.HasOP=1 THEN 'Mixed'
    WHEN tl.HasSNF=1 THEN 'SNF'
    WHEN tl.HasOP=1 THEN 'OP'
  END AS Libraries,
  isrc.Name AS ResidenceName,
  isrc.Abbrev AS ResidenceAbbrev,
  isrc.PlaceOfResidenceUsage,
  CASE
    WHEN isrc.PlaceOfResidenceUsage='HHA' THEN 'Home Health'
    WHEN fh.DivisionCode='8450' THEN 'Contract Rehab'
    WHEN fh.DivisionCode='5500' THEN 'Senior Living'
    WHEN fh.DivisionCode='6500' THEN 'HAP'
    WHEN fh.DivisionCode='5555' THEN 'Closed'
    ELSE CONCAT('Other/', ISNULL(fh.DivisionCode, 'null'))
  END AS ServiceLine,
  fh.DivisionCode,
  fh.DivisionName,
  fm.FacilityID,
  fac.FacilityName,
  fac.FacilityType,
  fac.SiteType,
  fac.PrimaryHealthcareSetting,
  trk.StartDate AS TrackStartDate,
  trk.EndDate   AS TrackEndDate
FROM track_libs tl
JOIN PatientInfo.TxTrack trk    ON trk.TxTrack_ID = tl.TxTrack_ID
JOIN PatientInfo.PatientCase pc ON pc.PatientCase_ID = tl.PatientCase_ID
JOIN PatientInfo.Stay stay      ON stay.Stay_ID = pc.Stay_ID
JOIN PatientInfo.Resident res   ON res.Resident_ID = stay.Resident_ID
LEFT JOIN BINetHealthGeneralLakehouse.Lookups.IntakeSource isrc     ON isrc.IntakeSource_ID = stay.IntakeSource_ID
LEFT JOIN BINetHealthGeneralLakehouse.FacilityInfo.FacilityMap fm   ON fm.Facility_ID = res.Facility_ID
LEFT JOIN BINetHealthGeneralLakehouse.FacilityInfo.Facilities fac   ON fac.FacilityID = fm.FacilityID
LEFT JOIN BINetHealthGeneralLakehouse.FacilityInfo.FacilityHierarchy fh ON fh.Facility_ID = res.Facility_ID
ORDER BY tl.TxTrack_ID
`;

(async () => {
  const { years, outPath } = parseArgs();
  const sql = SQL.replace("@YEARS", `-${years}`);
  console.error(`Running track-dimension pull: last ${years} year(s) → ${outPath}`);
  const t0 = Date.now();
  const result = await query(sql, "patient");
  const rows = result.recordset;
  console.error(`Query returned ${rows.length} rows in ${Math.round((Date.now() - t0) / 1000)}s`);
  fs.writeFileSync(outPath, toCsv(rows));
  console.error(`Wrote CSV → ${outPath}`);
  await closeAll();
})().catch((err) => {
  console.error("Pull failed:", err.message);
  process.exit(1);
});
