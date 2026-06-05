# Therapist Evaluation — Fabric-native rebuild

Downstream analytics layer for the People Dashboard / therapist scoring system. **Sits on top of the new PBIP model — does not compute outcomes itself.**

## Architecture (full pipeline)

```text
Raw NetHealth tables on Fabric (TxDocumentItem, TxDocument, TxTrack, …)
                       │
                       ▼  ◄─── upstream zone — owned by the new PBIP model
   New ClinicalOutcomes PBIP semantic model (../ClinicalOutcomes/)
   • Crosswalk-driven outcome filtering
   • EVAL/DISCH pairing, scale normalization (Points 0-100)
   • GG N/A recoding (EvalNEW), Included status gate
   • Cohort dimensions exposed (library_item, library, service_line,
     residence, discipline, job)
                       │
                       ▼  ◄─── one row per Included outcome, ready for analytics
   Per-outcome rows: (Case × Track × Item) + EvalNEW, TableDisch, dims
                       │
                       ▼  ◄─── handoff into this folder
   /evaluation/ (Python: attribution + outcome-level cohort percentiles)
                       │
                       ▼
   Therapist 1-5 ratings CSV  →  Power BI
```

- **Upstream (the PBIP model)** owns: outcome inclusion logic (`Status="Included"` in `OutcomeSummary`), scale normalization (`Outcomes Custom Scales[Points]`), GG N/A recoding (`EvalNEW`), cohort dimension derivation. Consult `../ClinicalOutcomes/` for the canonical methodology — not this folder.
- **Data extraction** is JS (already built — `../fabric-query.js`, `../queries/pull-track-dimensions.js`, etc.) and pulls from whatever the PBIP model exposes.
- **This folder** does ONLY: therapist attribution to tracks, outcome-level cohort assignment, percentile-within-cohort, attribution-weighted 1-5 rating roll-up. It assumes per-outcome rows already exist.
- **Output** is CSV consumed by Power BI as one more semantic-model table.

## Cohorting model (A2 — outcome-level, not track-level)

Cohort assignment happens per outcome, not per track. Cohort grain:

`(library_item × library × service_line × residence × discipline × job)`

Each outcome's percentile is computed within its cohort. Therapist rating is an attribution-weighted average of outcome percentiles, where attribution is still track-level (`contribution(therapist, T)`) and every outcome on track T inherits that weight. Mixed-library tracks are handled natively — OP-library outcomes go to OP cohorts, SNF outcomes to SNF cohorts. No outcomes dropped, no dominance rules, no Mixed bucket. See `memory/project_therapist_evaluation.md` for the math and rationale.

## Relationship to `../PeopleDashboard/`

`PeopleDashboard/` holds the prior implementation. **It had a free shortcut: its inputs were per-track outcome scores already computed by the legacy Power BI model**, exported via DAX. The Python in PeopleDashboard never had to compute outcomes from raw assessment data — it consumed a pre-scored stream.

The new system has no such shortcut. The upstream scoring is itself being rebuilt in `../ClinicalOutcomes/`. So the prior project is two things now:

- **Authoritative reference for therapist-scoring methodology** (`docs/`, `configs/`) — attribution, peer groups, percentile ranking. Borrowable.
- **Reference for the OLD data extraction approach** (`data/queries/*.dax`) — these DAX files reference the schemas of the LEGACY Power BI semantic models (Legacy / Blue / SL), not Fabric tables. Useful as a historical record of what data the prior system pulled, but the field/table names will not match anything in the new Fabric world.

The original methodology used a single peer group (`StaffTitle`). The new system extends to a multi-dimension cohort at the **outcome** level — see the Cohorting model section above and `memory/project_therapist_evaluation.md` for full design and rationale.

## Files

| File | Status | Source |
| --- | --- | --- |
| `attribution.py` | **Ported** from `PeopleDashboard/scripts/transforms.py::calculate_therapist_attribution` | Directly reusable — no methodology change |
| `filters.yaml` | **Ported** from `PeopleDashboard/configs/global_filters.yaml` | May need re-tuning for multi-dim cohorts |
| `track_gains.py` | **Obsolete under A2** | Previously held a track-level aggregation step. Outcome-level cohorting skips that aggregation entirely — gains live per outcome in the upstream model's `OutcomeSummary`. Delete or repurpose as a thin per-outcome loader |
| `cohort_percentiles.py` | **TBD** | New: per-outcome percentile within `(library_item × library × service_line × residence × discipline × job)` cohort. Pure analytics — runs after upstream provides per-outcome rows |
| `therapist_rating.py` | **TBD** | Attribution-weighted avg of outcome percentiles → 1-5 rating. Joins attribution (track grain) to outcome percentiles (outcome grain) via `TxTrack_ID` |
| `requirements.txt` | Created | pandas, pyyaml |

## Running

```bash
# From the repo root
pip install -r evaluation/requirements.txt
python -m evaluation.<script_name>
```

Inputs come from CSVs produced by the JS data-pull layer (e.g., `track-cohort-dimensions.csv`).

## Open design questions

Most of the open questions are **upstream** — they shape what the PBIP model exposes, which in turn determines what this folder consumes. See `memory/project_therapist_evaluation.md` for the running list. The most pressing:

- **Short Stay vs Long Stay payer split**: was a metric axis in the old project. Whether we keep it depends on the upstream model's payer surfacing.
- **Threshold re-tuning + reinterpretation** (the values in `filters.yaml`): the old thresholds were calibrated for a single peer group and track-level cohorts. Under outcome-level cohorts with `library_item` included, cell counts change materially — need empirical cell-size analysis before locking thresholds. Also need to reinterpret "min therapists per peer group" for an outcome-grained cohort.
- **Resolved (2026-04-15)**: Mixed libraries → outcome-level cohorting (A2) handles Mixed natively without dropping outcomes.

Until the upstream PBIP model exposes per-outcome rows (one row per Included OutcomeSummary record with EvalNEW, TableDisch, LibraryItem_ID, VersionName, and cohort dims) in a query-friendly way, the runnable code in this folder stays limited to `attribution.py`. That's by design, not a gap.
