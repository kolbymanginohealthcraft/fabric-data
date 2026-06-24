"""Stage C - per-therapist metric roll-up: Raw / Weighted / Percentile.

Output contract (no 1-5, no composite): for every metric, per therapist (x Stay where the
metric splits), three numbers:
  Raw        = metric before attribution (each of the therapist's tracks counted fully)
  Weighted   = metric after attribution (each track scaled by the therapist's Weight)
  Percentile = therapist's Weighted value ranked WITHIN cohort, then volume-weighted across
               the therapist's cohorts (the "Maria" recipe)

Every metric is a Sum(num)/Sum(den) ratio:
  Gain                 num=track_gain  den=1     stay-split   qualify: has included outcomes
  GainPerHour          num=track_gain  den=hours stay-split   qualify: included & hours>0
  PctImproved          num=improved    den=1     stay-split   qualify: has included outcomes
  PctUsage             num=uses_req    den=1                  qualify: PT/OT tracks
  PctValid             num=n_valid_good den=n_valid_good+n_invalid   qualify: has measurements
  PctDischWithOutcome  num=has_valid_outcome den=1  REGISTERED+MANAGER only  qualify: their tracks (cohort=Disc x PoR)

Universe = in-scope payers only (Stay in {Short, Long}); Excluded/Changed/NoPayer dropped.
EXCEPTION: SL (Template B) Gain is computed over ALL the SL therapist's patients (all stays/payers)
and emitted as Stay="All" in an SL-only pool — see the SL block below. CR/Telehealth are unchanged.
Run from repo root:  python -m evaluation.score
"""
from __future__ import annotations
from pathlib import Path
import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
FULL_COHORT = ["Discipline", "DomLibrary", "PoR"]
DISCH_COHORT = ["Discipline", "PoR"]            # no-outcome tracks have no library
SL_SCORECARD_GROUPS = {"SL Field Clinician", "SL Area Manager"}  # Template B: Gain over ALL patients


def compute(df, num, den, cohort_cols):
    """df: one row per (track x therapist contribution) already filtered to the metric's
    qualifying tracks (+ single stay if split). Returns per-Person Raw/Weighted/Percentile."""
    d = df.copy()
    d["_num"] = d[num] if num != "1" else 1.0
    d["_den"] = d[den] if den != "1" else 1.0
    d = d.dropna(subset=["_num", "_den"])
    d["_wn"] = d["Weight"] * d["_num"]
    d["_wd"] = d["Weight"] * d["_den"]

    # Raw (unweighted) and Weighted per person
    per = d.groupby("Person_ID").agg(
        rn=("_num", "sum"), rd=("_den", "sum"),
        wn=("_wn", "sum"), wd=("_wd", "sum")).reset_index()
    per["Raw"] = per["rn"] / per["rd"]
    per["Weighted"] = per["wn"] / per["wd"]

    # Percentile: per (person, cohort) weighted value -> rank within cohort -> volume-weighted
    cohort_ok = d.dropna(subset=cohort_cols)
    cell = cohort_ok.groupby(["Person_ID"] + cohort_cols).agg(
        cwn=("_wn", "sum"), cwd=("_wd", "sum")).reset_index()
    cell = cell[cell["cwd"] > 0]
    cell["cval"] = cell["cwn"] / cell["cwd"]
    cell["pct"] = cell.groupby(cohort_cols)["cval"].rank(pct=True)
    agg = cell.groupby("Person_ID").apply(
        lambda g: np.average(g["pct"], weights=g["cwd"]), include_groups=False
    ).rename("Percentile").reset_index()

    return per[["Person_ID", "Raw", "Weighted"]].merge(agg, on="Person_ID", how="left")


METRICS = [
    # name, num, den, stay_split, qualify_fn, cohort
    ("Gain", "track_gain", "1", True, lambda t: t["n_included"] > 0, FULL_COHORT),
    ("GainPerHour", "track_gain", "hours", True,
        lambda t: (t["n_included"] > 0) & (t["hours"] > 0), FULL_COHORT),
    ("PctImproved", "improved", "1", True, lambda t: t["n_included"] > 0, FULL_COHORT),
    ("PctUsage", "uses_required", "1", False,
        lambda t: t["Discipline"].isin(["PT", "OT"]), FULL_COHORT),
    ("PctValid", "n_valid_good", "_validden", False,
        lambda t: (t["n_valid_good"] + t["n_invalid"]) > 0, FULL_COHORT),
    # Registered + Manager ONLY (committee decision): documenting the discharge outcome is the
    # eval-author's / building's responsibility, not the assistant's -> N/A (blank) for assistants,
    # and the percentile pool is registered+manager. (Same N/A-by-population pattern as %Usage for SLP.)
    ("PctDischWithOutcome", "has_valid_outcome", "1", False,
        lambda t: t["TxTrack_ID"].notna() & t["Role"].isin(["Registered", "Manager"]), DISCH_COHORT),
]


def main() -> None:
    tracks = pd.read_csv(DATA / "tracks.csv")
    contrib = pd.read_csv(DATA / "contributions.csv")
    tracks["improved"] = tracks["improved"].astype("float")
    tracks["has_outcome"] = tracks["has_outcome"].astype(float)
    tracks["uses_required"] = tracks["uses_required"].astype(float)
    tracks["_validden"] = tracks["n_valid_good"].fillna(0) + tracks["n_invalid"].fillna(0)

    # In-scope DIVISIONS only: Contract Rehab + Senior Living. HAP (a therapy-management model),
    # Closed (retired facilities), and Other (unmapped) are out of scope — exclude them from BOTH
    # the metrics and the cohort comparison pools (restores the A2 Closed/Other exclusion that the
    # track-grain rewrite dropped, and honors "HAP is not part of this").
    IN_SCOPE_SERVICELINES = {"Contract Rehab", "Senior Living"}
    tracks = tracks[tracks["ServiceLine"].isin(IN_SCOPE_SERVICELINES)].copy()

    # Universe rule: stay-SPLIT metrics filter to their payer bucket (Short / Long); NON-split
    # metrics use ALL payers (within in-scope divisions). So no global payer filter here.
    ct = contrib.merge(tracks, on="TxTrack_ID", how="inner")
    print(f"in-scope tracks (CR+SL): {tracks['TxTrack_ID'].nunique():,} | contribution rows: {len(ct):,}")

    rows = []
    for name, num, den, split, qual, cohort in METRICS:
        base = ct[qual(ct)]
        stays = [("Short", base[base["Stay"] == "Short"]),
                 ("Long", base[base["Stay"] == "Long"])] if split else [("All", base)]
        for stay_lbl, sub in stays:
            if not len(sub):
                continue
            res = compute(sub, num, den, cohort)
            res["Metric"] = name
            res["Stay"] = stay_lbl
            rows.append(res)

    # SL (Template B) Gain over ALL patients. SL Field Clinicians + SL Area Managers are graded on
    # Gain across ALL their tracks (all stays / all payers), not the Long-only subset the split Gain
    # above gives. SL has ~0 short-stay tracks, so in practice this restores the ~8.5% of caseload on
    # non-Medicare-A/B payers (Medicaid/private/etc.) that the stay filter dropped — more defensible
    # (full caseload) at no reliability cost (values stable, rankings preserved, pools >=25). Emitting
    # it under Stay="All" — a label the split Gain never produces — puts SL in its OWN percentile pool
    # automatically (CR/Telehealth are never in the "All" group), which is the peer-appropriate
    # comparison. CR/Telehealth Short/Long Gain above is left UNCHANGED (their pool still includes SL's
    # Long value, so their numbers don't move). Gain/hr does NOT apply to SL. -> unsuffixed Gain_* col.
    roster = pd.read_csv(DATA / "employee-roster.csv", usecols=["Person_ID", "ScorecardGroup"])
    sl_ids = set(roster.loc[roster["ScorecardGroup"].isin(SL_SCORECARD_GROUPS), "Person_ID"])
    sl_gain = ct[(ct["n_included"] > 0) & ct["Person_ID"].isin(sl_ids)]
    if len(sl_gain):
        res = compute(sl_gain, "track_gain", "1", FULL_COHORT)
        res["Metric"] = "Gain"
        res["Stay"] = "All"
        rows.append(res)
        print(f"SL all-patient Gain (Stay=All, SL-only pool): {res['Person_ID'].nunique()} therapists")

    out = pd.concat(rows, ignore_index=True)
    out = out[["Person_ID", "Metric", "Stay", "Raw", "Weighted", "Percentile"]]
    out.to_csv(DATA / "therapist-metrics.csv", index=False)

    print(f"\noutput rows: {len(out):,} | therapists: {out['Person_ID'].nunique():,}")
    print("\nrows per metric/stay:")
    print(out.groupby(["Metric", "Stay"]).size().to_string())
    print("\nsanity - Percentile should center ~0.5 per metric:")
    print(out.groupby("Metric")["Percentile"].mean().round(3).to_string())
    print("\nWeighted means per metric:")
    print(out.groupby(["Metric", "Stay"])["Weighted"].mean().round(3).to_string())
    print(f"\nWrote {DATA / 'therapist-metrics.csv'}")


if __name__ == "__main__":
    main()
