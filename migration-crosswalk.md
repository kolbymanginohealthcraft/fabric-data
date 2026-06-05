# Migration Crosswalk — Legacy Sources → Fabric Lakehouses

Maps every legacy ClinicalOutcomes table (and its data origin) to the canonical
Fabric lakehouse table that the **NewModel** should ultimately bind to.

**Lakehouse host:** `aegisdataprod` (Fabric warehouse endpoint
`asot7hu5ofuezkzklqea75om6i-7etkehckn7cejnmv5wbgoctzfe.datawarehouse.fabric.microsoft.com`)

## Important caveat (from Scott, 2026-04-28)

> "I've done some more work. I'm not ready yet for you to start using it quite
> yet. I learned what I setup was kind of a band-aid on what we use to do. I'm
> creating new data sets to build our reports on… I plan on not keeping the
> stuff below around long."

Scott's current Fabric tables are **interim**. He is rebuilding the core data
pipeline (starting with employee info, facility info, hierarchy), and the
destinations below will change. Confirmed staleness on the interim tables:

| Table | Stopped receiving data |
|---|---|
| `BINetHealthPatientLakehouse.DailyInfo.Treatments` | 2026-02-26 |
| `BINetHealthPatientLakehouse.PatientInfo.TxSession` | 2026-03-30 |

Continue using these sources for now; expect rebinding when Scott's new
datasets land. Provide him as much detail as possible about what each report
actually consumes so he can shape the new datasets correctly.

---

## Workspace GUIDs (legacy dataflows)

The legacy ClinicalOutcomes model and the four `current_reports/` models
reference these dataflow workspaces. Friendly names not stored in TMDL —
listed only as inferred from table usage.

| `workspaceId` | Inferred role |
|---|---|
| `58ac0bf7-44e5-4241-a12e-4c6f42ba8a78` | Data – Net Health – General |
| `85b4966e-36ff-4433-990a-06a46dbbba67` | Data – Net Health – Patient |
| `0ad806a7-7698-4083-ba4f-c42c5aa91ecc` | Patient (Patients dataflow) |
| `538303cf-865c-4aae-b405-89ef5e1991aa` | Security / UPN |
| `60c237c9-bec9-41af-bf9e-6afa43a264e9` | Used by current_reports models only |
| `db9e762e-b1da-4705-8c3b-315fa4c4647c` | Used by current_reports models only |

---

## Lane A — Legacy dataflow → Fabric lakehouse

Tables whose legacy partition reads `PowerPlatform.Dataflows(null)`. These
must be rebound to direct lakehouse SQL in the NewModel.

| Legacy table | Dataflow entity | Fabric destination | Refresh |
|---|---|---|---|
| Employees | `Employees` | `BINetHealthGeneralLakehouse.Employees.Employees` | Live |
| EmployeeBasicInfo | `EmployeeBasicInfo` | `BIUserSecurityLakehouse.EmployeeBasicInfo.EmployeeBasicInfo` | Midnight |
| (no legacy table) | — | `BINetHealthGeneralLakehouse.Employees.EmployeeUserNames` | Live |
| (no legacy table) | — | `BIUserSecurityLakehouse.EmployeeBasicInfo.EmployeeUserNames` | Midnight |
| DiagnosisCode | `DiagnosisCode` | `BINetHealthPatientLakehouse.NetHealthDocumentation.DiagnosisCode` | Live (direct access, no filter) |
| (joined in DiagnosisCode M) | `DiagnosisCategory` | `BINetHealthPatientLakehouse.NetHealthDocumentation.DiagnosisCategory` | Live |
| DischargeReason | `Lookup` (filter `Type='CASEEND'`) | `BINetHealthGeneralLakehouse.Lookups.Lookup` WHERE `Type='CASEEND'` | Live |
| DischargeDestination | `Lookup` (filter `Type='DISCHRGTO'`) | `BINetHealthGeneralLakehouse.Lookups.Lookup` WHERE `Type='DISCHRGTO'` | Live |
| IntakeSources | `IntakeSources` | `BINetHealthGeneralLakehouse.Lookups.IntakeSource` | Live |
| LibraryItem | `LibraryItem` | `BINetHealthPatientLakehouse.NetHealthDocumentation.LibraryItem` | Live |
| LibraryScaleValue | `LibraryScaleValue` | `BINetHealthPatientLakehouse.NetHealthDocumentation.LibraryScaleValue` | Live |
| Patients | `Patients` | `BINetHealthPatientLakehouse.PatientInfo.Resident` ⨝ `PatientInfo.ResidentInfo` (`IsCurrent=1`) | Live |
| Payers | `Payers` | `BINetHealthPatientLakehouse.PayerInfo.Payer` | Live |
| Physician | `Physician` | `BINetHealthGeneralLakehouse.Lookups.Physician` | Live |
| Service | `Service` | `BINetHealthGeneralLakehouse.Lookups.Service` | Live |
| VW_NHAegisFacilities | `VW_NHAegisFacilities` | `BINetHealthGeneralLakehouse.FacilityInfo.NHAegisFacilities` *(name shortened — no `VW_` prefix)* | Midnight |
| (no legacy table) | — | `BINetHealthGeneralLakehouse.FacilityInfo.NHAegisHierarchy` *(rename of `VW_NHAegisHierarchy`)* | Midnight |
| vw_PatientPayers | `vw_PatientPayers` | **Open question — see below.** Scott points to `BINetHealthPatientLakehouse.Reports.PatientPayers` (Midnight); a direct-read alternative `BINetHealthPatientLakehouse.PayerInfo.PatientPayers` also exists. [episode-view.sql:151-152](queries/episode-view.sql#L151-L152) currently uses `PayerInfo.PatientPayers` (presumably for live data) | Midnight (Reports) / Live (PayerInfo) |
| vw_UpnFacilityAccess | `Vw_UpnFacilityAccess` | `BIUserSecurityLakehouse.UpnAccess.UserAccess` *(renamed)* | Midnight |
| PatientScreens | `PatientScreens` | **Open** — no direct match in `aegisdataprod` lakehouses; was a pre-aggregated dataflow |
| Telehealth | `BillingInfo` | **Open** — billing dataflow not addressed in Scott's notes |

---

## Lane B — Already on Fabric (legacy already migrated, but to a band-aid lakehouse)

Tables whose legacy M reads `Sql.Database(...,"AegisPreImplementationLakehouse")`
via shared expressions in [expressions.tmdl](ClinicalOutcomes/ClinicalOutcomes.SemanticModel/definition/expressions.tmdl).
These point at `dbo.dbo_vw_*` views in `AegisPreImplementationLakehouse` — Scott's
band-aid layer. The NewModel should bypass that lakehouse and bind to canonical
`BINetHealth*Lakehouse` tables directly.

| Legacy table | Phase 1 source (band-aid, current legacy bind) | Phase 2 canonical destination | Refresh / notes |
|---|---|---|---|
| PatientStays | `AegisPreImpl.dbo.dbo_vw_PatientStays` | `BINetHealthPatientLakehouse.PatientInfo.Stay` ⨝ `Resident` ⨝ `ResidentInfo` ⨝ `Facility` | Live (PatientInfo direct access, no filter) |
| StayCases | `AegisPreImpl.dbo.dbo_vw_StayCases` | `BINetHealthPatientLakehouse.PatientInfo.PatientCase` ⨝ `Stay` — already in [case-view.sql](queries/case-view.sql) | Live |
| CaseTracks | `AegisPreImpl.dbo.dbo_vw_CaseTracks` | `BINetHealthPatientLakehouse.PatientInfo.TxTrack` | Live |
| Documents | `AegisPreImpl.dbo.vw_AllEvalsAndDischargesLight` | `BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocument` filtered to `DocumentType IN ('EVAL','DISCH')`. Scott confirmed the legacy convenience view is gone — rebuild the joins. | Live |
| Assessments | `AegisPreImpl.dbo.vw_AllEvalsAndDischargesLight_Items` ⨝ `Outcomes Crosswalk` | `BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocumentItem` ⨝ `LibraryItem` ⨝ Crosswalk — already in [outcomes-summary.sql](queries/outcomes-summary.sql) | Live |
| ExpectedDischargeDestination | `AegisPreImpl.dbo.vw_AllEvalsAndDischargesLight_Items` (`LibraryItem_ID=7614`) | `TxDocumentItem` WHERE `LibraryItem_ID=7614` — already in [episode-view.sql:202-205](queries/episode-view.sql#L202-L205) | Live |
| PriorLivingEnvironment | `AegisPreImpl.dbo.vw_AllEvalsAndDischargesLight_Items` (`LibraryItem_ID=7857`) | `TxDocumentItem` WHERE `LibraryItem_ID=7857` — already in [episode-view.sql:219-222](queries/episode-view.sql#L219-L222) | Live |
| Treatments / TreatmentsDetails | `AegisPreImpl.dbo.dbo_vw_Treatments` | `BINetHealthPatientLakehouse.DailyInfo.Treatments` — already in [treatments.sql](queries/treatments.sql) | Hourly (16th min), **last 3 years filter**. **STALE: stopped getting data 2026-02-26** |
| Diagnosis | `AegisPreImpl.dbo.dbo_vw_Diagnosis` | `BINetHealthPatientLakehouse.NetHealthDocumentation.TxDiagnosis` | Live |
| HCC | `AegisPreImpl.dbo.ICD_10_CM_Mappings` | **Open** — not in Scott's destinations list; stays on AegisPreImpl unless promoted |
| Weights | `AegisPreImpl.dbo.csv_C2824T2n` (CSV-loaded) | **Open** — not promoted; stays on AegisPreImpl |
| FTEType | `AegisPreImpl.dbo.excel_Employee_FTE_status_vs_patient_outcomes_WD_Roster` | **Open** — Excel roster, not promoted |
| Outcomes Crosswalk | SharePoint Excel via `Web.Contents` (also `AegisPreImpl.dbo.excelOutcomesCrosswalk` shadow) | **Open — Phase 2 plan in [outcomes-summary.sql:25-26](queries/outcomes-summary.sql#L25-L26).** Currently injected as VALUES CTE by [pull-outcomes.js](queries/pull-outcomes.js). Needs canonical Fabric table. |
| Outcomes Custom Scales | SharePoint Excel / `AegisPreImpl.dbo.excelOutcomesCustomScales` | **Open** — same story as Crosswalk |
| Aegis Contract | `AegisPreImpl.dbo.Salesforce_Aegis_Contract` | **Open** — Salesforce, not promoted |
| Account / Chain | `AegisPreImpl.dbo.Salesforce_Account` | **Open** — Salesforce, not promoted |
| Peer Group | SharePoint Excel `Job Code to Peer Group.xlsx` | **Open** — never made it to Fabric |
| Perspectives (UPN-based) | `AegisPreImpl.dbo.dbo_vw_UpnFacilityAccess` ⨝ `Salesforce_Aegis_Contract` | `BIUserSecurityLakehouse.UpnAccess.UserAccess` (UPN side); Salesforce side still open | Midnight (UPN) |

---

## Lane C — Pure calc / parameter / static (no source migration)

Port DAX or inline JSON verbatim; no upstream binding required.

`Calendar`, `Calendar Parameter`, `OutcomeSummary`, `Outcomes Breakdown`,
`DX_Cases`, `Diagnosis Hierarchy`, `Override Chain`, `Override Payer`,
`Override State`, `Override Type`, `Payer Buckets`, `Service Rows`,
`Service Columns`, `Service Columns BM`, `ShowScales`, `Timeline`,
`BenchmarkTable`, `CaseInclusionTable`, `CaseTrackDays`, `ContextTable`,
`JitterTable`, `MeasureTable`, `DestinationPage`, `Disciplines`,
`Outcome Families`, `Basis`, `CustomerGroups`, `Tech`, `EDD`, `PLE`,
`StartDate`, `Dictionary`.

---

## Other Fabric tables Scott surfaced (not in legacy crosswalk)

Listed for awareness — these are now available in Fabric and may be useful for
the people dashboard, additional reports, or replacing band-aids:

| Table | Refresh |
|---|---|
| `BINetHealthGeneralLakehouse.Lookups.BillDateLookup` | Live |
| `BINetHealthGeneralLakehouse.FacilityInfo.FacilityTags` | Live |
| `BINetHealthPatientLakehouse.NonCareCharge.NonCareCharge` | Live |
| `BINetHealthPatientLakehouse.NonCareCharge.NonCareChargeItem` | Live |
| `BINetHealthPatientLakehouse.PatientPDPM.*` | Live |
| `BINetHealthPatientLakehouse.Reports.TherapyCensus` | Midnight |
| `BINetHealthPatientLakehouse.Reports.ReportMissingPayor` | Midnight |

---

## Did not move (Scott explicitly flagged)

- `Vw_ReportDailyInfo`, `Vw_ReportDailyInfo_Facility`,
  `Vw_ReportDailyInfo_MedBByWeekAggregation`, `Vw_ReportDailyInfo_Patient`
- `Net Health Documentation Extended – Patient Outcomes` (replaced by direct
  `NetHealthDocumentation.*` access)
- `Nightly SP Data`
- `Labor / Lake Clocker` — needs to be rebuilt in Fabric

---

## Open items / discussion needed with Scott

1. **`vw_PatientPayers` destination** — Reports (midnight) vs PayerInfo (live). Pick deliberately based on consumer freshness needs.
2. **AegisPreImpl tail** — HCC mappings, Weights CSV, FTE roster, Outcomes Crosswalk, Outcomes Custom Scales, Salesforce Account/Contract. Will any of these be promoted to canonical Fabric tables, or stay on the band-aid lakehouse?
3. **`Telehealth.BillingInfo`** — separate billing dataflow; what's the Fabric replacement?
4. **`PatientScreens`** — pre-aggregated dataflow with no obvious base-table equivalent.
5. **`Peer Group`** xlsx — needs to be ingested to Fabric before NewModel can drop SharePoint.
6. **Treatments freshness** — `DailyInfo.Treatments` shows no data after 2026-02-26 despite "Hourly" cadence. Is this expected during Scott's rework, or a pipeline break?
7. **TxSession freshness** — `PatientInfo.TxSession` shows no data after 2026-03-30 despite "Live" classification. Same question.
