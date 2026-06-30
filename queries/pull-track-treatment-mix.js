// Per-track treatment MIX (CPT/service categories, group, telehealth, assistant-delivered)
// from TxMinute -> Service (+TxSession for telehealth). To test which interventions/modalities
// associate with beating-expected. Window=scorecard 12mo. Fact=Bronze. Read-only.
// Categories: ACTIVE (ther-ex/activities/gait/neuro-re-ed/self-care/manual/etc.),
// MODALITY (passive: e-stim/ultrasound/diathermy/hotpack/etc.), GROUP (Service.IsGroup),
// COGNITIVE (97129/30), SPEECH/SWALLOW (925xx), AQUATIC (97113), EVAL (97161-68/925xx eval).
// Output: data/track-treatment-mix.csv. Usage: node queries/pull-track-treatment-mix.js [--years N]
const fs=require("fs"), path=require("path"); const {query,closeAll}=require("../fabric-query");
const REPO=path.join(__dirname,"..");
function args(){const a=process.argv.slice(2);let y=1,o=path.join(REPO,"data","track-treatment-mix.csv");
  for(let i=0;i<a.length;i++){if(a[i]==="--years")y=parseInt(a[++i],10);else if(a[i]==="--out")o=a[++i];}return{y,o};}
function esc(v){if(v==null)return"";const s=String(v);return /[,"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csv(r){if(!r.length)return"";const h=Object.keys(r[0]);return [h.join(",")].concat(r.map(x=>h.map(k=>esc(x[k])).join(","))).join("\n")+"\n";}
const ACTIVE="'97110','97112','97116','97124','97140','97530','97533','97535','97537','97542','97750','97760','97761','97763'";
const MOD="'97010','97012','97014','97016','97018','97022','97024','97026','97028','97032','97033','97034','97035','97039','G0283','G0281','G0282'";
const SQL=`
SELECT t.TxTrack_ID,
  SUM(m.Duration) AS total_min,
  SUM(CASE WHEN sv.ServiceCode IN (${ACTIVE}) THEN m.Duration ELSE 0 END) AS active_min,
  SUM(CASE WHEN sv.ServiceCode IN (${MOD}) THEN m.Duration ELSE 0 END) AS modality_min,
  SUM(CASE WHEN sv.IsGroup=1 THEN m.Duration ELSE 0 END) AS group_min,
  SUM(CASE WHEN sv.ServiceCode IN ('97129','97130') THEN m.Duration ELSE 0 END) AS cognitive_min,
  SUM(CASE WHEN sv.ServiceCode IN ('92507','92526','92508','92609','92610') THEN m.Duration ELSE 0 END) AS speech_min,
  SUM(CASE WHEN sv.ServiceCode='97113' THEN m.Duration ELSE 0 END) AS aquatic_min,
  SUM(CASE WHEN m.AssistantModifier=1 THEN m.Duration ELSE 0 END) AS assistant_min,
  SUM(CASE WHEN s.InteractionMethod IN ('ESynchronous','EASynchronous') THEN m.Duration ELSE 0 END) AS telehealth_min,
  COUNT(DISTINCT sv.ServiceCode) AS n_cpt
FROM dbo.TxMinute m
JOIN dbo.TxSession s ON s.TxSession_ID=m.TxSession_ID
JOIN dbo.TxTrack   t ON t.TxTrack_ID=s.TxTrack_ID AND t.IsDeletedTrack=0
JOIN dbo.Service  sv ON sv.Service_ID=m.Service_ID
WHERE m.IsDeletedService=0 AND s.IsDeletedSession=0
  AND t.EndDate >= DATEADD(YEAR,@YEARS,DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)))
  AND t.EndDate <  DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))
GROUP BY t.TxTrack_ID`;
(async()=>{const{y,o}=args();console.error(`track-treatment-mix pull: trailing ${y}yr (Bronze, TxMinute) -> ${o}`);
  const t0=Date.now(); const rows=(await query(SQL.replace("@YEARS",`-${y}`),"bronze")).recordset;
  console.error(`rows: ${rows.length} in ${Math.round((Date.now()-t0)/1000)}s`);
  fs.writeFileSync(o,csv(rows)); console.error(`wrote ${o}`); await closeAll();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
