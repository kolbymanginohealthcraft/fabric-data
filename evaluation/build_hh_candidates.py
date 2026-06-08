"""Candidate roster for the Home Health Field Clinician group -> data/hh-clinician-candidates.csv.

NO definition is committed here. There is no authoritative HR flag for home health (Workday exposes
only JobTitle + HomeLocation, and there is no HH division), so membership must be inferred from a
mix of signals. This script emits ONE ROW PER CANDIDATE clinician with every signal and a boolean
flag for each candidate definition side-by-side, so the options stay on the table and can be
compared before anyone commits. See docs/home-health-roster-options.md for the definitions.

Universe = clinicians who delivered >=1 home-health visit in the window  UNION  HH-titled employees
(so both the activity-based and the title-based populations are fully represented, including
HH-titled people who delivered no HH visits).

Signals per clinician:
  HH_visits / Total_visits / HH_share  (delivered+missed, by setting, from missed-visits.csv)
  HH_missed_rate                        (their home-health MissedVisitRate)
  HH_titled, Status/Active, Discipline, JobTitle, HomeDivision, CurrentScorecardGroup
  OtherSettings                         (non-HH settings they also work, with volumes)

Candidate definitions (flags, all kept):
  def_AnyHH              delivered >=1 HH visit                (broadest; 57% are incidental)
  def_MajorityHH         HH_share >= 50%
  def_PredominantHH      HH_share >= 75%                       (recommended core)
  def_PureHH             HH_share = 100%
  def_Titled             JobTitle marks home health           (HR signal; noisy)
  def_TitledAndDelivers  Titled AND delivered HH              (high-precision intersection)
  def_TitledOrPredominant Titled OR >=75% HH                  (high-recall union)
Cross-cut: Active (Status='Active'); low_volume (<20 HH visits -> share is noisy).

Inputs (data/): missed-visits.csv, employee-roster.csv
Output: data/hh-clinician-candidates.csv
Run from repo root:  python -m evaluation.build_hh_candidates
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"

HH = "HomeHealthAgency"
VOLUME_FLOOR = 20            # below this, HH_share is too noisy to trust on its own
PREDOMINANT = 0.75
MAJORITY = 0.50


def main() -> None:
    mv = pd.read_csv(DATA / "missed-visits.csv")
    mv["Person_ID"] = mv["Person_ID"].astype(int)
    mv["visits"] = mv["DeliveredVisits"] + mv["MissedVisits"]

    # per-clinician rollup across settings
    tot = mv.groupby("Person_ID")["visits"].sum().rename("Total_visits")
    hh = mv[mv["Setting"] == HH].set_index("Person_ID")
    hh_visits = hh["visits"].rename("HH_visits")
    hh_missed = hh["MissedVisits"].rename("HH_missed")

    # non-HH settings summary string, e.g. "SkilledNursingFacility:120; OutpatientClinic:8"
    other = (mv[mv["Setting"] != HH]
             .sort_values("visits", ascending=False)
             .groupby("Person_ID")
             .apply(lambda d: "; ".join(f"{s}:{int(v)}" for s, v in zip(d["Setting"], d["visits"])),
                    include_groups=False)
             .rename("OtherSettings"))

    df = pd.concat([tot, hh_visits, hh_missed, other], axis=1)
    df["HH_visits"] = df["HH_visits"].fillna(0).astype(int)
    df["HH_missed"] = df["HH_missed"].fillna(0).astype(int)
    df["Total_visits"] = df["Total_visits"].fillna(0).astype(int)
    df["HH_share"] = (df["HH_visits"] / df["Total_visits"]).where(df["Total_visits"] > 0, 0.0)
    df["HH_missed_rate"] = (df["HH_missed"] / df["HH_visits"]).where(df["HH_visits"] > 0)

    # identity / HR signals
    r = pd.read_csv(DATA / "employee-roster.csv", dtype=str)
    r["Person_ID"] = r["Person_ID"].astype(int)
    keep = ["Person_ID", "FullName", "Discipline", "JobTitle", "Status",
            "HomeDivision", "ScorecardGroup", "HH_titled"]
    r = r[keep].rename(columns={"ScorecardGroup": "CurrentScorecardGroup"})

    # universe = HH deliverers UNION HH-titled
    deliverers = set(df.index[df["HH_visits"] > 0])
    titled = set(r.loc[r["HH_titled"] == "Y", "Person_ID"])
    universe = sorted(deliverers | titled)

    out = pd.DataFrame({"Person_ID": universe}).merge(
        df.reset_index(), on="Person_ID", how="left").merge(r, on="Person_ID", how="left")
    for c in ["HH_visits", "HH_missed", "Total_visits"]:
        out[c] = out[c].fillna(0).astype(int)
    out["HH_share"] = out["HH_share"].fillna(0.0)
    out["HH_titled_flag"] = out["HH_titled"].eq("Y")
    out["Active"] = out["Status"].eq("Active")
    out["low_volume"] = out["HH_visits"] < VOLUME_FLOOR

    # candidate-definition flags (all kept on the table)
    out["def_AnyHH"] = out["HH_visits"] > 0
    out["def_MajorityHH"] = out["HH_share"] >= MAJORITY
    out["def_PredominantHH"] = out["HH_share"] >= PREDOMINANT
    out["def_PureHH"] = out["HH_share"] >= 0.999
    out["def_Titled"] = out["HH_titled_flag"]
    out["def_TitledAndDelivers"] = out["def_Titled"] & out["def_AnyHH"]
    out["def_TitledOrPredominant"] = out["def_Titled"] | out["def_PredominantHH"]

    out["HH_share"] = out["HH_share"].round(4)
    out["HH_missed_rate"] = out["HH_missed_rate"].round(4)

    cols = ["Person_ID", "FullName", "Discipline", "JobTitle", "Status", "Active",
            "HomeDivision", "CurrentScorecardGroup", "HH_titled_flag",
            "HH_visits", "HH_missed", "HH_missed_rate", "Total_visits", "HH_share",
            "low_volume", "OtherSettings",
            "def_AnyHH", "def_MajorityHH", "def_PredominantHH", "def_PureHH",
            "def_Titled", "def_TitledAndDelivers", "def_TitledOrPredominant"]
    out = out[cols].sort_values(["HH_share", "HH_visits"], ascending=[False, False])
    out.to_csv(DATA / "hh-clinician-candidates.csv", index=False, encoding="utf-8-sig")

    # ---- summary: population under each definition ----
    defs = ["def_AnyHH", "def_MajorityHH", "def_PredominantHH", "def_PureHH",
            "def_Titled", "def_TitledAndDelivers", "def_TitledOrPredominant"]
    print(f"candidate universe: {len(out):,} clinicians "
          f"(HH deliverers {len(deliverers):,}  +  HH-titled {len(titled):,}, unioned)  -> hh-clinician-candidates.csv")
    print(f"\n{'definition':<24}{'all':>6}{'active':>8}{'active & >=20 HH':>18}")
    for d in defs:
        a = int(out[d].sum())
        act = int((out[d] & out["Active"]).sum())
        actv = int((out[d] & out["Active"] & ~out["low_volume"]).sum())
        print(f"{d:<24}{a:>6}{act:>8}{actv:>18}")
    print(f"\ndiscipline mix (active, def_PredominantHH):")
    sub = out[out["def_PredominantHH"] & out["Active"]]
    print(sub["Discipline"].value_counts(dropna=False).to_string())


if __name__ == "__main__":
    main()
