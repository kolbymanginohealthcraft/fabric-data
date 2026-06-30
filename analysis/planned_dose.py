"""
PLANNED discharges only — does the duration "lever" survive once we drop episodes that
ended for reasons OUT OF OUR CONTROL (acute event, refusal, expired, payer/benefit)?

Layered planned definition (reason + destination):
  reason CASEEND classes:
    PLANNED_CLIN (goals/clinical completion)  -> planned
    ADVERSE (hospital/expired/hospice/AMA/medical change), DECLINE (refuse/non-compliant/
      benefit-exhausted), PAYER (payer/payment limit)      -> NOT planned (out of our control)
    AMBIG (Facility Discharge / Patient-Family decision / Other) -> adjudicate by DESTINATION
    EVAL ONLY -> dropped (no treatment course)
  destination unplanned settings: Hospital, Hospice, Expired, Left Facility AMA.

Then re-fit EXPECTED discharge (givens only) WITHIN the planned cohort and recompute the
lever decomposition, vs the all-discharge cohort. If duration's dominance collapses, the
earlier "longer = better" was largely truncation confounding (short = adverse/early-ended).

Usage: python -m analysis.planned_dose
"""
import warnings, numpy as np, pandas as pd
from pathlib import Path
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.linear_model import Ridge
from sklearn.model_selection import cross_val_predict, KFold
import statsmodels.api as sm
warnings.filterwarnings("ignore"); pd.options.mode.chained_assignment=None
D=Path("data"); OUT=Path("analysis/outputs"); RS=42

PLANNED_CLIN={"All Goals Met","Highest Practical Level Achieved","Maximum Potential Achieved, referred for RNP",
  "Maximum Potential Achieved, referred for FMP","Therapist Decision","Physician Decision",
  "Discharged per Physician or Case Manager"}
ADVERSE={"Discharged to Hospital","Patient Expired","Expired due to complications from COVID-19",
  "Patient Transferred to Hospice Care","Patient exhibits change in medical status","Against Medical Advice"}
DECLINE={"Patient Refuses Treatment","Patient Non-compliant with Plan of Treatment",
  "Patient and/or RSP Declines Further Tx","Copay exists, patient/RSP declines treatment",
  "Exhausted benefits, patient/RSP declines treatment"}
PAYER={"Payor/ Payment limitation","Change in Payer Source"}
AMBIG={"Facility Discharge","Patient/ Family decision","Other"}
UNPLANNED_SET={"Hospital","Hospice","Expired","Left Facility AMA"}
def setting_of(d):
    d="" if not isinstance(d,str) else d
    if d[:3]=="ILF":return "ILF"
    if d[:3]=="ALF":return "ALF"
    if d[:4]=="Home":return "Home"
    if "Acute care hospital" in d:return "Hospital"
    if "Rehab Hospital" in d:return "IRF"
    if "SNF" in d:return "SNF"
    if "Memory" in d:return "Memory Care"
    if "Hospice" in d:return "Hospice"
    if "Expired" in d:return "Expired"
    return d
def reason_class(r):
    if not isinstance(r,str) or r=="":return "MISSING"
    if r in PLANNED_CLIN:return "PLANNED_CLIN"
    if r in ADVERSE:return "ADVERSE"
    if r in DECLINE:return "DECLINE"
    if r in PAYER:return "PAYER"
    if r=="Evaluation Only":return "EVAL_ONLY"
    if r in AMBIG:return "AMBIG"
    return "OTHER"

c=pd.read_csv(OUT/"dose_decompose.csv")          # short-stay A cases: residual, decomposed dose, givens
dc=pd.read_csv(D/"case-discharge.csv")
c=c.merge(dc,on="PatientCase_ID",how="left")
c["setting"]=c.DischargedTo.map(setting_of)
c["rclass"]=c.EndReason.map(reason_class)
c["dest_planned"]=~c["setting"].isin(UNPLANNED_SET)
def planned_flag(row):
    rc=row.rclass
    if rc=="EVAL_ONLY":return np.nan          # drop
    if rc=="PLANNED_CLIN":return True
    if rc in ("ADVERSE","DECLINE","PAYER"):return False
    return bool(row.dest_planned)             # AMBIG / OTHER / MISSING -> destination adjudicates
c["planned"]=c.apply(planned_flag,axis=1)

print("="*78); print("PLANNED-ONLY re-analysis (short-stay Part A)"); print("="*78)
print("\n-- discharge reason class: share, mean residual, median duration/volume --")
t=(c.groupby("rclass").agg(n=("residual","size"),mean_resid=("residual","mean"),
     med_weeks=("weeks","median"),med_total=("total_min","median"),
     beat=("residual",lambda r:(r>=0).mean()*100)).sort_values("mean_resid",ascending=False))
for cl,r in t.iterrows():
    print(f"   {cl:13} n={int(r.n):>6}  resid={r.mean_resid:+.3f}  {r.beat:3.0f}% beat  "
          f"med {r.med_weeks:.1f}wk / {int(r.med_total)}min")

cl=c[c.planned==True].copy(); allc=c.dropna(subset=["planned"]).copy()
print(f"\nplanned cases: {len(cl):,} of {len(allc):,} ({len(cl)/len(allc):.0%})  "
      f"(Eval-Only dropped: {int((c.rclass=='EVAL_ONLY').sum())})")

# ---- re-fit EXPECTED within planned cohort, recompute residual ----
def refit(d):
    d=d.copy(); d["age2"]=d.age**2
    NUM=["adm_score","age","age2"]; CAT=["dx_chapter","Gender","Payer"]
    pipe=Pipeline([("p",ColumnTransformer([("n",StandardScaler(),NUM),
        ("c",OneHotEncoder(handle_unknown="ignore",min_frequency=200),CAT)])),("m",Ridge(1.0))])
    d["resid_p"]=d.dis_score-cross_val_predict(pipe,d[NUM+CAT],d.dis_score.values,cv=KFold(5,shuffle=True,random_state=RS))
    return d
cl=refit(cl)

def nested(d,resid):
    for v in ["frequency","min_per_session","weeks","min_per_week","total_min"]:
        d["z_"+v]=(np.log(d[v])-np.log(d[v]).mean())/np.log(d[v]).std()
    def r2(cols):
        X=sm.add_constant(d[["z_"+v for v in cols]]); return sm.OLS(d[resid],X).fit().rsquared
    return {"min/week":r2(["min_per_week"]),"frequency":r2(["frequency"]),
            "per-session":r2(["min_per_session"]),"duration":r2(["weeks"]),
            "volume":r2(["total_min"]),
            "freq+persession+duration":r2(["frequency","min_per_session","weeks"])}

print("\n-- lever nested R^2: ALL short-stay A vs PLANNED-only --")
na=nested(allc.assign(z=0),"residual"); npl=nested(cl,"resid_p")
print(f"   {'lever':28}{'ALL':>8}{'PLANNED':>9}")
for k in na: print(f"   {k:28}{na[k]:>8.3f}{npl[k]:>9.3f}")

# ---- duration univariate shape: planned vs all ----
def dur_shape(d,resid,lbl):
    d=d.copy(); d["q"]=pd.qcut(d.weeks,5,duplicates="drop")
    g=d.groupby("q").agg(n=("weeks","size"),resid=(resid,"mean"),lo=("weeks","min"),hi=("weeks","max"))
    print(f"\n   duration shape [{lbl}]:")
    for _,r in g.iterrows():
        print(f"     {r.lo:4.1f}-{r.hi:<4.1f}wk n={int(r.n):>5} resid={r.resid:+.3f}")
dur_shape(allc,"residual","ALL short-stay A")
dur_shape(cl,"resid_p","PLANNED only")
cl.to_csv(OUT/"planned_dose.csv",index=False)
print("\nDONE -> analysis/outputs/planned_dose.csv")
