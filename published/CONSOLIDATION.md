# Consolidating `Clinical Outcomes` into `Clinical Outcomes Main`

**Goal:** repoint the `Clinical Outcomes` and `Patient-Level Outcomes` reports at the
`Clinical Outcomes Main` semantic model, so the `Clinical Outcomes` model can be retired.

Scope is those two reports only. `ANA Reponses` and `Ohana Villas Stroke` also sit on the
`Clinical Outcomes` model and must be re-homed before it can actually be deleted.
`SL Outcomes Report` is explicitly **out of scope** — its measures are deliberately
track-grain and it is not a merge candidate.

Generated from the PBIP snapshots in this folder, which were verified identical to the service.

---

## Summary of work

| Item | Count | Nature |
|---|---|---|
| Columns to add to Main | **0** | nothing to do |
| Measures to add to Main | **36** | mechanical, all on `MeasureTable` |
| Collisions, cosmetic | **1** | `Timeframe` — identical once commented-out history is stripped |
| Collisions, one shared cause | **12** | the `[Report Scope]` wrapper — a single decision |
| Collisions, genuinely different | **12** | need individual review |

No table has to be created. All 36 measures to add live on `MeasureTable`, which already
exists in Main, so Part A is a single-file append.

---

## Status (2026-09-15)

**Part A — DONE in the repo, not yet published.** The 36 measures were appended verbatim to
`published/ClinicalOutcomesMain/.../tables/MeasureTable.tmdl` (199 -> 235 measures, 520 lines
inserted, no deletions). Dependencies were checked first: every table, column and measure they
reference already exists in Main. Still needs opening in Desktop and republishing.

**Part B — DECIDED: keep Main's behavior.** Benchmarks showing only when a filter is applied is
intentional, to avoid the "14% vs 14%" problem of comparing a cohort to itself. The 12 gated
measures stay as they are. Expectation to confirm after repointing: on `Patient-Level Outcomes`,
filtering to a single patient should itself narrow the scope enough to trigger benchmarks.

**Part C — TESTED EMPIRICALLY, half of it is a non-issue.** See the findings section below.

---

## Part A — measures to add to Main (36)

28 are the `Boxplot*` percentile family (4 groups x 7 percentiles), used only by
`Patient-Level Outcomes`. Templated; copy verbatim.

The other 8:

### `Cohort Text`

```dax
var AgeRange = IF(ISFILTERED(StayCases[Age Range]), "age range")
var DiagnosticCategory = IF(ISFILTERED(StayCases[Diagnostic Category]), "diagnostic category")
var PayerCategorization = IF(OR(ISFILTERED('Payer Buckets'[Payer Categorization]),ISFILTERED('Payer Buckets'[Payer Grouping])), "payer")
var ValuesTable = FILTER({AgeRange, DiagnosticCategory, PayerCategorization}, NOT(ISBLANK([Value])))
var TableLength = COUNTROWS(ValuesTable)
var ValuesList =
IF(TableLength<3,
CONCATENATEX(ValuesTable,[Value]," and "),
CONCATENATEX(TOPN(TableLength-1,ValuesTable),[Value],", ")&", and "&
CONCATENATEX(TOPN(1,ValuesTable,[Value],DESC),[Value],", ")
)
return
"National cohort of "&FORMAT([Total Cases BM]-1,"#,###")&" similar patients "&
IF(TableLength>0,"based on "&ValuesList)
```

### `Diagnosis Equals Cohort`

```dax
IF(
SELECTEDVALUE(DiagnosisCode[L2])=SELECTEDVALUE(StayCases[Diagnostic Category]),
1,0
)
```

### `Gain AxisHigh`

```dax
var range = [Gain]
var extendedrange = range/.8
var incrementalrange = (extendedrange-range)/2
var calc = MAX([Gain],[Gain BM])+incrementalrange
return IF([Gain]>[Gain BM]-.1,calc,[Gain BM])
```

### `Gain AxisLow`

```dax
var range = [Gain BM]-[Gain]
var extendedrange = range/.8
var incrementalrange = (extendedrange-range)/2
var calc = MIN(0,[Gain])-incrementalrange
return IF([Gain]<0,calc,0)
```

### `Total Disciplines`

```dax
CALCULATE(
DISTINCTCOUNT(Disciplines[Discipline]),
FILTER(
CaseTracks,
[Total Visits]>0
)
)
```

### `Total Outcome Areas`

```dax
CALCULATE(
DISTINCTCOUNT(Dictionary[Name]),
OR(
OutcomeSummary[LibraryItem_ID] IN {7764,7765,7766,7760,7761,7762,7763} && OutcomeSummary[Status] IN {"Included" ,"Started with ANA 88", "No start score"},
NOT(OutcomeSummary[LibraryItem_ID] IN {7764,7765,7766,7760,7761,7762,7763}) && OutcomeSummary[Status] IN {"Included"}
)
)
```

### `Units per Visit`

```dax
IF([Total Cases All Payers]>0,
CALCULATE(
DIVIDE(
[Total Units],
[Total Visits]
),
Disciplines[Discipline] IN {"PT", "OT"}
))
```

### `Visits per Week Delta`

```dax
[Visits per Week]-[Visits per Week BM]
```

<details><summary>The 28 <code>Boxplot*</code> measures</summary>

**`BoxplotALOS_05th`**

```dax
var range = [BoxplotALOS_90th]-[BoxplotALOS_10th]
var extendedrange = range/.8
var incrementalrange = (extendedrange-range)/2
var calc = [BoxplotALOS_10th]-incrementalrange
return calc
```

**`BoxplotALOS_10th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[ALOS],
.1
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotALOS_25th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[ALOS],
.25
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotALOS_50th`**

```dax
CALCULATE(
[ALOS],
BenchmarkTable[BenchmarkSetting] = "Benchmark"
)
```

**`BoxplotALOS_75th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[ALOS],
.75
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotALOS_90th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[ALOS],
.9
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotALOS_95th`**

```dax
var range = [BoxplotALOS_90th]-[BoxplotALOS_10th]
var extendedrange = range/.8
var incrementalrange = (extendedrange-range)/2
var calc = [BoxplotALOS_90th]+incrementalrange
return calc
```

**`BoxplotMinutes_05th`**

```dax
var range = [BoxplotMinutes_90th]-[BoxplotMinutes_10th]
var extendedrange = range/.8
var incrementalrange = (extendedrange-range)/2
var calc = [BoxplotMinutes_10th]-incrementalrange
return calc
```

**`BoxplotMinutes_10th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Minutes per Week],
.1
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotMinutes_25th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Minutes per Week],
.25
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotMinutes_50th`**

```dax
CALCULATE(
[Minutes per Week],
BenchmarkTable[BenchmarkSetting] = "Benchmark"
)
```

**`BoxplotMinutes_75th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Minutes per Week],
.75
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotMinutes_90th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Minutes per Week],
.9
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotMinutes_95th`**

```dax
var range = [BoxplotMinutes_90th]-[BoxplotMinutes_10th]
var extendedrange = range/.8
var incrementalrange = (extendedrange-range)/2
var calc = [BoxplotMinutes_90th]+incrementalrange
return calc
```

**`BoxplotUnitsPerVisit_05th`**

```dax
var range = [BoxplotUnitsPerVisit_90th]-[BoxplotUnitsPerVisit_10th]
var extendedrange = range/.8
var incrementalrange = (extendedrange-range)/2
var calc = [BoxplotUnitsPerVisit_10th]-incrementalrange
return calc
```

**`BoxplotUnitsPerVisit_10th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Units per Visit],
.1
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotUnitsPerVisit_25th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Units per Visit],
.25
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotUnitsPerVisit_50th`**

```dax
CALCULATE(
[Units per Visit],
BenchmarkTable[BenchmarkSetting] = "Benchmark"
)
```

**`BoxplotUnitsPerVisit_75th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Units per Visit],
.75
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotUnitsPerVisit_90th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Units per Visit],
.9
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotUnitsPerVisit_95th`**

```dax
var range = [BoxplotUnitsPerVisit_90th]-[BoxplotUnitsPerVisit_10th]
var extendedrange = range/.8
var incrementalrange = (extendedrange-range)/2
var calc = [BoxplotUnitsPerVisit_90th]+incrementalrange
return calc
```

**`BoxplotVistsPerWeek_05th`**

```dax
var range = [BoxplotVistsPerWeek_90th]-[BoxplotVistsPerWeek_10th]
var extendedrange = range/.8
var incrementalrange = (extendedrange-range)/2
var calc = [BoxplotVistsPerWeek_10th]-incrementalrange
return calc
```

**`BoxplotVistsPerWeek_10th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Visits per Week],
.1
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotVistsPerWeek_25th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Visits per Week],
.25
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotVistsPerWeek_50th`**

```dax
CALCULATE(
[Visits per Week],
BenchmarkTable[BenchmarkSetting] = "Benchmark"
)
```

**`BoxplotVistsPerWeek_75th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Visits per Week],
.75
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotVistsPerWeek_90th`**

```dax
CALCULATE(
PERCENTILEX.INC(
StayCases,
[Visits per Week],
.9
),
ALLSELECTED(StayCases[PatientCase_ID]),
ALL(StayCases[PatientCase_ID]),
ALL(vw_UpnFacilityAccess)
)
```

**`BoxplotVistsPerWeek_95th`**

```dax
var range = [BoxplotVistsPerWeek_90th]-[BoxplotVistsPerWeek_10th]
var extendedrange = range/.8
var incrementalrange = (extendedrange-range)/2
var calc = [BoxplotVistsPerWeek_90th]+incrementalrange
return calc
```

</details>

---

## Part B — the `[Report Scope]` decision (12 measures, one call)

Main defines:

```dax
Report Scope =
IF([Total Facilities]=[Total Facilities BM],"Full","Filtered")
```

and wraps these 12 measures as `IF([Report Scope]="Filtered", <the Clinical version>)`.
Verified mechanically: strip that wrapper and Main matches Clinical exactly. So this is
**one behavioral question, not 12**.

**Effect of repointing as-is:** benchmarks blank out whenever the report is viewed
unfiltered (all facilities), because `Report Scope` evaluates to `"Full"`. The Clinical-model
reports show a benchmark today regardless. This is the most visible change the repoint would
make, and it lands on `Clinical Outcomes` (66 viewers).

Affected: `% Total Cases Improved BM`, `% Total Cases Improved Delta`, `ALOS BM`, `ALOS Delta`, `Admit Level BM`, `DTC BM`, `DTC Delta`, `Discharge Level BM`, `Minutes per Week BM`, `Rehosp BM`, `Rehosp Delta`, `Visits per Week BM`

---

## Part C — genuinely different logic (12, review individually)

### `% Improvement Delta`

**Main:**
```dax
IF([Report Scope]="Filtered",[% Improvement]-[% Improvement BM])
```

**Clinical:**
```dax
TRUNC([% Improvement]-[% Improvement BM],5)
```

### `Admit Level`

**Main:**
```dax
CALCULATE(
AVERAGE(OutcomeSummary[EvalNEW]),
OutcomeSummary[Status]="Included"
)
```

**Clinical:**
```dax
CALCULATE(
AVERAGE(OutcomeSummary[EvalNEW]),
OR(
OutcomeSummary[LibraryItem_ID] IN {7764,7765,7766,7760,7761,7762,7763} && OutcomeSummary[Status] IN {"Included" ,"Started with ANA 88", "No start score"},
NOT(OutcomeSummary[LibraryItem_ID] IN {7764,7765,7766,7760,7761,7762,7763}) && OutcomeSummary[Status] IN {"Included"}
)
)
```

### `Customer Name`

**Main:**
```dax
IF(ISFILTERED(Employees[Person_ID]),SELECTEDVALUE(Employees[Name])&" ("&SELECTEDVALUE(Employees[StaffTitle])&")",
IF(HASONEVALUE(Account[Id]),SELECTEDVALUE(Account[Name])&" ("&SELECTEDVALUE(Account[BillingCity])&", "&SELECTEDVALUE(Account[BillingState])&")",
IF(ISFILTERED(Chain[Name]),SELECTEDVALUE(Chain[Name]),
IF(ISFILTERED(VW_NHAegisFacilities[Region]),"Region "&SELECTEDVALUE(VW_NHAegisFacilities[Region]),
IF(ISFILTERED(VW_NHAegisFacilities[District]),"District "&SELECTEDVALUE(VW_NHAegisFacilities[District]),
IF(ISFILTERED(VW_NHAegisFacilities[Division]),SELECTEDVALUE(VW_NHAegisFacilities[Division]),
IF(ISFILTERED(Account[BillingState]),"State of "&SELECTEDVALUE(Account[BillingState]),
IF(ISFILTERED(Perspectives[UPN]),"Customers of "&SELECTEDVALUE(Perspectives[UPN]),
IF([Total Facilities]=[Total Facilities BM],"Aegis Therapies",
"My Customers"
)))))))))
&IF([Total Facilities]>1," ("&[Total Facilities]&" facilities)")
```

**Clinical:**
```dax
IF(HASONEVALUE(Account[Id]),SELECTEDVALUE(Account[Name])&" ("&SELECTEDVALUE(Account[BillingCity])&", "&SELECTEDVALUE(Account[BillingState])&")",
IF(ISFILTERED(Chain[Name]),SELECTEDVALUE(Chain[Name]),
IF(ISFILTERED(VW_NHAegisFacilities[Region]),"Region "&SELECTEDVALUE(VW_NHAegisFacilities[Region]),
IF(ISFILTERED(VW_NHAegisFacilities[District]),"District "&SELECTEDVALUE(VW_NHAegisFacilities[District]),
IF(ISFILTERED(VW_NHAegisFacilities[Division]),SELECTEDVALUE(VW_NHAegisFacilities[Division]),
IF(ISFILTERED(Account[BillingState]),"State of "&SELECTEDVALUE(Account[BillingState]),
IF([Total Facilities]=[Total Facilities BM],"Aegis Therapies",
"My Customers"
)))))))
&IF([Total Facilities]>1," ("&[Total Facilities]&" facilities)")
```

### `Discharge Level`

**Main:**
```dax
CALCULATE(
AVERAGE(OutcomeSummary[TableDisch]),
OutcomeSummary[Status]="Included"
)
```

**Clinical:**
```dax
CALCULATE(
AVERAGE(OutcomeSummary[TableDisch]),
OR(
OutcomeSummary[LibraryItem_ID] IN {7764,7765,7766,7760,7761,7762,7763} && OutcomeSummary[Status] IN {"Included" ,"Started with ANA 88", "No start score"},
NOT(OutcomeSummary[LibraryItem_ID] IN {7764,7765,7766,7760,7761,7762,7763}) && OutcomeSummary[Status] IN {"Included"}
)
)
```

### `Therapist List`

**Main:**
```dax
CONCATENATEX(
FILTER(VALUES(Treatments[TherapistLabel]),NOT(ISBLANK(Treatments[TherapistLabel]))),
Treatments[TherapistLabel],
", ",
[Total Minutes],
DESC
)
```

**Clinical:**
```dax
IF(HASONEVALUE(StayCases[PatientCase_ID])=FALSE(),BLANK(),
IF(
ISINSCOPE(Service[Type]),
CONCATENATEX(
FILTER(VALUES(Treatments[TherapistLabel]),NOT(ISBLANK(Treatments[TherapistLabel]))),
Treatments[TherapistLabel],
", ",
[Total Minutes],
DESC
)
)
)
```

### `Total Cases BM`

**Main:**
```dax
CALCULATE(
[Total Cases],
BenchmarkTable[BenchmarkSetting]="Benchmark"
)
```

**Clinical:**
```dax
CALCULATE(
[Total Cases],
BenchmarkTable[BenchmarkSetting] = "Benchmark"
)
```

### `Total Days`

**Main:**
```dax
SUM(StayCases[UniqueDays])
```

**Clinical:**
```dax
/*
SUMX (
VALUES(StayCases[PatientCase_ID]),
CALCULATE (
COUNTROWS (
FILTER (
ALL('Calendar'),
COUNTROWS (
FILTER (
CaseTracks,
CaseTracks[PatientCase_ID] = MAX(StayCases[PatientCase_ID])
&& 'Calendar'[Date] >= CaseTracks[StartDate]
&& 'Calendar'[Date] <= CaseTracks[EndDate]
)
) > 0
)
)
)
)
*/
SUM(StayCases[UniqueDays])
```

### `Total Measurements`

**Main:**
```dax
CALCULATE(
[Total Measurements Recorded],
OutcomeSummary[Status]="Included"
)
```

**Clinical:**
```dax
CALCULATE(
COUNTROWS(OutcomeSummary),
OR(
OutcomeSummary[LibraryItem_ID] IN {7764,7765,7766,7760,7761,7762,7763} && OutcomeSummary[Status] IN {"Included" ,"Started with ANA 88", "No start score"},
NOT(OutcomeSummary[LibraryItem_ID] IN {7764,7765,7766,7760,7761,7762,7763}) && OutcomeSummary[Status] IN {"Included"}
)
)
```

### `Total Outcome Areas Subtitle`

**Main:**
```dax
[Total Outcome Areas Unique]&" areas measured"
```

**Clinical:**
```dax
[Total Outcome Areas]&" areas measured"
```

### `Units per Visit BM`

**Main:**
```dax
IF([Report Scope]="Filtered",
CALCULATE(
[Units per Visit (pt/ot)],
BenchmarkTable[BenchmarkSetting] = "Benchmark"
))
```

**Clinical:**
```dax
CALCULATE(
[Units per Visit],
BenchmarkTable[BenchmarkSetting] = "Benchmark"
)
```

### `Units per Visit Delta`

**Main:**
```dax
IF([Report Scope]="Filtered",[Units per Visit (pt/ot)]-[Units per Visit BM])
```

**Clinical:**
```dax
[Units per Visit]-[Units per Visit BM]
```

### `Visits per Week`

**Main:**
```dax
DIVIDE(
[Total Visits],
[Total Days]
)*7
```

**Clinical:**
```dax
AVERAGEX(
StayCases,
DIVIDE(
DIVIDE(
[Total Visits],
[Total Days]
)*7,
[Total Disciplines]
)
)
```

---

## Suggested order

1. **Part A** — append the 36 measures to Main. Purely additive; cannot affect existing reports.
2. **Decide Part B.** If benchmarks should keep showing unfiltered, the wrapper needs
   rethinking *before* repointing, not after.
3. **Work Part C**, deciding per measure which definition wins.
4. **Repoint `Patient-Level Outcomes` first** (29 viewers, touches 10 collisions), then
   `Clinical Outcomes` (66 viewers, 23 collisions).
5. Re-home `ANA Reponses` and `Ohana Villas Stroke`, then retire the Clinical model.

Rebinding is a seconds-long API call and stays reversible while the `Clinical Outcomes` model
exists. Keep it until all four of its reports are verified elsewhere.
---

## Empirical findings on Part C (2026-09-15)

Each Part C measure was evaluated **both ways against the same model** — Main's definition and
Clinical's definition, side by side on Main's data in the service, via
`DEFINE MEASURE ... EVALUATE ROW(...)`. This distinguishes "the formula differs" from "the
answer differs".

### Six are inert — Clinical's extra logic changes nothing

| Measure | Main | Clinical | |
|---|---|---|---|
| `Admit Level` | 0.3835624618313141 | 0.3835624618313139 | float noise |
| `Discharge Level` | 0.6957440596794321 | 0.6957440596794318 | float noise |
| `Total Measurements` | 1,622,785 | 1,622,785 | identical |
| `Total Cases BM` | 153,096 | 153,096 | identical |
| `Total Days` | 15,632,664 | 15,632,664 | identical |
| `Customer Name` | same string | same string | identical |

**Why**, for the first three: Clinical guards on
`OutcomeSummary[Status] IN {"Included","Started with ANA 88","No start score"}`. In the current
data `Status` only ever takes two values:

| Status | Rows |
|---|---|
| Included | 1,622,785 |
| Excluded | 1,393,915 |

`"Started with ANA 88"` and `"No start score"` **do not occur at all**. The extra clauses are
dead code left from an older `OutcomeSummary` structure. Main's simpler versions are equivalent
*and* cleaner — no backfill needed, and nothing was lost when the clauses were dropped.

Caveat: this is an argument from current data, not from the model. If those status values ever
reappear upstream, Main and Clinical would diverge. Worth a note wherever `Status` is populated.

### Six are real differences

- **`Visits per Week`** — the substantive one. Main is `DIVIDE([Total Visits],[Total Days])*7`,
  an aggregate rate. Clinical is
  `AVERAGEX(StayCases, DIVIDE(DIVIDE([Total Visits],[Total Days])*7, [Total Disciplines]))`,
  a per-case average divided by discipline count. These are different metrics, not different
  spellings of one. Decide which the reports should show.
- **`Units per Visit BM`** and **`Units per Visit Delta`** — Main calls
  `[Units per Visit (pt/ot)]` where Clinical calls `[Units per Visit]`. Main narrowed the
  metric to PT/OT. A real scope change, plus the Part B wrapper.
- **`Total Outcome Areas Subtitle`** — Main references `[Total Outcome Areas Unique]`,
  Clinical `[Total Outcome Areas]`. A rename, once Part A lands both exist; pick one.
- **`Therapist List`** — Clinical wraps the concatenation in
  `IF(HASONEVALUE(StayCases[PatientCase_ID])=FALSE(), BLANK(), IF(ISINSCOPE(Service[Type]), ...))`.
  Main has no guard, so at low grain it would concatenate every therapist. Clinical's guard
  looks like the better behavior and is probably worth porting *into* Main.
- **`% Improvement Delta`** — two differences at once: Main's Part B gating, and Clinical's
  `TRUNC(...,5)`. The truncation is the only piece not covered by the Part B decision.

### Net effect on the job

Of the 25 name collisions: 1 cosmetic, 12 resolved by the Part B decision, **6 proven inert**,
leaving **6 genuine calls** — and only `Visits per Week` is a real methodology question.

---

## Part C resolved (2026-09-15)

Each hypothesis was checked against the definitions and the data. Result: **only one item
needs work, and it is in the reports, not the model.**

### `Visits per Week` — the measure was SPLIT in Main, and this is a trap

Main's `Total Disciplines Unique` is **byte-identical** to Clinical's `Total Disciplines`, and
Main's `[Visits per Week]` is exactly Clinical's inner expression. Substituting:

| | Definition |
|---|---|
| Main `Visits per Week` | `DIVIDE([Total Visits],[Total Days])*7` — an aggregate rate |
| Main `Visits per Discipline per Week` | `AVERAGEX(StayCases, DIVIDE([Visits per Week],[Total Disciplines Unique]))` |
| Clinical `Visits per Week` | `AVERAGEX(StayCases, DIVIDE(DIVIDE([Total Visits],[Total Days])*7,[Total Disciplines]))` |

So **Clinical's `Visits per Week` IS Main's `Visits per Discipline per Week`.** Main split one
measure into two; Clinical's single name carries the per-discipline meaning.

**The trap:** `Visits per Week` is referenced by both `Clinical Outcomes` and
`Patient-Level Outcomes`. Repoint without remapping and those visuals silently switch from
per-discipline to aggregate — inflated by roughly the average discipline count (~1.94). No
error, no broken visual, just wrong numbers.

**Action, in the reports not the model:** remap `Visits per Week` -> `Visits per Discipline per
Week` (and the matching `BM` / `Delta` variants, which Main also has) in those two reports.

### Everything else resolved to no model change

- **`Units per Visit`** — both versions filter `Disciplines[Discipline] IN {"PT","OT"}` *inside
  the measure*; the visual-level-filter theory doesn't hold, but the conclusion does. The only
  difference is Clinical's `IF([Total Cases All Payers]>0, ...)` zero guard. Pure rename to make
  the PT/OT scope explicit. Pile A already added `Units per Visit`, so the reports resolve.
- **`Total Outcome Areas Subtitle`** — Main's `Total Outcome Areas Unique` is
  `Status="Included"`; Clinical's `Total Outcome Areas` is the same plus the dead ANA-88 clause.
  Equivalent on current data. Note: neither counts excluded rows, so whatever the Data Quality
  tab uses to count all measures, it is not one of these two. Both names now exist in Main and
  are in active use by different reports (`Total Outcome Areas` by Clinical Outcomes and Ohana,
  `Total Outcome Areas Unique` by SL), so keep both.
- **`% Improvement Delta`** — Main's version already has no `TRUNC`. Keeping Main's *is* the
  decision to drop the truncation. No change needed.
- **`Therapist List`** — **DONE.** Main had the guarded form commented out and the unguarded
  form live. Restored the guard (old version kept as a comment). Safe: only
  `Patient-Level Outcomes` references this measure, and no report on Main uses it.

### Redundancy introduced by Pile A, worth a later tidy

Pile A added `Total Disciplines`, which is byte-identical to Main's existing
`Total Disciplines Unique`. Harmless, but two names for one thing. Either drop it and remap
`Patient-Level Outcomes` to `Total Disciplines Unique`, or leave it. Same pattern for
`Units per Visit` vs `Units per Visit (pt/ot)` and `Total Outcome Areas` vs
`Total Outcome Areas Unique`.

---

## Option B adopted; Pile A revised to 30 measures (2026-09-15)

### Why Pile A changed

Pushing the original 36-measure Pile A **failed**, caught in a sandbox rehearsal before it
reached production:

> Failed to add a deserialized Measure object - name: `'Gain AxisHigh'` - An object with
> lineage-tag `1d70399f-...` already exists in the collection.

The measures were copied from Clinical verbatim, lineage tags included, and six of those tags
already exist in Main under **different names**. Shared lineage tags are proof these are the
same objects renamed, not coincidence — Main systematically renamed measures to be more precise
and Clinical kept the old names.

| Old name (Clinical) | Main's renamed version | Same DAX? |
|---|---|---|
| `Gain AxisHigh` | `% Improvement AxisHigh` | identical |
| `Gain AxisLow` | `% Improvement AxisLow` | identical |
| `Total Disciplines` | `Total Disciplines Unique` | identical |
| `Total Outcome Areas` | `Total Outcome Areas Unique` | differs only by the dead ANA-88 clause |
| `Units per Visit` | `Units per Visit (pt/ot)` | differs only by a zero guard |
| `Visits per Week Delta` | `Visits per Discipline per Week Delta` | different — grain + Report Scope |

**Option B chosen:** drop those 6 from Pile A and point the reports at Main's existing,
better-named measures, rather than carrying two names for one thing.

**Pile A is now 30 measures** (28 `Boxplot*` + `Cohort Text` + `Diagnosis Equals Cohort`).
Model goes 325 -> 355 measures. Duplicate lineage tags: 0.

### Verified by rehearsal, not by assumption

The whole operation was rehearsed in **KM Sandbox**, which sits on the same Pro/shared capacity
as Clinical Outcomes (`isOnDedicatedCapacity=False`, no capacity id):

1. `createItem` from the current service definition — **Succeeded**
2. `updateDefinition` with the Option B payload — **Succeeded**
3. Read back: **355 measures**, all 30 additions present, all 6 duplicates absent
4. Scratch model deleted

This also settles the capacity question: **the Fabric item-definition APIs work on this
non-Fabric workspace.** No Power BI Desktop round-trip is required to publish.

Payload excludes Desktop-only working files that are not part of the service definition:
`DAXQueries/`, `TMDLScripts/`, `diagramLayout.json`, `.pbi/`. 115 parts.

### Report remap required BEFORE repointing

These are field references inside the reports. Repointing without them yields no error — just
wrong numbers, because `Visits per Week` means per-discipline in Clinical and aggregate in Main.

**`Clinical Outcomes`** (5 fields)

| From | To |
|---|---|
| `Total Outcome Areas` | `Total Outcome Areas Unique` |
| `Units per Visit` | `Units per Visit (pt/ot)` |
| `Visits per Week` | `Visits per Discipline per Week` |
| `Visits per Week BM` | `Visits per Discipline per Week BM` |
| `Visits per Week Delta` | `Visits per Discipline per Week Delta` |

**`Patient-Level Outcomes`** (5 fields)

| From | To |
|---|---|
| `Gain AxisHigh` | `% Improvement AxisHigh` |
| `Gain AxisLow` | `% Improvement AxisLow` |
| `Total Disciplines` | `Total Disciplines Unique` |
| `Units per Visit` | `Units per Visit (pt/ot)` |
| `Visits per Week` | `Visits per Discipline per Week` |

**Later, when re-homing:** `Ohana Villas Stroke` needs `Total Outcome Areas` ->
`Total Outcome Areas Unique`. `ANA Reponses` needs nothing.

Every target measure was confirmed to exist in Main.

> **2026-09-15 UPDATE: the repoint is BLOCKED.** Validating it uncovered a defect in
> `Clinical Outcomes Main` that inflates `Total Days` 2.7x and `ALOS` from ~38 to ~102 days.
> See `UNIQUEDAYS-DEFECT.md`. It also invalidates the "six Pile C measures are inert" finding
> below, which was tested against a single model and therefore only proved formula equivalence.

---

## Gain Axis correction (2026-09-15)

Option B mapped `Gain AxisHigh`/`AxisLow` to `% Improvement AxisHigh`/`AxisLow` on the strength
of a shared lineage tag. **That was wrong.** Tested against live data the two returned 0.330 vs
0.815 — `Gain` is an absolute measure and `% Improvement` a relative one. A shared lineage tag
proves shared ancestry, not equivalence; the values have to be checked.

Corrected: those two are now **added** to Main as new measures with fresh lineage tags (Pile A
is 32, model 325 -> 357), and the two remap entries were reverted in the staged report.

### All five remaps verified under ReliableScope

| From (Clinical) | To (Main) | Clinical | Main | |
|---|---|---|---|---|
| `Gain AxisHigh` | `Gain AxisHigh` | 0.33007 | 0.32806 | freshness |
| `Gain AxisLow` | `Gain AxisLow` | 0 | 0 | match |
| `Total Disciplines` | `Total Disciplines Unique` | 3 | 3 | match |
| `Units per Visit` | `Units per Visit (pt/ot)` | 2.757623 | 2.757623 | match |
| `Visits per Week` | `Visits per Discipline per Week` | 3.577854 | 3.577814 | match |

The residual `Gain AxisHigh` gap traces to `[Gain]` itself differing 0.112% between the models
(0.29193 vs 0.29161) — the two refresh 9.5 hours apart — amplified by the axis formula, plus
`[Gain BM]` returning blank on Main under the intended `[Report Scope]` gating. `Total Cases` is
identical at 115,183. No logic mismatch remains.
