"""Satisfaction scoring — discipline-specific Advocacy Score per Facility x Discipline.

Mirrors the Patient Satisfaction PBIP: unpivot the survey question columns, score each answer
to points (Scoring lookup), and Advocacy Score = SUM(points) / SUM(max points) over a
discipline's therapy questions. Grain is Facility x Discipline (the survey rates "the
therapist(s)" team, not an individual) -> attributes to therapists facility+discipline-wide.

Inputs (data/):
  satisfaction-main.xlsx, satisfaction-ohana.xlsx   <- fetched by queries/pull-satisfaction.js
                                                       (BLOCKED: needs an IT service principal;
                                                        a one-time local copy also works for dev)
  satisfaction-scoring.csv, satisfaction-dictionary.csv  <- evaluation.extract_satisfaction_lookups
Output: data/satisfaction-scores.csv  (Facility, Discipline, AdvocacyScore, n_responses, n_surveys)

Also builds Response Rate (discipline-specific respondents / discipline-specific planned discharges,
per Facility x Discipline) -> data/satisfaction-response-rate.csv. Both satisfaction metrics are now
Facility x Discipline.
Run from repo root:  python -m evaluation.build_satisfaction
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
SLP_TO_ST = {"SLP": "ST"}                       # survey uses SLP; clinical data uses ST
THERAPY_DISCIPLINES = {"PT", "OT", "SLP"}        # discipline-specific advocacy = these only
RR_TRAILING_MONTHS = 12                          # Response Rate window; MUST match the discharge pull
NULL_FACILITY = "95993"                           # PBIP rule (Surveys M): null Facility -> 95993
#                                                  (= "The Ching Villas"); rescues the Ohana survey,
#                                                  whose facility column ships entirely null.


def load_surveys() -> pd.DataFrame:
    main, ohana = DATA / "satisfaction-main.xlsx", DATA / "satisfaction-ohana.xlsx"
    if not main.exists():
        raise SystemExit(
            "Survey xlsx not found in data/ (satisfaction-main.xlsx). Download the two survey files "
            "from OneDrive into your Downloads folder, then run:  node queries/pull-satisfaction.js"
        )
    frames = []
    m = pd.read_excel(main, sheet_name="Sheet1")
    m["Source"] = "main"
    frames.append(m)
    if ohana.exists():
        o = pd.read_excel(ohana, sheet_name="Sheet1").rename(columns={"Aegis Facility Number": "Facility"})
        o["Source"] = "ohana"
        frames.append(o)
    df = pd.concat(frames, ignore_index=True)
    df["SurveyID"] = range(1, len(df) + 1)
    return df


def facility_crosswalk() -> pd.DataFrame:
    """BizNo (business facility number, the leading digits of FacilityName) -> Facility_ID.
    The survey records the business number; the rest of the evaluation keys on Facility_ID."""
    fd = pd.read_csv(DATA / "facility-dim.csv")
    fd["BizNo"] = fd["FacilityName"].astype(str).str.extract(r"^\s*(\d+)")
    return fd.dropna(subset=["BizNo"])[["BizNo", "Facility_ID", "FacilityName", "DivisionCode"]]


def clean_bizno(series: pd.Series) -> pd.Series:
    """Survey Facility cell -> digit-only business number (handles junk prefixes, '.', names, dates)."""
    s = series.astype(str).str.replace(r"\D", "", regex=True)
    return s.where(s.str.len() > 0)  # '' -> NaN


def received_columns(df: pd.DataFrame) -> dict:
    """Map survey discipline (PT/OT/ST) -> its 'Did you receive ...?' column (whitespace-robust:
    e.g. OT's column has a stray space, 'Did you receive Occupational Therapy ?')."""
    keyword = {"PT": "physical", "OT": "occupational", "ST": "speech"}
    out = {}
    for disc, kw in keyword.items():
        match = [c for c in df.columns if "receive" in c.lower() and kw in c.lower()]
        if match:
            out[disc] = match[0]
    return out


def main() -> None:
    scoring = pd.read_csv(DATA / "satisfaction-scoring.csv")
    dictionary = pd.read_csv(DATA / "satisfaction-dictionary.csv")
    surveys = load_surveys()

    # PBIP rule: a null Facility -> 95993 (rescues the Ohana survey, whose facility col is all-null)
    surveys["Facility"] = surveys["Facility"].where(surveys["Facility"].notna(), NULL_FACILITY)
    # map survey business-number -> Facility_ID (drop the ~0.8% unmappable junk/typo rows)
    surveys["BizNo"] = clean_bizno(surveys["Facility"])
    xwalk = facility_crosswalk()
    surveys = surveys.merge(xwalk, on="BizNo", how="left")

    # attribution report by source (Ohana currently ships with no facility number at all)
    print("Facility attribution by source:")
    for src, grp in surveys.groupby("Source"):
        mapped = grp["Facility_ID"].notna().sum()
        print(f"  {src:5s}: {mapped:>6,}/{len(grp):>6,} mapped ({mapped / len(grp):.0%})")
    ohana_blank = surveys[(surveys["Source"] == "ohana") & surveys["BizNo"].isna()].shape[0]
    if ohana_blank:
        print(f"  -> {ohana_blank} Ohana responses have NO facility number in the file; "
              f"excluded pending an Ohana->Facility_ID mapping rule.")
    surveys = surveys.dropna(subset=["Facility_ID"])
    surveys["Facility_ID"] = surveys["Facility_ID"].astype(int)

    # questions we score = discipline therapy questions present in BOTH the dictionary and the xlsx
    disc_q = dictionary[dictionary["Discipline"].isin(THERAPY_DISCIPLINES)]
    q_cols = [q for q in disc_q["Question"] if q in surveys.columns]
    missing = sorted(set(disc_q["Question"]) - set(q_cols))
    if missing:
        print(f"WARNING: {len(missing)} dictionary questions not found as xlsx columns (string mismatch?):")
        for q in missing[:4]:
            print("   ", q)

    # unpivot -> one row per (survey, question, answer)
    long = surveys.melt(id_vars=["SurveyID", "Facility_ID", "FacilityName"], value_vars=q_cols,
                        var_name="Question", value_name="Answer")
    long = long[long["Answer"].notna() & (long["Answer"].astype(str).str.strip() != "")]

    # attach discipline (Question) + points/maxpoints (Answer -> Scoring, "Level of Agree" scale)
    long = long.merge(disc_q[["Question", "Discipline", "Topic"]], on="Question", how="inner")
    long = long.merge(scoring[["Sentiment", "Points", "MaxPoints"]],
                      left_on="Answer", right_on="Sentiment", how="left")
    unscored = long["Points"].isna().sum()
    if unscored:
        print(f"NOTE: {unscored} responses had answers not in the Scoring map (dropped): "
              f"{sorted(long.loc[long['Points'].isna(),'Answer'].astype(str).unique())[:6]}")
    long = long.dropna(subset=["Points"])

    # Advocacy Score = SUM(points) / SUM(maxpoints) per Facility x Discipline
    g = long.groupby(["Facility_ID", "FacilityName", "Discipline"]).agg(
        points=("Points", "sum"), maxpoints=("MaxPoints", "sum"),
        n_responses=("Points", "size"), n_surveys=("SurveyID", "nunique")).reset_index()
    g["AdvocacyScore"] = g["points"] / g["maxpoints"]
    g["Discipline"] = g["Discipline"].replace(SLP_TO_ST)        # SLP -> ST to match clinical

    out = g[["Facility_ID", "FacilityName", "Discipline", "AdvocacyScore", "n_responses", "n_surveys"]]
    out.to_csv(DATA / "satisfaction-scores.csv", index=False)
    print(f"\nwrote satisfaction-scores.csv: {len(out)} Facility x Discipline rows")
    print(out.groupby("Discipline")["AdvocacyScore"].describe()[["count", "mean", "min", "max"]].round(3).to_string())

    response_rate(surveys)


def response_rate(surveys: pd.DataFrame) -> None:
    """Response Rate per Facility x Discipline = discipline-specific respondents / discipline-specific
    planned discharges. A survey counts toward discipline D iff 'Did you receive D?'=Yes; the
    denominator (planned-discharges.csv, now Facility x Discipline) counts planned-discharged patients
    who received D. So Speech isn't measured against patients who never got speech. Numerator window
    MUST match the discharge denominator window (same 12 complete calendar months)."""
    pd_path = DATA / "planned-discharges.csv"
    if not pd_path.exists():
        print("\nResponse Rate skipped: data/planned-discharges.csv not found "
              "(run: node queries/pull-discharges.js  then  python -m evaluation.build_planned_discharges)")
        return
    planned = pd.read_csv(pd_path)        # Facility_ID, Discipline, n_total, n_planned

    ts = pd.to_datetime(surveys["Timestamp"], errors="coerce")
    # Complete-calendar-month window, matching the discharge pull's
    # [DATEADD(YEAR,-1,firstOfThisMonth), firstOfThisMonth) bounds: exclude the partial
    # current month so numerator and denominator cover the same 12 complete months.
    month_start = pd.Timestamp.now().normalize().replace(day=1)      # first of current month (exclusive upper)
    cutoff = month_start - pd.DateOffset(months=RR_TRAILING_MONTHS)  # first of month N months back (inclusive lower)
    win = surveys[(ts >= cutoff) & (ts < month_start)].copy()

    # discipline-specific numerator: a survey counts for discipline D iff "Did you receive D?" == Yes
    recv = received_columns(win)
    num_frames = []
    for disc, col in recv.items():
        yes = win[win[col].astype(str).str.strip().str.lower().eq("yes")]
        n = (yes.groupby(["Facility_ID", "FacilityName"])["SurveyID"].nunique()
             .reset_index(name="n_respondents"))
        n["Discipline"] = disc
        num_frames.append(n)
    resp = pd.concat(num_frames, ignore_index=True)

    rr = resp.merge(planned[["Facility_ID", "Discipline", "n_planned"]],
                    on=["Facility_ID", "Discipline"], how="left")
    missing = rr["n_planned"].isna().sum()
    rr = rr.dropna(subset=["n_planned"])
    rr = rr[rr["n_planned"] > 0]
    rr["n_planned"] = rr["n_planned"].astype(int)
    raw_rate = rr["n_respondents"] / rr["n_planned"]
    n_capped = int((raw_rate > 1).sum())
    # CAP at 100% (committee-approved 2026-06-23): a rate >1 (more respondents than planned
    # discharges, from window/denominator edges) is nonsensical as a "rate" and, left uncapped,
    # distorts any composite that averages it against bounded 0-1 metrics.
    rr["ResponseRate"] = raw_rate.clip(upper=1.0)

    rr[["Facility_ID", "FacilityName", "Discipline", "n_respondents", "n_planned", "ResponseRate"]] \
        .sort_values(["Discipline", "ResponseRate"], ascending=[True, False]) \
        .to_csv(DATA / "satisfaction-response-rate.csv", index=False)
    print(f"\nwrote satisfaction-response-rate.csv: {len(rr)} Facility x Discipline cells "
          f"({RR_TRAILING_MONTHS} complete months: {cutoff.date()} through "
          f"{(month_start - pd.Timedelta(days=1)).date()}); "
          f"{missing} cells had respondents but no discharge denominator (dropped); "
          f"{n_capped} cells capped at 100%")
    print("  ResponseRate by discipline (median / mean, capped):")
    for disc, g in rr.groupby("Discipline"):
        print(f"    {disc}: median {g['ResponseRate'].median():.2f}, mean {g['ResponseRate'].mean():.2f}")


if __name__ == "__main__":
    main()
