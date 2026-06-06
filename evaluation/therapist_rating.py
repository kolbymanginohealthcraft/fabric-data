"""A2 step 2 — attribution-weighted therapist rating from outcome percentiles.

Combines:
  - outcome-percentiles.csv  (cohort_percentiles.py) — per-outcome Percentile + TxTrack_ID
  - therapist-attribution.csv (pull-attribution.js)  — per (therapist x track) visits/minutes
    → Contribution_Pct via evaluation/attribution.py (ported PeopleDashboard formula).
  - employee-dim.csv         (pull-employee-dim.js)  — Person_ID -> identity + role.

Each outcome O on track T is weighted by contribution(therapist, T); a therapist's score
is the attribution-weighted average of the outcome percentiles they touched:

    Rating_Pct = Σ_T contrib(P,T)·Σ_{O in T} pct(O)  /  Σ_T contrib(P,T)·count_{O in T}

Population filtering (treatmentminute.PersonId sweeps in admins/execs who occasionally
logged minutes, so we filter to treating clinicians):
  - min_tracks_per_therapist (filters.yaml; default 25)
  - Discipline in CLINICAL_DISCIPLINES (PT/OT/ST/PTA/COTA)
Quintile bucketing is computed AFTER these filters so the 1-5 spread is among real therapists.

Bucketing to 1-5 is a DESIGN CHOICE — a weighted mean of percentiles compresses toward 0.5,
so fixed 0.2-bands pile everyone into "3". Emits raw Rating_Pct + a QUINTILE bucket and
prints how fixed-bands would fall, so the banding method can be chosen with the spread in view.

Run from repo root:  python -m evaluation.therapist_rating
"""

from __future__ import annotations

from pathlib import Path
import pandas as pd
import yaml

from evaluation.attribution import calculate_therapist_attribution

REPO = Path(__file__).resolve().parent.parent
PCT_CSV = REPO / "outcome-percentiles.csv"
ATTR_CSV = REPO / "therapist-attribution.csv"
EMP_CSV = REPO / "employee-dim.csv"
FILTERS = Path(__file__).resolve().parent / "filters.yaml"
OUT = REPO / "therapist-ratings.csv"

CLINICAL_DISCIPLINES = {"PT", "OT", "ST", "PTA", "COTA", "SLP", "CF-SLP"}


def main() -> None:
    filters = yaml.safe_load(FILTERS.read_text())
    min_tracks = int(filters.get("min_tracks_per_therapist", 25))

    contributions = pd.read_csv(ATTR_CSV)
    attrib = calculate_therapist_attribution(contributions)

    pct = pd.read_csv(PCT_CSV)
    track_agg = (
        pct.groupby("TxTrack_ID")["Percentile"]
        .agg(pct_sum="sum", n_outcomes="count")
        .reset_index()
    )

    m = attrib.merge(track_agg, on="TxTrack_ID", how="inner")
    m["w_numer"] = m["Contribution_Pct"] * m["pct_sum"]
    m["w_denom"] = m["Contribution_Pct"] * m["n_outcomes"]

    g = (
        m.groupby("Person_ID")
        .agg(numer=("w_numer", "sum"),
             denom=("w_denom", "sum"),
             n_tracks=("TxTrack_ID", "nunique"))
        .reset_index()
    )
    g = g[g["denom"] > 0].copy()
    g["Rating_Pct"] = g["numer"] / g["denom"]

    total = len(g)
    g = g[g["n_tracks"] >= min_tracks].copy()
    print(f"persons with any scored track: {total:,}")
    print(f"  after min_tracks >= {min_tracks}: {len(g):,}")

    # --- attach identity / role -----------------------------------------------------
    emp = pd.read_csv(EMP_CSV)
    # One Person_ID can have multiple employment rows; keep one (prefer Active —
    # 'Active' sorts before 'On Leave'/'Terminated').
    emp = emp.sort_values("Status").drop_duplicates("Person_ID", keep="first")
    g = g.merge(emp, on="Person_ID", how="left")
    matched = g["FullName"].notna().sum()
    print(f"  matched to employee: {matched:,} ({matched/len(g):.1%}); "
          f"unmatched: {len(g)-matched:,}")
    print("\nDiscipline of rated persons (pre-clinical-filter):")
    print(g["Discipline"].fillna("(none/admin)").value_counts().to_string())
    print("\nStatus of rated persons:")
    print(g["Status"].fillna("(unmatched)").value_counts().to_string())

    # --- filter to treating clinicians ----------------------------------------------
    clin = g[g["Discipline"].isin(CLINICAL_DISCIPLINES)].copy()
    print(f"\nafter clinical-discipline filter {sorted(CLINICAL_DISCIPLINES)}: "
          f"{len(clin):,} therapists (dropped {len(g)-len(clin):,} admins/unmatched)")

    print("\nRating_Pct distribution (clinical; weighted mean of percentiles):")
    print(clin["Rating_Pct"].describe(percentiles=[0.1, 0.25, 0.5, 0.75, 0.9]).to_string())

    clin["Rating_1_5"] = pd.qcut(clin["Rating_Pct"], 5, labels=[1, 2, 3, 4, 5]).astype(int)
    band = pd.cut(clin["Rating_Pct"], bins=[-0.01, 0.2, 0.4, 0.6, 0.8, 1.01],
                  labels=[1, 2, 3, 4, 5]).astype(int)
    print("\nFixed-band (0.2-width) vs Quintile distribution:")
    cmp = pd.DataFrame({"fixed_band": band.value_counts().sort_index(),
                        "quintile": clin["Rating_1_5"].value_counts().sort_index()}).fillna(0).astype(int)
    print(cmp.to_string())
    print("\nRating_1_5 mean by Discipline:")
    print(clin.groupby("Discipline")["Rating_Pct"].agg(["count", "mean"]).to_string())

    clin = clin.sort_values("Rating_Pct", ascending=False)
    cols = ["Person_ID", "FullName", "Discipline", "JobTitle", "Status",
            "n_tracks", "Rating_Pct", "Rating_1_5"]
    clin[cols].to_csv(OUT, index=False)
    print(f"\nWrote {len(clin):,} therapist ratings -> {OUT}")


if __name__ == "__main__":
    main()
