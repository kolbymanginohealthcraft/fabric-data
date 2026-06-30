"""
Decompose the FACILITY effect: how much of the ~9% facility share of the residual is
unmeasured CASE-MIX vs real practice QUALITY?

Method: re-fit EXPECTED discharge function two ways on the same planned cohort, then
recompute the facility variance share for each:
  A. current givens         = admission function, age, sex, primary-dx chapter, payer
  B. + comorbidity givens   = comorbidity count/groups + high-impact flags (dementia=cognition proxy)
If facility share SHRINKS A->B, that drop was case-mix the facility model was absorbing;
what PERSISTS is closer to real, stable facility practice (or still-unmeasured case-mix).

Caveat: therapy docs capture only treatment-relevant diagnoses (median ~2), so comorbidity
is PARTIAL vs the full MDS/claims problem list -> this is a lower bound on the case-mix portion.

Usage: python -m analysis.facility_decompose
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

c=pd.read_csv(OUT/"residual_drivers.csv")        # planned cohort + givens + Facility_ID
m=pd.read_csv("data/case-comorbidity.csv")
c=c.merge(m,on="PatientCase_ID",how="left")
CM=["comorbidity_count","comorbidity_groups"]+[x for x in c.columns if x.startswith("cm_")]
c[CM]=c[CM].fillna(0)
c["age2"]=c.age**2
print("="*78); print("FACILITY-EFFECT DECOMPOSITION (planned cohort)"); print("="*78)
print(f"cases: {len(c):,}  facilities: {c.Facility_ID.nunique():,}")

def fit(num,cat):
    pipe=Pipeline([("p",ColumnTransformer([("n",StandardScaler(),num),
        ("c",OneHotEncoder(handle_unknown="ignore",min_frequency=200),cat)])),("m",Ridge(1.0))])
    pred=cross_val_predict(pipe,c[num+cat],c.dis_score.values,cv=KFold(5,shuffle=True,random_state=RS))
    return pred, r2_score(c.dis_score,pred)

def fac_share(resid):
    grand=resid.mean(); df=pd.DataFrame({"f":c.Facility_ID,"r":resid})
    fg=df.groupby("f").r.agg(["size","mean"]); fg=fg[fg["size"]>=30]
    between=(fg["size"]*(fg["mean"]-grand)**2).sum(); total=((resid-grand)**2).sum()
    # split-half reliability
    rng=np.random.default_rng(RS); half=rng.integers(0,2,len(resid))
    h=pd.DataFrame({"f":c.Facility_ID,"r":resid,"h":half}).groupby(["f","h"]).r.mean().unstack().loc[fg.index].dropna()
    return between/total, spearmanr(h[0],h[1]).correlation, len(fg)

NUM_A=["adm_score","age","age2"]; CAT=["dx_chapter","Gender","Payer"]
NUM_B=NUM_A+CM
predA,r2A=fit(NUM_A,CAT); predB,r2B=fit(NUM_B,CAT)
residA=c.dis_score-predA; residB=c.dis_score-predB
shA,relA,nf=fac_share(residA); shB,relB,_=fac_share(residB)

print(f"\n{'model':36}{'expected R2':>12}{'facility share':>16}{'reliability':>13}")
print(f"{'A. current givens':36}{r2A:>12.3f}{shA:>16.3f}{relA:>13.3f}")
print(f"{'B. + comorbidity givens':36}{r2B:>12.3f}{shB:>16.3f}{relB:>13.3f}")
drop=shA-shB
print(f"\nfacility share {shA:.3f} -> {shB:.3f}  (change {drop:+.3f}, "
      f"{'shrank '+format(100*drop/shA,'.0f')+'%' if drop>0 else 'no shrink'})")
print(f"  -> case-mix (comorbidity) explained ~{max(0,drop)/shA:.0%} of the facility effect; "
      f"~{1-max(0,drop)/shA:.0%} PERSISTS (practice quality + still-unmeasured case-mix)")
print(f"  (facilities >=30 cases: {nf}; reliability stays ~{relB:.2f} => persistent signal is stable)")

# which comorbidities actually shift expected discharge (sanity: should LOWER expected)
from sklearn.linear_model import Ridge as R
import numpy as np
Xc=(c[CM]-c[CM].mean())/c[CM].std().replace(0,1)
co=R(alpha=1.0).fit(Xc.assign(adm=(c.adm_score-c.adm_score.mean())/c.adm_score.std()), c.dis_score)
coef=pd.Series(co.coef_[:-1],index=CM).sort_values()
print("\ncomorbidity association with discharge function (neg = lowers expected, as expected):")
print(coef.round(3).to_string())
print("\nDONE")
