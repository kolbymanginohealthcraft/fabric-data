"""
Treatment MIX vs residual — do intervention choices associate with beating-expected?
Merges per-track CPT/service mix onto the planned-cohort track residual (case-mix adjusted,
eval-author grain from therapist_attribution.csv). Shares of treatment minutes by category +
group/telehealth/aquatic flags + intervention diversity (n_cpt).

STRONG confound caveat: intervention mix is chosen FOR the patient (modalities for pain,
group for higher-functioning, assistants for steadier patients), so associations reflect
INDICATION, not causation. Residual nets out admission function/age/dx/payer, not the
clinical reason a given modality was chosen.

Usage: python -m analysis.treatment_mix
"""
import warnings, numpy as np, pandas as pd
from pathlib import Path
from scipy.stats import spearmanr
import statsmodels.api as sm
warnings.filterwarnings("ignore"); pd.options.mode.chained_assignment=None
OUT=Path("analysis/outputs")

c=pd.read_csv(OUT/"therapist_attribution.csv")   # planned tracks + residual + Discipline + Facility
mx=pd.read_csv("data/track-treatment-mix.csv")
c=c.merge(mx,on="TxTrack_ID",how="inner",suffixes=("","_mx"))
c=c[c.total_min>=30].copy()
T=c.total_min
c["active_share"]=c.active_min/T; c["modality_share"]=c.modality_min/T
c["group_share"]=c.group_min/T;   c["assistant_share"]=c.assistant_min/T
c["telehealth_any"]=(c.telehealth_min>0).astype(int); c["aquatic_any"]=(c.aquatic_min>0).astype(int)
print("="*78); print("TREATMENT MIX vs RESIDUAL (planned tracks, case-mix adjusted)"); print("="*78)
print(f"tracks: {len(c):,}")

print("\nSpearman( share , residual ):")
for v in ["active_share","modality_share","group_share","assistant_share","n_cpt"]:
    print(f"   {v:16} rho={spearmanr(c[v],c.residual).correlation:+.3f}")

def quint(col):
    try: c["_q"]=pd.qcut(c[col],5,duplicates="drop")
    except: return
    g=c.groupby("_q").agg(n=("residual","size"),resid=("residual","mean"),lo=(col,"min"),hi=(col,"max"))
    print(f"\n{col} quintiles:")
    for _,r in g.iterrows(): print(f"   {r.lo:5.2f}-{r.hi:<5.2f} n={int(r.n):>5} resid={r.resid:+.3f}")
for v in ["modality_share","group_share","assistant_share","n_cpt"]: quint(v)

print("\nflags (mean residual):")
for f in ["telehealth_any","aquatic_any"]:
    g=c.groupby(f).residual.agg(["size","mean"])
    print(f"   {f}: " + " | ".join(f"{k}={r['mean']:+.3f}(n{int(r['size'])})" for k,r in g.iterrows()))

# joint R^2 of mix over residual (how much can intervention mix explain, case-mix adjusted)
Z=pd.DataFrame({v:(c[v]-c[v].mean())/c[v].std() for v in ["active_share","modality_share","group_share","assistant_share","n_cpt"]})
print(f"\njoint mix R^2 on residual = {sm.OLS(c.residual,sm.add_constant(Z)).fit().rsquared:.3f}")
print("DONE")
