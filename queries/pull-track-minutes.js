// Delivered therapy minutes per track. Needed wherever an outcome comparison has to be stated
// per unit of therapy time (e.g. "ISNP achieves comparable gain on about half the therapy
// minutes"). pull-track-sessions.js gives session COUNTS but not minutes, so this fills that gap.
//
// Delivered = session not deleted, no MissedReason, track not deleted. Fact = Bronze.
// Window matches the other track pulls (rolls on the 10th, 10-day reconciliation lag).
//
// Output: data/track-minutes.csv (TxTrack_ID, TherapyMinutes, TherapyDays). Read-only.
// Usage: node queries/pull-track-minutes.js [--years N] [--out path]
const fs = require("fs"), path = require("path");
const { query, closeAll } = require("../fabric-query");
const REPO = path.join(__dirname, "..");
function args() {
  const a = process.argv.slice(2);
  let y = 1, o = path.join(REPO, "data", "track-minutes.csv");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--years") y = parseInt(a[++i], 10);
    else if (a[i] === "--out") o = a[++i];
  }
  return { y, o };
}
const SQL = `
SELECT trk.TxTrack_ID,
       SUM(CAST(m.Duration AS bigint)) AS TherapyMinutes,
       COUNT(DISTINCT CONVERT(date, ts.SessionDate)) AS TherapyDays
FROM dbo.TxMinute m
JOIN dbo.TxSession ts ON ts.TxSession_ID = m.TxSession_ID
                     AND ts.IsDeletedSession = 0 AND ts.MissedReason IS NULL
JOIN dbo.TxTrack trk ON trk.TxTrack_ID = ts.TxTrack_ID AND trk.IsDeletedTrack = 0
WHERE trk.EndDate >= DATEADD(YEAR,@YEARS,DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)))
  AND trk.EndDate <  DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))
GROUP BY trk.TxTrack_ID`;
(async () => {
  const { y, o } = args();
  console.error(`track-minutes pull: trailing ${y}yr (Bronze) -> ${o}`);
  const t0 = Date.now();
  const rows = (await query(SQL.replace("@YEARS", `-${y}`), "bronze")).recordset;
  console.error(`rows: ${rows.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  fs.writeFileSync(o, ["TxTrack_ID,TherapyMinutes,TherapyDays"]
    .concat(rows.map((r) => `${r.TxTrack_ID},${r.TherapyMinutes},${r.TherapyDays}`)).join("\n") + "\n");
  console.error(`wrote ${o}`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
