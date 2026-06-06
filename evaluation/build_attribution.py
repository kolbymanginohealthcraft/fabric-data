"""Stage B - role-based track -> therapist attribution.

Replaces the old (visit+minute)/2 blend. Credit depends on ROLE:
  - Registered (PT/OT/ST/SLP/...): FULL credit (weight 1.0) for tracks they EVALUATED
    (author of the EVAL doc) -> from eval-author.csv.
  - Assistant (PTA/COTA/OTA): weight = their minutes / track total minutes -> from
    therapist-attribution.csv.
  - Manager (DOR/Mgr Rehab codes): building credit, handled separately (NOT here); the
    only in-scope manager scorecard (SL Area Manager) is also blocked on its job code.

Weights do NOT sum to 1.0 per track (registered evaluator 1.0 + assistants' shares) - that
is intentional; this is a rating attribution, not a partition.

Output: contributions.csv (TxTrack_ID, Person_ID, Role, Weight).
Run from repo root:  python -m evaluation.build_attribution
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent

MANAGER_CODES = {8213, 8214, 8218, 8219, 8224}
REGISTERED_DISC = {"PT", "OT", "ST", "SLP", "CF-SLP", "CFY"}
ASSISTANT_DISC = {"PTA", "COTA", "OTA"}


def role_of(jobcode, discipline) -> str:
    try:
        if int(jobcode) in MANAGER_CODES:
            return "Manager"
    except (ValueError, TypeError):
        pass
    if discipline in REGISTERED_DISC:
        return "Registered"
    if discipline in ASSISTANT_DISC:
        return "Assistant"
    return "Excluded"


def main() -> None:
    emp = pd.read_csv(REPO / "employee-dim.csv")
    emp = emp.drop_duplicates("Person_ID").set_index("Person_ID")
    emp["Role"] = [role_of(jc, d) for jc, d in zip(emp["JobCode"], emp["Discipline"])]
    role = emp["Role"].to_dict()

    ea = pd.read_csv(REPO / "eval-author.csv").dropna(subset=["AuthorPerson_ID"])
    ea["AuthorPerson_ID"] = ea["AuthorPerson_ID"].astype(int)
    att = pd.read_csv(REPO / "therapist-attribution.csv")

    # --- Registered: eval author, weight 1.0 (only if author resolves to Registered) ---
    ea["Role"] = ea["AuthorPerson_ID"].map(role)
    reg = ea[ea["Role"] == "Registered"].copy()
    reg = reg.rename(columns={"AuthorPerson_ID": "Person_ID"})
    reg["Weight"] = 1.0
    reg = reg[["TxTrack_ID", "Person_ID", "Role", "Weight"]]

    # --- Assistant: minute share of track total minutes ---
    tot = att.groupby("TxTrack_ID")["Total_Minutes"].sum().rename("TrackMin")
    a = att.merge(tot, on="TxTrack_ID")
    a["Role"] = a["Person_ID"].map(role)
    asst = a[a["Role"] == "Assistant"].copy()
    asst["Weight"] = asst["Total_Minutes"] / asst["TrackMin"]
    asst = asst[asst["TrackMin"] > 0][["TxTrack_ID", "Person_ID", "Role", "Weight"]]

    out = pd.concat([reg, asst], ignore_index=True)
    out.to_csv(REPO / "contributions.csv", index=False)

    print(f"employee roles: " + ", ".join(f"{k}={v}" for k, v in emp['Role'].value_counts().items()))
    print(f"\ncontributions: {len(out):,}")
    print(out["Role"].value_counts().to_string())
    print(f"\nregistered tracks (1 evaluator each): {reg['TxTrack_ID'].nunique():,}")
    print(f"assistant contributions: {len(asst):,} over {asst['TxTrack_ID'].nunique():,} tracks")
    print(f"assistant weight: min {asst['Weight'].min():.3f} max {asst['Weight'].max():.3f} mean {asst['Weight'].mean():.3f}")
    print(f"distinct therapists credited: {out['Person_ID'].nunique():,}")
    print(f"\nWrote {REPO / 'contributions.csv'}")


if __name__ == "__main__":
    main()
