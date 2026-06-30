"""
Decomposing "minutes/week" — is the company's favorite metric the real lever, or a
costume worn by frequency / per-session intensity / duration?

min/week is a DERIVED composite:  min/week = frequency x min/session  (and
 volume = frequency x min/session x duration). The independent axes are really:
   FREQUENCY      = delivered sessions / week
   PER-SESSION    = minutes / session   (how much work each visit)
   DURATION       = weeks of care (LOS/7)
 with VOLUME (total min) and MIN/WEEK as their products.

We restrict to SHORT-STAY PART A (Medicare A + Managed Care A) where min/week is even
meaningful, re-fit EXPECTED discharge function within that cohort (givens only), then ask
which decomposed lever explains the residual (observed-minus-expected). True measured GG
only (ANA excluded, never recoded to dependency). Observational — see caveats in prior scripts.

Usage: python -m analysis.dose_decompose
"""
import warnings, numpy as np, pandas as pd
from pathlib import Path
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.linear_model import Ridge
from sklearn.model_selection import cross_val_predict, KFold
from sklearn.metrics import r2_score
import statsmodels.api as sm
warnings.filterwarnings("ignore"); pd.options.mode.chained_assignment=None
D=Path("data"); OUT=Path("analysis/outputs"); RS=42

def icd_chapter(code):
    if not isinstance(code,str) or not code: return "Unknown"
    c=code[0].upper()
    try: nn=int(code[1:3])
    except: nn=-1
    return {"S":"S-T Injury","T":"S-T Injury","M":"M Musculoskeletal","I":"I Circulatory",
            "G":"G Nervous","F":"F Mental","J":"J Respiratory","N":"N Genitourinary",
            "E":"E Endocrine","K":"K Digestive","R":"R Symptoms","Z":"Z Aftercare"
           }.get(c,"C-D Neoplasm" if (c=="C" or (c=="D" and nn<=49)) else f"{c} Other")

item=pd.read_csv(D/"gg-item-track.csv")
attr=pd.read_csv(D/"track-attributes.csv")
base=pd.read_csv(D/"track-base.csv",usecols=["TxTrack_ID","PatientCase_ID","Facility_ID"])
trk =pd.read_csv(D/"tracks.csv",usecols=["TxTrack_ID","PatientCase_ID","track_minutes"])
sess=pd.read_csv(D/"track-sessions.csv")
pay =pd.read_csv(D/"track-payer.csv")
attr["age"]=(pd.to_datetime(attr.TrackStart,errors="coerce")-pd.to_datetime(attr.DOB,errors="coerce")).dt.days/365.25
attr["dx_chapter"]=attr.PrimaryDxCode.astype("string").fillna("").map(icd_chapter)

# ---- case composite (true measured GG only; >=8 items) ----
itc=(item.merge(base[["TxTrack_ID","PatientCase_ID","Facility_ID"]],on="TxTrack_ID",how="inner")
         .merge(attr[["TxTrack_ID","age","Gender","dx_chapter"]],on="TxTrack_ID",how="left"))
ci=itc.groupby(["PatientCase_ID","LibraryItem_ID"]).agg(adm=("Eval","mean"),dis=("Disch","mean")).reset_index()
case=ci.groupby("PatientCase_ID").agg(adm_score=("adm","mean"),dis_score=("dis","mean"),n_items=("adm","size")).reset_index()
g=(itc.groupby("PatientCase_ID").agg(age=("age","mean"),
      Gender=("Gender",lambda s:s.mode().iat[0] if len(s.mode()) else "U"),
      dx_chapter=("dx_chapter",lambda s:s.mode().iat[0] if len(s.mode()) else "Unknown"),
      Facility_ID=("Facility_ID",lambda s:s.mode().iat[0] if len(s.mode()) else np.nan)).reset_index())
case=case.merge(g,on="PatientCase_ID").merge(pay,on="PatientCase_ID",how="left")

# ---- per-case decomposed dose ----
tt=trk.merge(sess,on="TxTrack_ID",how="left").merge(attr[["TxTrack_ID","TrackStart","TrackEnd"]],on="TxTrack_ID",how="left")
tt["s"]=pd.to_datetime(tt.TrackStart,errors="coerce"); tt["e"]=pd.to_datetime(tt.TrackEnd,errors="coerce")
dose=(tt.groupby("PatientCase_ID").agg(total_min=("track_minutes","sum"),sessions=("sessions","sum"),
        cstart=("s","min"),cend=("e","max")).reset_index())
dose["weeks"]=((dose.cend-dose.cstart).dt.days.clip(lower=3))/7
dose["frequency"]=dose.sessions/dose.weeks                 # sessions per week
dose["min_per_session"]=dose.total_min/dose.sessions       # per-session intensity
dose["min_per_week"]=dose.total_min/dose.weeks             # the composite
case=case.merge(dose,on="PatientCase_ID",how="left")

# ---- restrict: SHORT-STAY PART A, clean ----
c=case[(case.ShortStayA==1)&(case.n_items>=8)&(case.age.between(50,105))&
       (case.sessions.between(2,400))&(case.weeks.between(0.4,52))&
       (case.total_min.between(30,30000))&(case.frequency.between(0.5,21))&
       (case.min_per_session.between(5,240))].copy()
print("="*78); print("DECOMPOSING MIN/WEEK — short-stay Part A (Medicare A + Managed Care A)"); print("="*78)
print(f"cases: {len(c):,}  payers: {dict(c.Payer.value_counts())}")
print(f"median  freq={c.frequency.median():.1f}/wk  min/session={c.min_per_session.median():.0f}  "
      f"weeks={c.weeks.median():.1f}  min/week={c.min_per_week.median():.0f}  total={c.total_min.median():.0f}")

# ---- expected (givens only, within cohort), out-of-fold residual ----
c["age2"]=c.age**2
NUM=["adm_score","age","age2"]; CAT=["dx_chapter","Gender","Payer"]
pipe=Pipeline([("p",ColumnTransformer([("n",StandardScaler(),NUM),
      ("c",OneHotEncoder(handle_unknown="ignore",min_frequency=200),CAT)])),("m",Ridge(1.0))])
c["expected"]=cross_val_predict(pipe,c[NUM+CAT],c.dis_score.values,cv=KFold(5,shuffle=True,random_state=RS))
c["residual"]=c.dis_score-c.expected
print(f"expected-level model R^2 (within short-stay A) = {r2_score(c.dis_score,c.expected):.3f}; residual sd={c.residual.std():.2f}")

# ---- A. univariate shape of EACH lever (residual + %beat by quintile) ----
def q(col,label):
    c["_q"]=pd.qcut(c[col],5,duplicates="drop")
    gg=c.groupby("_q").agg(n=("residual","size"),resid=("residual","mean"),
                           beat=("residual",lambda r:(r>=0).mean()*100),lo=(col,"min"),hi=(col,"max"))
    print(f"\n{label}:")
    for _,r in gg.iterrows():
        bar="#"*int(max(0,r.resid)*50); neg="-"*int(max(0,-r.resid)*50)
        print(f"   {r.lo:6.1f}-{r.hi:<6.1f} n={int(r.n):>5}  resid={r.resid:+.3f} {r.beat:3.0f}%  {neg}{bar}")
print("\n--- A. UNIVARIATE shape of each lever (does beating-expected peak/rise?) ---")
q("min_per_week","min/week  (COMPOSITE — the company metric)")
q("frequency","frequency  (sessions/week)")
q("min_per_session","per-session intensity  (min/session)")
q("weeks","duration  (weeks)")
q("total_min","volume  (total minutes)")

# ---- B. joint model: which INDEPENDENT axis carries the signal? ----
print("\n--- B. JOINT standardized model (residual ~ z(log lever)); coef = GG pts per +1 SD ---")
for v in ["frequency","min_per_session","weeks","min_per_week","total_min"]:
    c["z_"+v]=(np.log(c[v])-np.log(c[v]).mean())/np.log(c[v]).std()
def ols(cols):
    X=sm.add_constant(c[["z_"+v for v in cols]]); m=sm.OLS(c.residual,X).fit()
    return m
m=ols(["frequency","min_per_session","weeks"])
print("  orthogonal basis {frequency, min/session, duration}:")
for v in ["frequency","min_per_session","weeks"]:
    print(f"     {v:16} beta={m.params['z_'+v]:+.3f}  p={m.pvalues['z_'+v]:.1e}")
print(f"     R^2={m.rsquared:.3f}")

# ---- C. does min/week add anything beyond its parts? and vice versa ----
print("\n--- C. nested R^2: is min/week just frequency x per-session? ---")
for lbl,cols in [("min/week ALONE",["min_per_week"]),
                 ("frequency ALONE",["frequency"]),
                 ("per-session ALONE",["min_per_session"]),
                 ("duration ALONE",["weeks"]),
                 ("freq + per-session",["frequency","min_per_session"]),
                 ("freq + per-session + duration",["frequency","min_per_session","weeks"]),
                 ("min/week + duration",["min_per_week","weeks"])]:
    print(f"   {lbl:32} R^2={ols(cols).rsquared:.3f}")

c.to_csv(OUT/"dose_decompose.csv",index=False)
print("\nDONE -> analysis/outputs/dose_decompose.csv")
