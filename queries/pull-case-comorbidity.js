// Per-case comorbidity burden + high-impact comorbidity flags, from the FULL medical
// diagnosis list (TxDiagnosis MEDICAL, all docs in the case) — to enrich the case-mix
// "givens" in the expected-outcome model and test how much of the facility effect is
// unmeasured case-mix. (Primary-dx-only is in track-attributes; this adds the rest.)
// No structured BIMS exists in therapy data -> cm_dementia is the cognition proxy.
// Fact = Bronze. Window = scorecard trailing-12mo. Output: data/case-comorbidity.csv. Read-only.
// Usage: node queries/pull-case-comorbidity.js [--years N] [--out path]
const fs=require("fs"), path=require("path"); const {query,closeAll}=require("../fabric-query");
const REPO=path.join(__dirname,"..");
function args(){const a=process.argv.slice(2);let y=1,o=path.join(REPO,"data","case-comorbidity.csv");
  for(let i=0;i<a.length;i++){if(a[i]==="--years")y=parseInt(a[++i],10);else if(a[i]==="--out")o=a[++i];}return{y,o};}
function esc(v){if(v==null)return"";const s=String(v);return /[,"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csv(r){if(!r.length)return"";const h=Object.keys(r[0]);return [h.join(",")].concat(r.map(x=>h.map(k=>esc(x[k])).join(","))).join("\n")+"\n";}
const SQL=`
WITH dx AS (
  SELECT DISTINCT tk.PatientCase_ID, dc.Code, LEFT(dc.Code,3) AS cat3
  FROM dbo.TxDiagnosis td
  JOIN dbo.TxDocument doc ON doc.TxDocument_ID=td.TxDocument_ID
  JOIN dbo.TxTrack   tk  ON tk.TxTrack_ID=doc.TxTrack_ID AND tk.IsDeletedTrack=0
  JOIN dbo.DiagnosisCode dc ON dc.DiagnosisCode_ID=td.DiagnosisCode_ID
  WHERE td.DiagnosisType='MEDICAL' AND td.IsInactive=0 AND dc.Code IS NOT NULL
    AND tk.EndDate >= DATEADD(YEAR,@YEARS,DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)))
    AND tk.EndDate <  DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))
)
SELECT PatientCase_ID,
  COUNT(DISTINCT Code) AS comorbidity_count,
  COUNT(DISTINCT cat3) AS comorbidity_groups,
  MAX(CASE WHEN cat3 IN ('F00','F01','F02','F03','G30','G31') THEN 1 ELSE 0 END) AS cm_dementia,
  MAX(CASE WHEN cat3='I50' THEN 1 ELSE 0 END) AS cm_chf,
  MAX(CASE WHEN cat3 IN ('J40','J41','J42','J43','J44','J45','J47') THEN 1 ELSE 0 END) AS cm_copd,
  MAX(CASE WHEN cat3 IN ('E08','E09','E10','E11','E13') THEN 1 ELSE 0 END) AS cm_diabetes,
  MAX(CASE WHEN cat3 IN ('N18','N19') THEN 1 ELSE 0 END) AS cm_ckd,
  MAX(CASE WHEN cat3 LIKE 'I6%' OR cat3='G81' OR cat3='G82' THEN 1 ELSE 0 END) AS cm_stroke_paralysis,
  MAX(CASE WHEN cat3='E66' THEN 1 ELSE 0 END) AS cm_obesity,
  MAX(CASE WHEN cat3 IN ('F31','F32','F33','F41') THEN 1 ELSE 0 END) AS cm_mood,
  MAX(CASE WHEN LEFT(Code,1)='C' THEN 1 ELSE 0 END) AS cm_cancer,
  MAX(CASE WHEN cat3 IN ('G20','G35','G12','G70','G80') THEN 1 ELSE 0 END) AS cm_neurodegen
FROM dx GROUP BY PatientCase_ID`;
(async()=>{const{y,o}=args();console.error(`case-comorbidity pull: trailing ${y}yr (Bronze) -> ${o}`);
  const t0=Date.now(); const rows=(await query(SQL.replace("@YEARS",`-${y}`),"bronze")).recordset;
  console.error(`rows: ${rows.length} in ${Math.round((Date.now()-t0)/1000)}s`);
  fs.writeFileSync(o,csv(rows)); console.error(`wrote ${o}`); await closeAll();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
