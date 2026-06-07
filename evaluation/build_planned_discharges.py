"""Response Rate DENOMINATOR — planned discharges per facility.

Mirrors the PBIP exactly: derive a discharge destination's Setting from its Descrip, then
Planned = Setting NOT IN {Hospital, Hospice, Expired, Left Facility AMA}. (IRF / Rehab Hospital
is Planned; only acute Hospital is Unplanned.) Aggregates discharges.csv to per-facility
planned/total counts. The numerator (survey respondents) comes from build_satisfaction once the
survey xlsx is reachable; Response Rate = respondents / planned discharges.

Input:  data/discharges.csv  (Facility_ID, DischargedTo, n_discharges)
Output: data/planned-discharges.csv  (Facility_ID, n_planned, n_total)
Run from repo root:  python -m evaluation.build_planned_discharges
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
UNPLANNED_SETTINGS = {"Hospital", "Hospice", "Expired", "Left Facility AMA"}


def setting_of(descrip) -> str:
    """Replicates DischargeDestination[Setting] from the PBIP (Descrip -> Setting)."""
    d = "" if descrip is None or (isinstance(descrip, float)) else str(descrip)
    if d[:3] == "ILF":
        return "ILF"
    if d[:3] == "ALF":
        return "ALF"
    if d[:4] == "Home":
        return "Home"
    if "Acute care hospital" in d:
        return "Hospital"
    if "Rehab Hospital" in d:
        return "IRF"
    if "SNF" in d:
        return "SNF"
    if "Memory" in d:
        return "Memory Care"
    if "Hospice" in d:
        return "Hospice"
    if "Expired" in d:
        return "Expired"
    return d  # incl. "Left Facility AMA", blanks, and any unmapped destination


def main() -> None:
    df = pd.read_csv(DATA / "discharges.csv")
    df["Setting"] = df["DischargedTo"].map(setting_of)
    df["Planned"] = ~df["Setting"].isin(UNPLANNED_SETTINGS) & df["DischargedTo"].notna()

    g = df.groupby("Facility_ID").apply(
        lambda x: pd.Series({
            "n_total": int(x["n_discharges"].sum()),
            "n_planned": int(x.loc[x["Planned"], "n_discharges"].sum()),
        }), include_groups=False).reset_index()
    g.to_csv(DATA / "planned-discharges.csv", index=False)

    tot, planned = int(df["n_discharges"].sum()), int(df.loc[df["Planned"], "n_discharges"].sum())
    print(f"facilities: {len(g):,} | discharges total {tot:,} | planned {planned:,} ({planned/tot:.1%})")
    print("\nSetting mix (by discharge count):")
    print(df.groupby("Setting")["n_discharges"].sum().sort_values(ascending=False).to_string())
    print(f"\nwrote planned-discharges.csv")


if __name__ == "__main__":
    main()
