"""
Predictability of Section GG functional outcomes — item-level (comparable units).

Premise (docs/care-delivery-optimization-framework.md): measure each GG item on its
native 6-point scale so a gain is comparable across patients, then test which
independent variables predict it -- singly and in combination -- WITHIN an item
(like-for-like), the fair test the blended 0-100% scale could never support.

Inputs (gitignored CSVs, all keyed by TxTrack_ID):
  data/gg-item-track.csv   per (track x GG item): native Eval, Disch (6-pt)
  data/track-attributes.csv  age (DOB@start), gender, primary medical dx code
  data/tracks.csv          discipline, library (OP/SNF), PoR, Stay, dose, dates
  data/Outcomes Crosswalk.csv  LibraryItem_ID -> Group/Name labels

MCID convention (no validated per-item MCID exists; field uses 1 pt): improved = change>=1.

Usage: python -m analysis.predict_gg
"""
import warnings, numpy as np, pandas as pd
from pathlib import Path
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, roc_auc_score
warnings.filterwarnings("ignore")
pd.options.mode.chained_assignment = None

D = Path("data"); OUT = Path("analysis/outputs"); OUT.mkdir(parents=True, exist_ok=True)
RS = 42

# ---- ICD-10 chapter label (coarse, for readable summaries) ----
def icd_chapter(code):
    if not isinstance(code, str) or not code:
        return "Unknown"
    c = code[0].upper()
    n = code[1:3]
    try: nn = int(n)
    except: nn = -1
    if c in "ST": return "S-T Injury/poisoning"
    if c == "M": return "M Musculoskeletal"
    if c == "I": return "I Circulatory"
    if c == "G": return "G Nervous system"
    if c == "F": return "F Mental/behavioral"
    if c == "J": return "J Respiratory"
    if c == "N": return "N Genitourinary"
    if c == "E": return "E Endocrine/metabolic"
    if c == "K": return "K Digestive"
    if c == "C" or (c == "D" and nn <= 49): return "C-D Neoplasms"
    if c == "R": return "R Symptoms/signs"
    if c == "Z": return "Z Factors/aftercare"
    return f"{c} Other"

print("="*80); print("LOADING & MERGING"); print("="*80)
item = pd.read_csv(D/"gg-item-track.csv")
attr = pd.read_csv(D/"track-attributes.csv")
trk  = pd.read_csv(D/"tracks.csv", usecols=[  # tracks.csv dates are JS strings; use attr ISO dates for LOS
    "TxTrack_ID","DomLibrary","PoR","Stay","ServiceLine","DivisionCode","track_minutes"])
xw = pd.read_csv(D/"Outcomes Crosswalk.csv")
xw["item_label"] = (xw["Group"].str.replace(r"^[A-Z-]+: ","",regex=True) + " / " +
                    xw["Name"].str.replace(r"^[A-Z]+\. ","",regex=True))
xw = xw[["LibraryItem_ID","Family","item_label"]].drop_duplicates("LibraryItem_ID")

# derive track-level attributes
attr["age"] = (pd.to_datetime(attr["TrackStart"],errors="coerce") -
               pd.to_datetime(attr["DOB"],errors="coerce")).dt.days/365.25
attr["age_band"] = pd.cut(attr["age"], [0,65,75,85,95,200],
                          labels=["<65","65-74","75-84","85-94","95+"])
attr["PrimaryDxCode"] = attr["PrimaryDxCode"].astype("string").fillna("")
attr["dx_chapter"] = attr["PrimaryDxCode"].map(icd_chapter)
attr["dx3"] = attr["PrimaryDxCode"].str.slice(0,3).replace("","Unknown")
attr["los_days"] = (pd.to_datetime(attr["TrackEnd"],errors="coerce") -
                    pd.to_datetime(attr["TrackStart"],errors="coerce")).dt.days

df = (item.merge(attr,on="TxTrack_ID",how="inner")
          .merge(trk, on="TxTrack_ID",how="left",suffixes=("","_t"))
          .merge(xw, on="LibraryItem_ID",how="left"))
df["mpw"] = df["track_minutes"] / (df["los_days"].clip(lower=1)/7)
df["change"] = df["Disch"] - df["Eval"]
df["improved"] = (df["change"] >= 1).astype(int)
# clean
df = df[(df.age.between(50,105)) & (df.los_days.between(1,365)) &
        (df.track_minutes.between(10,20000))]
print(f"analytic rows (track x item): {len(df):,}  |  tracks: {df.TxTrack_ID.nunique():,}")
print(f"overall mean change={df.change.mean():.2f}  %improved(>=1)={df.improved.mean():.1%}")

CATS = ["dx_chapter","Discipline","DomLibrary","PoR","Stay","Gender","ServiceLine"]
def pipe(num, cat, kind):
    tr=[]
    if num: tr.append(("n",StandardScaler(),num))
    if cat: tr.append(("c",OneHotEncoder(handle_unknown="ignore",min_frequency=300),cat))
    m = Ridge(alpha=1.0) if kind=="reg" else LogisticRegression(max_iter=2000)
    return Pipeline([("p",ColumnTransformer(tr)),("m",m)])

def blocks_eval(d, blocks, target, kind):
    y = d[target].values
    Xtr,Xte,ytr,yte = train_test_split(d,y,test_size=.3,random_state=RS,
                                        stratify=(y if kind=="clf" else None))
    num,cat,prev,rows=[],[],None,[]
    for name,nf,cf in blocks:
        num+=nf; cat+=cf
        p=pipe(num,cat,kind); p.fit(Xtr[num+cat],ytr)
        pr=(p.predict(Xte[num+cat]) if kind=="reg" else p.predict_proba(Xte[num+cat])[:,1])
        met=(r2_score(yte,pr) if kind=="reg" else roc_auc_score(yte,pr))
        rows.append((name,met,None if prev is None else met-prev)); prev=met
    return rows

# =====================================================================
# A. WITHIN-ITEM predictability — incremental blocks, per high-volume item
# =====================================================================
print("\n"+"="*80)
print("A. WITHIN-ITEM PREDICTABILITY (target = native change, R^2 on held-out 30%)")
print("   blocks added cumulatively; Δ = gain over previous")
print("="*80)
BLOCKS = [
    ("baseline (Eval)",        ["Eval"], []),
    ("+ age",                  ["age"], []),
    ("+ diagnosis",            [],      ["dx_chapter"]),
    ("+ dose (mpw,LOS,min)",   ["mpw","los_days","track_minutes"], []),
    ("+ setting/discipline",   [],      ["Discipline","DomLibrary","PoR","Stay"]),
]
anchor_items = (df.groupby(["LibraryItem_ID","item_label"]).size()
                  .sort_values(ascending=False).head(8).reset_index())
summary=[]
for _,r in anchor_items.iterrows():
    d=df[df.LibraryItem_ID==r.LibraryItem_ID]
    if len(d)<2000: continue
    rows=blocks_eval(d,BLOCKS,"change","reg")
    print(f"\n-- {r.item_label[:46]:48} (n={len(d):,}, mean Δ={d.change.mean():.2f}) --")
    for name,met,delta in rows:
        ds = "" if delta is None else f"  Δ{delta:+.3f}"
        print(f"     {name:26} R²={met:6.3f}{ds}")
    full=rows[-1][1]; base=rows[0][1]
    summary.append({"item":r.item_label,"n":len(d),"R2_baseline":round(base,3),
                    "R2_full":round(full,3),"R2_added_by_attrs":round(full-base,3)})
pd.DataFrame(summary).to_csv(OUT/"within_item_r2.csv",index=False)

# =====================================================================
# B. SINGLE-VARIABLE signal within an anchor item (Toilet transfer)
# =====================================================================
TOILET = int(anchor_items.iloc[0].LibraryItem_ID)  # highest-volume = Toilet transfer
a = df[df.LibraryItem_ID==TOILET]
print("\n"+"="*80)
print(f"B. SINGLE-VARIABLE SIGNAL within '{anchor_items.iloc[0].item_label}' (n={len(a):,})")
print("="*80)
def by(col, top=12):
    g=a.groupby(col).agg(n=("change","size"),mean_change=("change","mean"),
                         pct_improved=("improved","mean"),mean_baseline=("Eval","mean"))
    g=g[g.n>=200].sort_values("mean_change",ascending=False)
    return g.head(top)
a["mpw_q"]=pd.qcut(a["mpw"],4,labels=["Q1 low","Q2","Q3","Q4 high"],duplicates="drop")
a["baseline_lvl"]=a["Eval"].round().astype(int)
for col in ["age_band","dx_chapter","mpw_q","baseline_lvl"]:
    print(f"\n## by {col}")
    print(by(col).assign(pct_improved=lambda x:(100*x.pct_improved).round(1)).round(2).to_string())

# =====================================================================
# C. COMBINATIONS / INTERACTIONS — do combos beat singles? (anchor item)
# =====================================================================
print("\n"+"="*80)
print(f"C. SINGLE vs COMBINATION predictors (target=change, R² test) — anchor item")
print("="*80)
def r2_of(d, num, cat):
    y=d["change"].values
    Xtr,Xte,ytr,yte=train_test_split(d,y,test_size=.3,random_state=RS)
    p=pipe(num,cat,"reg"); p.fit(Xtr[num+cat],ytr)
    return r2_score(yte,p.predict(Xte[num+cat]))
combos = {
    "age only":(["age"],[]),
    "diagnosis only":([],["dx_chapter"]),
    "baseline only":(["Eval"],[]),
    "dose only (mpw,LOS)":(["mpw","los_days"],[]),
    "baseline+age":(["Eval","age"],[]),
    "baseline+diagnosis":(["Eval"],["dx_chapter"]),
    "baseline+dose":(["Eval","mpw","los_days"],[]),
    "baseline+age+diagnosis+dose":(["Eval","age","mpw","los_days"],["dx_chapter"]),
    "ALL +discipline/library/PoR":(["Eval","age","mpw","los_days","track_minutes"],
                                   ["dx_chapter","Discipline","DomLibrary","PoR","Stay","Gender"]),
}
res=[]
for nm,(nu,ca) in combos.items():
    v=r2_of(a,nu,ca); res.append((nm,v)); print(f"   {nm:32} R²={v:6.3f}")
pd.DataFrame(res,columns=["model","R2_test"]).to_csv(OUT/"anchor_combos_r2.csv",index=False)

# explicit interaction test: baseline x diagnosis (does the baseline effect differ by dx?)
print("\n   interaction probe (baseline × diagnosis):")
ai=a.copy()
base_main=r2_of(ai,["Eval"],["dx_chapter"])
# build interaction features (baseline centered, per top dx)
ai["Eval_c"]=ai["Eval"]-ai["Eval"].mean()
top_dx=ai["dx_chapter"].value_counts().head(6).index
for dxn in top_dx: ai[f"Ex_{dxn[:4]}"]=ai["Eval_c"]*(ai["dx_chapter"]==dxn)
inter_num=["Eval"]+[f"Ex_{d[:4]}" for d in top_dx]
base_plus_inter=r2_of(ai,inter_num,["dx_chapter"])
print(f"     baseline+diagnosis           R²={base_main:.3f}")
print(f"     + baseline×diagnosis interact R²={base_plus_inter:.3f}  Δ{base_plus_inter-base_main:+.3f}")

# =====================================================================
# D. TRACK-LEVEL GG COMPOSITE (overall functional gain per track)
# =====================================================================
print("\n"+"="*80)
print("D. TRACK-LEVEL GG COMPOSITE (mean item score eval->disch, per track)")
print("="*80)
comp = (df.groupby("TxTrack_ID").agg(
        eval_mean=("Eval","mean"),disch_mean=("Disch","mean"),
        n_items=("Eval","size")).reset_index())
comp["comp_change"]=comp["disch_mean"]-comp["eval_mean"]
tmeta=df.drop_duplicates("TxTrack_ID")[["TxTrack_ID","age","dx_chapter","Discipline",
        "DomLibrary","PoR","Stay","Gender","mpw","los_days","track_minutes"]]
comp=comp.merge(tmeta,on="TxTrack_ID").rename(columns={"eval_mean":"Eval"})
comp=comp[comp.n_items>=3]
print(f"tracks with >=3 GG items: {len(comp):,}  mean composite change={comp.comp_change.mean():.2f}")
CBLOCKS=[("baseline (mean Eval)",["Eval"],[]),("+ age",["age"],[]),
         ("+ diagnosis",[],["dx_chapter"]),("+ dose",["mpw","los_days","track_minutes"],[]),
         ("+ setting/discipline",[],["Discipline","DomLibrary","PoR","Stay"])]
comp["change"]=comp["comp_change"]
for name,met,delta in blocks_eval(comp,CBLOCKS,"change","reg"):
    ds="" if delta is None else f"  Δ{delta:+.3f}"
    print(f"   {name:26} R²={met:6.3f}{ds}")

print("\nDONE. tables -> analysis/outputs/*.csv")
