"""
Diagnosis handling, fixed (answers the 3 methodology questions):
  - MEDICAL (disease) vs TREATMENT (functional impairment) PRIMARY dx as the case-mix predictor
  - SECONDARY comorbidity = distinct medical 3-char groups EXCLUDING the principal dx (not the
    contaminated all-codes count) + clinical flags
Re-fit EXPECTED discharge level under each and recompute the FACILITY variance share, on the
planned cohort. Question: does the functional (treatment) dx predict better, and does the
fixed case-mix shrink the facility effect below the prior 0.090?

Usage: python -m analysis.dx_compare
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

c=pd.read_csv(OUT/"residual_drivers.csv")               # planned cohort + base givens + Facility_ID
dx=pd.read_csv("data/case-diagnoses.csv")
cm=pd.read_csv("data/case-comorbidity.csv")[["PatientCase_ID","cm_dementia","cm_chf","cm_copd",
     "cm_diabetes","cm_ckd","cm_stroke_paralysis","cm_obesity","cm_mood","cm_cancer","cm_neurodegen"]]
c=c.merge(dx,on="PatientCase_ID",how="left").merge(cm,on="PatientCase_ID",how="left")
c["med3"]=c.med_primary.astype("string").str.slice(0,3).fillna("UNK")
c["tx3"] =c.tx_primary.astype("string").str.slice(0,3).fillna("UNK")
c["med_groups_secondary"]=c.med_groups_secondary.fillna(0)
CMF=[x for x in c.columns if x.startswith("cm_")]; c[CMF]=c[CMF].fillna(0)
c["age2"]=c.age**2
print("="*78); print("DIAGNOSIS HANDLING — medical vs treatment primary, fixed comorbidity"); print("="*78)
print(f"planned cases: {len(c):,}  facilities: {c.Facility_ID.nunique():,}")

def fit(num,cat):
    pipe=Pipeline([("p",ColumnTransformer(
        ([("n",StandardScaler(),num)] if num else []) +
        ([("c",OneHotEncoder(handle_unknown="ignore",min_frequency=200),cat)] if cat else []))),
        ("m",Ridge(1.0))])
    pred=cross_val_predict(pipe,c[num+cat],c.dis_score.values,cv=KFold(5,shuffle=True,random_state=RS))
    return pred,r2_score(c.dis_score,pred)
def fac_share(resid):
    grand=resid.mean(); g=pd.DataFrame({"f":c.Facility_ID,"r":resid}).groupby("f").r.agg(["size","mean"])
    g=g[g["size"]>=30]; between=(g["size"]*(g["mean"]-grand)**2).sum(); total=((resid-grand)**2).sum()
    return between/total

BASE_N=["adm_score","age","age2"]; BASE_C=["Gender","Payer"]
variants={
 "base (no dx)":            (BASE_N, BASE_C),
 "+ medical primary (chapter, old)": (BASE_N, BASE_C+["dx_chapter"]),
 "+ medical primary (3-char)":      (BASE_N, BASE_C+["med3"]),
 "+ treatment primary (3-char)":    (BASE_N, BASE_C+["tx3"]),
 "+ BOTH med+tx (3-char)":          (BASE_N, BASE_C+["med3","tx3"]),
 "+ BOTH + secondary comorbidity":  (BASE_N+["med_groups_secondary"]+CMF, BASE_C+["med3","tx3"]),
}
print(f"\n{'expected model':40}{'R2':>8}{'facility share':>16}")
rows=[]
for name,(num,cat) in variants.items():
    pred,r2=fit(num,cat); sh=fac_share(c.dis_score-pred)
    print(f"{name:40}{r2:>8.3f}{sh:>16.3f}"); rows.append({"model":name,"R2":round(r2,3),"facility_share":round(sh,3)})
pd.DataFrame(rows).to_csv(OUT/"dx_compare.csv",index=False)

# direct comparison: solo predictive value of disease vs functional primary
def solo(cat):
    pred,r2=fit(["adm_score"],[cat]); return r2
print(f"\nsolo (adm_score + dx only) R2:  medical={solo('med3'):.3f}   treatment={solo('tx3'):.3f}")
print("\nDONE -> analysis/outputs/dx_compare.csv")
