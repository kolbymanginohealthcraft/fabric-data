"""
EFFICIENCY (gain per hour) vs EFFECTIVENESS (level reached) — are they different lenses?

So far the residual measured EFFECTIVENESS: observed-minus-expected discharge function LEVEL.
"A good outcome achieved efficiently is better" -> add FG/hour (the old framework's payer-
neutral primary metric). Questions:
  1. Risk-adjust gain-per-hour (expected from givens) -> an EFFICIENCY residual.
  2. Do facilities reliably differ in efficiency (like they do in effectiveness)?
  3. Is efficiency a SEPARATE differentiator? (correlate facility effectiveness vs efficiency)
Plus a PRESCRIPTIVE-ceiling check: does knowing the care PLAN (levers) predict the outcome
materially better than knowing the PATIENT (givens)? If not, we can't prescribe.

Planned cohort, case grain. gain = discharge - admission GG composite (native pts); hours =
total treatment minutes / 60. Observational; gain/hour mechanically rewards shorter episodes
and lower baselines (more room) -> risk-adjust + caveat.

Usage: python -m analysis.efficiency
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
OUT=Path("analysis/outputs"); RS=42

c=pd.read_csv(OUT/"residual_drivers.csv")   # planned cohort: adm_score, dis_score, total_min, givens, residual(effectiveness), Facility_ID
c["gain"]=c.dis_score-c.adm_score
c["hours"]=c.total_min/60.0
c=c[(c.hours.between(0.5,300))].copy()
c["gain_per_hour"]=c.gain/c.hours
c=c[c.gain_per_hour.between(-2,2)].copy()
c["age2"]=c.age**2
print("="*78); print("EFFICIENCY (gain per hour) vs EFFECTIVENESS"); print("="*78)
print(f"planned cases: {len(c):,}")
print(f"gain/hour: median={c.gain_per_hour.median():.3f} pts/hr  mean={c.gain_per_hour.mean():.3f}  "
      f"(median gain={c.gain.median():.2f} pts over median {c.hours.median():.1f} hrs)")

# 1. expected gain-per-hour from GIVENS only -> efficiency residual
NUM=["adm_score","age","age2"]; CAT=["dx_chapter","Gender","Payer"]
def oof(y):
    p=Pipeline([("p",ColumnTransformer([("n",StandardScaler(),NUM),
        ("c",OneHotEncoder(handle_unknown="ignore",min_frequency=200),CAT)])),("m",Ridge(1.0))])
    return cross_val_predict(p,c[NUM+CAT],y,cv=KFold(5,shuffle=True,random_state=RS))
c["eff_exp"]=oof(c.gain_per_hour.values); c["eff_resid"]=c.gain_per_hour-c.eff_exp
print(f"\nexpected gain/hour model (givens) R^2={r2_score(c.gain_per_hour,c.eff_exp):.3f} "
      f"(admission level dominates: low baseline => more room => higher gain/hr)")

# 2. facility reliability of EFFICIENCY residual
def rel(df,key,resid,minct=30):
    g=df.groupby(key)[resid].agg(["size","mean"]); g=g[g["size"]>=minct]
    grand=df[resid].mean(); between=(g["size"]*(g["mean"]-grand)**2).sum(); total=((df[resid]-grand)**2).sum()
    rng=np.random.default_rng(RS); df["_h"]=rng.integers(0,2,len(df))
    h=df.groupby([key,"_h"])[resid].mean().unstack().loc[g.index].dropna()
    return between/total,(spearmanr(h[0],h[1]).correlation if len(h)>5 else np.nan),len(g),g
shE,rhoE,nE,gEff=rel(c,"Facility_ID","eff_resid")
print(f"FACILITY efficiency residual: var share={shE:.3f}  reliability={rhoE:.3f} (n={nE})")
print(f"  (effectiveness for comparison was var ~0.09, reliability ~0.79)")

# 3. is efficiency a SEPARATE dimension? correlate facility effectiveness vs efficiency
_,_,_,gEffv=rel(c,"Facility_ID","eff_resid"); _,_,_,gEct=rel(c,"Facility_ID","residual")
fac=pd.DataFrame({"eff":gEffv["mean"],"effectiveness":gEct["mean"]}).dropna()
rho=spearmanr(fac.effectiveness,fac.eff).correlation
print(f"\nFACILITY effectiveness vs efficiency residual: Spearman={rho:+.3f}")
print(f"  -> {'largely the SAME providers' if rho>0.6 else ('PARTLY distinct' if rho>0.3 else 'DISTINCT dimensions')}; "
      f"efficiency adds a separate lens" if rho<0.6 else "")
# quadrant counts (median split)
fac["eEff"]=fac.eff>=fac.eff.median(); fac["eEct"]=fac.effectiveness>=fac.effectiveness.median()
print("  facility quadrants (n): "
      f"hi-effective+hi-efficient={int((fac.eEff&fac.eEct).sum())}, "
      f"effective-but-inefficient={int((~fac.eEff&fac.eEct).sum())}, "
      f"efficient-but-less-effective={int((fac.eEff&~fac.eEct).sum())}, "
      f"low-both={int((~fac.eEff&~fac.eEct).sum())}")

# 4. PRESCRIPTIVE ceiling: does the PLAN (levers) predict outcome beyond the PATIENT (givens)?
print("\n"+"-"*78); print("PRESCRIPTIVE-CEILING CHECK: plan (levers) lift over patient (givens)"); print("-"*78)
c["mpw"]=c.total_min/c.weeks.clip(lower=0.3)
LEVERS_N=["total_min","weeks","mpw","frequency","min_per_session","soc_lag","n_therapists"]
for col in LEVERS_N: c[col]=c[col].fillna(c[col].median())
def r2_pred(num,cat):
    p=Pipeline([("p",ColumnTransformer(([("n",StandardScaler(),num)] if num else [])+
        ([("c",OneHotEncoder(handle_unknown="ignore",min_frequency=200),cat)] if cat else []))),("m",Ridge(1.0))])
    return r2_score(c.dis_score.values,cross_val_predict(p,c[num+cat],c.dis_score.values,cv=KFold(5,shuffle=True,random_state=RS)))
r2_givens=r2_pred(NUM,CAT); r2_plan=r2_pred(NUM+LEVERS_N,CAT)
print(f"predict discharge function from GIVENS only:        R^2={r2_givens:.3f}")
print(f"predict discharge function from GIVENS + PLAN:      R^2={r2_plan:.3f}   (plan lift = {r2_plan-r2_givens:+.3f})")
print("  -> a tiny lift means the controllable plan barely changes the predicted result")
print("     => we can SET EXPECTATIONS from givens, but cannot yet PRESCRIBE an optimal plan.")
c.to_csv(OUT/"efficiency.csv",index=False)
print("\nDONE -> analysis/outputs/efficiency.csv")
