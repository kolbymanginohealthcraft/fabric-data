"""
Does the reliable provider signal extend to THERAPISTS, ROLE MIX, and VOLUME? + facility profiling.

The facility effect is real & case-mix-robust (reliability 0.79). Now:
  A. THERAPIST signal — assign each planned case to its primary treating clinician (max
     treatment minutes); is there reliable between-therapist variance in residual, and does
     it survive WITHIN-FACILITY (therapist demeaned by facility)?  [some therapists better?]
  B. ROLE MIX — assistant-delivered share of treatment minutes (PTA/COTA) vs residual
     [registered-driven vs assistant-driven care].
  C. THERAPIST VOLUME / FTE proxy — primary therapist's total annual treatment minutes
     (FT vs PT vs PRN tertiles) vs residual.
  D. FACILITY PROFILE — what do top- vs bottom-residual facilities do differently?

Residual = observed-minus-expected discharge GG (planned cohort, case-mix adjusted). Observational.
Usage: python -m analysis.provider_signal
"""
import warnings, numpy as np, pandas as pd
from pathlib import Path
from scipy.stats import spearmanr
warnings.filterwarnings("ignore"); pd.options.mode.chained_assignment=None
D=Path("data"); OUT=Path("analysis/outputs"); RS=42

c=pd.read_csv(OUT/"residual_drivers.csv")    # planned cohort: PatientCase_ID, residual, Facility_ID, FacilityName, Payer, total_min, weeks, ...
att=pd.read_csv(D/"therapist-attribution.csv")
base=pd.read_csv(D/"track-base.csv",usecols=["TxTrack_ID","PatientCase_ID"])
emp=pd.read_csv(D/"employee-dim.csv",usecols=["Person_ID","Discipline","FullName","Status"])
REG={"PT","OT","ST","CF-SLP","CFY"}; ASST={"PTA","COTA"}
emp["role"]=emp.Discipline.map(lambda d:"Registered" if d in REG else ("Assistant" if d in ASST else "Aide/Other"))
role=dict(zip(emp.Person_ID,emp.role))

# attribution -> per (case, person) treatment minutes
ac=att.merge(base,on="TxTrack_ID",how="inner")
ac["role"]=ac.Person_ID.map(role).fillna("Aide/Other")
cp=ac.groupby(["PatientCase_ID","Person_ID","role"]).Total_Treatment_Minutes.sum().reset_index()
# per case: primary therapist (max minutes), assistant share, n_therapists
def case_prov(x):
    tot=x.Total_Treatment_Minutes.sum()
    prm=x.loc[x.Total_Treatment_Minutes.idxmax()]
    asst=x.loc[x.role=="Assistant","Total_Treatment_Minutes"].sum()
    return pd.Series({"primary_person":prm.Person_ID,"primary_role":prm.role,
                      "assistant_share":asst/max(1,tot),"n_ther":x.Person_ID.nunique()})
cpr=cp.groupby("PatientCase_ID").apply(case_prov,include_groups=False).reset_index()
# therapist annual volume (all tracks) -> FTE proxy
vol=ac.groupby("Person_ID").Total_Treatment_Minutes.sum().rename("ther_volume")
cpr["primary_volume"]=cpr.primary_person.map(vol)
c=c.merge(cpr,on="PatientCase_ID",how="inner")
print("="*78); print("PROVIDER SIGNAL (planned cohort)"); print("="*78)
print(f"cases: {len(c):,}  facilities: {c.Facility_ID.nunique():,}  therapists(primary): {c.primary_person.nunique():,}")

def reliability(df,key,resid="residual",minct=15):
    g=df.groupby(key)[resid].agg(["size","mean"]); g=g[g["size"]>=minct]
    grand=df[resid].mean(); between=(g["size"]*(g["mean"]-grand)**2).sum(); total=((df[resid]-grand)**2).sum()
    rng=np.random.default_rng(RS); df["_h"]=rng.integers(0,2,len(df))
    h=df.groupby([key,"_h"])[resid].mean().unstack().loc[g.index].dropna()
    rho=spearmanr(h[0],h[1]).correlation if len(h)>5 else np.nan
    return between/total, rho, len(g)

# A. therapist signal
sh,rho,nt=reliability(c,"primary_person",minct=15)
print(f"\nA. THERAPIST (>=15 cases as primary, n={nt}): variance share={sh:.3f}  split-half reliability={rho:.3f}")
# within-facility: demean residual by facility, re-test therapist
fmean=c.groupby("Facility_ID").residual.transform("mean")
c["resid_wf"]=c.residual-fmean
shw,rhow,ntw=reliability(c,"primary_person",resid="resid_wf",minct=15)
print(f"   WITHIN-FACILITY (therapist demeaned by facility): variance share={shw:.3f}  reliability={rhow:.3f}")
print(f"   (facility for comparison: share ~0.090, reliability ~0.79)")

# B. role mix
print("\nB. ROLE MIX — residual by assistant-delivered share of minutes:")
c["asst_q"]=pd.qcut(c.assistant_share,5,duplicates="drop")
for iv,r in c.groupby("asst_q").residual.agg(["size","mean"]).iterrows():
    print(f"   asst share {str(iv):22} n={int(r['size']):>5}  resid={r['mean']:+.3f}")
print(f"   primary-clinician role: " + " | ".join(
    f"{rl}={g.mean():+.3f}(n{len(g)})" for rl,g in c.groupby("primary_role").residual))

# C. volume / FTE proxy (tertiles of primary therapist annual minutes)
c["fte_tier"]=pd.qcut(c.primary_volume,3,labels=["PRN/low","Part-time","Full-time"],duplicates="drop")
print("\nC. THERAPIST VOLUME (primary clinician annual treatment minutes) vs residual:")
for iv,r in c.groupby("fte_tier").agg(n=("residual","size"),resid=("residual","mean"),
        vol=("primary_volume","median")).iterrows():
    print(f"   {str(iv):12} n={int(r['n']):>6}  resid={r['resid']:+.3f}  (median {int(r['vol'])} min/yr)")

# D. facility profile: top vs bottom residual facilities, practice patterns
fac=(c.groupby(["Facility_ID","FacilityName"]).agg(n=("residual","size"),resid=("residual","mean"),
      asst=("assistant_share","mean"),nther=("n_ther","mean"),
      mpw=("total_min","median"),weeks=("weeks","median")).reset_index())
fac=fac[fac.n>=30].sort_values("resid",ascending=False)
def prof(rows,lbl):
    m=rows.agg({"asst":"mean","nther":"mean","mpw":"median","weeks":"median","resid":"mean","n":"sum"})
    print(f"   {lbl:14} resid={m['resid']:+.3f}  asst_share={m['asst']:.2f}  n_ther={m['nther']:.1f}  "
          f"total_min(med)={int(m['mpw'])}  weeks(med)={m['weeks']:.1f}  (cases={int(m['n'])})")
print("\nD. FACILITY PROFILE — top vs bottom quartile facilities (>=30 cases):")
q=len(fac)//4
prof(fac.head(q),"TOP 25%"); prof(fac.tail(q),"BOTTOM 25%")
print("   corr(facility resid, assistant_share)=%.3f | corr(resid, n_therapists)=%.3f | corr(resid, total_min)=%.3f"%(
    spearmanr(fac.resid,fac.asst).correlation, spearmanr(fac.resid,fac.nther).correlation, spearmanr(fac.resid,fac.mpw).correlation))
c.to_csv(OUT/"provider_signal.csv",index=False)
print("\nDONE -> analysis/outputs/provider_signal.csv")
