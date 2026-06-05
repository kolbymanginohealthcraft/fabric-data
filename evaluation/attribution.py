"""Therapist attribution to tracks.

Ported from PeopleDashboard/scripts/transforms.py::calculate_therapist_attribution
(2026-04-15). Adapted for stand-alone use against Fabric-extracted CSVs.

The attribution formula is unchanged: each therapist's contribution to a track
is the unweighted average of their visit share and minute share.

    visit_share   = therapist_visits   / track_total_visits
    minute_share  = therapist_minutes  / track_total_minutes
    contribution  = (visit_share + minute_share) / 2

Track totals include ALL contributors — managers, inactive employees, and
employees without a job code. A 5% contribution means 5% of the total, not
5% of an active-therapist subset. Downstream filters affect WHO appears in
results; they do not change the attribution math.
"""

from __future__ import annotations

import pandas as pd


def calculate_therapist_attribution(
    contributions: pd.DataFrame,
    track_metrics: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Calculate fair attribution of outcomes to therapists per track.

    Parameters
    ----------
    contributions : DataFrame
        One row per (therapist × track). Must contain columns:
            - TxTrack_ID
            - Person_ID
            - Total_Visits      (this therapist's visits on this track)
            - Total_Minutes     (this therapist's minutes on this track)
        Additional columns are passed through.
    track_metrics : DataFrame, optional
        One row per track with track-level metrics to be attributed. If
        provided, must contain TxTrack_ID. All other columns are merged in
        and any column whose name matches the patterns below will be
        multiplied by Contribution_Pct to produce Attributed_<col>:
            - Gain
            - Improved   (treated as 0/1)

    Returns
    -------
    DataFrame
        One row per (therapist × track) with original columns plus:
            - Track_Total_Visits, Track_Total_Minutes
            - Visit_Contribution_Pct, Minute_Contribution_Pct
            - Contribution_Pct        (the attribution weight)
            - Attributed_Gain, Attributed_Improved (if track_metrics provided)
    """
    df = contributions.copy()

    track_totals = (
        df.groupby("TxTrack_ID")
        .agg(Track_Total_Visits=("Total_Visits", "sum"),
             Track_Total_Minutes=("Total_Minutes", "sum"))
        .reset_index()
    )
    df = df.merge(track_totals, on="TxTrack_ID")

    df["Visit_Contribution_Pct"] = df["Total_Visits"] / df["Track_Total_Visits"]
    df["Minute_Contribution_Pct"] = df["Total_Minutes"] / df["Track_Total_Minutes"]
    df["Contribution_Pct"] = (
        df["Visit_Contribution_Pct"] + df["Minute_Contribution_Pct"]
    ) / 2

    if track_metrics is not None:
        df = df.merge(track_metrics, on="TxTrack_ID", how="inner")
        if "Gain" in df.columns:
            df["Attributed_Gain"] = df["Gain"] * df["Contribution_Pct"]
        if "Improved" in df.columns:
            df["Attributed_Improved"] = (
                df["Improved"].astype(int) * df["Contribution_Pct"]
            )

    return df
