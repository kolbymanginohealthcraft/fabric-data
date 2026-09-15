# `published/` — snapshots of what is LIVE in the Clinical Outcomes workspace

These are PBIP exports of the three semantic models (and their reports) currently
published to the **Clinical Outcomes** Power BI workspace
(`5f4d44ed-7a93-4ca3-961c-d57038f7421d`).

**This folder is a mirror of production, not a build target.** Do not confuse it with
`ClinicalOutcomes/` at the repo root, which is the *rebuild* lineage (Fabric-native,
Salesforce-free). The two have diverged deliberately — keeping them visibly separate is the
point of this folder.

| Folder | Service semantic model | Drives |
|---|---|---|
| `ClinicalOutcomes/` | `Clinical Outcomes` (`e9a7f4e0`) | Clinical Outcomes, Patient-Level Outcomes, ANA Reponses, Ohana Villas Stroke |
| `ClinicalOutcomesMain/` | `Clinical Outcomes Main` (`cf59a121`) | Clinical Outcomes Semantic, Total Care Through Transitions |
| `SLOutcomesReport/` | `SL Outcomes Report` (`ad568020`) | SL Outcomes Report |

## Provenance

Exported 2026-09-15 and verified table-for-table and measure-for-measure against the live
service definitions (`getDefinition?format=TMDL`) at time of import:

| Model | Tables | Measures | Verified |
|---|---|---|---|
| Clinical Outcomes Main | 108 | 325 | identical to service |
| Clinical Outcomes | 63 | 162 | identical to service |
| SL Outcomes Report | 97 | 315 | identical to service |

Table counts include Power BI auto-date tables (`LocalDateTable_*`, `DateTableTemplate_*`).
Main has 77 real tables once those are excluded.

## Why this exists

Before this snapshot these three models existed **only in the service**. An edit made in the
browser left no diff, no history and no recovery path. Tracking them here ends that, and turns
model-comparison questions into `git diff` instead of ad-hoc API archaeology.

## Known state (2026-09-15)

- **Main is a near-superset of Clinical Outcomes.** No report on the Clinical Outcomes model
  references a table Main lacks. The gap is ~38 fields, 28 of which are the `Boxplot*`
  percentile family.
- **47 measures share a name across models but carry different DAX** (34 Clinical-vs-Main,
  13 SL-vs-Main). These are the real obstacle to consolidation, not the missing fields.
- **SL's 13 differences are deliberate**, not drift: they re-point case grain to **track grain**
  (`Total Cases` returns `[Total Tracks]`, `% Total Cases Improved` runs on `CaseTracks`,
  `Total Patients` gates on `[Total Measurements]>0`). SL is not a merge candidate.
- **Main gates 20 of its 25 `* BM` measures** on `IF([Report Scope]="Filtered", …)`, where
  `Report Scope = IF([Total Facilities]=[Total Facilities BM],"Full","Filtered")`. Clinical has
  no such concept and always returns a benchmark. Repointing a Clinical-model report at Main
  will blank benchmarks at the unfiltered company-wide level.
- `SurveyData` in the SL model is **never referenced** by the SL report — dead weight.

## Conventions

- `.pbi/` (local caches and per-user settings) and `*.pbix` are git-ignored repo-wide.
- Inner folder names keep their Power BI spelling, spaces included, because the `.pbip`
  files reference them by relative path. Don't rename them.
