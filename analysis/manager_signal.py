"""
Manager / leader signal. RehabManager_ID is unpopulated (9 mgrs/12 facilities), so we use
the employee SUPERVISOR edge: group each planned track (eval-author grain) by the eval
author's supervisor and ask whether some supervisors' teams reliably beat expectation.

Caveat: a supervisor's signal largely AGGREGATES their therapists' individual signal (and
overlaps facility), so high supervisor reliability is partly "good team composition," not
proven leadership. We report it alongside facility (0.073) and therapist (0.745, 0.52 within-
facility) for scale, and check facility overlap.

Usage: python -m analysis.manager_signal
"""
import warnings, numpy as np, pandas as pd
from pathlib import Path
from scipy.stats import spearmanr
warnings.filterwarnings("ignore"); pd.options.mode.chained_assignment=None
OUT=Path("analysis/outputs"); RS=42

c=pd.read_csv(OUT/"therapist_attribution.csv")
emp=pd.read_csv("data/employee-dim.csv",usecols=["Person_ID","SupervisorIdentifier"])
c=c.merge(emp.rename(columns={"Person_ID":"AuthorPerson_ID","SupervisorIdentifier":"supervisor"}),
          on="AuthorPerson_ID",how="left")
c=c[c.supervisor.notna()].copy()
print("="*78); print("MANAGER/LEADER SIGNAL (supervisor of eval author, planned tracks)"); print("="*78)
print(f"tracks: {len(c):,}  supervisors: {c.supervisor.nunique():,}")

def rel(df,key,resid="residual",minct=30):
    g=df.groupby(key)[resid].agg(["size","mean"]); g=g[g["size"]>=minct]
    grand=df[resid].mean(); between=(g["size"]*(g["mean"]-grand)**2).sum(); total=((df[resid]-grand)**2).sum()
    rng=np.random.default_rng(RS); df["_h"]=rng.integers(0,2,len(df))
    h=df.groupby([key,"_h"])[resid].mean().unstack().loc[g.index].dropna()
    return between/total,(spearmanr(h[0],h[1]).correlation if len(h)>5 else np.nan),len(g)

sh,rho,n=rel(c,"supervisor")
print(f"\nSUPERVISOR (>=30 tracks, n={n}): variance share={sh:.3f}  split-half reliability={rho:.3f}")
print(f"  for scale: therapist 0.104/0.745 ; facility (track grain) 0.073 ; therapist-within-facility 0.042/0.52")

# facility overlap: how concentrated is a supervisor's work in one facility?
fac_conc=c.groupby("supervisor").apply(lambda x: x.Facility_ID.value_counts(normalize=True).iloc[0],include_groups=False)
print(f"\nsupervisor facility concentration (share of tracks in their top facility): median={fac_conc.median():.2f}")
print("  -> if high, supervisor signal overlaps facility; if low, supervisors span facilities")

# supervisor signal WITHIN facility (demean by facility): is there leader signal beyond place?
c["resid_wf"]=c.residual-c.groupby("Facility_ID").residual.transform("mean")
shw,rhow,nw=rel(c,"supervisor",resid="resid_wf")
print(f"\nSUPERVISOR within-facility (residual demeaned by facility): var={shw:.3f}  reliability={rhow:.3f} (n={nw})")
print("DONE")
