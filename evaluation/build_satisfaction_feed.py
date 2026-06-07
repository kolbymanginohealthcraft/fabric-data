"""Attribute facility-level satisfaction metrics to therapists -> raw / weighted / percentile.

Attribution is simpler than outcomes (the surveys have no patient/therapist grain -- they rate
"the therapist(s)" at a facility):
  - FIELD CLINICIANS (Contract Rehab / SL / Telehealth): get their HOME facility's result for THEIR
    discipline (PT/PTA->PT, OT/COTA->OT, ST/SLP->ST). Telehealth = Advocacy Score only (no Response
    Rate). Everyone of the same discipline at the same facility gets the same value -- by design.
  - SL AREA MANAGERS: every discipline rolled up across EVERY facility in their territory, via the
    shared ledger rule reused from build_attribution (same rule the clinical side uses). Advocacy =
    response-weighted mean (= Sum points / Sum max points); Response Rate = Sum respondents /
    Sum planned discharges over the territory.
  - CR Managers / Leadership stay PARKED (consistent with the clinical scorecard).

Percentile peer group (higher is better): ScorecardGroup x Discipline for Advocacy; ScorecardGroup
for Response Rate (RR is facility-level, not discipline-specific). [CONFIRM: see note in summary.]

Inputs (data/): employee-roster.csv, employee-dim.csv, facility-hier.csv, facility-dim.csv,
                satisfaction-scores.csv, satisfaction-response-rate.csv
Output: data/satisfaction-feed.csv
Run from repo root:  python -m evaluation.build_satisfaction_feed
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

from evaluation.build_attribution import (
    SL_AREA_MGR_CODES, build_ledger_maps, territory_codes, _orgchart_territory,
)

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"

# clinician discipline -> survey discipline (assistants fold into their registered discipline)
DISC_MAP = {"PT": "PT", "PTA": "PT", "OT": "OT", "COTA": "OT",
            "ST": "ST", "SLP": "ST", "CF-SLP": "ST", "CFY": "ST"}
HOME_FIELD_GROUPS = {"Contract Rehab Field Clinician", "SL Field Clinician"}  # attributed by home facility
TELEHEALTH = "Telehealth Field Clinician"                                     # no home building -> served facilities
MGR_GROUP = "SL Area Manager"
SURVEY_DISCIPLINES = ["PT", "OT", "ST"]


def weighted_advocacy(pairs, adv, advN):
    """Response-weighted Advocacy over a set of (Facility_ID, survey_discipline) pairs
    = Sum(score*n_responses) / Sum(n_responses) = Sum points / Sum max points."""
    num = den = 0.0
    for fid, d in pairs:
        a, n = adv.get((fid, d)), advN.get((fid, d))
        if pd.notna(a) and pd.notna(n):
            num += a * n
            den += n
    return (num / den) if den > 0 else None


def served_facilities() -> dict:
    """Person_ID -> set of Facility_IDs where they have credited treatment tracks (for Telehealth,
    who have no home building). From therapist-attribution (who touched each track) x tracks."""
    att = pd.read_csv(DATA / "therapist-attribution.csv", usecols=["TxTrack_ID", "Person_ID"])
    trk = pd.read_csv(DATA / "tracks.csv", usecols=["TxTrack_ID", "Facility_ID"])
    j = att.merge(trk, on="TxTrack_ID", how="inner").dropna(subset=["Facility_ID"])
    j["Facility_ID"] = j["Facility_ID"].astype(int)
    return j.groupby("Person_ID")["Facility_ID"].apply(set).to_dict()


def load_emp() -> pd.DataFrame:
    emp = pd.read_csv(DATA / "employee-dim.csv", dtype=str).drop_duplicates("Person_ID")
    emp["Person_ID"] = emp["Person_ID"].astype(int)
    emp["JobCode_int"] = pd.to_numeric(emp["JobCode"], errors="coerce")
    emp["home"] = emp["HomeLocation"].str.zfill(5)
    return emp


def main() -> None:
    roster = pd.read_csv(DATA / "employee-roster.csv", dtype=str)
    roster["Person_ID"] = roster["Person_ID"].astype(int)
    scores = pd.read_csv(DATA / "satisfaction-scores.csv")          # Facility_ID, Discipline, AdvocacyScore, n_responses, n_surveys
    rr = pd.read_csv(DATA / "satisfaction-response-rate.csv")       # Facility_ID, n_respondents, n_planned, ResponseRate

    fac = pd.read_csv(DATA / "facility-dim.csv")
    fac["code"] = fac["FacilityName"].str.extract(r"^\s*(\d+)")[0].str.zfill(5)
    code2fid = fac.dropna(subset=["code"]).drop_duplicates("code").set_index("code")["Facility_ID"].to_dict()

    adv = scores.set_index(["Facility_ID", "Discipline"])["AdvocacyScore"].to_dict()
    advN = scores.set_index(["Facility_ID", "Discipline"])["n_responses"].to_dict()
    rr_rate = rr.set_index("Facility_ID")["ResponseRate"].to_dict()

    rows = []

    # ---- CR / SL FIELD CLINICIANS: home facility x their discipline ----
    field = roster[roster["ScorecardGroup"].isin(HOME_FIELD_GROUPS)].copy()
    field["survey_disc"] = field["Discipline"].map(DISC_MAP)
    field["fid"] = field["HomeLocation"].str.zfill(5).map(code2fid)
    n_nohome = field["fid"].isna().sum()
    n_nodisc = field["survey_disc"].isna().sum()
    for _, r in field.iterrows():
        if pd.isna(r["fid"]) or pd.isna(r["survey_disc"]):
            continue
        fid, sd = int(r["fid"]), r["survey_disc"]
        base = {"Person_ID": r["Person_ID"], "FullName": r["FullName"],
                "ScorecardGroup": r["ScorecardGroup"], "Discipline": sd,
                "Facility_ID": fid, "Coverage": 1}
        a = adv.get((fid, sd))
        if pd.notna(a):
            rows.append({**base, "Metric": "AdvocacyScore", "Raw": a})
        rt = rr_rate.get(fid)
        if pd.notna(rt):
            rows.append({**base, "Metric": "ResponseRate", "Discipline": "All", "Raw": rt})

    # ---- TELEHEALTH: no home building -> Advocacy over facilities they SERVED (their discipline) ----
    served = served_facilities()
    th = roster[roster["ScorecardGroup"] == TELEHEALTH].copy()
    th["survey_disc"] = th["Discipline"].map(DISC_MAP)
    n_th_noserve = 0
    for _, r in th.iterrows():
        sd = r["survey_disc"]
        fids = served.get(r["Person_ID"], set())
        if pd.isna(sd) or not fids:
            n_th_noserve += 1
            continue
        a = weighted_advocacy([(f, sd) for f in fids], adv, advN)   # Telehealth = Advocacy only
        if a is not None:
            rows.append({"Person_ID": r["Person_ID"], "FullName": r["FullName"],
                         "ScorecardGroup": TELEHEALTH, "Discipline": sd, "Facility_ID": pd.NA,
                         "Coverage": len(fids), "Metric": "AdvocacyScore", "Raw": a})

    # ---- SL AREA MANAGERS: all disciplines rolled up across their territory ----
    emp = load_emp()
    M = build_ledger_maps(pd.read_csv(DATA / "facility-hier.csv", dtype=str))
    org = _orgchart_territory(emp)
    home_d = emp.set_index("Person_ID")["home"].to_dict()
    rr_idx = rr.set_index("Facility_ID")

    mgr = roster[roster["ScorecardGroup"] == MGR_GROUP]
    for _, r in mgr.iterrows():
        pid = r["Person_ID"]
        level, codes = territory_codes(home_d.get(pid), M)
        if codes is None:
            codes = org.get(pid, set())
        fids = {code2fid.get(c) for c in codes}
        fids = {int(f) for f in fids if pd.notna(f)}
        base = {"Person_ID": pid, "FullName": r["FullName"], "ScorecardGroup": MGR_GROUP,
                "Discipline": "All", "Facility_ID": pd.NA, "Coverage": len(fids)}
        # Advocacy = response-weighted mean over territory facilities x ALL disciplines
        a = weighted_advocacy([(f, d) for f in fids for d in SURVEY_DISCIPLINES], adv, advN)
        if a is not None:
            rows.append({**base, "Metric": "AdvocacyScore", "Raw": a})
        # Response Rate = total respondents / total planned discharges over territory
        sub = rr_idx[rr_idx.index.isin(fids)]
        if len(sub) and sub["n_planned"].sum() > 0:
            rows.append({**base, "Metric": "ResponseRate", "Raw": sub["n_respondents"].sum() / sub["n_planned"].sum()})

    df = pd.DataFrame(rows)
    df["Stay"] = "All"
    df["Weighted"] = df["Raw"]                                      # no within-therapist re-weighting for satisfaction

    # percentile within peer group (higher = better); Advocacy peers by discipline, RR by group only
    df["CohortDisc"] = df.apply(lambda x: x["Discipline"] if x["Metric"] == "AdvocacyScore" else "All", axis=1)
    df["Percentile"] = df.groupby(["Metric", "ScorecardGroup", "CohortDisc"])["Raw"].rank(pct=True)

    out = df[["Person_ID", "FullName", "ScorecardGroup", "Discipline", "Facility_ID",
              "Metric", "Stay", "Raw", "Weighted", "Percentile", "Coverage"]] \
        .sort_values(["Metric", "ScorecardGroup", "Percentile"], ascending=[True, True, False])
    out.to_csv(DATA / "satisfaction-feed.csv", index=False)

    print(f"wrote satisfaction-feed.csv: {len(out):,} therapist-metric rows "
          f"({out['Person_ID'].nunique():,} distinct therapists)")
    print(f"\nCR/SL field dropped: {n_nohome} no home-facility match, {n_nodisc} non-therapy discipline | "
          f"Telehealth without served facilities: {n_th_noserve}")
    print("\nrows by Metric x ScorecardGroup:")
    print(df.groupby(["Metric", "ScorecardGroup"]).agg(
        n=("Person_ID", "nunique"), raw_mean=("Raw", "mean")).round(3).to_string())


if __name__ == "__main__":
    main()
