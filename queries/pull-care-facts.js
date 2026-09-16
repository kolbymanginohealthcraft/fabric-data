// ONE fact table behind slide 1's chart and its first two cards, plus the 23% reach figure.
//
// Grain: Resident x Month x CareType x OnCaseload, carrying Minutes and Days.
// Every figure below is a plain aggregation over this one table, which is the point: the slide
// stops being four separate scripts and becomes four measures over a single traceable fact.
//
//   chart + 74%   SUM(Minutes) where CareType='Restorative', split by OnCaseload, by month
//   85 min/week   SUM(Minutes) / COUNT(resident-months with restorative) / 4.348
//   ~3 days/week  SUM(Days)    / COUNT(resident-months with restorative) / 4.348
//   46% ISNP      restorative Minutes / all Minutes, for residents flagged IsISNP
//   23% reach     residents with restorative and NO therapy in a month, over residents with therapy
//
// WHY MONTH GRAIN IS SAFE HERE. The on/off caseload decision is still made at the individual
// SERVICE DATE inside the SQL and only then rolled up. Classifying at month grain would call a
// resident "on caseload" for a June 20 restorative visit because they had therapy June 1-10,
// and would overstate the on-caseload share by roughly half. Reporting monthly is fine;
// classifying monthly is not.
//
// SCOPE: the 52 facilities that documented Nursing Restorative in the window. Rehab tech is
// excluded, so "all care" here means restorative + skilled therapy, which is the denominator
// the 46% ISNP figure was built on.
//
// Usage: node queries/pull-care-facts.js [startDate] [endDate] [--csv]
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const WRITE_CSV = process.argv.includes("--csv");
const START = args[0] || "2025-10-01";
const END = args[1] || "2026-08-01";
const ISNP = "550,1389,1390";
const OUT = path.join(__dirname, "..", "data", "care-facts.csv");

// Bronze lands NetHealth varbinary GUID Ids in two encodings and they do not join. Normalize.
const guidKey = (c) =>
  `UPPER(CASE WHEN DATALENGTH(${c}) = 36 THEN CAST(${c} AS varchar(36))` +
  ` ELSE LEFT(CONVERT(varchar(32), ${c}, 2), 8) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 9, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 13, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 17, 4) + '-'` +
  ` + SUBSTRING(CONVERT(varchar(32), ${c}, 2), 21, 12) END)`;

const sql = `
WITH Isnp AS (      -- resident-level, EVER enrolled: a plan is not a stay
  SELECT DISTINCT rp.Resident_ID
  FROM dbo.ResidentPayer rp
  JOIN dbo.PayerPayerType ppt ON ppt.PayerPayerType_ID = rp.PayerPayerType_ID
  WHERE ppt.Payer_ID IN (${ISNP})
),
Svc AS (SELECT Category, ${guidKey("Id")} AS GuidKey
        FROM PatientLevelOptionalServices.Service),
RestDay AS (        -- restorative rolled to resident x DATE (several instances can share a day)
  SELECT rr.Facility_ID, p.Resident_ID, CAST(p.CreatedDate AS date) AS SvcDate,
         SUM(CAST(p.Duration AS bigint)) AS Minutes
  FROM (SELECT Resident_ID, CreatedDate, Duration, ${guidKey("Service_ID")} AS GuidKey
        FROM PatientLevelOptionalServices.Instance
        WHERE CreatedDate >= '${START}' AND CreatedDate < '${END}') p
  JOIN Svc s ON s.GuidKey = p.GuidKey
  JOIN dbo.Resident rr ON rr.Resident_ID = p.Resident_ID
  WHERE s.Category = 'Nursing Restorative'
  GROUP BY rr.Facility_ID, p.Resident_ID, CAST(p.CreatedDate AS date)
),
RestFac AS (SELECT DISTINCT Facility_ID FROM RestDay),
Cases AS (
  SELECT st.Resident_ID, CAST(pc.StartDate AS date) AS S,
         CAST(ISNULL(pc.EndDate, '2099-12-31') AS date) AS E
  FROM dbo.PatientCase pc
  JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
  WHERE ISNULL(pc.IsDeletedCase, 0) = 0
),
-- classify at SERVICE DATE, before any grouping. An EXISTS in a GROUP BY list is rejected.
RestTagged AS (
  SELECT r.Facility_ID, r.Resident_ID, r.SvcDate, r.Minutes,
         CASE WHEN EXISTS (SELECT 1 FROM Cases c
                           WHERE c.Resident_ID = r.Resident_ID
                             AND r.SvcDate BETWEEN c.S AND c.E)
              THEN 1 ELSE 0 END AS OnCaseload
  FROM RestDay r
),
TherDay AS (        -- skilled therapy rolled to resident x DATE, all disciplines together
  SELECT rr.Facility_ID, st.Resident_ID, CAST(ts.SessionDate AS date) AS SvcDate,
         SUM(CAST(m.Duration AS bigint)) AS Minutes
  FROM dbo.TxMinute m
  JOIN dbo.TxSession ts ON ts.TxSession_ID = m.TxSession_ID
                        AND ISNULL(ts.IsDeletedSession, 0) = 0
  JOIN dbo.TxTrack tt ON tt.TxTrack_ID = ts.TxTrack_ID AND ISNULL(tt.IsDeletedTrack, 0) = 0
  JOIN dbo.PatientCase pc ON pc.PatientCase_ID = tt.PatientCase_ID
                          AND ISNULL(pc.IsDeletedCase, 0) = 0
  JOIN dbo.Stay st ON st.Stay_ID = pc.Stay_ID
  JOIN dbo.Resident rr ON rr.Resident_ID = st.Resident_ID
  WHERE ts.SessionDate >= '${START}' AND ts.SessionDate < '${END}'
  GROUP BY rr.Facility_ID, st.Resident_ID, CAST(ts.SessionDate AS date)
),
Care AS (
  SELECT Facility_ID, Resident_ID, SvcDate, 'Restorative' AS CareType, OnCaseload, Minutes
  FROM RestTagged
  UNION ALL
  SELECT Facility_ID, Resident_ID, SvcDate, 'Skilled therapy', 1, Minutes
  FROM TherDay
)
SELECT c.Resident_ID, c.Facility_ID,
       FORMAT(c.SvcDate, 'yyyy-MM') AS CareMonth,
       c.CareType, c.OnCaseload,
       CASE WHEN i.Resident_ID IS NULL THEN 0 ELSE 1 END AS IsISNP,
       SUM(c.Minutes) AS Minutes,
       COUNT(DISTINCT c.SvcDate) AS Days
FROM Care c
LEFT JOIN Isnp i ON i.Resident_ID = c.Resident_ID
WHERE c.Facility_ID IN (SELECT Facility_ID FROM RestFac)
GROUP BY c.Resident_ID, c.Facility_ID, FORMAT(c.SvcDate, 'yyyy-MM'), c.CareType, c.OnCaseload,
         CASE WHEN i.Resident_ID IS NULL THEN 0 ELSE 1 END
ORDER BY CareMonth, c.Resident_ID`;

const n = (x) => Number(x).toLocaleString();
const csvEscape = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// The PBIP model embeds this exact SQL in its partition, so the query and the semantic model
// cannot drift. `node tooling/emit-care-facts-sql.js` flattens it for pasting into the .tmdl.
module.exports = { sql, START, END };
if (require.main !== module) return;

query(sql, "bronze").then(async (r) => {
  const rows = r.recordset;
  const num = (v) => Number(v);
  console.log(`\nCare facts, ${START} to ${END}`);
  console.log(`  rows ${n(rows.length)}   residents ${n(new Set(rows.map(x => x.Resident_ID)).size)}`
    + `   facilities ${n(new Set(rows.map(x => x.Facility_ID)).size)}`);

  // ---- every slide figure, recomputed from this one table ---------------------------------
  const CARD_START = "2026-01", CARD_END = "2026-07";   // the cards' own window
  const inCards = (x) => x.CareMonth >= CARD_START && x.CareMonth <= CARD_END;
  const rest = rows.filter((x) => x.CareType === "Restorative");

  console.log("\n=== 1. chart + the 74% (restorative minutes by caseload) ===");
  const chart = {};
  for (const x of rest) {
    const k = x.CareMonth;
    chart[k] = chart[k] || { off: 0, on: 0 };
    chart[k][x.OnCaseload ? "on" : "off"] += num(x.Minutes);
  }
  let tOff = 0, tOn = 0;
  for (const mo of Object.keys(chart).sort()) {
    const { off, on } = chart[mo];
    console.log(`  ${mo}  off ${n(off).padStart(9)}   on ${n(on).padStart(8)}`
      + `   off ${((off / (off + on)) * 100).toFixed(1)}%`);
    if (mo >= CARD_START && mo <= CARD_END) { tOff += off; tOn += on; }
  }
  console.log(`  -> Jan to Jul 2026 off-caseload share ${((tOff / (tOff + tOn)) * 100).toFixed(1)}%`
    + `   (slide says 74%)`);

  console.log("\n=== 2. card one: minutes and days per week per resident ===");
  const rc = rest.filter(inCards);
  const resMonths = new Set(rc.map((x) => `${x.Resident_ID}|${x.CareMonth}`)).size;
  const mins = rc.reduce((a, x) => a + num(x.Minutes), 0);
  const days = rc.reduce((a, x) => a + num(x.Days), 0);
  const WKS = 30.437 / 7;
  console.log(`  resident-months ${n(resMonths)}   minutes ${n(mins)}   days ${n(days)}`);
  console.log(`  -> ${(mins / resMonths / WKS).toFixed(0)} minutes a week`
    + `   (slide says 85)`);
  console.log(`  -> ${(days / resMonths / WKS).toFixed(2)} days a week   (slide says about 3)`);

  console.log("\n=== 3. card two: restorative share of care, ISNP vs others ===");
  for (const [lab, flag] of [["ISNP", 1], ["other residents", 0]]) {
    const s = rows.filter((x) => inCards(x) && x.IsISNP === flag);
    const rm = s.filter((x) => x.CareType === "Restorative")
      .reduce((a, x) => a + num(x.Minutes), 0);
    const all = s.reduce((a, x) => a + num(x.Minutes), 0);
    console.log(`  ${lab.padEnd(16)} restorative ${((rm / all) * 100).toFixed(1)}%`
      + `   of ${n(all)} minutes`);
  }
  console.log("  (slide says 46% ISNP against 13% others)");

  console.log("\n=== 4. the 23%: residents restorative reaches that therapy does not ===");
  const byMo = {};
  for (const x of rows.filter(inCards)) {
    byMo[x.CareMonth] = byMo[x.CareMonth] || {};
    const e = (byMo[x.CareMonth][x.Resident_ID] = byMo[x.CareMonth][x.Resident_ID] || {});
    e[x.CareType === "Restorative" ? "r" : "t"] = true;
  }
  let sumT = 0, sumRO = 0;
  for (const mo of Object.keys(byMo).sort()) {
    const res = Object.values(byMo[mo]);
    const t = res.filter((e) => e.t).length;
    const ro = res.filter((e) => e.r && !e.t).length;
    sumT += t; sumRO += ro;
    console.log(`  ${mo}  therapy ${n(t).padStart(5)}   restorative-only ${n(ro).padStart(4)}`
      + `   +${((ro / t) * 100).toFixed(1)}%`);
  }
  console.log(`  -> average +${((sumRO / sumT) * 100).toFixed(1)}%   (slide says 23%)`);

  console.log("\n=== 5. slide 3 card two: share of restorative that lands off caseload ===");
  for (const [lab, flag] of [["ISNP", 1], ["other residents", 0]]) {
    const s = rest.filter((x) => inCards(x) && x.IsISNP === flag);
    const off = s.filter((x) => !x.OnCaseload).reduce((a, x) => a + num(x.Minutes), 0);
    const all = s.reduce((a, x) => a + num(x.Minutes), 0);
    console.log(`  ${lab.padEnd(16)} off caseload ${((off / all) * 100).toFixed(1)}%`
      + `   of ${n(all)} restorative minutes`);
  }

  // Dawn, 2026-08-07: to count toward CMI a resident needs roughly 30 min on 5-6 days, so
  // 150-180 min a week. The 85 min average invites "restorative is not moving CMI". Her ask
  // was what share actually reach that volume. Rate uses the same months x 4.348 convention
  // as the 85, so a resident admitted mid-month is measured against a full month.
  console.log("\n=== 6. share of restorative volume reaching CMI-relevant intensity ===");
  const perResMonth = {};
  for (const x of rest.filter(inCards)) {
    const k = `${x.Resident_ID}|${x.CareMonth}`;
    perResMonth[k] = (perResMonth[k] || 0) + num(x.Minutes);
  }
  const rmVals = Object.values(perResMonth);
  const perRes = {};
  for (const [k, v] of Object.entries(perResMonth)) {
    const r = k.split("|")[0];
    perRes[r] = perRes[r] || { min: 0, mo: 0 };
    perRes[r].min += v; perRes[r].mo += 1;
  }
  const resAvg = Object.values(perRes).map((e) => e.min / e.mo / WKS);
  for (const thr of [90, 150, 180]) {
    const mo = rmVals.filter((v) => v / WKS >= thr).length;
    const rs = resAvg.filter((v) => v >= thr).length;
    console.log(`  >= ${String(thr).padStart(3)} min/wk   resident-months `
      + `${((mo / rmVals.length) * 100).toFixed(1)}%`.padStart(6)
      + `   residents ${((rs / resAvg.length) * 100).toFixed(1)}%`.padStart(20)
      + `   (${n(mo)} of ${n(rmVals.length)} / ${n(rs)} of ${n(resAvg.length)})`);
  }
  const sorted = rmVals.map((v) => v / WKS).sort((a, b) => a - b);
  const pct = (q) => sorted[Math.floor(q * (sorted.length - 1))].toFixed(0);
  console.log(`  resident-month min/wk distribution: p25 ${pct(0.25)}  median ${pct(0.5)}`
    + `  p75 ${pct(0.75)}  p90 ${pct(0.9)}  p95 ${pct(0.95)}`);

  if (WRITE_CSV) {
    const cols = Object.keys(rows[0]);
    fs.writeFileSync(OUT, [cols.join(",")]
      .concat(rows.map((x) => cols.map((k) => csvEscape(x[k])).join(","))).join("\n") + "\n");
    console.log(`\nwrote ${OUT}`);
  }
  await closeAll();
});
