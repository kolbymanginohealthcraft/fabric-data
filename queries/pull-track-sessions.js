// Delivered session counts per track — to decompose dose into FREQUENCY (sessions/wk)
// and PER-SESSION INTENSITY (minutes/session), instead of the composite minutes/week.
// Delivered = not deleted and no MissedReason. Fact = Bronze. Window = scorecard 12mo.
//
// Output: data/track-sessions.csv (TxTrack_ID, sessions, session_days). Read-only.
// Usage: node queries/pull-track-sessions.js [--years N] [--out path]
const fs=require("fs"), path=require("path"); const {query,closeAll}=require("../fabric-query");
const REPO=path.join(__dirname,"..");
function args(){const a=process.argv.slice(2);let y=1,o=path.join(REPO,"data","track-sessions.csv");
  for(let i=0;i<a.length;i++){if(a[i]==="--years")y=parseInt(a[++i],10);else if(a[i]==="--out")o=a[++i];}return{y,o};}
function esc(v){if(v==null)return"";const s=String(v);return /[,"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csv(r){if(!r.length)return"";const h=Object.keys(r[0]);return [h.join(",")].concat(r.map(x=>h.map(k=>esc(x[k])).join(","))).join("\n")+"\n";}
const SQL=`
SELECT s.TxTrack_ID,
       COUNT(*) AS sessions,
       COUNT(DISTINCT CONVERT(date,s.SessionDate)) AS session_days,
       CONVERT(varchar(10),MIN(s.SessionDate),23) AS first_session,
       CONVERT(varchar(10),MAX(s.SessionDate),23) AS last_session
FROM dbo.TxSession s
JOIN dbo.TxTrack trk ON trk.TxTrack_ID=s.TxTrack_ID
WHERE s.IsDeletedSession=0 AND s.MissedReason IS NULL AND trk.IsDeletedTrack=0
  AND trk.EndDate >= DATEADD(YEAR,@YEARS,DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)))
  AND trk.EndDate <  DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))
GROUP BY s.TxTrack_ID`;
(async()=>{const{y,o}=args();console.error(`track-sessions pull: trailing ${y}yr (Bronze) -> ${o}`);
  const t0=Date.now(); const rows=(await query(SQL.replace("@YEARS",`-${y}`),"bronze")).recordset;
  console.error(`rows: ${rows.length} in ${Math.round((Date.now()-t0)/1000)}s`);
  fs.writeFileSync(o,csv(rows)); console.error(`wrote ${o}`); await closeAll();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
