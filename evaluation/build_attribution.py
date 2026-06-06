"""Stage B - role-based track -> therapist/manager attribution.

Credit depends on ROLE:
  - Registered (PT/OT/ST/SLP/...): FULL credit (weight 1.0) for tracks they EVALUATED
    (author of the EVAL doc) -> eval-author.csv.
  - Assistant (PTA/COTA/OTA): weight = their TREATMENT minutes / track total treatment minutes
    -> therapist-attribution.csv.
  - Manager: building credit. Only SL Area Managers (JobCodes 8221/8223/9206 = "Area Manager
    Outpatient" = region 5500 Senior Living) are scored now; they get FULL credit (1.0) for every
    track in their building set = own HomeLocation + the HomeLocations of clinicians reporting to
    them (inverted SupervisorIdentifier). DOR/CR managers are parked (Manager role -> excluded
    from clinical credit, no scorecard built).

Output: contributions.csv (TxTrack_ID, Person_ID, Role, Weight).
Run from repo root:  python -m evaluation.build_attribution
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent

DOR_CODES = {8213, 8214, 8218, 8219, 8224}
SL_AREA_MGR_CODES = {8221, 8223, 9206}
MANAGER_CODES = DOR_CODES | SL_AREA_MGR_CODES          # all excluded from clinical credit
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


def manager_buildings(emp: pd.DataFrame) -> dict:
    """SL Area Manager Person_ID -> set of building facility codes (own + direct reports')."""
    # resolve each employee's supervisor Person_ID via the two edge types
    by_empnum = emp.dropna(subset=["EmployeeNumber"]).drop_duplicates("EmployeeNumber") \
                   .set_index("EmployeeNumber")["Person_ID"].to_dict()
    by_user = emp.dropna(subset=["Username"]).drop_duplicates("Username") \
                 .set_index("Username")["Person_ID"].to_dict()

    def resolve(row):
        sid, typ = row["SupervisorIdentifier"], row["SupervisorIdentifierType"]
        if pd.isna(sid):
            return None
        if typ == "EmployeeNumber":
            return by_empnum.get(str(sid))
        if typ == "UserName":
            return by_user.get(str(sid))
        return None

    emp = emp.copy()
    emp["sup_pid"] = emp.apply(resolve, axis=1)
    home = emp.set_index("Person_ID")["home"].to_dict()

    # children map -> transitive descendants (a manager's territory is the WHOLE sub-tree,
    # so an Area Mgr over DORs also gets the line therapists below those DORs).
    children: dict = {}
    for pid, sup in zip(emp["Person_ID"], emp["sup_pid"]):
        if pd.notna(sup):
            children.setdefault(int(sup), []).append(pid)

    def descendants(root):
        seen, stack = set(), [root]
        while stack:
            for c in children.get(stack.pop(), []):
                if c not in seen:
                    seen.add(c)
                    stack.append(c)
        return seen

    mgrs = emp[emp["JobCode_int"].isin(SL_AREA_MGR_CODES)]
    out = {}
    for pid in mgrs["Person_ID"]:
        people = descendants(pid) | {pid}          # whole sub-tree incl. self
        bset = {home.get(p) for p in people}
        out[pid] = {b for b in bset if b and pd.notna(b) and b not in ("00000", "00001")}
    return out


def main() -> None:
    emp = pd.read_csv(REPO / "employee-dim.csv", dtype=str).drop_duplicates("Person_ID")
    emp["Person_ID"] = emp["Person_ID"].astype(int)
    emp["JobCode_int"] = pd.to_numeric(emp["JobCode"], errors="coerce")
    emp["home"] = emp["HomeLocation"].str.zfill(5)
    emp["Role"] = [role_of(jc, d) for jc, d in zip(emp["JobCode"], emp["Discipline"])]
    role = emp.set_index("Person_ID")["Role"].to_dict()

    # ---- Registered: eval author, weight 1.0 ----
    ea = pd.read_csv(REPO / "eval-author.csv").dropna(subset=["AuthorPerson_ID"])
    ea["AuthorPerson_ID"] = ea["AuthorPerson_ID"].astype(int)
    ea["Role"] = ea["AuthorPerson_ID"].map(role)
    reg = ea[ea["Role"] == "Registered"].rename(columns={"AuthorPerson_ID": "Person_ID"}).copy()
    reg["Weight"] = 1.0
    reg = reg[["TxTrack_ID", "Person_ID", "Role", "Weight"]]

    # ---- Assistant: treatment-minute share ----
    att = pd.read_csv(REPO / "therapist-attribution.csv")
    tot = att.groupby("TxTrack_ID")["Total_Treatment_Minutes"].sum().rename("TrackMin")
    a = att.merge(tot, on="TxTrack_ID")
    a["Role"] = a["Person_ID"].map(role)
    asst = a[(a["Role"] == "Assistant") & (a["TrackMin"] > 0)].copy()
    asst["Weight"] = asst["Total_Treatment_Minutes"] / asst["TrackMin"]
    asst = asst[["TxTrack_ID", "Person_ID", "Role", "Weight"]]

    # ---- Manager (SL Area Mgr): full credit for every track in their building set ----
    tracks = pd.read_csv(REPO / "tracks.csv", usecols=["TxTrack_ID", "Facility_ID"])
    fac = pd.read_csv(REPO / "facility-dim.csv")
    fac["code"] = fac["FacilityName"].str.extract(r"^\s*(\d+)")[0].str.zfill(5)
    code2fid = fac.dropna(subset=["code"]).groupby("code")["Facility_ID"].apply(set).to_dict()

    bmap = manager_buildings(emp)
    mgr_rows = []
    for pid, codes in bmap.items():
        fids = set().union(*[code2fid.get(c, set()) for c in codes]) if codes else set()
        if not fids:
            continue
        mt = tracks[tracks["Facility_ID"].isin(fids)]["TxTrack_ID"]
        for t in mt:
            mgr_rows.append((t, pid, "Manager", 1.0))
    mgr = pd.DataFrame(mgr_rows, columns=["TxTrack_ID", "Person_ID", "Role", "Weight"])

    out = pd.concat([reg, asst, mgr], ignore_index=True)
    out.to_csv(REPO / "contributions.csv", index=False)

    print("employee roles: " + ", ".join(f"{k}={v}" for k, v in emp["Role"].value_counts().items()))
    print(f"\ncontributions: {len(out):,}")
    print(out["Role"].value_counts().to_string())
    print(f"\nSL Area Managers with a building set: {len([k for k,v in bmap.items() if v])}/{len(bmap)}")
    if len(mgr):
        per_mgr = mgr.groupby("Person_ID")["TxTrack_ID"].nunique()
        print(f"manager building tracks: median {per_mgr.median():.0f}, max {per_mgr.max()}, "
              f"buildings/mgr median {pd.Series([len(v) for v in bmap.values() if v]).median():.0f}")
    print(f"distinct people credited: {out['Person_ID'].nunique():,}")
    print(f"\nWrote {REPO / 'contributions.csv'}")


if __name__ == "__main__":
    main()
