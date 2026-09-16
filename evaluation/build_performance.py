"""PROTOTYPE - per-therapist CLINICIAN PERFORMANCE metrics (volume / top-of-license /
eval codes / telehealth), from the 2026-07-22 My Quality Scorecard call (Clay/Martha ask).

Scope decision (Kolby, 2026-07-23): PCT/productivity stays with Deepak until we crack the
formula; THIS builds "everything else". Kept DELIBERATELY standalone (own output CSV, not wired
into score.py's cohort/percentile machinery yet) so we can hand Brad real raw numbers while the
exact definitions are still being locked. Integration into score.py METRICS + the feed (as a
Clinical Excellence sub-group, per committee) is the follow-up once definitions are final.

REUSE, don't reinvent (per Kolby): every input here is an existing pipeline artifact, and role/
attribution follows the SAME model as build_attribution.py (Workday discipline/jobcode via
role_of; deliverer = treatmentminute.PersonId, already in therapist-attribution.csv).

Metrics (raw per therapist; RAW only for the prototype):
  Unique_Patients      volume = DISTINCT patients the therapist TREATED (>=1 treatment minute).
                       "treatment minutes only, no screens/optional" per the call.
  Top_Of_License_Pct   eval/re-eval share of the therapist's DELIVERED time =
                       eval_minutes / total_minutes, where eval_minutes = Total_Minutes -
                       Total_Treatment_Minutes (the pipeline's established Description-LIKE-'eval'
                       split from pull-attribution.js). Higher = more time at top of license.
  Eval_Codes_Billed    evaluating-therapist volume = # in-scope tracks whose EVAL they authored
                       (eval-author.csv). Proxy for "how many eval codes billed".
  Telehealth_Eval_*    of those authored tracks, how many carry a '95' modifier (track-telehealth.csv,
                       correct billing-95 def) -> count + rate. "shows more versatility" per the call.
  Unique_Buildings     # distinct facilities the therapist delivered in (assistants esp.).

Universe = in-scope divisions only (Contract Rehab + Senior Living), matching score.py.
Run from repo root:  python -m evaluation.build_performance
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

from evaluation.build_attribution import role_of, norm_discipline

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
IN_SCOPE_SERVICELINES = {"Contract Rehab", "Senior Living"}   # mirror score.py; drop HAP/Closed/Other


def main() -> None:
    # ---- track dim (in-scope only): track -> patient / facility / servaceline ----
    tracks = pd.read_csv(DATA / "tracks.csv",
                         usecols=["TxTrack_ID", "PatientCase_ID", "Facility_ID", "ServiceLine"])
    tracks = tracks[tracks["ServiceLine"].isin(IN_SCOPE_SERVICELINES)].copy()
    in_scope = set(tracks["TxTrack_ID"])
    print(f"in-scope tracks (CR+SL): {len(in_scope):,}")

    # ---- employee dim -> role (SAME role_of as build_attribution) ----
    emp = pd.read_csv(DATA / "employee-dim.csv", dtype=str).drop_duplicates("Person_ID")
    emp["Person_ID"] = emp["Person_ID"].astype(int)
    emp["Role"] = [role_of(jc, d, t) for jc, d, t in zip(emp["JobCode"], emp["Discipline"], emp["JobTitle"])]
    emp["Disc"] = emp["Discipline"].map(norm_discipline)
    role = emp.set_index("Person_ID")["Role"].to_dict()

    # ---- delivered-care metrics: therapist-attribution (person x track) ⋈ track dim ----
    att = pd.read_csv(DATA / "therapist-attribution.csv")
    att = att[att["TxTrack_ID"].isin(in_scope)].merge(
        tracks[["TxTrack_ID", "PatientCase_ID", "Facility_ID"]], on="TxTrack_ID", how="left")

    grp = att.groupby("Person_ID")
    deliver = pd.DataFrame({
        "Total_Visits":  grp["Total_Visits"].sum(),
        "Total_Minutes": grp["Total_Minutes"].sum(),
        "Treatment_Minutes": grp["Total_Treatment_Minutes"].sum(),
        "Unique_Buildings":  grp["Facility_ID"].nunique(),
    })
    # Volume = distinct patients TREATED (>=1 treatment minute on the track) -> "any treatment"
    treated = att[att["Total_Treatment_Minutes"] > 0]
    deliver["Unique_Patients"] = treated.groupby("Person_ID")["PatientCase_ID"].nunique()
    deliver["Eval_Minutes"] = deliver["Total_Minutes"] - deliver["Treatment_Minutes"]
    deliver["Top_Of_License_Pct"] = (deliver["Eval_Minutes"] / deliver["Total_Minutes"]).where(
        deliver["Total_Minutes"] > 0)
    deliver = deliver.reset_index()

    # ---- evaluating-therapist metrics: eval-author (+ telehealth 95 on the authored track) ----
    ea = pd.read_csv(DATA / "eval-author.csv").dropna(subset=["AuthorPerson_ID"])
    ea = ea[ea["TxTrack_ID"].isin(in_scope)].copy()
    ea["AuthorPerson_ID"] = ea["AuthorPerson_ID"].astype(int)
    tele = pd.read_csv(DATA / "track-telehealth.csv")
    tele_tracks = set(tele.loc[tele["tele_charges"] > 0, "TxTrack_ID"])
    ea["is_tele"] = ea["TxTrack_ID"].isin(tele_tracks)
    ev = ea.groupby("AuthorPerson_ID").agg(
        Eval_Codes_Billed=("TxTrack_ID", "nunique"),
        Telehealth_Eval_Tracks=("is_tele", "sum")).reset_index().rename(
        columns={"AuthorPerson_ID": "Person_ID"})
    ev["Telehealth_Eval_Rate"] = (ev["Telehealth_Eval_Tracks"] / ev["Eval_Codes_Billed"]).where(
        ev["Eval_Codes_Billed"] > 0)

    # ---- assemble; keep clinicians only (Registered + Assistant); attach identity ----
    out = deliver.merge(ev, on="Person_ID", how="outer")
    out = out.merge(emp[["Person_ID", "FullName", "Disc", "Role", "JobTitle", "UPN"]],
                    on="Person_ID", how="left")
    out["Role"] = out["Role"].fillna(out["Person_ID"].map(role))
    out = out[out["Role"].isin(["Registered", "Assistant"])].copy()

    cols = ["Person_ID", "FullName", "Disc", "Role", "JobTitle",
            "Unique_Patients", "Unique_Buildings", "Total_Visits", "Total_Minutes",
            "Eval_Minutes", "Top_Of_License_Pct",
            "Eval_Codes_Billed", "Telehealth_Eval_Tracks", "Telehealth_Eval_Rate", "UPN"]
    out = out[cols].sort_values(["Role", "Disc", "FullName"])
    for c in ("Unique_Patients", "Unique_Buildings", "Total_Visits", "Total_Minutes",
              "Eval_Minutes", "Eval_Codes_Billed", "Telehealth_Eval_Tracks"):
        out[c] = out[c].fillna(0).astype(int)
    out.to_csv(DATA / "therapist-performance.csv", index=False)

    print(f"\ntherapists: {len(out):,}  ({out['Role'].value_counts().to_dict()})")
    print("\nby discipline x role (median values):")
    print(out.groupby(["Role", "Disc"]).agg(
        n=("Person_ID", "size"),
        med_patients=("Unique_Patients", "median"),
        med_bldgs=("Unique_Buildings", "median"),
        med_topoflicense=("Top_Of_License_Pct", "median"),
        med_evals=("Eval_Codes_Billed", "median"),
        med_tele_rate=("Telehealth_Eval_Rate", "median")).round(3).to_string())
    print(f"\nWrote {DATA / 'therapist-performance.csv'}")


if __name__ == "__main__":
    main()
