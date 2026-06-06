"""A2 step 1 — per-outcome percentile within its cohort.

Reads the assembled per-outcome dataset (outcomes-cohort.csv from build_outcomes.py),
applies the eval-scope filters, drops thin cohorts, and ranks each outcome's Gain
against the other outcomes in its cohort (percentile 0-1).

Cohort grain: LibraryItem_ID x Library x ServiceLine x Residence x Discipline.
(`job` is a therapist attribute applied at rating time — not a cohort column here.)

Filters / thresholds (starting defaults — easy to dial):
  - exclude ServiceLine in {Closed, Other/*}  (closed/unmapped facilities, not current eval)
  - MIN_COHORT_OUTCOMES = 25                   (cell-size analysis: drops ~57% of cohorts
                                                but only ~0.3% of outcomes)
Deferred (noted, not yet applied): min_track_duration_days (needs date parsing of the
JS-string TrackStart/EndDate) and min_peer_group_size reinterpreted as min DISTINCT
THERAPISTS per cohort (a therapist-diversity floor, layered at rating time).

Run from repo root:  python -m evaluation.cohort_percentiles
"""

from __future__ import annotations

from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
COHORT_CSV = REPO / "outcomes-cohort.csv"
OUT = REPO / "outcome-percentiles.csv"

MIN_COHORT_OUTCOMES = 25
COHORT_DIMS = ["LibraryItem_ID", "Library", "ServiceLine", "Residence", "Discipline"]


def main() -> None:
    df = pd.read_csv(COHORT_CSV)
    n0 = len(df)
    print(f"assembled outcomes: {n0:,}")

    excl = df["ServiceLine"].eq("Closed") | df["ServiceLine"].str.startswith("Other")
    df = df[~excl].copy()
    print(f"  after ServiceLine exclusion (Closed/Other): {len(df):,} "
          f"(-{n0 - len(df):,})")

    df["_cohort_n"] = df.groupby(COHORT_DIMS, dropna=False)["Gain"].transform("size")
    n_cohorts_all = df[COHORT_DIMS].drop_duplicates().shape[0]
    kept = df[df["_cohort_n"] >= MIN_COHORT_OUTCOMES].copy()
    n_cohorts_kept = kept[COHORT_DIMS].drop_duplicates().shape[0]
    print(f"  after cohort floor (>= {MIN_COHORT_OUTCOMES} outcomes): {len(kept):,} "
          f"outcomes in {n_cohorts_kept:,} of {n_cohorts_all:,} cohorts "
          f"({len(kept)/len(df):.2%} of outcomes retained)")

    # Percentile rank of Gain within cohort (ties averaged).
    kept["Percentile"] = (
        kept.groupby(COHORT_DIMS, dropna=False)["Gain"].rank(pct=True, method="average")
    )

    cols = ["TxTrack_ID", "PatientCase_ID", "LibraryItem_ID", "Library",
            "ServiceLine", "Residence", "Discipline", "Gain", "Percentile"]
    kept[cols].to_csv(OUT, index=False)

    print("\nPercentile distribution (sanity — should span ~0..1, centered ~0.5):")
    print(kept["Percentile"].describe(percentiles=[0.1, 0.25, 0.5, 0.75, 0.9]).to_string())
    print(f"\nWrote {len(kept):,} scored outcomes -> {OUT}")


if __name__ == "__main__":
    main()
