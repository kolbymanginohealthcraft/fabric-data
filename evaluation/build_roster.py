"""Employee audit roster - one row per employee with EVERY categorization, for spot-checking.

Columns: identity (Person_ID, FullName, Discipline, JobCode, JobTitle, Status, HomeLocation)
+ Role (attribution) + AttributionRule (plain English) + ScorecardGroup + Template
+ DivisionsWorked + nContribTracks + (managers) territory level/buildings/tracks + flags.

This also IMPLEMENTS the scorecard-group classifier (telehealth-by-title; else division-of-work
CR->A / SL-only->B; managers by code; HH/HAP flagged out of scope).

Run from repo root:  python -m evaluation.build_roster
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

from evaluation.build_attribution import (
    role_of, SL_AREA_MGR_CODES, DOR_CODES,
    build_ledger_maps, territory_codes, _orgchart_territory,
)

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
REGION_DIV = {"08450": "Contract Rehab", "05500": "Senior Living",
              "06500": "HAP", "05555": "Closed"}


def home_type(home, M: dict) -> str:
    """What the HomeLocation value IS in the hierarchy (the 'grain' that sets a manager's level)."""
    if home in M["closed"]:
        return "Closed sentinel"
    if home in M["fac2dist"]:
        return "Building (facility)"
    if home in M["dist_ledgers"]:
        return "District ledger"
    if home in M["area_ledgers"]:
        return "Area ledger"
    if home in M["region_ledgers"]:
        return "Region ledger"
    return "Unmapped"


def main() -> None:
    emp = pd.read_csv(DATA / "employee-dim.csv", dtype=str).drop_duplicates("Person_ID")
    emp["Person_ID"] = emp["Person_ID"].astype(int)
    emp["JobCode_int"] = pd.to_numeric(emp["JobCode"], errors="coerce")
    emp["home"] = emp["HomeLocation"].str.zfill(5)
    emp["Role"] = [role_of(jc, d, t)
                   for jc, d, t in zip(emp["JobCode"], emp["Discipline"], emp["JobTitle"])]

    contrib = pd.read_csv(DATA / "contributions.csv")
    tracks = pd.read_csv(DATA / "tracks.csv", usecols=["TxTrack_ID", "Facility_ID", "ServiceLine"])
    metrics = pd.read_csv(DATA / "therapist-metrics.csv", usecols=["Person_ID"])
    hier = pd.read_csv(DATA / "facility-hier.csv", dtype=str)
    fac = pd.read_csv(DATA / "facility-dim.csv")
    fac["code"] = fac["FacilityName"].str.extract(r"^\s*(\d+)")[0].str.zfill(5)

    scored = set(metrics["Person_ID"].unique())

    # divisions a person actually works in = ServiceLine over their credited tracks
    ct = contrib.merge(tracks, on="TxTrack_ID", how="left")
    divs = ct.groupby("Person_ID")["ServiceLine"].agg(lambda s: set(x for x in s if pd.notna(x)))
    ntrk = ct.groupby("Person_ID")["TxTrack_ID"].nunique()

    # manager territory (per-manager level + size), reusing the shared ledger rule
    M = build_ledger_maps(hier)
    org = _orgchart_territory(emp)
    code2fid = fac.dropna(subset=["code"]).groupby("code")["Facility_ID"].apply(set).to_dict()
    tracks_by_fid = tracks.groupby("Facility_ID")["TxTrack_ID"].nunique().to_dict()
    home_d = emp.set_index("Person_ID")["home"].to_dict()
    # home value -> its region, whether home is a facility OR a district/area/region ledger
    hh = hier.assign(code=hier["code"].str.zfill(5), RegionNumber=hier["RegionNumber"].str.zfill(5),
                     AreaNumber=hier["AreaNumber"].str.zfill(5),
                     DistrictNumber=hier["DistrictNumber"].str.zfill(5))
    code2region = {}
    code2region.update(hh.set_index("code")["RegionNumber"].to_dict())
    code2region.update(hh.drop_duplicates("DistrictNumber").set_index("DistrictNumber")["RegionNumber"].to_dict())
    code2region.update(hh.drop_duplicates("AreaNumber").set_index("AreaNumber")["RegionNumber"].to_dict())
    code2region.update({r: r for r in hh["RegionNumber"].unique()})

    def mgr_territory_info(pid):
        level, codes = territory_codes(home_d.get(pid), M)
        if codes is None:
            level, codes = "orgchart(fallback)", org.get(pid, set())
        fids = set().union(*[code2fid.get(c, set()) for c in codes]) if codes else set()
        ntr = sum(tracks_by_fid.get(f, 0) for f in fids)
        return level, len(fids), ntr

    def classify(r):
        role = r["Role"]
        title = (r["JobTitle"] or "").lower()
        dset = divs.get(r["Person_ID"], set())
        insc = dset & {"Contract Rehab", "Senior Living"}
        # HomeLocation -> hierarchy -> region -> division = the 1:1 EMPLOYEE attribute that decides
        # the bucket (replaces treatment-footprint inference, which let cross-coverage straddle two).
        home_div = REGION_DIV.get(code2region.get(r["home"], r["home"]), "")
        # returns: ScorecardGroup, Template, AttributionRule, GroupBasis (how the group was decided)
        if role == "Manager":
            jc = r["JobCode_int"]
            if jc in SL_AREA_MGR_CODES:
                if r["Status"] == "Terminated":
                    return "SL Area Manager (terminated-excluded)", "-", "Excluded (terminated)", "code"
                return "SL Area Manager", "B", "Building credit: 1.0 for every track in territory", "code"
            if jc in DOR_CODES:
                return "CR Manager / DOR (PARKED)", "-", "Parked - no credit yet", "code"
            return "Leadership (PARKED, above DOR/Area)", "-", "Parked - higher-tier manager, no credit yet", "code"
        if role in ("Registered", "Assistant"):
            base = ("Eval-author: full credit (1.0) for tracks they authored the EVAL on"
                    if role == "Registered"
                    else "Treatment-minute share of tracks they treated")
            if "telehealth" in title:
                return "Telehealth Field Clinician", "A", base, "title"
            # PRIMARY: home division (1:1, no straddling)
            if home_div == "Contract Rehab":
                return "Contract Rehab Field Clinician", "A", base, "home"
            if home_div == "Senior Living":
                return "SL Field Clinician", "B", base, "home"
            # FALLBACK (~1.6%: home is Closed / HAP / blank / unmapped): treatment footprint, the old
            # logic. User wants these KEPT for now (not excluded) for spot-checking -> basis flags them.
            if "Contract Rehab" in insc:
                return "Contract Rehab Field Clinician", "A", base, "work-fallback"
            if insc == {"Senior Living"}:
                return "SL Field Clinician", "B", base, "work-fallback"
            if not dset:
                return "(no scored tracks)", "-", base + " (no tracks in window)", "none"
            return "Out of scope (HAP/Closed/Other only)", "-", base, "work-fallback"
        return "Excluded (non-clinical/blank discipline)", "-", "None", "none"

    rows = []
    for _, r in emp.iterrows():
        grp, tmpl, rule, basis = classify(r)
        d = divs.get(r["Person_ID"], set())
        rec = {
            "Person_ID": r["Person_ID"], "FullName": r["FullName"],
            "Discipline": r["Discipline"], "JobCode": r["JobCode"], "JobTitle": r["JobTitle"],
            "Status": r["Status"], "HomeLocation": r["HomeLocation"],
            "HomeDivision": REGION_DIV.get(code2region.get(r["home"], r["home"]), ""),
            "HomeLocationType": home_type(r["home"], M),
            "Role": r["Role"], "ScorecardGroup": grp, "Template": tmpl,
            "GroupBasis": basis,
            "AttributionRule": rule,
            "Scored": "Y" if r["Person_ID"] in scored else "N",
            "DivisionsWorked": "; ".join(sorted(d)) if d else "",
            "nContribTracks": int(ntrk.get(r["Person_ID"], 0)),
            "HH_titled": "Y" if "home health" in (r["JobTitle"] or "").lower()
                              or (r["JobTitle"] or "").lower().endswith(" hh") else "",
        }
        if r["Role"] == "Manager" and r["JobCode_int"] in SL_AREA_MGR_CODES and r["Status"] != "Terminated":
            lvl, nb, nt = mgr_territory_info(r["Person_ID"])
            rec["MgrTerritoryLevel"], rec["MgrBuildings"], rec["MgrTracks"] = lvl, nb, nt
        else:
            rec["MgrTerritoryLevel"], rec["MgrBuildings"], rec["MgrTracks"] = "", "", ""
        rows.append(rec)

    out = pd.DataFrame(rows).sort_values(["ScorecardGroup", "Role", "FullName"])
    try:
        out.to_csv(DATA / "employee-roster.csv", index=False, encoding="utf-8-sig")
    except PermissionError:
        raise SystemExit("employee-roster.csv is open (Excel?) - close it and re-run.")

    print(f"employees: {len(out):,}  -> employee-roster.csv")
    print("\n=== ScorecardGroup distribution ===")
    print(out["ScorecardGroup"].value_counts(dropna=False).to_string())
    print("\n=== Role distribution ===")
    print(out["Role"].value_counts().to_string())
    print("\n=== GroupBasis (how field-clinician scorecard group was decided) ===")
    print(out["GroupBasis"].value_counts().to_string())
    fb = out[(out["GroupBasis"] == "work-fallback") & out["Role"].isin(["Registered", "Assistant"])]
    print(f"work-fallback field clinicians (home Closed/HAP/blank -> spot-check these): {len(fb)}")
    print(f"\nScored (appear in therapist-metrics): {(out['Scored']=='Y').sum():,}")


if __name__ == "__main__":
    main()
