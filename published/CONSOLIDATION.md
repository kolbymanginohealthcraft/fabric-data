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