"""
Therapist signal with PROPER attribution — track grain, registered eval-author.

Earlier therapist test used case grain + "primary = most treatment minutes" (mixes
registered & assistants; assistant case-selection confound). Here we do it the scorecard
way: TRACK grain (one discipline, one responsible registered clinician), attribute the
track's risk-adjusted outcome to the REGISTERED EVAL AUTHOR (owns eval / plan of care).
Compare against the dominant-minutes treater to show which attribution gives a cleaner signal.

Track residual = observed - expected discharge GG composite for the TRACK (its own GG items,
native 6-pt, ANA excluded), expected from givens only (admission composite, age, dx, payer,
sex, discipline). Planned cohort only. Observational.

Usage: python -m analysis.therapist_attribution
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
    for k,v in [("Acute care hospital","Hospital"),("Rehab Hospital","IRF"),("SNF","SNF"),("Memory","Memory Care"),("Hospice","Hospice"),("Expired","Expired")]:
        if k in d: return v
    return d
PLANNED_CLIN={"All Goals Met","Highest Practical Level Achieved","Maximum Potential Achieved, referred for RNP",
  "Maximum Potential Achieved, referred for FMP","Therapist Decision","Physician Decision","Discharged per Physician or Case Manager"}
OOC={"Discharged to Hospital","Patient Expired","Expired due to complications from COVID-19","Patient Transferred to Hospice Care",
  "Patient exhibits change in medical status","Against Medical Advice","Patient Refuses Treatment","Patient Non-compliant with Plan of Treatment",
  "Patient and/or RSP Declines Further Tx","Copay exists, patient/RSP declines treatment","Exhausted benefits, patient/RSP declines treatment",
  "Payor/ Payment limitation","Change in Payer Source"}
UNPLANNED_SET={"Hospital","Hospice","Expired","Left Facility AMA"}

item=pd.read_csv(D/"gg-item-track.csv")
attr=pd.read_csv(D/"track-attributes.csv")
base=pd.read_csv(D/"track-base.csv",usecols=["TxTrack_ID","PatientCase_ID","Facility_ID"])
pay =pd.read_csv(D/"track-payer.csv"); fac=pd.read_csv(D/"facility-dim.csv")
dc  =pd.read_csv(D/"case-discharge.csv")
ea  =pd.read_csv(D/"eval-author.csv")
att =pd.read_csv(D/"therapist-attribution.csv")
emp =pd.read_csv(D/"employee-dim.csv",usecols=["Person_ID","Discipline"])
REG={"PT","OT","ST","CF-SLP","CFY"}
emp["role"]=emp.Discipline.map(lambda d:"Registered" if d in REG else "Assistant/Aide")

# track-grain composite
tg=item.groupby("TxTrack_ID").agg(adm_score=("Eval","mean"),dis_score=("Disch","mean"),n_items=("Eval","size")).reset_index()
attr["age"]=(pd.to_datetime(attr.TrackStart,errors="coerce")-pd.to_datetime(attr.DOB,errors="coerce")).dt.days/365.25
attr["dx_chapter"]=attr.PrimaryDxCode.astype("string").fillna("").map(icd_chapter)
tg=(tg.merge(attr[["TxTrack_ID","PatientCase_ID","Discipline","Gender","age","dx_chapter"]],on="TxTrack_ID",how="left")
      .merge(base[["TxTrack_ID","Facility_ID"]],on="TxTrack_ID",how="left")
      .merge(pay[["PatientCase_ID","Payer"]],on="PatientCase_ID",how="left")
      .merge(fac[["Facility_ID","DivisionCode"]],on="Facility_ID",how="left")
      .merge(ea,on="TxTrack_ID",how="left").merge(dc,on="PatientCase_ID",how="left"))
# planned flag (case reason/destination)
tg["setting"]=tg.DischargedTo.map(setting_of)
def planned(r):
    if r.EndReason=="Evaluation Only": return False
    if r.EndReason in PLANNED_CLIN: return True
    if r.EndReason in OOC: return False
    return r.setting not in UNPLANNED_SET
tg["planned"]=tg.apply(planned,axis=1)
tg["age2"]=tg.age**2
c=tg[(tg.planned)&(tg.n_items>=4)&(tg.age.between(50,105))&(tg.DivisionCode.isin([8450,5500,6500]))
     &(tg.Payer.notna())&(tg.AuthorPerson_ID.notna())].copy()
print("="*78); print("THERAPIST SIGNAL — track grain, eval-author attribution"); print("="*78)
print(f"planned tracks: {len(c):,}  eval authors: {c.AuthorPerson_ID.nunique():,}  facilities: {c.Facility_ID.nunique():,}")

# expected (givens only) at track grain
NUM=["adm_score","age","age2"]; CAT=["dx_chapter","Gender","Payer","Discipline"]
pipe=Pipeline([("p",ColumnTransformer([("n",StandardScaler(),NUM),
      ("c",OneHotEncoder(handle_unknown="ignore",min_frequency=200),CAT)])),("m",Ridge(1.0))])
c["expected"]=cross_val_predict(pipe,c[NUM+CAT],c.dis_score.values,cv=KFold(5,shuffle=True,random_state=RS))
c["residual"]=c.dis_score-c.expected
print(f"track-grain expected R^2={r2_score(c.dis_score,c.expected):.3f}; residual sd={c.residual.std():.2f}")

def reliability(df,key,resid="residual",minct=20):
    g=df.groupby(key)[resid].agg(["size","mean"]); g=g[g["size"]>=minct]
    grand=df[resid].mean(); between=(g["size"]*(g["mean"]-grand)**2).sum(); total=((df[resid]-grand)**2).sum()
    rng=np.random.default_rng(RS); df["_h"]=rng.integers(0,2,len(df))
    h=df.groupby([key,"_h"])[resid].mean().unstack().loc[g.index].dropna()
    return between/total, (spearmanr(h[0],h[1]).correlation if len(h)>5 else np.nan), len(g)

# dominant-minutes treater per track (for comparison)
dm=att.sort_values("Total_Treatment_Minutes").drop_duplicates("TxTrack_ID",keep="last")[["TxTrack_ID","Person_ID"]]
c=c.merge(dm.rename(columns={"Person_ID":"dom_person"}),on="TxTrack_ID",how="left")

print("\nATTRIBUTION COMPARISON (>=20 tracks, planned):")
for key,lbl in [("AuthorPerson_ID","eval author (registered, scorecard rule)"),
                ("dom_person","dominant-minutes treater")]:
    sh,rho,n=reliability(c,key); print(f"  {lbl:42} var share={sh:.3f}  reliability={rho:.3f}  (n={n})")
# within-facility on eval author
c["resid_wf"]=c.residual-c.groupby("Facility_ID").residual.transform("mean")
shw,rhow,nw=reliability(c,"AuthorPerson_ID",resid="resid_wf")
print(f"  {'eval author WITHIN-FACILITY':42} var share={shw:.3f}  reliability={rhow:.3f}  (n={nw})")

# discipline-specific eval-author reliability (PT vs OT)
print("\neval-author reliability by discipline:")
for disc in ["PT","OT","ST"]:
    d=c[c.Discipline==disc]
    if len(d)<2000: continue
    sh,rho,n=reliability(d,"AuthorPerson_ID")
    print(f"  {disc}: tracks={len(d):,}  authors(>=20)={n}  var share={sh:.3f}  reliability={rho:.3f}")

# how much does facility + author together vs alone (nested)
fac_sh,_,_=reliability(c,"Facility_ID",minct=30)
print(f"\nfor scale: facility var share (track grain, >=30) = {fac_sh:.3f}")
c.to_csv(OUT/"therapist_attribution.csv",index=False)
print("\nDONE -> analysis/outputs/therapist_attribution.csv")
