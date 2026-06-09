# PatientJourney model — scoping sketch

**Status:** Stage 1 BUILT + Desktop-verified (commit 0b2de98). Stage 1.5 (leanness strip) pending.
**Date:** 2026-06-09. Model name = **`PatientTimeline.SemanticModel`** (not "PatientJourney").
**Context:** the `TimelineReport` needs a fundamentally different population than the
`ClinicalOutcomes.SemanticModel` provides. This documents why, and sketches a separate
purpose-built model for it.

## BUILD STATUS

**Decisions (locked 2026-06-09):** scope = patients with any Stay active in ~2yr; visit detail
= PER-VISIT + all PLOS touches (user wants every service touch visible); RLS = reuse facility
UPN security; keep DX_Cases; Import.

**Stage 1 DONE (0b2de98, verified):** copied ClinicalOutcomes.SemanticModel → PatientTimeline
(distinct .platform identity), re-anchored: `CohortAnchorDate` 365→730; NEW
`_QualifyingPatientIdsSql` (Stay active in window); `_QualifyingCaseIdsSql` redefined = cases of
qualifying patients (incl open); `_QualifyingStays` + `Patients` → patient-anchor; Timeline
display cutoff 12→24mo. TimelineReport repointed. ALL 57 tables still present (refreshable);
inclusive population confirmed (never-therapy + in-progress patients appear).

**Stage 1.5 (PENDING) — leanness strip. CORRECTED keep-set after a dependency sweep:**
A naive strip BREAKS the report. The report's full field surface (verified via JSON walk) needs
more than the bases+dims+Timeline. DO NOT bulk-purge measures.
- **KEEP these tables that look outcome-y but the report transitively needs:**
  `EDD` + `ExpectedDischargeDestination` (→ `StayCases[Expected Discharge Destination]`, used by
  report + ActiveFilters), and **`PatientScreens`** (→ `ServiceTypes[Patients Touched]` Screens
  lane — central to the "how often we touch the patient" purpose). So true KEEP ≈ 29 tables.
- **KEEP these measures (the report binds them) — restore if purged, rewriting to drop stripped
  deps:** `Calendar[Report Date]`, `Patients[Avg Age]` + `Patients[Patient Name for Title]`,
  `ServiceTypes[Patients Touched]` (deps all kept once PatientScreens stays), `Facility[Customer
  Name]` (REWRITE — drop the Employees therapist clause + `[Total Facilities]` clauses), and
  `MeasureTable` needs FIVE: `ActiveFilters: All / D/C Status / Override / Patient` + `Benchmark
  Subtitle`. REWRITE `ActiveFilters: Override` (drop `[Total Cases]`/`[Total Cases BM]`) and stub
  `Benchmark Subtitle` (no benchmark in this model).
- **STILL STRIP (~28):** OutcomeSummary, Assessments, Outcomes Crosswalk/Custom Scales, Dictionary,
  Outcome Families, ShowScales, LibraryItem, BenchmarkTable, Unit of Analysis, Time Basis, Basis,
  Service Columns/Columns BM/Rows, PriorLivingEnvironment, PLE, Employees, FTEType, Peer Group,
  Physician, DischargeReason, Telehealth, CaseTrackDays, Diagnosis Hierarchy, Calendar Parameter,
  DestinationPage, Outcomes Breakdown.
- **DANGLING calc columns to remove from kept tables:** CaseTracks (Evaluating Therapist,
  Evaluation Method, Evaluating Therapist FTE Type, Admit Level: Walk 10 ft, Admit Level: Gait
  Speed, Track Result), StayCases (Prior Living Environment + Granular, the CaseTrackDays-ref col,
  the Dictionary-ref cols), Treatments (the Employees-ref TherapistLabel col).
- **LESSON:** the report leans on measures spread across Facility/ServiceTypes/Patients/Calendar/
  MeasureTable — purge SELECTIVELY (only measures referencing stripped tables, then restore/rewrite
  the report-bound ones), and KEEP the EDD chain + PatientScreens. Then DAX-ref sweep for any
  residual reference to a stripped table before committing.

## Why a separate model

The `ClinicalOutcomes.SemanticModel` is a **completed-outcomes cohort** model. Its spine is
`PatientCase`, and every base table's SQL is gated by `_QualifyingCaseIdsSql`
(`case OR track EndDate >= today-365`). That filter is the model's defining population *and*
its anti-bloat mechanism. It is import-time, baked into the table SQL — it cannot be relaxed
per-report.

The `TimelineReport` is a different **product** — care-journey analytics across payers, places
of residence, and therapy involvement. It needs the *opposite* population:

- patients who **never did therapy** with us (not reachable via `PatientCase` at all — a
  different spine root: `Resident`/`Stay`),
- patients **currently on caseload** (open, no recently-ended track),
- **full longitudinal history**, not a 12-month completion window.

You cannot have `Patients` be both "cohort-only" (for lean, correct outcomes) and
"everyone, all-time" (for the journey) in one import model without either breaking outcomes
leanness or carrying two contradictory `Patients` tables. The facts barely overlap either:
journey = event **spans** (admissions, payer spans, residence, therapy episodes) at
patient-journey grain; outcomes = completed **measurements**/Gain at case-track grain.

**Decision:** give the journey its own model. The "one model" consolidation goal was about the
outcomes *family* (Outcomes / Senior Living / Stroke / Patient Detail) sharing exploration and
measures — which it does. Timeline was always the odd one out.

## What the current Timeline already defines

The `Timeline` calculated table in the outcomes model is a `UNION` of events — **8 event types
across 7 lanes**. Keep this structure verbatim; just feed it from unscoped bases:

| Lane group | EventType(s) | Source today (cohort-scoped) |
|---|---|---|
| 02 Residence | Residence | `PatientStays` → `IntakeSources` |
| 03 Payer | Payer | `vw_PatientPayers` |
| 04 Stay | Stay | `PatientStays` |
| 05 Case / Discharge | Case, Discharge | `StayCases` → `DischargeDestination` |
| 06 Track | Track | `CaseTracks` |
| 07 PLOS | PLOS (Nursing Restorative, Rehab Tech, Screens, Wellness) | `PatientLevelOptionalServices_*` |
| (visits) | Visit | Treatments |

## Table plan — reuse vs. rebuild vs. omit

### Reuse as-is (copy the now-clean M, no change)
- `Facility` (collapsed/cleaned dim)
- `Payers`, `Payer Buckets`
- `DischargeDestination` (incl. the "Unknown" member)
- `IntakeSources`, `ServiceTypes`
- `Calendar` (consider widening the date range)

### Rebuild UNSCOPED (same M, drop the `IN _QualifyingCaseIdsSql` clause; re-anchor on Resident/Stay)
- `Patients` — all residents active in window (drop the cohort subquery)
- `PatientStays` — all stays/admissions
- `StayCases` — all cases incl. open (null end date)
- `CaseTracks` — all tracks incl. in-progress
- `vw_PatientPayers` — full payer-span history
- Visits + PLOS — all (see granularity decision below)

### New / re-pointed
- `Timeline` — the calculated `UNION` span table, repointed to the unscoped bases. Core deliverable.
- A new **activity-based anchor** expression (replaces completion-based `_QualifyingCaseIdsSql`).

### Omit entirely (no outcomes machinery applies)
`OutcomeSummary`, `Assessments`, `Outcomes Crosswalk`/`Custom Scales`, `Dictionary`,
`Outcome Families`, `ShowScales`, `Documents`, `Diagnosis`/`DiagnosisCode`, `BenchmarkTable`,
`Unit of Analysis`, `Time Basis`, `Service`/`Basis`/`Service Columns`/`Service Rows`, EDD/PLE,
the entire Employee/eval cluster.

**Net:** ~12–15 tables vs. the outcomes model's 57. Duplication is only the ~6 reused dims
(cheap copy-paste M).

## Counter-intuitive upside on size

Even though it has *more patients* (inclusive), it **drops the heaviest tables**
(`OutcomeSummary` = one row per measurement, `Assessments`, `TreatmentsDetails`, `Diagnosis`
lines). Journey events are coarse — one row per stay / case / track / payer-span. It may be
**lighter** than the outcomes model, not heavier.

## What the report binds to (confirmed)

`TimelineReport` (Timeline Patient + Timeline Aggregate) references: `Timeline`, `Patients`,
`StayCases`, `Facility`, `Payers`, `Payer Buckets`, `DischargeDestination`, `IntakeSources`,
`ServiceTypes`, `Calendar`, `DX_Cases`, `MeasureTable`. All are either reused dims or
rebuilt-unscoped bases — no outcomes-only tables, confirming the clean split. (`DX_Cases` is
the one cohort-derived table it touches — decision below.)

## Open decisions (resolve before building)

1. **Scope window** — all-time vs. "any activity (stay/case/payer/therapy) in last N years."
   *Recommend:* activity-windowed (~2–3 yr) — inclusive of never-therapy / in-progress without
   unbounded history.
2. **Visit lane granularity** — per-visit rows (heavy) vs. aggregated span/count per track.
   *Recommend:* aggregated unless every visit must be dotted on the timeline.
3. **`DX_Cases` on the timeline** — keep diagnosis context (rebuild unscoped) or drop from the
   journey?
4. **RLS** — reuse the `vw_UpnFacilityAccess` + `ContextTable` facility-security pattern?
   (Journey is patient-level, so probably yes.)
5. **Import vs. composite/DirectQuery** — start Import (simplest); revisit only if volume bites.
6. **Model name** — `PatientJourney`, `CareJourney`, `Timeline`?

## Effort

A single focused build session reaches a verifiable draft: scaffold the model, copy the 6 dims,
rebuild ~6 bases unscoped (mostly deleting a WHERE clause), repoint the `Timeline` calc table,
point `TimelineReport` at the new model, then Desktop-verify the refresh. Trickiest piece: the
activity-anchor SQL and confirming the `Timeline` `UNION` holds up for open / never-therapy
patients.

## Net architectural effect

Refines the migration plan cleanly: **outcomes family = one shared model; care-journey = its
own model.** Two purpose-built datasets instead of one compromised one.
