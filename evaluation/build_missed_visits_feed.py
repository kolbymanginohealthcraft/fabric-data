"""Build the "% Missed Visits" metric feed -> data/missed-visits-feed.csv.

Turns the per-(Person x Setting) missed/delivered counts from pull-missed-visits.js into the same
long schema the app feed folds in (Person_ID, Metric, Stay, Raw, Weighted, Percentile) -- identical
pattern to build_satisfaction_feed.py, so build_feed can pick it up the moment we want it.

The metric is the PLAIN missed rate: MissedVisits / (MissedVisits + DeliveredVisits). There is no
FR (frequency-ordered) variant -- NetHealth has no per-visit FR/PRN tag and home-health tracks carry
no ordered frequency, so "% missed FR visits" cannot be sourced from this pipeline (see project
memory: project_missed_visits). Lower is better.

This step deliberately does NOT decide WHO gets the metric. It emits a row per clinician per setting
for everyone with visits; scoping to the Home Health Field Clinician group (and the percentile peer
group) is applied later, once that roster/group is defined. Percentile here is provisional: ranked
within Setting x Discipline among clinicians clearing a small volume floor, lower-rate = higher pctile.

Inputs (data/): missed-visits.csv, employee-dim.csv (for Discipline/name; optional)
Output: data/missed-visits-feed.csv
Run from repo root:  python -m evaluation.build_missed_visits_feed
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"

METRIC = "MissedVisitRate"          # PascalCase, matches therapist-metrics convention
MIN_VISITS_FOR_PCTILE = 20          # don't rank clinicians on a handful of visits


def main() -> None:
    mv = pd.read_csv(DATA / "missed-visits.csv")
    mv["Person_ID"] = mv["Person_ID"].astype(int)
    mv["TotalVisits"] = mv["DeliveredVisits"] + mv["MissedVisits"]
    mv = mv[mv["TotalVisits"] > 0].copy()
    mv["Raw"] = mv["MissedVisits"] / mv["TotalVisits"]

    # identity / discipline (best-effort; feed only strictly needs the 6 long-schema cols)
    disc = name = None
    emp_path = DATA / "employee-dim.csv"
    if emp_path.exists():
        emp = pd.read_csv(emp_path, dtype=str).drop_duplicates("Person_ID")
        emp["Person_ID"] = emp["Person_ID"].astype(int)
        disc = emp.set_index("Person_ID")["Discipline"].to_dict() if "Discipline" in emp else None
        name = emp.set_index("Person_ID")["FullName"].to_dict() if "FullName" in emp else None
    mv["Discipline"] = mv["Person_ID"].map(disc) if disc else pd.NA
    mv["FullName"] = mv["Person_ID"].map(name) if name else pd.NA

    # long-schema constants
    mv["Metric"] = METRIC
    mv["Stay"] = "All"
    mv["Weighted"] = mv["Raw"]          # no within-clinician re-weighting for a rate
    mv["Coverage"] = mv["TotalVisits"]  # volume behind the number (mirrors satisfaction)

    # provisional percentile: lower missed-rate = better (higher pctile), within Setting x Discipline,
    # among clinicians clearing the volume floor. Revisit the peer group when the HH group is finalized.
    elig = mv["TotalVisits"] >= MIN_VISITS_FOR_PCTILE
    grp_cols = ["Setting", "Discipline"] if disc else ["Setting"]
    mv["Percentile"] = (
        mv[elig].groupby(grp_cols, dropna=False)["Raw"].rank(pct=True, ascending=False)
    )

    out = mv[["Person_ID", "FullName", "Discipline", "Setting", "Metric", "Stay",
              "MissedVisits", "TotalVisits", "Raw", "Weighted", "Percentile", "Coverage"]] \
        .sort_values(["Setting", "Raw"], ascending=[True, False])
    out.to_csv(DATA / "missed-visits-feed.csv", index=False, encoding="utf-8-sig")

    print(f"wrote missed-visits-feed.csv: {len(out):,} (clinician x setting) rows "
          f"({out['Person_ID'].nunique():,} distinct clinicians)")
    print(f"  percentile floor: >= {MIN_VISITS_FOR_PCTILE} visits "
          f"({int(elig.sum()):,} rows ranked, {int((~elig).sum()):,} below floor -> blank pctile)")
    print("\n  missed rate by Setting (volume-weighted):")
    g = out.groupby("Setting").apply(
        lambda d: pd.Series({"clinicians": d["Person_ID"].nunique(),
                             "visits": int(d["TotalVisits"].sum()),
                             "missed": int(d["MissedVisits"].sum()),
                             "pct": d["MissedVisits"].sum() / d["TotalVisits"].sum()}),
        include_groups=False)
    print(g.assign(pct=(g["pct"] * 100).round(1)).to_string())


if __name__ == "__main__":
    main()
