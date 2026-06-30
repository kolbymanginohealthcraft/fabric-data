// Primary payer per PatientCase (for short-stay scoping). min/week dose logic applies
// ONLY to short-stay Part A (Medicare Part A + Managed Care Part A); this lets the
// analysis restrict to that cohort.
//
// Chain: CasePayerSet -> ResidentPayerSequence (Sequence=1 = primary) -> ResidentPayer
//        -> PayerPayerType -> PayerType (Descrip). One primary payer per case
//        (lowest sequence, latest set). Fact = Bronze. Window = scorecard trailing-12mo.
//
// Output: data/track-payer.csv (PatientCase_ID, PayerType_ID, Payer, ShortStayA). Read-only.
// Usage: node queries/pull-track-payer.js [--years N] [--out path]
const fs=require("fs"), path=require("path"); const {query,closeAll}=require("../fabric-query");
const REPO=path.join(__dirname,"..");
function args(){const a=process.argv.slice(2);let y=1,o=path.join(REPO,"data","track-payer.csv");
  for(let i=0;i<a.length;i++){if(a[i]==="--years")y=parseInt(a[++i],10);else if(a[i]==="--out")o=a[++i];}return{y,o};}
function esc(v){if(v==null)return"";const s=String(v);return /[,"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csv(r){if(!r.length)return"";const h=Object.keys(r[0]);return [h.join(",")].concat(r.map(x=>h.map(k=>esc(x[k])).join(","))).join("\n")+"\n";}
const SQL=`
WITH WinCases AS (
  SELECT DISTINCT trk.PatientCase_ID FROM dbo.TxTrack trk
  WHERE trk.IsDeletedTrack=0
    AND trk.EndDate >= DATEADD(YEAR,@YEARS,DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)))
    AND trk.EndDate <  DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))
),
Prim AS (
  SELECT cps.PatientCase_ID, pt.PayerType_ID, pt.Descrip,
         ROW_NUMBER() OVER (PARTITION BY cps.PatientCase_ID ORDER BY rps.Sequence ASC, cps.FromDate DESC) rn
  FROM dbo.CasePayerSet cps
  JOIN WinCases wc ON wc.PatientCase_ID=cps.PatientCase_ID
  JOIN dbo.ResidentPayerSequence rps ON rps.ResidentPayerSet_ID=cps.ResidentPayerSet_ID
  JOIN dbo.ResidentPayer rp ON rp.ResidentPayer_ID=rps.ResidentPayer_ID
  JOIN dbo.PayerPayerType ppt ON ppt.PayerPayerType_ID=rp.PayerPayerType_ID
  JOIN dbo.PayerType pt ON pt.PayerType_ID=ppt.PayerType_ID
)
SELECT PatientCase_ID, PayerType_ID, Descrip AS Payer FROM Prim WHERE rn=1`;
(async()=>{const{y,o}=args();console.error(`track-payer pull: trailing ${y}yr (Bronze) -> ${o}`);
  const t0=Date.now(); const rows=(await query(SQL.replace("@YEARS",`-${y}`),"bronze")).recordset;
  const SSA=new Set([1,6]); // Medicare Part A, Managed Care Part A
  rows.forEach(r=>r.ShortStayA = SSA.has(r.PayerType_ID)?1:0);
  console.error(`rows: ${rows.length} in ${Math.round((Date.now()-t0)/1000)}s; ShortStayA=${rows.filter(r=>r.ShortStayA).length}`);
  fs.writeFileSync(o,csv(rows)); console.error(`wrote ${o}`); await closeAll();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
