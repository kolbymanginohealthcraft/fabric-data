# `published/` — snapshots of what is LIVE in the Power BI service

PBIP exports of the semantic models (and their reports) currently published to the
**Clinical Outcomes** workspace (`5f4d44ed-7a93-4ca3-961c-d57038f7421d`) and the
**Patient Satisfaction Survey** workspace (`e3358290-a29b-48c3-9dea-d694da8407ae`).

**This folder is a mirror of production, not a build target.** Do not confuse it with
`ClinicalOutcomes/` or `PatientSatisfaction/` at the repo root, which are the *rebuild*
lineages (Fabric-native, Salesforce-free). The two have diverged deliberately — keeping
them visibly separate is the point of this folder.

| Folder | Service semantic model | Workspace | Drives |
|---|---|---|---|
| `ClinicalOutcomesMain/` | `Clinical Outcomes Main` (`cf59a121`) | Clinical Outcomes | Clinical Outcomes, Clinical Outcomes Semantic, Patient-Level Outcomes, ANA Reponses, Ohana Villas Stroke, Total Care Through Transitions |
| `SLOutcomesReport/` | `SL Outcomes Report` (`ad568020`) | Clinical Outcomes | SL Outcomes Report |
| `PatientSatisfactionReport/` | `Patient Satisfaction Report` (`db3c5ab9`) | Patient Satisfaction Survey | Patient Satisfaction Report, Patient Satisfaction Report - Ohana |

## Retired

**`Clinical Outcomes` (`e9a7f4e0`) was deleted from the service on 2026-09-16, and its
`ClinicalOutcomes/` folder removed from this mirror.** The consolidation repointed every report
onto `Clinical Outcomes Main`, leaving it with zero consumers (verified: 0 reports across all 78
visible workspaces, 0 dashboards, and all 5 app reports resolving to Main or SL) while it kept
running a scheduled refresh at 05:00 daily for nothing.

Nine measures existed only in the retired model and were deliberately not ported, because no live
report referenced any of them. Six were superseded by better-named equivalents in Main
(`Total Disciplines Unique`, `Total Outcome Areas Unique`, `Units per Visit BM`/`Delta`,
`Visits per Week`/`BM`, `Total Track Days (Test)`). Three had no analog and were a retired
experiment: `Total Cases Reported Pain`, `% Total Cases Reported Pain`, and
`Number of Primary Medical Diagnoses`. Main carries richer pain logic regardless
(`Admit Level (Pain)`, `Discharge Level (Pain)`, `% Improvement (Pain)`, `Gain (Pain)`).
All of it remains recoverable from git at `c47d90a`.

## Provenance

Exported 2026-09-15 and verified table-for-table and measure-for-measure against the live
service definitions (`getDefinition?format=TMDL`) at time of import:

| Model | Tables | Measures | Verified |
|---|---|---|---|
| Clinical Outcomes Main | 109 | 356 | identical to service |
| SL Outcomes Report | 97 | 315 | identical to service |
| Patient Satisfaction Report | 22 | 62 | identical to service (after one fix, below) |

Table counts include Power BI auto-date tables (`LocalDateTable_*`, `DateTableTemplate_*`).
Main has 77 real tables once those are excluded.

### One edit was made to the Patient Satisfaction export

The Desktop export was missing a measure that exists in the service:

```tmdl
measure 'Current User' = USERPRINCIPALNAME()    -- on ContextTable
```

It is referenced by no visual in the report, so it is almost certainly a diagnostic left
from testing the UPN soft-RLS. It was **added to the local copy** so the snapshot is a true
mirror — without it, republishing this PBIP would silently delete the measure from the
service. This is the only place `published/` deviates from what came out of Desktop.

### The Ohana report was taken from the service, not from Desktop

`Patient Satisfaction Report - Ohana` is a second report on the **same** model. Its folder
here was pulled directly from the service via `getDefinition`, not exported from Desktop,
because the local Desktop copy had diverged badly:

| | Local Desktop copy | Service (what is live) |
|---|---|---|
| Model | its own embedded one | the shared `Patient Satisfaction Report` model |
| Tables | 19 | 22 |
| Measures | 27 | 62 |
| Pages | `Main`, `Comments` | `Summary`, `Comments` |

The local copy was missing 35 measures the service has, including the whole Advocacy Score
and NPS families, and still carried `Aegis Area` / `Aegis District` / `Aegis Region` — the
retired Salesforce hierarchy, which is why refreshing it fails. It contained **zero** measures
the service does not have, so nothing was lost by not using it.

`definition.pbir` was rewritten from `byConnection` to `byPath` so it binds to the local
copy of the shared model, matching how the primary report's project is laid out.

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
