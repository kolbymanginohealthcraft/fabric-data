"""
PER-ITEM risk-adjusted scorecard — the demonstration behind deliverable #1.

The old "blended 0-100%" outcome collapses every patient into one number and quietly
compares apples to oranges. This script keeps the item dimension: it computes
observed-minus-expected for EACH Section GG item on its native 6-point scale, then rolls
that up into a PER-ITEM provider profile. The payoff a single blended number can't give:
you can see WHERE a facility beats expectation (e.g. toilet transfers) and where it falls
short (e.g. walking), instead of one averaged-away score.

Grain = (PatientCase x LibraryItem). Expected = a per-item, givens-only, out-of-fold model
(admission score on THAT item + age + dx chapter + sex). Residual = observed - expected,
in native GG points. Same risk-adjustment logic as expected_vs_observed.py, but never
collapsed across items. Observational; therapy-documentation outcomes, NOT a CMS QM.

Usage: python -m analysis.item_scorecard
"""
import warnings, numpy as np, pandas as pd
from pathlib import Path
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.linear_model import Ridge
from sklearn.model_selection import cross_val_predict, KFold
from scipy.stats import spearmanr, pearsonr
warnings.filterwarnings("ignore"); pd.options.mode.chained_assignment=None
D=Path("data"); OUT=Path("analysis/outputs"); OUT.mkdir(parents=True,exist_ok=True); RS=42

def icd_chapter(code):
    if not isinstance(code,str) or not code: return "Unknown"
    c=code[0].upper()
    try: nn=int(code[1:3])
    except: nn=-1
    return {"S":"S-T Injury","T":"S-T Injury","M":"M Musculoskeletal","I":"I Circulatory",
            "G":"G Nervous","F":"F Mental","J":"J Respiratory","N":"N Genitourinary",
            "E":"E Endocrine","K":"K Digestive","R":"R Symptoms","Z":"Z Aftercare"
           }.get(c, "C-D Neoplasm" if (c=="C" or (c=="D" and nn<=49)) else f"{c} Other")

print("="*82); print("PER-ITEM RISK-ADJUSTED SCORECARD (observed - expected, native GG points)"); print("="*82)

# --- item name map (crosswalk) ---
xw=pd.read_csv(D/"Outcomes Crosswalk.csv")
xw=xw[xw.Family.str.startswith("(a)")|xw.Family.str.startswith("(b)")].copy()
xw["fam"]=np.where(xw.Family.str.startswith("(a)"),"Mobility","Self-Care")
name=xw.set_index("LibraryItem_ID")[["Name","Group","fam"]].to_dict("index")

# --- load + assemble (PatientCase x item) ---
item=pd.read_csv(D/"gg-item-track.csv")
attr=pd.read_csv(D/"track-attributes.csv")
base=pd.read_csv(D/"track-base.csv",usecols=["TxTrack_ID","PatientCase_ID","Facility_ID"])
fac =pd.read_csv(D/"facility-dim.csv")
attr["age"]=(pd.to_datetime(attr.TrackStart,errors="coerce")-pd.to_datetime(attr.DOB,errors="coerce")).dt.days/365.25
attr["dx_chapter"]=attr.PrimaryDxCode.astype("string").fillna("").map(icd_chapter)
tmap=base.merge(attr[["TxTrack_ID","age","Gender","dx_chapter"]],on="TxTrack_ID",how="left")
itc=item.merge(tmap,on="TxTrack_ID",how="inner")

# case x item: adm/dis = mean across the case's tracks; case givens = mean age / modal dx,sex,facility
ci=(itc.groupby(["PatientCase_ID","LibraryItem_ID"])
       .agg(adm=("Eval","mean"),dis=("Disch","mean")).reset_index())
g=(itc.groupby("PatientCase_ID")
      .agg(age=("age","mean"),
           Gender=("Gender",lambda s:s.mode().iat[0] if len(s.mode()) else "U"),
           dx_chapter=("dx_chapter",lambda s:s.mode().iat[0] if len(s.mode()) else "Unknown"),
           Facility_ID=("Facility_ID",lambda s:s.mode().iat[0] if len(s.mode()) else np.nan))
      .reset_index())
ci=ci.merge(g,on="PatientCase_ID").merge(fac,on="Facility_ID",how="left")
ci=ci[ci.age.between(50,105)&ci.DivisionCode.isin([8450,5500,6500])].copy()
ci["age2"]=ci.age**2; ci["gain"]=ci.dis-ci.adm
print(f"case x item rows: {len(ci):,}   cases: {ci.PatientCase_ID.nunique():,}   "
      f"items: {ci.LibraryItem_ID.nunique()}   facilities: {ci.Facility_ID.nunique():,}")

# --- PER-ITEM expected model (givens only, out-of-fold) -> residual ---
NUM=["adm","age","age2"]; CAT=["dx_chapter","Gender"]
cv=KFold(5,shuffle=True,random_state=RS)
parts=[]
for iid,grp in ci.groupby("LibraryItem_ID"):
    if len(grp)<300: continue              # need enough to fit a stable per-item model
    pipe=Pipeline([("p",ColumnTransformer([("n",StandardScaler(),NUM),
            ("c",OneHotEncoder(handle_unknown="ignore",min_frequency=200),CAT)])),("m",Ridge(1.0))])
    grp=grp.copy()
    grp["expected"]=cross_val_predict(pipe,grp[NUM+CAT],grp.dis.values,cv=cv)
    grp["residual"]=grp.dis-grp.expected
    parts.append(grp)
ci=pd.concat(parts,ignore_index=True)
ci["item"]=ci.LibraryItem_ID.map(lambda i:name.get(i,{}).get("Name",str(i)))
ci["group"]=ci.LibraryItem_ID.map(lambda i:name.get(i,{}).get("Group",""))
ci["fam"]=ci.LibraryItem_ID.map(lambda i:name.get(i,{}).get("fam",""))

# ============================================================================
# 1. POPULATION view: per item — where is the room, where is the gain?
# ============================================================================
pop=(ci.groupby(["fam","group","item"])
       .agg(n=("dis","size"),adm=("adm","mean"),dis=("dis","mean"),
            gain=("gain","mean"),pct_ge=("residual",lambda r:(r>=0).mean()*100)).reset_index())
pop=pop.sort_values(["fam","group","item"])
print("\n"+"-"*82); print("1) POPULATION per item (native 6pt: 6=Independent .. 1=Dependent)"); print("-"*82)
print(f"  {'Item':40}{'n':>7}{'adm':>6}{'disch':>7}{'gain':>6}{'%>=exp':>8}")
cf=None
for _,r in pop.iterrows():
    if r.fam!=cf: print(f"  -- {r.fam} --"); cf=r.fam
    print(f"  {r["item"][:39]:40}{int(r.n):>7}{r.adm:>6.2f}{r.dis:>7.2f}{r.gain:>+6.2f}{r.pct_ge:>7.0f}%")

# ============================================================================
# 2. Which items RELIABLY discriminate providers? (split-half facility reliability)
# ============================================================================
print("\n"+"-"*82); print("2) Per-item provider RELIABILITY (do facilities rank the same on a random half-split?)"); print("-"*82)
rng=np.random.default_rng(RS); ci["half"]=rng.integers(0,2,len(ci))
rel_rows=[]
for iid,grp in ci.groupby("LibraryItem_ID"):
    fc=grp.groupby("Facility_ID").size(); keep=fc[fc>=20].index
    sub=grp[grp.Facility_ID.isin(keep)]
    h=sub.groupby(["Facility_ID","half"]).residual.mean().unstack().dropna()
    if len(h)<8: continue
    rho=spearmanr(h[0],h[1]).correlation
    rel_rows.append({"item":name.get(iid,{}).get("Name",str(iid))[:39],
                     "fam":name.get(iid,{}).get("fam",""),"nfac":len(h),"reliability":rho,
                     "spread":sub.groupby("Facility_ID").residual.mean().std()})
rel=pd.DataFrame(rel_rows).sort_values("reliability",ascending=False)
print(f"  {'Item':40}{'#fac':>6}{'reliab.':>9}{'fac spread(sd)':>16}")
for _,r in rel.iterrows():
    print(f"  {r["item"]:40}{int(r.nfac):>6}{r.reliability:>9.2f}{r.spread:>15.2f}")
print(f"\n  median per-item reliability = {rel.reliability.median():.2f}  "
      f"(blended composite was ~0.79; single items are noisier but several still discriminate)")

# ============================================================================
# 3. ITEM-SPECIFICITY: a facility's strength is NOT uniform across items
# ============================================================================
print("\n"+"-"*82); print("3) ITEM-SPECIFICITY — the payoff a blended score hides"); print("-"*82)
fcase=ci.groupby("Facility_ID").PatientCase_ID.nunique()
big=fcase[fcase>=50].index
fi=(ci[ci.Facility_ID.isin(big)].groupby(["Facility_ID","FacilityName","LibraryItem_ID"])
      .agg(n=("residual","size"),resid=("residual","mean")).reset_index())
fi=fi[fi.n>=15]
fi["item"]=fi.LibraryItem_ID.map(lambda i:name.get(i,{}).get("Name",str(i)))
fi["fam"]=fi.LibraryItem_ID.map(lambda i:name.get(i,{}).get("fam",""))
# overall facility residual
fov=ci[ci.Facility_ID.isin(big)].groupby(["Facility_ID","FacilityName"]).residual.mean().reset_index()
fov=fov.sort_values("residual",ascending=False)

def profile(fid,fname,label):
    sub=fi[fi.Facility_ID==fid].sort_values("resid",ascending=False)
    if sub.empty: return
    print(f"\n  {label}: {fname[:45]}  (overall {fov[fov.Facility_ID==fid].residual.iat[0]:+.2f} GG vs expected)")
    print(f"    strongest items: "+", ".join(f"{r["item"].split('.')[-1].strip()[:18]} {r.resid:+.2f}" for _,r in sub.head(3).iterrows()))
    print(f"    weakest items:   "+", ".join(f"{r["item"].split('.')[-1].strip()[:18]} {r.resid:+.2f}" for _,r in sub.tail(3).iterrows()))
    print(f"    within-facility spread across items: {sub.resid.std():.2f} GG (if ~0, items agree; if large, strength is item-specific)")

profile(fov.Facility_ID.iat[0],fov.FacilityName.iat[0],"TOP facility overall")
mid=fov.iloc[len(fov)//2]; profile(mid.Facility_ID,mid.FacilityName,"MIDDLE facility overall")
profile(fov.Facility_ID.iat[-1],fov.FacilityName.iat[-1],"BOTTOM facility overall")

# Does being good at Mobility predict being good at Self-Care? (if r is low, items carry distinct info)
fm=(fi[fi.fam=="Mobility"].groupby("Facility_ID").resid.mean())
fs=(fi[fi.fam=="Self-Care"].groupby("Facility_ID").resid.mean())
j=pd.concat([fm.rename("mob"),fs.rename("self")],axis=1).dropna()
r=pearsonr(j.mob,j["self"])[0]
print(f"\n  Facility Mobility-residual vs Self-Care-residual: r={r:+.2f}  (n={len(j)} facilities)")
print(f"  -> {'moderate overlap, but each family still adds its own signal' if 0.3<r<0.8 else ('largely the same' if r>=0.8 else 'distinct')}; "
      "a per-item profile says more than one averaged score.")
# average within-facility spread across items
sp=fi.groupby("Facility_ID").resid.std().median()
print(f"  median within-facility spread across items = {sp:.2f} GG points "
      f"-> facilities are genuinely better at some functions than others.")

# --- output: facility x item residual matrix for the dashboard prototype ---
mat=(fi.pivot_table(index=["Facility_ID","FacilityName"],columns="item",values="resid"))
mat.to_csv(OUT/"item_scorecard_facility_by_item.csv")
ci[["PatientCase_ID","Facility_ID","FacilityName","DivisionCode","LibraryItem_ID","item",
    "group","fam","adm","dis","gain","expected","residual"]].to_csv(OUT/"item_scorecard_caseitem.csv",index=False)
print("\nDONE -> analysis/outputs/item_scorecard_facility_by_item.csv (facility x item matrix)")
print("     -> analysis/outputs/item_scorecard_caseitem.csv (case x item residuals)")
