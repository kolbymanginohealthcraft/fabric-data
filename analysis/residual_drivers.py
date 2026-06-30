"""
What moves the residual among PLANNED discharges?  (a)+(b)+(c) on the clean cohort.

(a) Re-fit expected-vs-observed on PLANNED-only (all payers, case grain) -> the headline
    risk-adjusted quality measure on episodes that ran their course.
(b) Hunt for what explains the residual: SCHEDULING/CONTINUITY levers (start-of-care lag,
    therapist count, primary-therapist share) and FACILITY effects, vs the dose levers.
(c) Payer-limit "capped potential" cohort: episodes ended by payer/benefit limits — were
    improving patients cut off early?

Outcomes = true measured GG only (ANA excluded). Planned = reason(CASEEND) clinical-completion,
or ambiguous-reason adjudicated by destination; out-of-control (adverse/decline/payer) dropped
from the planned cohort (payer kept aside for (c)). Observational throughout.

Usage: python -m analysis.residual_drivers
"""
import warnings, numpy as np, pandas as pd
from pathlib import Path
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.linear_model import Ridge
from sklearn.model_selection import cross_val_predict, KFold
from sklearn.metrics import r2_score
from scipy.stats import spearmanr
import statsmodels.api as sm
warnings.filterwarnings("ignore"); pd.options.mode.chained_assignment=None
D=Path("data"); OUT=Path("analysis/outputs"); RS=42

def icd_chapter(code):
    if not isinstance(code,str) or not code: return "Unknown"
    c=code[0].upper()
    try: nn=int(code[1:3])
    except: nn=-1
    return {"S":"S-T Injury","T":"S-T Injury","M":"M Musculoskeletal","I":"I Circulatory","G":"G Nervous",
            "F":"F Mental","J":"J Respiratory","N":"N Genitourinary","E":"E Endocrine","K":"K Digestive",
            "R":"R Symptoms","Z":"Z Aftercare"}.get(c,"C-D Neoplasm" if (c=="C" or (c=="D" and nn<=49)) else f"{c} Other")
def setting_of(d):
    d="" if not isinstance(d,str) else d
    for p,v in [("ILF","ILF"),("ALF","ALF"),("Home","Home")]:
        if d[:len(p)]==p: return v
    for k,v in [("Acute care hospital","Hospital"),("Rehab Hospital","IRF"),("SNF","SNF"),
                ("Memory","Memory Care"),("Hospice","Hospice"),("Expired","Expired")]:
        if k in d: return v
    return d
PLANNED_CLIN={"All Goals Met","Highest Practical Level Achieved","Maximum Potential Achieved, referred for RNP",
  "Maximum Potential Achieved, referred for FMP","Therapist Decision","Physician Decision","Discharged per Physician or Case Manager"}
ADVERSE={"Discharged to Hospital","Patient Expired","Expired due to complications from COVID-19",
  "Patient Transferred to Hospice Care","Patient exhibits change in medical status","Against Medical Advice"}
DECLINE={"Patient Refuses Treatment","Patient Non-compliant with Plan of Treatment","Patient and/or RSP Declines Further Tx",
  "Copay exists, patient/RSP declines treatment","Exhausted benefits, patient/RSP declines treatment"}
PAYER={"Payor/ Payment limitation","Change in Payer Source"}
UNPLANNED_SET={"Hospital","Hospice","Expired","Left Facility AMA"}

# ---- load ----
item=pd.read_csv(D/"gg-item-track.csv")
attr=pd.read_csv(D/"track-attributes.csv")
base=pd.read_csv(D/"track-base.csv",usecols=["TxTrack_ID","PatientCase_ID","Facility_ID"])
trk =pd.read_csv(D/"tracks.csv",usecols=["TxTrack_ID","PatientCase_ID","track_minutes"])
sess=pd.read_csv(D/"track-sessions.csv")
att =pd.read_csv(D/"therapist-attribution.csv")
pay =pd.read_csv(D/"track-payer.csv"); fac=pd.read_csv(D/"facility-dim.csv")
dc  =pd.read_csv(D/"case-discharge.csv")
attr["age"]=(pd.to_datetime(attr.TrackStart,errors="coerce")-pd.to_datetime(attr.DOB,errors="coerce")).dt.days/365.25
attr["dx_chapter"]=attr.PrimaryDxCode.astype("string").fillna("").map(icd_chapter)

# ---- case composite + givens ----
itc=(item.merge(base,on="TxTrack_ID",how="inner")
        .merge(attr[["TxTrack_ID","age","Gender","dx_chapter"]],on="TxTrack_ID",how="left"))
ci=itc.groupby(["PatientCase_ID","LibraryItem_ID"]).agg(adm=("Eval","mean"),dis=("Disch","mean")).reset_index()
case=ci.groupby("PatientCase_ID").agg(adm_score=("adm","mean"),dis_score=("dis","mean"),n_items=("adm","size")).reset_index()
g=(itc.groupby("PatientCase_ID").agg(age=("age","mean"),
     Gender=("Gender",lambda s:s.mode().iat[0] if len(s.mode()) else "U"),
     dx_chapter=("dx_chapter",lambda s:s.mode().iat[0] if len(s.mode()) else "Unknown"),
     Facility_ID=("Facility_ID",lambda s:s.mode().iat[0] if len(s.mode()) else np.nan)).reset_index())
case=case.merge(g,on="PatientCase_ID").merge(pay,on="PatientCase_ID",how="left").merge(fac,on="Facility_ID",how="left")

# ---- dose + scheduling levers per case ----
tt=(trk.merge(sess,on="TxTrack_ID",how="left")
       .merge(attr[["TxTrack_ID","TrackStart"]],on="TxTrack_ID",how="left"))
tt["ts"]=pd.to_datetime(tt.TrackStart,errors="coerce"); tt["fs"]=pd.to_datetime(tt.first_session,errors="coerce")
tt["le"]=pd.to_datetime(tt.last_session,errors="coerce")
dose=tt.groupby("PatientCase_ID").agg(total_min=("track_minutes","sum"),sessions=("sessions","sum"),
     cstart=("ts","min"),first_sess=("fs","min"),last_sess=("le","max")).reset_index()
dose["weeks"]=((dose.last_sess-dose.first_sess).dt.days.clip(lower=3))/7
dose["frequency"]=dose.sessions/dose.weeks
dose["min_per_session"]=dose.total_min/dose.sessions
dose["soc_lag"]=(dose.first_sess-dose.cstart).dt.days.clip(lower=0)
# therapist continuity from attribution (treating clinicians)
at=att.merge(base[["TxTrack_ID","PatientCase_ID"]],on="TxTrack_ID",how="inner")
cont=at.groupby("PatientCase_ID").apply(lambda x: pd.Series({
    "n_therapists": x.Person_ID.nunique(),
    "primary_share": (x.groupby("Person_ID").Total_Treatment_Minutes.sum().max() /
                      max(1,x.Total_Treatment_Minutes.sum()))}),include_groups=False).reset_index()
case=case.merge(dose,on="PatientCase_ID",how="left").merge(cont,on="PatientCase_ID",how="left")

# ---- discharge reason/destination -> planned flag ----
case=case.merge(dc,on="PatientCase_ID",how="left")
case["setting"]=case.DischargedTo.map(setting_of)
def planned_flag(r):
    rs=r.EndReason
    if rs=="Evaluation Only": return np.nan
    if rs in PLANNED_CLIN: return True
    if rs in ADVERSE or rs in DECLINE or rs in PAYER: return False
    return (r.setting not in UNPLANNED_SET)   # ambiguous/missing -> destination adjudicates
case["planned"]=case.apply(planned_flag,axis=1)
case["payer_limited"]=case.EndReason.isin(PAYER)

base_ok=( (case.n_items>=8)&(case.age.between(50,105))&(case.DivisionCode.isin([8450,5500,6500]))
         &(case.weeks.between(0.3,52))&(case.sessions.between(2,400))&(case.total_min.between(30,30000))
         &(case.soc_lag.between(0,60))&(case.n_therapists.between(1,30)) )
c=case[base_ok & (case.planned==True)].copy()
c["age2"]=c.age**2
print("="*78); print("PLANNED-COHORT residual drivers (a/b/c)"); print("="*78)
print(f"planned cases: {len(c):,}  facilities: {c.Facility_ID.nunique():,}")

# (a) expected within planned
NUM=["adm_score","age","age2"]; CAT=["dx_chapter","Gender","Payer"]
pipe=Pipeline([("p",ColumnTransformer([("n",StandardScaler(),NUM),
      ("c",OneHotEncoder(handle_unknown="ignore",min_frequency=200),CAT)])),("m",Ridge(1.0))])
c["expected"]=cross_val_predict(pipe,c[NUM+CAT],c.dis_score.values,cv=KFold(5,shuffle=True,random_state=RS))
c["residual"]=c.dis_score-c.expected
print(f"(a) expected-level R^2 (planned, givens only) = {r2_score(c.dis_score,c.expected):.3f}; residual sd={c.residual.std():.2f}")

# (b) facility variance share + reliability
grand=c.residual.mean()
fg=c.groupby("Facility_ID").residual.agg(["size","mean"]); fg=fg[fg["size"]>=30]
between=(fg["size"]*(fg["mean"]-grand)**2).sum(); total=((c.residual-grand)**2).sum()
print(f"(b) FACILITY variance share of residual (>=30-case facilities) = {between/total:.3f}")
rng=np.random.default_rng(RS); c["half"]=rng.integers(0,2,len(c))
h=c.groupby(["Facility_ID","half"]).residual.mean().unstack().loc[fg.index].dropna()
print(f"    facility split-half reliability rho={spearmanr(h[0],h[1]).correlation:.3f} (n={len(h)} facilities)")

# (b) levers vs residual: univariate spearman + joint incremental R^2
levers={"soc_lag":"start-of-care lag (days)","n_therapists":"# therapists (case)",
        "primary_share":"primary-therapist share","frequency":"frequency (sess/wk)",
        "min_per_session":"min/session","weeks":"duration (weeks)","total_min":"volume (min)"}
print("\n(b) lever -> residual:  univariate Spearman | solo R^2")
for v,lbl in levers.items():
    rho=spearmanr(c[v],c.residual).correlation
    z=(c[v]-c[v].mean())/c[v].std(); r2=sm.OLS(c.residual,sm.add_constant(z)).fit().rsquared
    print(f"    {lbl:26} rho={rho:+.3f}   R^2={r2:.3f}")
# joint scheduling-only vs +dose vs +facility-mean
def r2cols(cols):
    Z=pd.DataFrame({v:(c[v]-c[v].mean())/c[v].std() for v in cols})
    return sm.OLS(c.residual,sm.add_constant(Z)).fit().rsquared
print(f"\n    joint scheduling {{soc_lag,n_therapists,primary_share}} R^2={r2cols(['soc_lag','n_therapists','primary_share']):.3f}")
print(f"    joint dose {{frequency,min_per_session,weeks}}            R^2={r2cols(['frequency','min_per_session','weeks']):.3f}")
print(f"    scheduling + dose together                          R^2={r2cols(['soc_lag','n_therapists','primary_share','frequency','min_per_session','weeks']):.3f}")
print(f"    (for scale: FACILITY alone explains {between/total:.3f})")

# univariate quintiles for the most interesting scheduling levers
def quint(col,lbl):
    c["_q"]=pd.qcut(c[col],5,duplicates="drop")
    gg=c.groupby("_q").agg(n=("residual","size"),resid=("residual","mean"),lo=(col,"min"),hi=(col,"max"))
    print(f"\n    {lbl} quintiles:")
    for _,r in gg.iterrows(): print(f"      {r.lo:6.1f}-{r.hi:<6.1f} n={int(r.n):>5} resid={r.resid:+.3f}")
quint("soc_lag","start-of-care lag"); quint("primary_share","primary-therapist share")

# (c) payer-limited "capped potential": residual vs duration, payer-limit vs clinical-completion
print("\n(c) PAYER-LIMITED vs CLINICAL-COMPLETION (capped potential?):")
cc=case[base_ok].copy()
cc["age2"]=cc.age**2
cc["expected"]=cross_val_predict(pipe,cc[NUM+CAT],cc.dis_score.values,cv=KFold(5,shuffle=True,random_state=RS))
cc["residual"]=cc.dis_score-cc.expected
for grp,mask in [("clinical-completion",cc.EndReason.isin(PLANNED_CLIN)),("payer-limited",cc.payer_limited)]:
    d=cc[mask]
    print(f"   {grp:20} n={len(d):>6}  resid={d.residual.mean():+.3f}  med weeks={d.weeks.median():.1f}  "
          f"med adm={d.adm_score.median():.2f}  %beat={100*(d.residual>=0).mean():.0f}")
c.to_csv(OUT/"residual_drivers.csv",index=False)
print("\nDONE -> analysis/outputs/residual_drivers.csv")
