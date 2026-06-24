"""Build the app feed: one wide row per scored therapist -> therapist-scorecard-feed.csv.

This is the HANDOFF surface to the Performance Management app (IT-owned). The file REPLACES the
legacy `outcomes_and_satisfaction.xlsx`, so the column LAYOUT mirrors that file where it overlaps:
the 33 metric columns + identity adopt the original headers, percentiles are scaled to 0-100 (raw /
weighted stay 0-1, as in the original), Timeframe matches the original string format, and the two
`*_Avg_Percentile` composites are reproduced. We deliberately DROP the 1-5 ratings
(Clinical_Excellence_Rating / Patient_Satisfaction_Rating) and the legacy Peer_Group / JobCodeId
(old discipline-peer-group + a different code system). We ADD our newer pieces (SL all-patients
Gain, ScorecardGroup/Template, data_quality_flag, metadata) as extra columns after the legacy block.

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
MIN_EFFECTIVE_TRACKS = 10   # person-level reliability gate: below this -> data_quality_flag='low_volume'
IN_SCOPE_SERVICELINES = {"Contract Rehab", "Senior Living"}

# credential -> licensed/folded discipline (Primary_Discipline); speech already normalized to SLP
DISC_FOLD = {"PT": "PT", "PTA": "PT", "OT": "OT", "COTA": "OT", "SLP": "SLP"}
# ScorecardGroup -> legacy Cohort (CR/SL division descriptor)
COHORT_OF = {"Contract Rehab Field Clinician": "CR", "Telehealth Field Clinician": "CR",
             "SL Field Clinician": "SL", "SL Area Manager": "SL"}
CLINICAL_METRICS = {"Gain", "GainPerHour", "PctImproved", "PctUsage", "PctValid", "PctDischWithOutcome"}
SAT_METRICS = {"AdvocacyScore", "ResponseRate"}

# our wide column -> original (legacy) header
_METRIC_STEM = {
    "Gain_Short": "Gain_Short_Stay", "Gain_Long": "Gain_Long_Stay", "Gain": "Gain_All_Stay",
    "GainPerHour_Short": "Gain_Per_Hour_Short_Stay", "GainPerHour_Long": "Gain_Per_Hour_Long_Stay",
    "PctImproved_Short": "Percent_Tracks_Improved_Short_Stay", "PctImproved_Long": "Percent_Tracks_Improved_Long_Stay",
    "PctUsage": "Percent_Usage_Of_Required_Measure", "PctDischWithOutcome": "Percent_Tracks_With_Outcome",
    "PctValid": "Percent_Measurements_Valid", "AdvocacyScore": "Advocacy_Score", "ResponseRate": "Response_Rate",
}
RENAME = {"FullName": "Name", "EmployeeNumber": "EmployeeNo", "effective_tracks": "Total_Weighted_Tracks"}
for _stem, _ostem in _METRIC_STEM.items():
    for _suf, _osuf in [("Raw", "raw"), ("Weighted", "weighted"), ("Percentile", "percentile")]:
        RENAME[f"{_stem}_{_suf}"] = f"{_ostem}_{_osuf}"


def _metric_cols(ostem):
    return [f"{ostem}_raw", f"{ostem}_weighted", f"{ostem}_percentile"]


# final column order: legacy layout (minus dropped/skipped) then our additions
OUTPUT_ORDER = (
    ["Timeframe", "Person_ID", "EmployeeNo", "Name", "StaffTitle", "Cohort",
     "All_Disciplines", "Primary_Discipline",
     "Total_Visits", "Total_Minutes", "Total_Tracks", "Total_Weighted_Tracks",
     "Short_Stay_Tracks", "Short_Stay_Visits", "Short_Stay_Minutes",
     "Long_Stay_Tracks", "Long_Stay_Visits", "Long_Stay_Minutes"]
    + _metric_cols("Gain_Short_Stay") + _metric_cols("Gain_Long_Stay")
    + _metric_cols("Gain_Per_Hour_Short_Stay") + _metric_cols("Gain_Per_Hour_Long_Stay")
    + _metric_cols("Percent_Tracks_Improved_Short_Stay") + _metric_cols("Percent_Tracks_Improved_Long_Stay")
    + _metric_cols("Percent_Usage_Of_Required_Measure") + _metric_cols("Percent_Tracks_With_Outcome")
    + _metric_cols("Percent_Measurements_Valid") + _metric_cols("Advocacy_Score") + _metric_cols("Response_Rate")
    + ["Clinical_Excellence_Avg_Percentile", "Patient_Satisfaction_Avg_Percentile"]
    # --- our additions (not in the legacy file) ---
    + _metric_cols("Gain_All_Stay")
    + ["Discipline", "Role", "ScorecardGroup", "Template", "UPN",
       "scoring_version", "as_of_date", "computed_at", "period_start", "period_end", "data_quality_flag"]
)
INT_COLS = ["Total_Visits", "Total_Minutes", "Total_Tracks", "Short_Stay_Tracks", "Short_Stay_Visits",
            "Short_Stay_Minutes", "Long_Stay_Tracks", "Long_Stay_Visits", "Long_Stay_Minutes"]


def main() -> None:
    m = pd.read_csv(DATA / "therapist-metrics.csv")
    sat_path = DATA / "satisfaction-feed.csv"
    if sat_path.exists():
        sat = pd.read_csv(sat_path, usecols=["Person_ID", "Metric", "Stay", "Raw", "Weighted", "Percentile"])
        m = pd.concat([m, sat], ignore_index=True)
        print(f"folded satisfaction-feed: +{len(sat):,} rows ({sat['Person_ID'].nunique():,} therapists)")
    else:
        print("NOTE: satisfaction-feed.csv not found — feed will be clinical-only")
    # missed-visits domain GATED OFF by default (HH not a scored group yet); flip INCLUDE_MISSED_VISITS=1.
    mv_path = DATA / "missed-visits-feed.csv"
    if os.environ.get("INCLUDE_MISSED_VISITS") == "1" and mv_path.exists():
        mvf = pd.read_csv(mv_path, usecols=["Person_ID", "Metric", "Stay", "Raw", "Weighted", "Percentile"])
        m = pd.concat([m, mvf], ignore_index=True)
        print(f"folded missed-visits-feed: +{len(mvf):,} rows [INCLUDE_MISSED_VISITS=1]")
    elif mv_path.exists():
        print("NOTE: missed-visits-feed.csv present but NOT folded (set INCLUDE_MISSED_VISITS=1)")

    roster = pd.read_csv(DATA / "employee-roster.csv",
                         usecols=["Person_ID", "FullName", "Discipline", "Role", "ScorecardGroup", "Template"])
    emp = pd.read_csv(DATA / "employee-dim.csv", dtype=str).drop_duplicates("Person_ID")
    emp["Person_ID"] = emp["Person_ID"].astype(int)

    # ---- composites (mean of percentiles, stay-collapsed, N/A-aware) — computed on 0-1, scaled x100 ----
    pm = m.dropna(subset=["Percentile"]).groupby(["Person_ID", "Metric"])["Percentile"].mean().reset_index()
    clin_avg = pm[pm["Metric"].isin(CLINICAL_METRICS)].groupby("Person_ID")["Percentile"].mean()
    sat_avg = pm[pm["Metric"].isin(SAT_METRICS)].groupby("Person_ID")["Percentile"].mean()

    # ---- long -> wide metrics ----
    m["base"] = m["Metric"] + m["Stay"].map(lambda s: "" if s == "All" else f"_{s}")
    long = m.melt(id_vars=["Person_ID", "base"], value_vars=["Raw", "Weighted", "Percentile"],
                  var_name="measure", value_name="val")
    long["col"] = long["base"] + "_" + long["measure"]
    wide = long.pivot_table(index="Person_ID", columns="col", values="val").reset_index()

    feed = (wide
            .merge(roster, on="Person_ID", how="left")
            .merge(emp[["Person_ID", "UPN", "EmployeeNumber", "JobTitle"]], on="Person_ID", how="left"))

    # ---- volume (in-scope tracks): counts from contributions, visits/minutes from attribution ----
    trk = pd.read_csv(DATA / "tracks.csv", usecols=["TxTrack_ID", "ServiceLine", "Stay", "Discipline"])
    trk = trk[trk["ServiceLine"].isin(IN_SCOPE_SERVICELINES)]
    co = pd.read_csv(DATA / "contributions.csv", usecols=["TxTrack_ID", "Person_ID", "Weight"])
    ct = co.merge(trk, on="TxTrack_ID", how="inner")
    feed["effective_tracks"] = feed["Person_ID"].map(ct.groupby("Person_ID")["Weight"].sum()).round(4)
    feed["Total_Tracks"] = feed["Person_ID"].map(ct.groupby("Person_ID")["TxTrack_ID"].nunique())
    feed["All_Disciplines"] = feed["Person_ID"].map(
        ct.groupby("Person_ID")["Discipline"].apply(lambda s: ", ".join(sorted(set(s.dropna())))))
    for stay, pre in [("Short", "Short_Stay"), ("Long", "Long_Stay")]:
        feed[f"{pre}_Tracks"] = feed["Person_ID"].map(
            ct[ct["Stay"] == stay].groupby("Person_ID")["TxTrack_ID"].nunique())

    att = pd.read_csv(DATA / "therapist-attribution.csv", usecols=["TxTrack_ID", "Person_ID", "Total_Visits", "Total_Minutes"])
    at = att.merge(trk[["TxTrack_ID", "Stay"]], on="TxTrack_ID", how="inner")
    feed["Total_Visits"] = feed["Person_ID"].map(at.groupby("Person_ID")["Total_Visits"].sum())
    feed["Total_Minutes"] = feed["Person_ID"].map(at.groupby("Person_ID")["Total_Minutes"].sum())
    for stay, pre in [("Short", "Short_Stay"), ("Long", "Long_Stay")]:
        sub = at[at["Stay"] == stay].groupby("Person_ID")
        feed[f"{pre}_Visits"] = feed["Person_ID"].map(sub["Total_Visits"].sum())
        feed[f"{pre}_Minutes"] = feed["Person_ID"].map(sub["Total_Minutes"].sum())

    # ---- derived legacy descriptors ----
    feed["StaffTitle"] = feed["JobTitle"]
    feed["Cohort"] = feed["ScorecardGroup"].map(COHORT_OF)
    feed["Primary_Discipline"] = feed["Discipline"].map(DISC_FOLD)
    feed["Clinical_Excellence_Avg_Percentile"] = (feed["Person_ID"].map(clin_avg) * 100)
    feed["Patient_Satisfaction_Avg_Percentile"] = (feed["Person_ID"].map(sat_avg) * 100)

    # ---- metadata (period = the 12 COMPLETE calendar months, matching the SQL window) ----
    today = date.today()
    fom = today.replace(day=1)
    ps, pe = date(fom.year - 1, fom.month, 1), fom - timedelta(days=1)
    feed["Timeframe"] = f"{ps.strftime('%b')} {ps.day}, {ps.year} - {pe.strftime('%b')} {pe.day} {pe.year}"
    feed["scoring_version"] = SCORING_VERSION
    feed["as_of_date"] = today.isoformat()
    feed["computed_at"] = datetime.now().replace(microsecond=0).isoformat()
    feed["period_start"], feed["period_end"] = ps.isoformat(), pe.isoformat()
    feed["data_quality_flag"] = (feed["effective_tracks"].fillna(0) >= MIN_EFFECTIVE_TRACKS
                                 ).map({True: "OK", False: "low_volume"})

    # ---- adopt legacy headers; scale percentiles to 0-100; round ----
    feed = feed.rename(columns=RENAME)
    pct_cols = [c for c in feed.columns if c.endswith("_percentile")]
    feed[pct_cols] = feed[pct_cols] * 100
    floatcols = feed.select_dtypes("number").columns
    feed[floatcols] = feed[floatcols].round(4)
    for c in INT_COLS:
        if c in feed:
            feed[c] = feed[c].astype("Int64")

    missing = [c for c in OUTPUT_ORDER if c not in feed.columns]
    if missing:
        print(f"WARNING: expected columns absent (will be skipped): {missing}")
    feed = feed[[c for c in OUTPUT_ORDER if c in feed.columns]]

    out = DATA / "therapist-scorecard-feed.csv"
    try:
        feed.to_csv(out, index=False, encoding="utf-8-sig")
    except PermissionError:
        raise SystemExit("therapist-scorecard-feed.csv is open (Excel?) - close it and re-run.")

    print(f"\nfeed rows (scored therapists): {len(feed):,} | columns: {len(feed.columns)}  -> {out.name}")
    nlow = int((feed["data_quality_flag"] == "low_volume").sum())
    print(f"data_quality_flag: low_volume={nlow}, OK={len(feed) - nlow}")
    print(f"Timeframe: {feed['Timeframe'].iloc[0]}")
    print("\nScorecardGroup in feed:")
    print(feed["ScorecardGroup"].value_counts().to_string())


if __name__ == "__main__":
    main()
