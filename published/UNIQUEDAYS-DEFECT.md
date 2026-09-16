# Defect: `StayCases[UniqueDays]` is inflated in `Clinical Outcomes Main`

**Found 2026-09-15 while validating the Clinical -> Main consolidation. Not yet fixed.**

`ALOS` reads **102.1 days** on the `Clinical Outcomes Main` model and **38.1 days** on the
`Clinical Outcomes` model, for the same 153,096 cases. Main is wrong.

This is live. `Clinical Outcomes Semantic` (133 viewers, the app's most-used report) runs on
Main and shows the inflated figure today.

## The two definitions

Both models define `Total Days` as `SUM(StayCases[UniqueDays])` and `ALOS` as
`DIVIDE([Total Days],[Total Cases])` — **identical DAX**. The divergence is entirely in the
`UniqueDays` calculated column.

**`Clinical Outcomes` (sound):**

```dax
CALCULATE(
    COUNTROWS(
        FILTER(
            ALL('Calendar'),
            COUNTROWS(
                FILTER(
                    CaseTracks,
                    CaseTracks[PatientCase_ID] = SELECTEDVALUE(StayCases[PatientCase_ID])
                    && 'Calendar'[Date] >= CaseTracks[StartDate]
                    && 'Calendar'[Date] <= CaseTracks[EndDate]
                )
            ) > 0
        )
    )
)
```

Counts calendar dates falling inside the case's own track spans. Self-scoping — the case id is
matched explicitly.

**`Clinical Outcomes Main` (defective):**

```dax
CALCULATE(DISTINCTCOUNT(CaseTrackDays[TrackDate]))
```

Relies on filter context reaching `CaseTrackDays` through
`StayCases -> CaseTracks -> CaseTrackDays`. The last hop is an **auto-detected**,
bidirectional relationship on `TxTrack_ID`. When that propagation does not constrain the case,
the `DISTINCTCOUNT` widens beyond the case.

## Evidence

| | Clinical | Main |
|---|---|---|
| `StayCases` rows | 157,436 | 157,436 |
| `SUM(UniqueDays)` | 5,826,667 | **15,632,664** |
| `AVERAGE(UniqueDays)` | 43.7 | **102.1** |
| `MAX(UniqueDays)` | 2,057 | **7,792** |
| Avg therapy span (independent reference) | 38.84 | 38.84 |
| Max therapy span | 6,947 | 6,947 |

Three things convict Main:

1. **The therapy span is identical in both models** (38.84 avg, 6,947 max), so the underlying
   case data agrees. Only the derived column differs.
2. **Main's max `UniqueDays` (7,792) exactly equals `DISTINCTCOUNT(CaseTrackDays[TrackDate])`
   over the whole table (7,792).** For at least one case the filter collapses entirely and it
   counts every date in a 2005-05-17 to 2026-09-15 range.
3. **24,533 of 157,436 cases (15.6%) have `UniqueDays` greater than their own therapy span** —
   logically impossible. A case cannot have more treatment days than calendar days in its
   therapy window.

Clinical's 43.7 average sits just above the 38.84 therapy span, which is what you would expect
when track spans extend slightly past the therapy dates. Main's 102.1 is 2.6x the span.

## Blast radius

**46 objects** in Main depend on `[Total Days]` or `[ALOS]`, including:

- `ALOS`, `ALOS BM`, `ALOS Delta`, `Gain per Day`, `_Correlation - ALOS to Gain`
- `Minutes per Week`, `Minutes per Discipline per Week`, `Visits per Week`,
  `Visits per Discipline per Week`
- every `BoxplotALOS_*` percentile and the `Boxplot_p*` family
- the `StayCases` bucketing columns: `Range: LOS`, `Range: Minutes per Week`,
  `Range: Visits per Week`, `Range: PRN Utilization`, `Uses: *`, and `Analysis Eligible`

`Analysis Eligible` is the concerning one — a defective LOS can change which cases are
considered eligible at all.

## Recommended fix

Replace Main's `UniqueDays` with the Clinical definition, which is explicitly case-scoped and
does not depend on relationship propagation. If the `CaseTrackDays` approach is preferred for
performance, it needs an explicit case filter rather than relying on the auto-detected
bidirectional relationship.

Either way this is a **calculated column**, so the model must be refreshed after the change,
and `ALOS` on `Clinical Outcomes Semantic` will drop from ~102 to ~38 days. That is a large,
visible correction on the app's most-viewed report and should be communicated, not slipped in.

## Consequence for the consolidation

The Clinical -> Main repoint is **blocked** until this is resolved. The measure remap staged in
`ClinicalOutcomesMain/Patient-Level Outcomes.Report` is correct as far as measure *names* go,
but repointing now would carry the inflated `Total Days` into reports that currently show the
sound figure.

It also invalidates the earlier "six Pile C measures are inert" finding in `CONSOLIDATION.md`.
That test evaluated both formulas against a single model, which establishes formula equivalence
only. Evaluated against their own models, most core measures disagree — `Total Days` most of
all. Any future equivalence claim must compare each model on its own data.
