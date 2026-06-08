"""Build the app feed: one wide row per scored therapist -> therapist-scorecard-feed.csv.

This is the HANDOFF surface to the Performance Management app (IT-owned). The file is the
boundary: the app never sees our logic, only these columns. Treat the schema as a contract
(stable column names + metadata), even though delivery is just a CSV for now. Final column
names get remapped once IT provides their ingest spec; drop location is added later.

Pivots therapist-metrics (long: Person x Metric x Stay -> Raw/Weighted/Percentile) into wide
columns, joins identity + scorecard categorization, stamps versioning metadata.

Run from repo root:  python -m evaluation.build_feed
"""
from __future__ import annotations
from datetime import date, datetime, timedelta
from pathlib import Path
import os
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
SCORING_VERSION = "1.0.0"


def main() -> None:
    m = pd.read_csv(DATA / "therapist-metrics.csv")
    # fold in the satisfaction domain (Advocacy Score, Response Rate), same long schema
    sat_path = DATA / "satisfaction-feed.csv"
    if sat_path.exists():
        sat = pd.read_csv(sat_path, usecols=["Person_ID", "Metric", "Stay", "Raw", "Weighted", "Percentile"])
        m = pd.concat([m, sat], ignore_index=True)
        print(f"folded satisfaction-feed: +{len(sat):,} rows ({sat['Person_ID'].nunique():,} therapists)")
    else:
        print("NOTE: satisfaction-feed.csv not found — feed will be clinical-only "
              "(run: python -m evaluation.build_satisfaction_feed)")
    # fold in the missed-visits domain (MissedVisitRate), same long schema — but GATED OFF by
    # default: the metric is built and ready, yet HH clinicians aren't a scored group yet, so we
    # don't want it silently landing on CR/SL scorecards. Flip on with INCLUDE_MISSED_VISITS=1
    # once the Home Health Field Clinician group is defined (and ideally scoped there).
    mv_path = DATA / "missed-visits-feed.csv"
    if os.environ.get("INCLUDE_MISSED_VISITS") == "1" and mv_path.exists():
        mvf = pd.read_csv(mv_path, usecols=["Person_ID", "Metric", "Stay", "Raw", "Weighted", "Percentile"])
        m = pd.concat([m, mvf], ignore_index=True)
        print(f"folded missed-visits-feed: +{len(mvf):,} rows "
              f"({mvf['Person_ID'].nunique():,} clinicians) [INCLUDE_MISSED_VISITS=1]")
    elif mv_path.exists():
        print("NOTE: missed-visits-feed.csv present but NOT folded "
              "(set INCLUDE_MISSED_VISITS=1 to include it once the HH group is scoped)")
    roster = pd.read_csv(DATA / "employee-roster.csv",
                         usecols=["Person_ID", "FullName", "Discipline", "Role",
                                  "ScorecardGroup", "Template"])
    emp = pd.read_csv(DATA / "employee-dim.csv", dtype=str).drop_duplicates("Person_ID")
    emp["Person_ID"] = emp["Person_ID"].astype(int)

    # long -> wide: column base is Metric (+ _Stay unless All), then _Raw/_Weighted/_Percentile
    m["base"] = m["Metric"] + m["Stay"].map(lambda s: "" if s == "All" else f"_{s}")
    long = m.melt(id_vars=["Person_ID", "base"],
                  value_vars=["Raw", "Weighted", "Percentile"],
                  var_name="measure", value_name="val")
    long["col"] = long["base"] + "_" + long["measure"]
    wide = long.pivot_table(index="Person_ID", columns="col", values="val").reset_index()
    wide = wide.round(4)

    # identity + categorization
    feed = (wide
            .merge(roster, on="Person_ID", how="left")
            .merge(emp[["Person_ID", "UPN", "EmployeeNumber"]], on="Person_ID", how="left"))

    # metadata / versioning
    today = date.today()
    feed["scoring_version"] = SCORING_VERSION
    feed["as_of_date"] = today.isoformat()
    feed["computed_at"] = datetime.now().replace(microsecond=0).isoformat()
    feed["period_start"] = (today - timedelta(days=365)).isoformat()
    feed["period_end"] = today.isoformat()
    feed["data_quality_flag"] = "OK"

    # column order: identity -> categorization -> metadata -> metrics
    ident = ["Person_ID", "FullName", "UPN", "EmployeeNumber", "Discipline",
             "Role", "ScorecardGroup", "Template"]
    meta = ["scoring_version", "as_of_date", "computed_at",
            "period_start", "period_end", "data_quality_flag"]
    metric_cols = [c for c in feed.columns if c not in ident + meta]
    feed = feed[ident + meta + sorted(metric_cols)]

    out = DATA / "therapist-scorecard-feed.csv"
    try:
        feed.to_csv(out, index=False, encoding="utf-8-sig")
    except PermissionError:
        raise SystemExit("therapist-scorecard-feed.csv is open (Excel?) - close it and re-run.")

    print(f"feed rows (scored therapists): {len(feed):,}  -> {out.name}")
    print(f"columns: {len(feed.columns)}")
    print("\nmetric columns:")
    print("\n".join("  " + c for c in metric_cols))
    print(f"\nScorecardGroup in feed:")
    print(feed["ScorecardGroup"].value_counts().to_string())


if __name__ == "__main__":
    main()
