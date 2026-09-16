"""Stage A - assemble the per-TRACK table (track grain, dominant library).

One row per discharged track (track-base universe), carrying the cohort dims and the
six metric COMPONENTS. The therapist roll-up (raw/weighted/percentile) happens later in
score.py; this file just produces clean per-track values.

Inputs (repo root):
  track-base.csv        universe: TxTrack_ID, Discipline, Facility_ID, Residence, Stay, HasDischDoc, dates,
                        Library_ID, LibraryName (authoritative, from Bronze dbo.Library)
  track-outcomes.csv    ungated per-outcome: TableEval/TableDisch/StartScoreValues/HasEval/HasDisch/Family/LibraryItem_ID
  facility-dim.csv      Facility_ID -> DivisionCode

OP/SNF/HH group is DERIVED from the authoritative Library.Name via library_group_of() (a code rule,
mirrored as the Library[LibraryGroup] DAX column in the PBIP) -- the same "derive from a text field"
pattern as build_planned_discharges.setting_of(); there is no stored OP/SNF field.
  Outcomes Crosswalk.csv LibraryItem_ID -> RequiredFor (PT/OT)  [% Usage]
  therapist-attribution.csv  track minutes -> hours  [Gain per hour]

Output: tracks.csv (one row per track).

Run from repo root:  python -m evaluation.build_tracks
"""
from __future__ import annotations
from pathlib import Path
import numpy as np
import pandas as pd

from evaluation.build_attribution import norm_discipline

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"

GG_FAMILIES = {"(a) Section GG Mobility", "(b) Section GG Self Care"}
GG_ANA = ("15102", "15103", "15104", "15105")  # GG N/A-at-eval codes -> start 0

SERVICE_LINE = {"08450": "Contract Rehab", "05500": "Senior Living",
                "06500": "HAP", "05555": "Closed"}
POR_BUCKET = {
    "SNF": "SNF",
    "ALF": "AL/MC", "MC": "AL/MC",
    "ILF": "IL/OP", "OC": "IL/OP", "OUT": "IL/OP", "CCR": "IL/OP",
    "HOS": "Hospital",
}  # everything else -> Other


def library_group_of(name) -> str | None:
    """Care-setting group (OP/SNF/HH) derived from the authoritative Library.Name.

    Same pattern as build_planned_discharges.setting_of(): there is NO stored OP/SNF field, so we
    classify from the library's name text (the signal Jaclyn Warshauer validated -- library/document
    names literally say "Outpatient ...", "... SNF ...", etc.). A rule in code, not a stored lookup,
    so new libraries classify automatically. Replicated verbatim as the Library[LibraryGroup] DAX
    calculated column in the ClinicalOutcomes/PatientTimeline models.

    Returns None for blank/unmapped names (ROX / Rehab Optima) -> uncohortable, matching prior NaN.
    """
    n = "" if name is None or isinstance(name, float) else str(name)
    if "SNF" in n:
        return "SNF"
    if "HH" in n or "OASIS" in n:
        return "HH"
    if any(k in n for k in ("Outpatient", "Group Practice", "CORF", "Pediatric")):
        return "OP"
    return None


def derive_outcome_flags(o: pd.DataFrame) -> pd.DataFrame:
    """valid / disregarded / included / gain per outcome (the verified rules)."""
    ssv = o["StartScoreValues"].astype(str)
    ana = ssv.str.contains("|".join(GG_ANA), regex=True, na=False)
    gg_recode = o["Family"].isin(GG_FAMILIES) & (o["StartScoreValues"].isna() | ana)
    o["EvalNEW"] = np.where(gg_recode, 0.0, o["TableEval"])
    o["valid"] = o["EvalNEW"].notna() & o["TableDisch"].notna()
    o["disregarded"] = o["EvalNEW"].eq(1.0)              # start = 100%
    o["included"] = o["valid"] & ~o["disregarded"]       # gain/improved basis
    o["valid_good"] = o["valid"] & ~o["disregarded"]     # %Valid numerator
    o["invalid"] = ~o["valid"]                           # %Valid also-counted
    o["gain"] = o["TableDisch"] - o["EvalNEW"]
    return o


def main() -> None:
    base = pd.read_csv(DATA / "track-base.csv")
    base["Discipline"] = base["Discipline"].map(norm_discipline)   # ST -> SLP (consolidate speech)
    oc = pd.read_csv(DATA / "track-outcomes.csv", low_memory=False)
    oc["Discipline"] = oc["Discipline"].map(norm_discipline)
    fac = pd.read_csv(DATA / "facility-dim.csv", dtype={"DivisionCode": str})
    cw = pd.read_csv(DATA / "Outcomes Crosswalk.csv")[["LibraryItem_ID", "RequiredFor"]]
    att = pd.read_csv(DATA / "therapist-attribution.csv",
                      usecols=["TxTrack_ID", "Total_Treatment_Minutes"])

    print(f"track-base: {len(base):,} | track-outcomes: {len(oc):,}")

    oc = derive_outcome_flags(oc)
    oc = oc.merge(cw, on="LibraryItem_ID", how="left")         # -> RequiredFor
    # %Usage counts a VALID use of the discipline's required measure (Gait Speed PT / Barthel OT) --
    # numeric at BOTH eval and discharge, not mere presence. "Present anywhere" was near-ceiling
    # (~88-93%) because it counted N/A / one-sided charting; valid use is ~43% and actually
    # discriminates (PT especially: 83% present -> 24% valid).
    oc["uses_required"] = oc["RequiredFor"].eq(oc["Discipline"]) & oc["valid"]

    # per-track aggregates
    g = oc.groupby("TxTrack_ID")
    agg = pd.DataFrame({
        "n_outcomes": g.size(),
        "n_included": g["included"].sum(),
        "track_gain": g.apply(lambda d: d.loc[d["included"], "gain"].mean(), include_groups=False),
        "n_valid": g["valid"].sum(),          # valid outcomes (numeric eval+disch) -> %Disch numerator
        "n_valid_good": g["valid_good"].sum(),
        "n_invalid": g["invalid"].sum(),
        "uses_required": g["uses_required"].any(),
    }).reset_index()
    agg["improved"] = np.where(agg["n_included"] > 0, (agg["track_gain"] > 0), np.nan)
    denom = agg["n_valid_good"] + agg["n_invalid"]
    agg["valid_frac"] = np.where(denom > 0, agg["n_valid_good"] / denom, np.nan)

    # LEFT join base <- agg  (tracks with no crosswalked outcome: has_outcome=0)
    df = base.merge(agg, on="TxTrack_ID", how="left")
    df["has_outcome"] = df["n_outcomes"].notna() & (df["n_outcomes"] > 0)

    # DomLibrary = AUTHORITATIVE library per track: TxDocument.Library_ID (one per track,
    # NetHealth-enforced) -> Library.Name (Bronze dbo.Library, carried in track-base) -> OP/SNF/HH via
    # library_group_of(). Replaces the old element-VersionName heuristic, which manufactured phantom
    # cross-library tracks (a VersionName is an element's own revision tag, not the document library:
    # even the OP2025 library is only ~39% OP-tagged at the element level). Library_ID validated
    # 1-per-track across all 2.48M tracks.
    df["DomLibrary"] = df["LibraryName"].map(library_group_of)
    # %Disch numerator: discharge had a VALID outcome (numeric eval+disch), not just any outcome.
    # No-outcome / only-invalid tracks -> False (counted as failures, NOT dropped); denominator stays
    # all discharges. Distinct from %Valid (which is per-recorded-outcome quality, not per-discharge).
    df["has_valid_outcome"] = df["n_valid"].fillna(0) > 0

    # dims: ServiceLine + PoR
    fac["DivisionCode"] = fac["DivisionCode"].str.replace(r"\.0$", "", regex=True).str.zfill(5)
    df = df.merge(fac[["Facility_ID", "DivisionCode"]], on="Facility_ID", how="left")
    df["ServiceLine"] = df["DivisionCode"].map(SERVICE_LINE).fillna("Other")
    df["PoR"] = df["Residence"].map(POR_BUCKET).fillna("Other")

    # hours (Gain per hour) = treatment hours (eval minutes excluded)
    mins = att.groupby("TxTrack_ID")["Total_Treatment_Minutes"].sum().rename("track_minutes")
    df = df.merge(mins, on="TxTrack_ID", how="left")
    df["hours"] = df["track_minutes"] / 60.0

    # cohort = Discipline x DomLibrary x PoR
    df["Cohort"] = df["Discipline"] + " | " + df["DomLibrary"].fillna("?") + " | " + df["PoR"]

    out = DATA / "tracks.csv"
    df.to_csv(out, index=False)

    # ---- profile ----
    print(f"\ntracks: {len(df):,}")
    print(f"  has_outcome: {df['has_outcome'].mean():.1%}")
    print(f"  with usable library (cohortable): {df['DomLibrary'].notna().mean():.1%}")
    print("\nStay:"); print(df["Stay"].value_counts(dropna=False).to_string())
    print("\nServiceLine:"); print(df["ServiceLine"].value_counts(dropna=False).to_string())
    print("\nPoR:"); print(df["PoR"].value_counts(dropna=False).to_string())
    print(f"\nimproved (of has_outcome+included): {df.loc[df['n_included']>0,'improved'].mean():.1%}")
    print(f"valid_frac mean (tracks w/ measurements): {df['valid_frac'].mean():.3f}")
    print(f"uses_required among PT/OT tracks: "
          f"{df.loc[df['Discipline'].isin(['PT','OT']),'uses_required'].mean():.1%}")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
