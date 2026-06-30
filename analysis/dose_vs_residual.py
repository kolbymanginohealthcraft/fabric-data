"""
Lever -> quality: does therapy DOSE explain who beats their EXPECTED outcome?

Bridges predictability (#1) and optimization. The case residual (observed - expected
discharge GG, from expected_vs_observed.py) already nets out case-mix GIVENS (admission
function, age, diagnosis, sex). Here we ask: holding expected outcome fixed, do cases /
facilities that received more or differently-dosed therapy (a LEVER) finish ABOVE expected?

Dose is built per CASE from the same tracks: total therapy minutes, episode LOS,
minutes/week (intensity), #tracks, discipline mix. Outcomes basis = TRUE measured GG only
(performance levels 1-6; ANA/non-answers excluded, NOT recoded to dependency).

CAUSAL CAVEAT: observational. Dose is not randomly assigned; unmeasured severity/motivation
can drive both dose and outcome. An inverted-U (sweet spot) is more robust to pure-severity
confounding than a monotonic trend, but nothing here is causal proof.

Usage: python -m analysis.dose_vs_residual
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
warnings.filterwarnings("ignore"); pd.options.mode.chained_assignment=None
D=Path("data"); OUT=Path("analysis/outputs"); RS=42

res=pd.read_csv(OUT/"case_expected_observed.csv")          # PatientCase_ID, residual, expected, ...
trk=pd.read_csv(D/"tracks.csv",usecols=["TxTrack_ID","PatientCase_ID","Discipline","track_minutes"])
attr=pd.read_csv(D/"track-attributes.csv",usecols=["TxTrack_ID","TrackStart","TrackEnd"])

# ---- per-CASE dose from the case's tracks ----
t=trk.merge(attr,on="TxTrack_ID",how="left")
t["s"]=pd.to_datetime(t.TrackStart,errors="coerce"); t["e"]=pd.to_datetime(t.TrackEnd,errors="coerce")
dose=(t.groupby("PatientCase_ID")
       .agg(total_min=("track_minutes","sum"),n_tracks=("TxTrack_ID","nunique"),
            cstart=("s","min"),cend=("e","max"),
            disc=("Discipline",lambda s:"+".join(sorted(set(s.dropna())))))
       .reset_index())
dose["los"]=(dose.cend-dose.cstart).dt.days.clip(lower=1)
dose["mpw"]=dose.total_min/(dose.los/7)
dose["min_per_track"]=dose.total_min/dose.n_tracks

df=res.merge(dose,on="PatientCase_ID",how="inner")
df=df[(df.total_min.between(30,30000))&(df.los.between(2,365))&(df.mpw.between(10,3000))]
print("="*78); print("DOSE (lever) vs RESIDUAL (observed-minus-expected, case-mix adjusted)"); print("="*78)
print(f"cases: {len(df):,}  mean residual={df.residual.mean():+.3f}  "
      f"median mpw={df.mpw.median():.0f} min/wk, median LOS={df.los.median():.0f}d, median total={df.total_min.median():.0f}")

# ---- A. how much of the (case-mix-free) residual does dose explain? ----
NUM=["mpw","los","total_min","n_tracks","min_per_track"]; CAT=["disc"]
pipe=Pipeline([("p",ColumnTransformer([("n",StandardScaler(),NUM),
        ("c",OneHotEncoder(handle_unknown="ignore",min_frequency=300),CAT)])),("m",Ridge(alpha=1.0))])
cv=KFold(5,shuffle=True,random_state=RS)
pred=cross_val_predict(pipe,df[NUM+CAT],df.residual.values,cv=cv)
print(f"\nA. Dose-only model of the residual: out-of-fold R^2 = {r2_score(df.residual,pred):.3f}")
print("   (residual already has case-mix removed; this is variance dose adds beyond givens)")

# ---- B. sweet-spot view: mean residual by intensity / duration / volume quartile ----
def q_table(col,label,nq=5):
    df["_q"]=pd.qcut(df[col],nq,duplicates="drop")
    g=df.groupby("_q").agg(n=("residual","size"),mean_residual=("residual","mean"),
                           pct_beat=("residual",lambda r:(r>=0).mean()*100),
                           lo=(col,"min"),hi=(col,"max"))
    print(f"\nB. residual by {label} quintile (does beating-expected peak at a dose?):")
    for iv,row in g.iterrows():
        bar="#"*int(max(0,row.mean_residual)*60); barn="-"*int(max(0,-row.mean_residual)*60)
        print(f"   {row.lo:6.0f}-{row.hi:<6.0f} n={int(row.n):>6}  resid={row.mean_residual:+.3f} "
              f"{row.pct_beat:4.0f}% beat  {barn}{bar}")
q_table("mpw","minutes/week (INTENSITY)")
q_table("los","episode LOS (DURATION)")
q_table("total_min","total minutes (VOLUME)")

# ---- C. discipline mix ----
dm=(df.groupby("disc").agg(n=("residual","size"),mean_residual=("residual","mean"),
      mpw=("mpw","mean")).reset_index())
dm=dm[dm.n>=300].sort_values("mean_residual",ascending=False)
print("\nC. residual by discipline mix (n>=300):")
for _,r in dm.iterrows():
    print(f"   {r.disc:12} n={int(r.n):>6}  resid={r.mean_residual:+.3f}  (mean {r.mpw:.0f} min/wk)")

# ---- D. facility level: do higher-dosing facilities beat expected? ----
fac=(df.groupby("Facility_ID").agg(n=("residual","size"),fac_resid=("residual","mean"),
      fac_mpw=("mpw","mean"),fac_los=("los","mean")).reset_index())
fac=fac[fac.n>=30]
rho_mpw=spearmanr(fac.fac_mpw,fac.fac_resid).correlation
rho_los=spearmanr(fac.fac_los,fac.fac_resid).correlation
print(f"\nD. facility-level (n={len(fac)} facilities >=30 cases):")
print(f"   Spearman(facility mean minutes/week, facility risk-adj residual) = {rho_mpw:+.3f}")
print(f"   Spearman(facility mean LOS,           facility risk-adj residual) = {rho_los:+.3f}")

# ---- E. partial check: within intensity quintile, is there still a residual gradient by LOS? ----
df["mpw_q"]=pd.qcut(df.mpw,5,labels=["I1","I2","I3","I4","I5"],duplicates="drop")
df["los_q"]=pd.qcut(df.los,3,labels=["short","med","long"],duplicates="drop")
piv=df.pivot_table(index="mpw_q",columns="los_q",values="residual",aggfunc="mean")
print("\nE. mean residual by intensity (rows) x LOS (cols) — disentangle intensity vs duration:")
print(piv.round(3).to_string())

df.to_csv(OUT/"case_dose_residual.csv",index=False)
print("\nDONE -> analysis/outputs/case_dose_residual.csv")
