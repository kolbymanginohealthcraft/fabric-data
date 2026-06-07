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

NOTE: Response Rate (surveys / appropriate discharges) is NOT here yet — its denominator needs
the "appropriate discharges" definition + a Fabric discharge pull. Advocacy Score only for now.
Run from repo root:  python -m evaluation.build_satisfaction
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
SLP_TO_ST = {"SLP": "ST"}                       # survey uses SLP; clinical data uses ST
THERAPY_DISCIPLINES = {"PT", "OT", "SLP"}        # discipline-specific advocacy = these only


def load_surveys() -> pd.DataFrame:
    main, ohana = DATA / "satisfaction-main.xlsx", DATA / "satisfaction-ohana.xlsx"
    if not main.exists():
        raise SystemExit(
            "Survey xlsx not found in data/ (satisfaction-main.xlsx). The automated fetch is "
            "blocked pending an IT service principal (queries/pull-satisfaction.js gets 403). "
            "Drop a one-time copy in data/ for a dev run, or wait for the SP."
        )
    frames = []
    m = pd.read_excel(main, sheet_name="Sheet1")
    frames.append(m)
    if ohana.exists():
        o = pd.read_excel(ohana, sheet_name="Sheet1").rename(columns={"Aegis Facility Number": "Facility"})
        frames.append(o)
    df = pd.concat(frames, ignore_index=True)
    df["SurveyID"] = range(1, len(df) + 1)
    return df


def main() -> None:
    scoring = pd.read_csv(DATA / "satisfaction-scoring.csv")
    dictionary = pd.read_csv(DATA / "satisfaction-dictionary.csv")
    surveys = load_surveys()

    # questions we score = discipline therapy questions present in BOTH the dictionary and the xlsx
    disc_q = dictionary[dictionary["Discipline"].isin(THERAPY_DISCIPLINES)]
    q_cols = [q for q in disc_q["Question"] if q in surveys.columns]
    missing = sorted(set(disc_q["Question"]) - set(q_cols))
    if missing:
        print(f"WARNING: {len(missing)} dictionary questions not found as xlsx columns (string mismatch?):")
        for q in missing[:4]:
            print("   ", q)

    # unpivot -> one row per (survey, question, answer)
    long = surveys.melt(id_vars=["SurveyID", "Facility"], value_vars=q_cols,
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
    g = long.groupby(["Facility", "Discipline"]).agg(
        points=("Points", "sum"), maxpoints=("MaxPoints", "sum"),
        n_responses=("Points", "size"), n_surveys=("SurveyID", "nunique")).reset_index()
    g["AdvocacyScore"] = g["points"] / g["maxpoints"]
    g["Discipline"] = g["Discipline"].replace(SLP_TO_ST)        # SLP -> ST to match clinical

    out = g[["Facility", "Discipline", "AdvocacyScore", "n_responses", "n_surveys"]]
    out.to_csv(DATA / "satisfaction-scores.csv", index=False)
    print(f"\nwrote satisfaction-scores.csv: {len(out)} Facility x Discipline rows")
    print(out.groupby("Discipline")["AdvocacyScore"].describe()[["count", "mean", "min", "max"]].round(3).to_string())


if __name__ == "__main__":
    main()
