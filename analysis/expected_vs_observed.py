"""
Expected-vs-Observed functional outcomes — a risk-adjusted quality signal.

Mirrors the CMS SNF "Discharge Function Score" logic (docs/care-delivery-optimization
-framework.md): predict each episode's EXPECTED discharge function from case-mix GIVENS
ONLY (admission function, age, diagnosis, sex) -- deliberately NOT levers like dose or
discipline -- then residual = observed - expected. Individual residuals are noisy, but
aggregated to facility/division they form a STABLE, case-mix-adjusted performance signal.

Grain = PatientCase (whole-person episode): GG items aggregated across the case's tracks,
each item on its native 6-pt scale, composite = mean over items (>=8 items, both adm+dis).
Expected discharge level is estimated with out-of-fold (5-fold) predictions so residuals
are unbiased. NOTE: this is therapy-documentation outcomes, NOT the CMS Part-A-stay QM;
not comparable to CMS DTC/Rehosp QM values.

Usage: python -m analysis.expected_vs_observed
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

print("="*78); print("EXPECTED vs OBSERVED — risk-adjusted functional outcome"); print("="*78)
item=pd.read_csv(D/"gg-item-track.csv")
attr=pd.read_csv(D/"track-attributes.csv")
base=pd.read_csv(D/"track-base.csv",usecols=["TxTrack_ID","PatientCase_ID","Facility_ID"])
fac =pd.read_csv(D/"facility-dim.csv")

attr["age"]=(pd.to_datetime(attr.TrackStart,errors="coerce")-pd.to_datetime(attr.DOB,errors="coerce")).dt.days/365.25
attr["dx_chapter"]=attr.PrimaryDxCode.astype("string").fillna("").map(icd_chapter)

# track -> case + facility
tmap=base.merge(attr[["TxTrack_ID","age","Gender","dx_chapter"]],on="TxTrack_ID",how="left")
itc=item.merge(tmap,on="TxTrack_ID",how="inner")

# case x item (mean across the case's tracks), then case composite over items
ci=itc.groupby(["PatientCase_ID","LibraryItem_ID"]).agg(adm=("Eval","mean"),dis=("Disch","mean")).reset_index()
case=ci.groupby("PatientCase_ID").agg(adm_score=("adm","mean"),dis_score=("dis","mean"),
                                      n_items=("adm","size")).reset_index()
# case givens (constant-ish per case): mean age, modal dx/sex, facility
g=(itc.groupby("PatientCase_ID")
      .agg(age=("age","mean"),
           Gender=("Gender",lambda s:s.mode().iat[0] if len(s.mode()) else "U"),
           dx_chapter=("dx_chapter",lambda s:s.mode().iat[0] if len(s.mode()) else "Unknown"),
           Facility_ID=("Facility_ID",lambda s:s.mode().iat[0] if len(s.mode()) else np.nan))
      .reset_index())
case=case.merge(g,on="PatientCase_ID").merge(fac,on="Facility_ID",how="left")
case["change"]=case.dis_score-case.adm_score
case=case[(case.n_items>=8)&(case.age.between(50,105))&(case.DivisionCode.isin([8450,5500,6500]))]
case["age2"]=case.age**2
print(f"cases: {len(case):,}  facilities: {case.Facility_ID.nunique():,}  "
      f"mean adm={case.adm_score.mean():.2f} dis={case.dis_score.mean():.2f} change={case.change.mean():.2f}")

# ---- EXPECTED discharge model: GIVENS ONLY, out-of-fold predictions ----
NUM=["adm_score","age","age2"]; CAT=["dx_chapter","Gender"]
pipe=Pipeline([("p",ColumnTransformer([("n",StandardScaler(),NUM),
        ("c",OneHotEncoder(handle_unknown="ignore",min_frequency=200),CAT)])),("m",Ridge(alpha=1.0))])
X=case[NUM+CAT]; y=case.dis_score.values
cv=KFold(5,shuffle=True,random_state=RS)
case["expected"]=cross_val_predict(pipe,X,y,cv=cv)
case["residual"]=case.dis_score-case.expected
r2=r2_score(y,case.expected)
print(f"\nExpected-discharge-level model (givens only): out-of-fold R^2 = {r2:.3f}")
print(f"  (contrast: predicting individual CHANGE was R^2~0.1; predicting LEVEL is far more stable)")
print(f"  residual mean={case.residual.mean():+.3f} (≈0 by construction), sd={case.residual.std():.2f}")

# ---- calibration: observed vs expected by expected-decile ----
case["edec"]=pd.qcut(case.expected,10,labels=False,duplicates="drop")
cal=case.groupby("edec").agg(exp=("expected","mean"),obs=("dis_score","mean"),n=("dis_score","size"))
print("\nCalibration (expected decile -> mean expected vs observed):")
print("  "+"  ".join(f"{e:.2f}/{o:.2f}" for e,o in zip(cal.exp,cal.obs)))

# ---- FACILITY-level risk-adjusted performance ----
fr=(case.groupby(["Facility_ID","FacilityName","DivisionCode"])
        .agg(n=("residual","size"),adj_resid=("residual","mean"),
             raw_change=("change","mean"),mean_adm=("adm_score","mean"),
             pct_obs_ge_exp=("residual",lambda r:(r>=0).mean()*100)).reset_index())
fr=fr[fr.n>=30].copy()
fr["adj_rank"]=fr.adj_resid.rank(ascending=False)
fr["raw_rank"]=fr.raw_change.rank(ascending=False)
print(f"\nFacilities with >=30 cases: {len(fr)}")
print(f"Risk-adjusted residual spread: sd={fr.adj_resid.std():.3f}  "
      f"range {fr.adj_resid.min():+.2f}..{fr.adj_resid.max():+.2f} (GG points vs expected)")

# does risk-adjustment reorder vs raw? (if rho<1, case-mix mattered)
rho=spearmanr(fr.raw_change,fr.adj_resid).correlation
print(f"Spearman(raw mean-change rank, risk-adjusted rank) = {rho:.3f}  "
      f"-> {'risk adjustment meaningfully reorders facilities' if rho<0.9 else 'similar ordering'}")

# reliability: split each facility's cases in half, correlate the two half-residuals
rng=np.random.default_rng(RS); case["half"]=rng.integers(0,2,len(case))
h=(case.groupby(["Facility_ID","half"]).residual.mean().unstack())
h=h.loc[fr.set_index("Facility_ID").index].dropna()
rel=spearmanr(h[0],h[1]).correlation
print(f"Split-half reliability of facility residual (n={len(h)} facilities): rho={rel:.3f}  "
      f"-> {'stable, real between-facility signal' if rel>0.4 else 'weak/noisy'}")

fr=fr.sort_values("adj_resid",ascending=False)
def show(rows,lbl):
    print(f"\n{lbl}")
    print(f"  {'Facility':42}{'n':>5}{'adm':>6}{'rawΔ':>7}{'adj':>7}{'%≥exp':>7}{'rawRk':>7}")
    for _,r in rows.iterrows():
        print(f"  {r.FacilityName[:41]:42}{int(r.n):>5}{r.mean_adm:>6.2f}{r.raw_change:>7.2f}"
              f"{r.adj_resid:>+7.2f}{r.pct_obs_ge_exp:>6.0f}%{int(r.raw_rank):>7}")
show(fr.head(10),"TOP 10 facilities by RISK-ADJUSTED performance (observed-minus-expected GG):")
show(fr.tail(10),"BOTTOM 10 by risk-adjusted performance:")

# division-level
dv=(case.groupby("DivisionCode").agg(n=("residual","size"),adj_resid=("residual","mean"),
     raw_change=("change","mean"),mean_adm=("adm_score","mean")).reset_index())
print("\nDivision-level (risk-adjusted residual ~0 expected if model captures case-mix):")
print(dv.round(3).to_string(index=False))

case[["PatientCase_ID","Facility_ID","FacilityName","DivisionCode","n_items","age",
      "dx_chapter","adm_score","dis_score","change","expected","residual"]].to_csv(OUT/"case_expected_observed.csv",index=False)
fr.sort_values("adj_resid",ascending=False).to_csv(OUT/"facility_risk_adjusted.csv",index=False)
print("\nDONE -> analysis/outputs/case_expected_observed.csv, facility_risk_adjusted.csv")
