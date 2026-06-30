// Per-case PRIMARY medical dx, PRIMARY treatment dx, and a proper SECONDARY-comorbidity
// count — fixing the earlier conflation (comorbidity had included the principal dx).
//   MEDICAL  = the disease (dementia, COPD, cerebral infarction, ...)
//   TREATMENT= the functional impairment therapy targets (M62.81 weakness, R26.x gait, ...)
// Primary = DisplayOrder rank, EVAL document preferred. med_groups_secondary = distinct
// MEDICAL 3-char categories EXCLUDING the primary medical category. Fact=Bronze, window=12mo.
// Output: data/case-diagnoses.csv. Read-only.
// Usage: node queries/pull-case-diagnoses.js [--years N] [--out path]
const fs=require("fs"), path=require("path"); const {query,closeAll}=require("../fabric-query");
const REPO=path.join(__dirname,"..");
function args(){const a=process.argv.slice(2);let y=1,o=path.join(REPO,"data","case-diagnoses.csv");
  for(let i=0;i<a.length;i++){if(a[i]==="--years")y=parseInt(a[++i],10);else if(a[i]==="--out")o=a[++i];}return{y,o};}
function esc(v){if(v==null)return"";const s=String(v);return /[,"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csv(r){if(!r.length)return"";const h=Object.keys(r[0]);return [h.join(",")].concat(r.map(x=>h.map(k=>esc(x[k])).join(","))).join("\n")+"\n";}
const W=`tk.EndDate >= DATEADD(YEAR,@YEARS,DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)))
     AND tk.EndDate <  DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))`;
const SQL=`
WITH Mr AS (
  SELECT tk.PatientCase_ID, dc.Code,
    ROW_NUMBER() OVER (PARTITION BY tk.PatientCase_ID
      ORDER BY CASE WHEN doc.DocumentType='EVAL' THEN 0 ELSE 1 END, td.DisplayOrder, td.TxDiagnosis_ID) rn
  FROM dbo.TxDiagnosis td
  JOIN dbo.TxDocument doc ON doc.TxDocument_ID=td.TxDocument_ID
  JOIN dbo.TxTrack tk ON tk.TxTrack_ID=doc.TxTrack_ID AND tk.IsDeletedTrack=0
  JOIN dbo.DiagnosisCode dc ON dc.DiagnosisCode_ID=td.DiagnosisCode_ID
  WHERE td.DiagnosisType='MEDICAL' AND td.IsInactive=0 AND dc.Code IS NOT NULL AND ${W}
),
Tr AS (
  SELECT tk.PatientCase_ID, dc.Code,
    ROW_NUMBER() OVER (PARTITION BY tk.PatientCase_ID
      ORDER BY CASE WHEN doc.DocumentType='EVAL' THEN 0 ELSE 1 END, td.DisplayOrder, td.TxDiagnosis_ID) rn
  FROM dbo.TxDiagnosis td
  JOIN dbo.TxDocument doc ON doc.TxDocument_ID=td.TxDocument_ID
  JOIN dbo.TxTrack tk ON tk.TxTrack_ID=doc.TxTrack_ID AND tk.IsDeletedTrack=0
  JOIN dbo.DiagnosisCode dc ON dc.DiagnosisCode_ID=td.DiagnosisCode_ID
  WHERE td.DiagnosisType='TREATMENT' AND td.IsInactive=0 AND dc.Code IS NOT NULL AND ${W}
),
Mall AS (
  SELECT tk.PatientCase_ID, LEFT(dc.Code,3) cat3
  FROM dbo.TxDiagnosis td
  JOIN dbo.TxDocument doc ON doc.TxDocument_ID=td.TxDocument_ID
  JOIN dbo.TxTrack tk ON tk.TxTrack_ID=doc.TxTrack_ID AND tk.IsDeletedTrack=0
  JOIN dbo.DiagnosisCode dc ON dc.DiagnosisCode_ID=td.DiagnosisCode_ID
  WHERE td.DiagnosisType='MEDICAL' AND td.IsInactive=0 AND dc.Code IS NOT NULL AND ${W}
  GROUP BY tk.PatientCase_ID, LEFT(dc.Code,3)
)
SELECT m1.PatientCase_ID,
       m1.Code AS med_primary,
       t1.Code AS tx_primary,
       (SELECT COUNT(*) FROM Mall a WHERE a.PatientCase_ID=m1.PatientCase_ID
          AND a.cat3 <> LEFT(m1.Code,3)) AS med_groups_secondary
FROM (SELECT PatientCase_ID, Code FROM Mr WHERE rn=1) m1
LEFT JOIN (SELECT PatientCase_ID, Code FROM Tr WHERE rn=1) t1 ON t1.PatientCase_ID=m1.PatientCase_ID`;
(async()=>{const{y,o}=args();console.error(`case-diagnoses pull: trailing ${y}yr (Bronze) -> ${o}`);
  const t0=Date.now(); const rows=(await query(SQL.replace(/@YEARS/g,`-${y}`),"bronze")).recordset;
  console.error(`rows: ${rows.length} in ${Math.round((Date.now()-t0)/1000)}s`);
  fs.writeFileSync(o,csv(rows)); console.error(`wrote ${o}`); await closeAll();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
