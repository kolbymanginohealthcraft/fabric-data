// Per-track TELEHEALTH minutes — CORRECT definition: billing modifier '95' (per legacy
// model's Telehealth table = BillingInfo TxSession_ID where any Modifier='95'). Source here:
// Billing.ARCharge (has TxTrack_ID + Modifier1-3 directly). Replaces the earlier
// TxSession.InteractionMethod guess. Window=scorecard 12mo. Output: data/track-telehealth.csv.
// Usage: node queries/pull-track-telehealth.js [--years N]
const fs=require("fs"), path=require("path"); const {query,closeAll}=require("../fabric-query");
const REPO=path.join(__dirname,"..");
function args(){const a=process.argv.slice(2);let y=1,o=path.join(REPO,"data","track-telehealth.csv");
  for(let i=0;i<a.length;i++){if(a[i]==="--years")y=parseInt(a[++i],10);else if(a[i]==="--out")o=a[++i];}return{y,o};}
function esc(v){if(v==null)return"";const s=String(v);return /[,"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csv(r){if(!r.length)return"";const h=Object.keys(r[0]);return [h.join(",")].concat(r.map(x=>h.map(k=>esc(x[k])).join(","))).join("\n")+"\n";}
// Modifier '95' lives at claim-line grain (Billing.ARClaimDetail, Modifier1-8); join to
// Billing.ARCharge via ARChargeID for the TxTrack_ID link. (ARCharge's own modifiers are sparse.)
const SQL=`
SELECT t.TxTrack_ID, SUM(c.Duration) AS tele_min, COUNT(*) AS tele_charges
FROM Billing.ARClaimDetail cd
JOIN Billing.ARCharge c ON c.ARChargeID=cd.ARChargeID
JOIN dbo.TxTrack t ON t.TxTrack_ID=c.TxTrack_ID AND t.IsDeletedTrack=0
WHERE '95' IN (cd.Modifier1,cd.Modifier2,cd.Modifier3,cd.Modifier4,cd.Modifier5,cd.Modifier6,cd.Modifier7,cd.Modifier8)
  AND c.TxTrack_ID IS NOT NULL
  AND t.EndDate >= DATEADD(YEAR,@YEARS,DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)))
  AND t.EndDate <  DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))
GROUP BY t.TxTrack_ID`;
(async()=>{const{y,o}=args();console.error(`track-telehealth pull (modifier 95, Billing.ARCharge): trailing ${y}yr -> ${o}`);
  const t0=Date.now(); const rows=(await query(SQL.replace("@YEARS",`-${y}`),"bronze")).recordset;
  console.error(`telehealth tracks: ${rows.length} in ${Math.round((Date.now()-t0)/1000)}s`);
  fs.writeFileSync(o,csv(rows)); console.error(`wrote ${o}`); await closeAll();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
