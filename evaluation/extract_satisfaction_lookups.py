"""Extract the satisfaction scoring lookups embedded in the Patient Satisfaction PBIP.

The report's Dictionary (Question->Discipline/Topic) and Scoring (Answer->Points/Type) tables
are inline base64+deflate blobs in the .tmdl. Decode them to committed reference CSVs in data/
(the scoring scheme, not PHI) so build_satisfaction.py has a stable, auditable lookup without
re-parsing the PBIP each run. Re-run if the report's scoring scheme changes.

Run from repo root:  python -m evaluation.extract_satisfaction_lookups
"""
from __future__ import annotations
import base64
import json
import re
import zlib
from pathlib import Path
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
TBL = REPO / "PatientSatisfaction" / "Patient Satisfaction Report.SemanticModel" / "definition" / "tables"


def decode_inline_table(tmdl_name: str, columns: list[str]) -> pd.DataFrame:
    text = (TBL / tmdl_name).read_text(encoding="utf-8")
    b64 = re.search(r'Binary\.FromText\("([A-Za-z0-9+/=]+)"', text).group(1)
    rows = json.loads(zlib.decompress(base64.b64decode(b64), -15))  # Compression.Deflate = raw deflate
    return pd.DataFrame(rows, columns=columns)


def main() -> None:
    scoring = decode_inline_table("Scoring.tmdl", ["Sentiment", "Type", "Points", "Sort"])
    scoring["Points"] = scoring["Points"].astype(int)
    # Max points per scale Type (the denominator unit for Advocacy Score)
    scoring["MaxPoints"] = scoring.groupby("Type")["Points"].transform("max")
    scoring.to_csv(DATA / "satisfaction-scoring.csv", index=False, encoding="utf-8-sig")

    dictionary = decode_inline_table("Dictionary.tmdl", ["Question", "Discipline", "Topic", "Sort Order"])
    dictionary.to_csv(DATA / "satisfaction-dictionary.csv", index=False, encoding="utf-8-sig")

    print(f"satisfaction-scoring.csv: {len(scoring)} rows; MaxPoints by Type:")
    print(scoring.groupby("Type")["MaxPoints"].first().to_string())
    print(f"\nsatisfaction-dictionary.csv: {len(dictionary)} rows; questions by Discipline:")
    print(dictionary["Discipline"].value_counts().to_string())


if __name__ == "__main__":
    main()
