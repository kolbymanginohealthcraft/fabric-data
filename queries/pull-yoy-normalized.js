// Is "skilled therapy held steady, down 3.4%" a real finding or a denominator artifact?
//
// A raw minutes total is only comparable year over year if the population being served is
// comparable. If 2026 had fewer buildings, fewer patients, or a different case mix, a small
// change in total minutes means nothing. This normalizes the comparison:
//
//   facilities served      - did the footprint change?
//   residents treated      - did the patient count change?
//   therapy session days   - did the volume of encounters change?
//   minutes per resident   - therapy intensity per person (the real "held steady" test)
//   minutes per day        - therapy intensity per encounter
//
// Same facility set both years (facilities that ran restorative in either year), so the
// footprint is fixed by construction. Everything else is measured, not assumed.
//
// Usage: node queries/pull-yoy-normalized.js
const { query } = require("../fabric-query");

const PERIODS = [
  { label: "Jan-Jul 2025", start: "2025-01-01", end: "2025-08-01" },
  { label: "Jan-Jul 2026", start: "2026-01-01", end: "2026-08-01" },
];

const guidKey = (c) =>
  `UPPER(CASE WHEN DATALENGTH(${c}) = 36 THEN CAST(${c} AS varchar(36))` +
  ` ELSE LEFT(CONVERT(varchar(32), ${c}, 2), 8) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 9, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 13, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 17, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 21, 12) END)`;

const OS = PERIODS[0].start, OE = PERIODS[PERIODS.length - 1].end;
const per = (a) => PERIODS.map((p) =>
  `WHEN ${a} >= '${p.start}' AND ${a} < '${p.end}' THEN '${p.label}'`).join(" ");

const sql = `
WITH Svc AS (SELECT Category, ${guidKey("Id")} AS GuidKey
             FROM PatientLevelOptionalServices.Service),
Plos AS (
  SELECT rr.Facility_ID, p.Resident_ID, CAST(p.CreatedDate AS date) AS D,
         p.Duration, s.Category
  FROM (SELECT Resident_ID, CreatedDate, Duration, ${guidKey("Service_ID")} AS GuidKey
        FROM PatientLevelOptionalServices.Instance
        WHERE CreatedDate >= '${OS}' AND CreatedDate < '${OE}') p
  JOIN Svc s ON s.GuidKey = p.GuidKey
  JOIN dbo.Resident rr ON rr.Resident_ID = p.Resident_ID
  WHERE s.Category IN ('Nursing Restorative','Rehab Tech')
),
RestFac AS (SELECT DISTINCT Facility_ID FROM Plos WHERE Category = 'Nursing Restorative'),
Ther AS (
  SELECT rr.Facility_ID, st.Resident_ID, CAST(ts.SessionDate AS date) AS D,
         m.Duration, ts.TxSession_ID
  FROM dbo.TxMinute m
  JOIN dbo.TxSession ts ON ts.TxSession_ID = m.TxSession_ID AND ISNULL(ts.IsDeletedSession,0)=0
  JOIN dbo.TxTrack tt ON tt.TxTrack_ID = ts.TxTrack_ID AND ISNULL(tt.IsDeletedTrack,0)=0
  JOIN dbo.PatientCase pc ON pc.PatientCase_ID = tt.PatientCase_ID
                          AND ISNULL(pc.IsDeletedCase,0)=0
  JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
  JOIN dbo.Resident rr ON rr.Resident_ID = st.Resident_ID
  WHERE ts.SessionDate >= '${OS}' AND ts.SessionDate < '${OE}'
    AND rr.Facility_ID IN (SELECT Facility_ID FROM RestFac)
)
SELECT 'therapy' AS Stream, CASE ${per("D")} END AS Period,
       COUNT(DISTINCT Facility_ID) AS Facilities,
       COUNT(DISTINCT Resident_ID) AS Residents,
       COUNT(DISTINCT CAST(Resident_ID AS varchar(12)) + '|' + CONVERT(varchar(10), D, 120))
         AS ResidentDays,
       SUM(CAST(Duration AS bigint)) AS Minutes
FROM Ther GROUP BY CASE ${per("D")} END
UNION ALL
SELECT LOWER(Category), CASE ${per("D")} END,
       COUNT(DISTINCT Facility_ID), COUNT(DISTINCT Resident_ID),
       COUNT(DISTINCT CAST(Resident_ID AS varchar(12)) + '|' + CONVERT(varchar(10), D, 120)),
       SUM(CAST(Duration AS bigint))
FROM Plos WHERE Facility_ID IN (SELECT Facility_ID FROM RestFac)
GROUP BY Category, CASE ${per("D")} END
ORDER BY Stream, Period`;

const n = (x) => Number(x).toLocaleString();
const pct = (a, b) => `${b / a - 1 >= 0 ? "+" : ""}${((b / a - 1) * 100).toFixed(1)}%`;

query(sql, "bronze").then((r) => {
  const rows = r.recordset.filter((x) => x.Period);
  const streams = [...new Set(rows.map((x) => x.Stream))];
  const [p1, p2] = PERIODS.map((p) => p.label);

  console.log("\nIs the therapy comparison denominator-stable? Same facility set both years.\n");
  for (const s of streams) {
    const a = rows.find((x) => x.Stream === s && x.Period === p1);
    const b = rows.find((x) => x.Stream === s && x.Period === p2);
    if (!a || !b) continue;
    console.log(`=== ${s} ===`);
    const M = (x) => Number(x.Minutes), R = (x) => Number(x.Residents),
          D = (x) => Number(x.ResidentDays), F = (x) => Number(x.Facilities);
    const rowsOut = [
      ["facilities served", F(a), F(b), pct(F(a), F(b)), 0],
      ["residents served", R(a), R(b), pct(R(a), R(b)), 0],
      ["resident-days", D(a), D(b), pct(D(a), D(b)), 0],
      ["total minutes", M(a), M(b), pct(M(a), M(b)), 0],
      ["minutes / resident", M(a) / R(a), M(b) / R(b), pct(M(a) / R(a), M(b) / R(b)), 1],
      ["minutes / resident-day", M(a) / D(a), M(b) / D(b), pct(M(a) / D(a), M(b) / D(b)), 1],
      ["days / resident", D(a) / R(a), D(b) / R(b), pct(D(a) / R(a), D(b) / R(b)), 1],
    ];
    console.log("metric".padEnd(24) + p1.padStart(14) + p2.padStart(14) + "change".padStart(10));
    console.log("-".repeat(62));
    for (const [lab, x, y, ch, dec] of rowsOut) {
      const f = (v) => dec ? v.toFixed(1) : n(v);
      console.log(lab.padEnd(24) + f(x).padStart(14) + f(y).padStart(14) + ch.padStart(10));
    }
    console.log();
  }
});
