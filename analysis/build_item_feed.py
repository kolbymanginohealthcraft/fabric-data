"""
Build the report feeds for the FunctionalOutcomes (risk-adjusted per-item) Power BI report.

Reads the per-item residual output of item_scorecard.py (analysis/outputs/
item_scorecard_caseitem.csv) and shapes a small STAR for the report to import:

  data/item-fact-feed.csv        FactItemResidual  — one row per (Facility x GG item)
  data/item-facility-feed.csv    DimFacility       — one row per facility
  data/item-dim-feed.csv         DimItem           — one row per GG item (+ split-half reliability)

Same decoupling as the therapist scorecard: the report surfaces this OUTPUT; it does not
re-derive the expected model in DAX. Dev source = these local CSVs (git-ignored, facility
performance is PHI-adjacent); production = an IT-ingested medallion table on the same
trailing-12-month window. Facility-item cells below MIN_N are dropped as too thin to show.

Usage: python -m analysis.build_item_feed   (run item_scorecard.py first)
"""
import numpy as np, pandas as pd
from pathlib import Path
D=Path("data"); OUT=Path("analysis/outputs"); RS=42
MIN_ITEM_N=15      # min episodes for a facility x item cell to be shown
MIN_FAC_CASES=50   # min episodes for a facility to appear at all

src=OUT/"item_scorecard_caseitem.csv"
if not src.exists():
    raise SystemExit("Missing analysis/outputs/item_scorecard_caseitem.csv — run: python -m analysis.item_scorecard")
ci=pd.read_csv(src)

# Division code -> name (from the facility dim)
fd=pd.read_csv(D/"facility-dim.csv",usecols=["Facility_ID","DivisionName"]).drop_duplicates("Facility_ID")
divname=(pd.read_csv(D/"facility-dim.csv",usecols=["DivisionCode","DivisionName"])
           .dropna().drop_duplicates().set_index("DivisionCode")["DivisionName"].to_dict())

# item sort order: mobility A..S then self-care A..H, by the letter prefix already in `item`
def item_code(s):  # "F. Toilet transfer" -> "F"
    return str(s).split(".")[0].strip()

# ---- facility eligibility (enough episodes overall) ----
fac_cases=ci.groupby("Facility_ID").PatientCase_ID.nunique()
keep_fac=fac_cases[fac_cases>=MIN_FAC_CASES].index
ci=ci[ci.Facility_ID.isin(keep_fac)].copy()

# ===== FACT: facility x item =====
fact=(ci.groupby(["Facility_ID","LibraryItem_ID"])
        .agg(Episodes=("residual","size"),Admission=("adm","mean"),Observed=("dis","mean"),
             Expected=("expected","mean"),Gain=("gain","mean"),Residual=("residual","mean"),
             PctGeExp=("residual",lambda r:(r>=0).mean()*100)).reset_index())
fact=fact[fact.Episodes>=MIN_ITEM_N].copy()
fact=fact.rename(columns={"LibraryItem_ID":"ItemCode"})
for c in ["Admission","Observed","Expected","Gain","Residual"]: fact[c]=fact[c].round(3)
fact["PctGeExp"]=fact.PctGeExp.round(1)

# ===== DIM FACILITY =====
fac=(ci.groupby(["Facility_ID","FacilityName","DivisionCode"])
       .agg(TotalCases=("PatientCase_ID","nunique"),OverallResidual=("residual","mean")).reset_index())
fac["DivisionName"]=fac.DivisionCode.map(divname).fillna(fac.DivisionCode.astype(str))
fac["OverallResidual"]=fac.OverallResidual.round(3)
fac=fac[fac.Facility_ID.isin(fact.Facility_ID.unique())][
      ["Facility_ID","FacilityName","DivisionName","TotalCases","OverallResidual"]]

# ===== DIM ITEM (+ split-half reliability of facility residual, per item) =====
rng=np.random.default_rng(RS); ci["half"]=rng.integers(0,2,len(ci))
from scipy.stats import spearmanr
rel={}
for iid,grp in ci.groupby("LibraryItem_ID"):
    fc=grp.groupby("Facility_ID").size(); sub=grp[grp.Facility_ID.isin(fc[fc>=20].index)]
    h=sub.groupby(["Facility_ID","half"]).residual.mean().unstack().dropna()
    rel[iid]=round(float(spearmanr(h[0],h[1]).correlation),3) if len(h)>=8 else np.nan
dim=(ci.groupby(["LibraryItem_ID","item","group","fam"])
       .agg(PopEpisodes=("residual","size"),PopAdmission=("adm","mean"),
            PopObserved=("dis","mean"),PopGain=("gain","mean"),
            PopPctGeExp=("residual",lambda r:(r>=0).mean()*100)).reset_index())
dim=dim.rename(columns={"LibraryItem_ID":"ItemCode","item":"Item","group":"ItemGroup","fam":"Family"})
dim["ItemLetter"]=dim.Item.map(item_code)
dim["SortOrder"]=(dim.Family.map({"Mobility":0,"Self-Care":1}).fillna(2)*100
                  + dim.groupby("Family").cumcount())
dim["Reliability"]=dim.ItemCode.map(rel)
for c in ["PopAdmission","PopObserved","PopGain"]: dim[c]=dim[c].round(3)
dim["PopPctGeExp"]=dim.PopPctGeExp.round(1)

fact.to_csv(D/"item-fact-feed.csv",index=False)
fac.to_csv(D/"item-facility-feed.csv",index=False)
dim.sort_values("SortOrder").to_csv(D/"item-dim-feed.csv",index=False)
print(f"FactItemResidual : {len(fact):,} facility x item cells  (>= {MIN_ITEM_N} episodes)")
print(f"DimFacility      : {len(fac):,} facilities (>= {MIN_FAC_CASES} cases)")
print(f"DimItem          : {len(dim)} items   median reliability={dim.Reliability.median():.2f}")
print("-> data/item-fact-feed.csv, data/item-facility-feed.csv, data/item-dim-feed.csv")
