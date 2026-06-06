"""A2 step 2 — attribution-weighted therapist rating from outcome percentiles.

Combines:
  - outcome-percentiles.csv  (cohort_percentiles.py) — per-outcome Percentile + TxTrack_ID
  - therapist-attribution.csv (pull-attribution.js)  — per (therapist x track) visits/minutes
    → Contribution_Pct via evaluation/attribution.py (ported PeopleDashboard formula).

Each outcome O on track T is weighted by contribution(therapist, T); a therapist's score
is the attribution-weighted average of the outcome percentiles they touched:

    Rating_Pct = Σ_T contrib(P,T)·Σ_{O in T} pct(O)  /  Σ_T contrib(P,T)·count_{O in T}

i.e. every outcome on T carries weight contrib(P,T). Mixed-library tracks need no special
handling — each outcome already sits in its own library's cohort.

Threshold: min_tracks_per_therapist (from filters.yaml; default 25).

Bucketing to 1-5 is a DESIGN CHOICE — a weighted mean of percentiles compresses toward 0.5,
so fixed 0.2-bands would pile everyone into "3". This emits the raw Rating_Pct plus a
QUINTILE bucket (Rating_1_5, equal-population) and also prints how fixed-bands would fall,
so the banding method can be chosen with the spread in view.

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
FILTERS = Path(__file__).resolve().parent / "filters.yaml"
OUT = REPO / "therapist-ratings.csv"


def main() -> None:
    filters = yaml.safe_load(FILTERS.read_text())
    min_tracks = int(filters.get("min_tracks_per_therapist", 25))

    # Attribution weight per (therapist x track) — track totals include ALL contributors.
    contributions = pd.read_csv(ATTR_CSV)
    attrib = calculate_therapist_attribution(contributions)

    # Per-track percentile sum + count over SCORED outcomes only.
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
    print(f"therapists with any scored track: {total:,}")
    print(f"  after min_tracks_per_therapist >= {min_tracks}: {len(g):,}")

    print("\nRating_Pct distribution (weighted mean of percentiles — compresses toward 0.5):")
    print(g["Rating_Pct"].describe(percentiles=[0.1, 0.25, 0.5, 0.75, 0.9]).to_string())

    # Quintile bucket (equal-population 1-5) — gives an interpretable spread.
    g["Rating_1_5"] = pd.qcut(g["Rating_Pct"], 5, labels=[1, 2, 3, 4, 5]).astype(int)

    # For comparison: how fixed 0.2-bands would distribute (absolute interpretation).
    band = pd.cut(g["Rating_Pct"], bins=[-0.01, 0.2, 0.4, 0.6, 0.8, 1.01],
                  labels=[1, 2, 3, 4, 5]).astype(int)
    print("\nFixed-band (0.2-width) distribution, for comparison:")
    print(band.value_counts().sort_index().to_string())
    print("\nQuintile (Rating_1_5) distribution:")
    print(g["Rating_1_5"].value_counts().sort_index().to_string())

    g = g.sort_values("Rating_Pct", ascending=False)
    g[["Person_ID", "n_tracks", "Rating_Pct", "Rating_1_5"]].to_csv(OUT, index=False)
    print(f"\nWrote {len(g):,} therapist ratings -> {OUT}")


if __name__ == "__main__":
    main()
