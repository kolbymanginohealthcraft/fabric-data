"""B4 — assemble the per-outcome cohort dataset + profile cohort cell sizes.

Cross-host join done client-side (the medallion's Bronze/Silver/aegisdataprod live on
different endpoints, so each was pulled separately):

    outcomes-core.csv   (Bronze)         one row per Included (Case x Track x Item) outcome
      + library-dim.csv (aegisdataprod)  LibraryItem_ID -> Library (OP/SNF)
      + facility-dim.csv(Silver)         Facility_ID    -> DivisionCode (padded RegionNumber)
      => ServiceLine computed here       (HHA residence -> Home Health, else division map)

Output: outcomes-cohort.csv (the per-outcome dataset with full cohort dims + Gain),
plus a printed cohort cell-size profile for the A2 design (outcome-level cohorting).

Cohort grain here = library_item x Library x ServiceLine x Residence x Discipline.
NOTE: the methodology also lists `job` in the cohort, but job is a THERAPIST attribute
applied at rating time (one outcome is attributed to multiple therapists), not an outcome
attribute -- so it is intentionally NOT a column here. Adding it multiplies cell count and
raises the "which attributed therapist's job?" question -- a design decision to settle with
real numbers in hand.

Run from repo root:  python -m evaluation.build_outcomes
"""

from __future__ import annotations

from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
OUTCOMES = REPO / "outcomes-core.csv"
LIBRARY = REPO / "library-dim.csv"
FACILITY = REPO / "facility-dim.csv"
OUT = REPO / "outcomes-cohort.csv"

# Division codes are Silver RegionNumber, zero-padded -> keep as strings.
SERVICE_LINE_BY_DIVISION = {
    "08450": "Contract Rehab",
    "05500": "Senior Living",
    "06500": "HAP",
    "05555": "Closed",
}
COHORT_DIMS = ["LibraryItem_ID", "Library", "ServiceLine", "Residence", "Discipline"]


def service_line(row) -> str:
    if str(row.get("PlaceOfResidenceUsage", "")).strip() == "HHA":
        return "Home Health"
    code = row.get("DivisionCode")
    if pd.isna(code) or code == "":
        return "Other/null"
    return SERVICE_LINE_BY_DIVISION.get(str(code), f"Other/{code}")


def main() -> None:
    outcomes = pd.read_csv(OUTCOMES)
    library = pd.read_csv(LIBRARY)
    facility = pd.read_csv(FACILITY, dtype={"DivisionCode": str})  # preserve leading zeros

    n0 = len(outcomes)
    print(f"outcomes-core rows: {n0:,}")

    # Join the two dims (left, so we can measure match rates).
    df = outcomes.merge(library[["LibraryItem_ID", "Library", "VersionName"]],
                        on="LibraryItem_ID", how="left")
    lib_unmatched = df["Library"].isna().sum()

    df = df.merge(facility[["Facility_ID", "DivisionCode", "DivisionName"]],
                  on="Facility_ID", how="left")
    fac_unmatched = df["DivisionCode"].isna().sum()

    df["ServiceLine"] = df.apply(service_line, axis=1)

    print(f"  LibraryItem unmatched: {lib_unmatched:,} ({lib_unmatched/n0:.2%})")
    print(f"  Facility unmatched:    {fac_unmatched:,} ({fac_unmatched/n0:.2%})")

    print("\nLibrary split:")
    print(df["Library"].value_counts(dropna=False).to_string())
    print("\nServiceLine split:")
    print(df["ServiceLine"].value_counts(dropna=False).to_string())

    # ---- Cohort cell-size profile -------------------------------------------------
    sizes = df.groupby(COHORT_DIMS, dropna=False).size()
    print(f"\n=== Cohort cell-size profile  (grain: {' x '.join(COHORT_DIMS)}) ===")
    print(f"distinct cohorts: {len(sizes):,}")
    print("outcomes-per-cohort distribution:")
    print(sizes.describe(percentiles=[0.10, 0.25, 0.50, 0.75, 0.90]).to_string())
    for thr in (10, 25, 100):
        thin = (sizes < thr).sum()
        cov = sizes[sizes >= thr].sum()
        print(f"  cohorts < {thr:>3} outcomes: {thin:,} of {len(sizes):,} "
              f"({thin/len(sizes):.1%})  |  outcomes in cohorts >= {thr}: "
              f"{cov:,} ({cov/len(df):.1%})")

    df.to_csv(OUT, index=False)
    print(f"\nWrote {len(df):,} rows -> {OUT}")


if __name__ == "__main__":
    main()
