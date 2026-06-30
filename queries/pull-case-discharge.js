// Per-case discharge DESTINATION (Lookup DISCHRGTO on DischargedTo_ID) + REASON
// (Lookup CASEEND on EndReason_ID) — to isolate PLANNED discharges (our care ran its
// course) from out-of-our-control endings (acute event, refusal, expired, payer/benefit).
// Layering both: reason classifies intent; destination adjudicates ambiguous reasons
// (e.g. Facility Discharge -> Home = planned vs -> Acute hospital = unplanned).
// Lookup_IDs are reused across Types, so each join is Type-filtered. Fact=Bronze, window=12mo.
//
// Output: data/case-discharge.csv (PatientCase_ID, DischargedTo, EndReason). Read-only.
// Usage: node queries/pull-case-discharge.js [--years N] [--out path]
const fs=require("fs"), path=require("path"); const {query,closeAll}=require("../fabric-query");
const REPO=path.join(__dirname,"..");
function args(){const a=process.argv.slice(2);let y=1,o=path.join(REPO,"data","case-discharge.csv");
  for(let i=0;i<a.length;i++){if(a[i]==="--years")y=parseInt(a[++i],10);else if(a[i]==="--out")o=a[++i];}return{y,o};}
function esc(v){if(v==null)return"";const s=String(v);return /[,"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csv(r){if(!r.length)return"";const h=Object.keys(r[0]);return [h.join(",")].concat(r.map(x=>h.map(k=>esc(x[k])).join(","))).join("\n")+"\n";}
const SQL=`
SELECT pc.PatientCase_ID,
       ldd.Descrip AS DischargedTo,
       lkr.Descrip AS EndReason
FROM dbo.PatientCase pc
LEFT JOIN dbo.Lookup ldd ON ldd.Lookup_ID=pc.DischargedTo_ID AND ldd.Type='DISCHRGTO '
LEFT JOIN dbo.Lookup lkr ON lkr.Lookup_ID=pc.EndReason_ID   AND lkr.Type='CASEEND   '
WHERE pc.IsDeletedCase=0
  AND pc.EndDate >= DATEADD(YEAR,@YEARS,DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1)))
  AND pc.EndDate <  DATEADD(MONTH,CASE WHEN DAY(GETDATE())>=10 THEN 0 ELSE -1 END,DATEFROMPARTS(YEAR(GETDATE()),MONTH(GETDATE()),1))`;
(async()=>{const{y,o}=args();console.error(`case-discharge pull: trailing ${y}yr (Bronze) -> ${o}`);
  const t0=Date.now(); const rows=(await query(SQL.replace("@YEARS",`-${y}`),"bronze")).recordset;
  console.error(`rows: ${rows.length} in ${Math.round((Date.now()-t0)/1000)}s`);
  fs.writeFileSync(o,csv(rows)); console.error(`wrote ${o}`); await closeAll();
})().catch(e=>{console.error("FAIL:",e.message);process.exit(1);});
