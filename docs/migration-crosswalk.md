# Migration Crosswalk — Legacy Sources → Fabric Medallion

Maps every legacy ClinicalOutcomes table (and its data origin) to the Fabric
table the **NewModel** should bind to. Updated **2026-06-05** after verifying the
new medallion workspaces end-to-end (see `memory/project_fabric_medallion.md`).

## Status (2026-06-05) — supersedes the 2026-04-28 "interim/don't-use-yet" caveat

Scott's medallion stack is now real, populated, and fresh. The earlier warning
that "the tables below are a band-aid and will change" is **resolved for the
NetHealth core**: the source data now lives in **Bronze** (raw, near-real-time
mirror) and **Silver** (conformed). What has **not** happened yet is the
**consumer repoint** — the `queries/` scripts and every semantic model
(`ClinicalOutcomes/`, all `current_reports/`, and most of `NewModel/`) still read
the **retiring `aegisdataprod`** lakehouses / `AegisPreImplementationLakehouse`.
Data is ready; the rebinding work is what remains.

- 🟢 **Bronze** (`NetHealth_Bronze_Lakehouse`) — full source mirror, current to the hour.
- 🟢 **Silver** (`Aegis_Core_Silver_Lakehouse`) — conformed activity/labor/org, fresh through prior day.
- 🟡 **Silver patient spine** (`patientstay`/`patientcase`/`track`) — populated but **skeletal** (keys only, no attributes yet).
- 🔴 **Gold** — **empty** (no lakehouses/warehouses). Nothing to bind to yet.
- 🔴 **`LibraryItem` / `LibraryScaleValue`** — the **only source data with no Fabric home**; still only on `aegisdataprod`. See blocker section.

## Endpoints (SQL analytics endpoints; one host per workspace)

Wired into `databases.json` (gitignored) under the listed aliases.

| Alias | Workspace | Database | Endpoint host | Status |
|---|---|---|---|---|
| `general` | aegisdataprod | `BINetHealthGeneralLakehouse` | `…-7etkehckn7cejnmv5wbgoctzfe…` | 🔴 RETIRING |
| `patient` | aegisdataprod | `BINetHealthPatientLakehouse` | `…-7etkehckn7cejnmv5wbgoctzfe…` | 🔴 RETIRING |
| `security` | aegisdataprod | `BIUserSecurityLakehouse` | `…-7etkehckn7cejnmv5wbgoctzfe…` | 🔴 RETIRING |
| `bronze` | Fabric - Bronze | `NetHealth_Bronze_Lakehouse` | `…-4wksxtle6exu7ne42rpqmph27i…` | 🟢 raw mirror |
| `bronze-workday` | Fabric - Bronze | `WorkDay_Bronze_Lakehouse` | `…-4wksxtle6exu7ne42rpqmph27i…` | 🟢 HR/labor |
| `silver` | Fabric - Silver | `Aegis_Core_Silver_Lakehouse` | `…-vox2z5x5nsnuri4qviabf7xo3i…` | 🟢 conformed |
| `silver-wh` | Fabric - Silver Warehouses | `A_SilverWarehousesLakehouse` | `…-4t6nxoxhgn6uthipsbsfog6dxu…` | 🟢 |
| — | Fabric - Gold | *(none)* | — | 🔴 empty |

All hosts share the prefix `asot7hu5ofuezkzklqea75om6i-`. DocAudit and Salesforce
workspaces exist too but are **out of scope** for this migration.

## Which layer to bind to

1. **Prefer Silver** (`silver`) where a conformed table exists — it's cleaner and
   the dirty source values are resolved. Conformed + fresh today: `treatmentsession`,
   `treatmentminute`, `labor`, `workday_nonworkhours`, `employee`, and the org spine
   `region`/`area`/`district`/`facility`/`facilityhierarchy`, `service`.
2. **Fall back to Bronze** (`bronze`) for anything Silver doesn't conform yet —
   notably the **clinical documentation** (`TxDocument`, `TxDocumentItem`, `TxDiagnosis`)
   and the **full patient episode spine with attributes** (`PatientCase`, `Stay`,
   `TxTrack`, `Resident`, `ResidentInfo`), plus `Payer*`, `Lookup`, `IntakeSource`,
   `DiagnosisCode`, and the `Billing.*` schema. Bronze is raw → **filter defensively**
   (e.g. `TxDocument` has a bad future `CompletedDate` of 2051-07-24).
3. **Cross-host caveat:** Bronze and Silver are on **different endpoint hosts**, so a
   single `Value.NativeQuery` **cannot join across them**. Source each table from one
   layer, or split into separate model partitions and relate in the model. (Silver
   already co-locates `facility` + `facilityhierarchy`, so facility/org joins stay
   single-query.)

## The one source-data blocker: `LibraryItem` / `LibraryScaleValue`

Confirmed absent from **all** of `bronze`/`silver`/`silver-wh` (searched every
`COLUMNS` entry for Library/Scale/Outcome). `TxDocumentItem` carries the FK IDs
(`LibraryItem_ID`, `LibraryScaleValue_ID`) but the reference tables — which give
`VersionName` (OP/GP library detection) and the scale catalog — exist only on
`aegisdataprod.BINetHealthPatientLakehouse.NetHealthDocumentation.*`
(used in [outcomes-summary.sql:59-60](queries/outcomes-summary.sql#L59-L60),
[episode-view.sql:207-225](queries/episode-view.sql#L207-L225),
[pull-track-dimensions.js:69](queries/pull-track-dimensions.js#L69)).
These are low-churn reference tables, but they need a Fabric home before
aegisdataprod can be fully retired. **→ Scott's ingestion list.**
(Distinct from the CSV-injected `Outcomes Crosswalk` / `Custom Scales`, which are
business mappings keyed *by* these IDs and already off aegisdataprod.)

## Division segmentation & hierarchy level-shift (verified)

The model's `DivisionCode` (8450 Contract Rehab / 5500 Senior Living / 6500 HAP /
5555 Closed) was a **curated field** in the old `GeneralLakehouse.FacilityHierarchy`
and does **not** exist as a named column anywhere in the medallion. It is recoverable:
old `DivisionCode` = Silver **`facilityhierarchy.RegionNumber`** (zero-padded, e.g.
`'08450'`). The NetHealth-native hierarchy is labeled **one level deeper** than the old
curated one (verified value-for-value):

| Old (aegisdataprod curated) | Silver (`facilityhierarchy`) |
|---|---|
| `DivisionName` (8450/5500/6500…) | `RegionName` / `RegionNumber` |
| `RegionName` | `AreaName` / `AreaNumber` |
| `AreaName` | `DistrictName` / `DistrictNumber` |

The old `DivisionName` was already code-prefixed (`"8450 - Region 3"`), so the
mapping is 1:1 — no friendly-name lookup required. Filter live divisions with
`RegionNumber IN ('08450','05500','06500')`.

## Facility repoint — DONE (the proven pattern)

[NewModel/…/Facility.tmdl](NewModel/ClinicalOutcomes.SemanticModel/definition/tables/Facility.tmdl)
is repointed off aegisdataprod to **Silver**, verified value-for-value (1,126
division-scoped facilities). Final mapping:

| Model column | ← Silver |
|---|---|
| `Facility_ID` | `facility.NetHealthId` |
| `FacilityName` | `facility.Name` |
| `FacilityCode` | `facility.FacilityNumber` |
| `SiteType` | `facility.SiteType` |
| `DivisionName` | `facilityhierarchy.RegionName` |
| `RegionName` | `facilityhierarchy.AreaName` |
| `AreaName` | `facilityhierarchy.DistrictName` |
| ~~`PrimaryHealthcareSetting`~~ | dropped (no clean Silver source; nothing consumed it) |

**Repoint method (reusable for every table below):** find the Silver-conformed
table → map columns watching for **key-type changes** (int `Facility_ID` →
varchar `FacilityNumber`) and **hierarchy level-shifts** → reconcile counts
old-vs-new (`queries/reconcile-facility.js`, dual-pool now works after the
`fabric-query.js` ConnectionPool fix) → expect Silver to be *fresher* (the
old-vs-new count delta on Facility was entirely closed/added facilities).

---

## How to read the Lane tables below

The "Fabric destination" columns name the **canonical NetHealth table**. Translate
each to the medallion using the layer rule above: NetHealth `PatientInfo.*` /
`NetHealthDocumentation.*` / lookups now resolve to **Bronze `…_Bronze_Lakehouse.dbo.*`**
(same table names, raw mirror) or to a **Silver conformed table** where one exists.
The mappings themselves are still accurate as legacy→NetHealth references.

## Workspace GUIDs (legacy dataflows)

| `workspaceId` | Inferred role |
|---|---|
| `58ac0bf7-44e5-4241-a12e-4c6f42ba8a78` | Data – Net Health – General |
| `85b4966e-36ff-4433-990a-06a46dbbba67` | Data – Net Health – Patient |
| `0ad806a7-7698-4083-ba4f-c42c5aa91ecc` | Patient (Patients dataflow) |
| `538303cf-865c-4aae-b405-89ef5e1991aa` | Security / UPN |
| `60c237c9-bec9-41af-bf9e-6afa43a264e9` | Used by current_reports models only |
| `db9e762e-b1da-4705-8c3b-315fa4c4647c` | Used by current_reports models only |

New medallion workspace GUIDs: Bronze `cd2b95e5-f164-4f2f-b49c-d45f063cfafa`,
Silver `f6acafab-6cfd-489b-a390-aa0012feeeda`, Gold `8686c794-385c-439c-b210-6d976e9cf3a8`,
Silver Warehouses `badbfce4-33e7-497d-9d0f-9064571bc3bd`.

---

## Lane A — Legacy dataflow → NetHealth canonical (rebind to Bronze/Silver)

Tables whose legacy partition reads `PowerPlatform.Dataflows(null)`.

| Legacy table | Dataflow entity | NetHealth canonical | Medallion target |
|---|---|---|---|
| Employees | `Employees` | `…General.Employees.Employees` | 🟢 **Silver `dbo.employee`** (rich: UPN, JobCode, Discipline, Supervisor) |
| EmployeeBasicInfo | `EmployeeBasicInfo` | `…Security.EmployeeBasicInfo` | 🟡 Silver `dbo.employee` likely covers; security/UPN-access replacement **unverified** |
| DiagnosisCode | `DiagnosisCode` | `…Patient.NetHealthDocumentation.DiagnosisCode` | 🟢 Bronze `dbo.DiagnosisCode` |
| DischargeReason | `Lookup` (`Type='CASEEND'`) | `…General.Lookups.Lookup` | 🟢 Bronze `dbo.Lookup` WHERE `Type='CASEEND'` |
| DischargeDestination | `Lookup` (`Type='DISCHRGTO'`) | `…General.Lookups.Lookup` | 🟢 Bronze `dbo.Lookup` WHERE `Type='DISCHRGTO'` |
| IntakeSources | `IntakeSources` | `…General.Lookups.IntakeSource` | 🟢 Bronze `dbo.IntakeSource` |
| LibraryItem | `LibraryItem` | `…Patient.NetHealthDocumentation.LibraryItem` | 🔴 **No medallion home — still aegisdataprod only.** Blocker. |
| LibraryScaleValue | `LibraryScaleValue` | `…Patient.NetHealthDocumentation.LibraryScaleValue` | 🔴 **No medallion home — still aegisdataprod only.** Blocker. |
| Patients | `Patients` | `…Patient.PatientInfo.Resident` ⨝ `ResidentInfo` | 🟢 Bronze `dbo.Resident` ⨝ `dbo.ResidentInfo` |
| Payers | `Payers` | `…Patient.PayerInfo.Payer` | 🟢 Bronze `dbo.Payer` (+ `PayerType`, `PayerPayerType`) |
| Physician | `Physician` | `…General.Lookups.Physician` | 🟢 Bronze `dbo.Physician` |
| Service | `Service` | `…General.Lookups.Service` | 🟢 Bronze `dbo.Service` / Silver `dbo.service` |
| VW_NHAegisFacilities | `VW_NHAegisFacilities` | `…General.FacilityInfo.NHAegisFacilities` | 🟢 Silver `dbo.facility` (**Facility repoint done** — see above) |
| (hierarchy) | — | `…General.FacilityInfo.NHAegisHierarchy` | 🟢 Silver `dbo.facilityhierarchy` (**level-shift** — see above) |
| vw_PatientPayers | `vw_PatientPayers` | `…Patient.PayerInfo.PatientPayers` / `Reports.PatientPayers` | 🟢 Bronze `dbo.` payer linkage (`ResidentPayer*`, `CasePayerSet`) |
| vw_UpnFacilityAccess | `Vw_UpnFacilityAccess` | `…Security.UpnAccess.UserAccess` | 🟡 security/UPN-access medallion replacement **unverified** |
| PatientScreens | `PatientScreens` | — | 🔴 **Open** — pre-aggregated dataflow, no base-table equivalent found |
| Telehealth | `BillingInfo` | — | 🟢 Bronze **`Billing.*` schema** (AR*/Payer*/CustomerStay) — was an open item |

## Lane B — Was on the `AegisPreImplementationLakehouse` band-aid

Legacy M reads `Sql.Database(…,"AegisPreImplementationLakehouse")` via
[expressions.tmdl](ClinicalOutcomes/ClinicalOutcomes.SemanticModel/definition/expressions.tmdl).
The NewModel should bypass that lakehouse entirely.

| Legacy table | Band-aid source | Medallion target |
|---|---|---|
| PatientStays | `dbo_vw_PatientStays` | 🟢 Bronze `dbo.Stay` ⨝ `Resident` ⨝ `ResidentInfo` ⨝ `Facility` (full attrs: AdmitDate/DischargeDate/IsCurrent…) |
| StayCases | `dbo_vw_StayCases` | 🟢 Bronze `dbo.PatientCase` ⨝ `Stay` (the "case" table; has StartDate/EndDate/EndReason_ID) |
| CaseTracks | `dbo_vw_CaseTracks` | 🟢 Bronze `dbo.TxTrack` (Discipline, StartDate, EndDate, **`IsUnplannedDischarge`**, EndReason_ID) |
| Documents | `vw_AllEvalsAndDischargesLight` | 🟢 Bronze `dbo.TxDocument` WHERE `DocumentType IN ('EVAL','DISCH')` |
| Assessments | `…Light_Items` ⨝ Crosswalk | 🟢 Bronze `dbo.TxDocumentItem` ⨝ Crosswalk (LibraryItem still aegisdataprod — blocker) |
| ExpectedDischargeDestination | `…Light_Items` (`LibraryItem_ID=7614`) | 🟢 Bronze `dbo.TxDocumentItem` WHERE `LibraryItem_ID=7614` |
| PriorLivingEnvironment | `…Light_Items` (`LibraryItem_ID=7857`) | 🟢 Bronze `dbo.TxDocumentItem` WHERE `LibraryItem_ID=7857` |
| Treatments / Details | `dbo_vw_Treatments` | 🟢 **Silver `dbo.treatmentminute`** (was STALE on aegisdataprod after 2026-02-26; **fresh in Silver**) |
| (sessions) | — | 🟢 **Silver `dbo.treatmentsession`** (was STALE `TxSession` after 2026-03-30; **fresh in Silver**) |
| Diagnosis | `dbo_vw_Diagnosis` | 🟢 Bronze `dbo.TxDiagnosis` |
| Perspectives (UPN) | `dbo_vw_UpnFacilityAccess` ⨝ Salesforce | 🟡 UPN side unverified; Salesforce side → `SalesforceLakehouse` (out of scope) |
| HCC | `ICD_10_CM_Mappings` | 🔴 **Open** — not promoted; stays on AegisPreImpl unless ingested |
| Weights | `csv_C2824T2n` | 🔴 **Open** — CSV, not promoted |
| FTEType | `excel_…_WD_Roster` | 🟡 partly covered by Silver `dbo.employee` + WorkDay bronze; confirm |
| Outcomes Crosswalk | SharePoint Excel | ⚪ CSV-injected today ([pull-outcomes.js](queries/pull-outcomes.js)); wants a canonical Fabric table eventually |
| Outcomes Custom Scales | SharePoint Excel | ⚪ same as Crosswalk |
| Aegis Contract / Account / Chain | `Salesforce_*` | 🟡 → `SalesforceLakehouse` (separate workspace, **out of scope**) |
| Peer Group | `Job Code to Peer Group.xlsx` | 🔴 **Open** — never ingested to Fabric |

## Lane C — Pure calc / parameter / static (no source migration)

Port DAX/JSON verbatim; no upstream binding.

`Calendar`, `Calendar Parameter`, `OutcomeSummary`, `Outcomes Breakdown`,
`DX_Cases`, `Diagnosis Hierarchy`, `Override Chain`, `Override Payer`,
`Override State`, `Override Type`, `Payer Buckets`, `Service Rows`,
`Service Columns`, `Service Columns BM`, `ShowScales`, `Timeline`,
`BenchmarkTable`, `CaseInclusionTable`, `CaseTrackDays`, `ContextTable`,
`JitterTable`, `MeasureTable`, `DestinationPage`, `Disciplines`,
`Outcome Families`, `Basis`, `CustomerGroups`, `Tech`, `EDD`, `PLE`,
`StartDate`, `Dictionary`.

---

## Labor / Lake Clocker — rebuilt (was "needs rebuild")

🟢 Now in **Silver `dbo.labor`** (+ `dbo.workday_nonworkhours` for PTO/non-productive),
fed by a real WorkDay source. The prior "Labor / Lake Clocker needs to be rebuilt"
item is resolved.

## Open items / discussion with Scott (updated 2026-06-05)

**Resolved this session:** Treatments/TxSession freshness (fresh in Silver) ·
Telehealth/billing (Bronze `Billing.*`) · Labor/Lake Clocker (Silver) · Salesforce
(own lakehouse) · planned/unplanned discharge (`TxTrack.IsUnplannedDischarge`) ·
Division segmentation (Silver `RegionNumber`).

**Still open:**
1. **`LibraryItem` / `LibraryScaleValue`** — sole source data with no Fabric home. Top ask.
2. **Security / UPN access** (`UpnAccess.UserAccess`, `EmployeeBasicInfo`) — medallion replacement not yet verified (we scanned Bronze/Silver/Gold/SilverWH only).
3. **Silver patient spine attributes** — `patientstay`/`patientcase`/`track` are keys-only in Silver; until enriched, episode-level reporting sources from Bronze.
4. **`PatientScreens`** — pre-aggregated dataflow, no base-table equivalent.
5. **`Peer Group` xlsx, HCC mappings, Weights CSV, FTE roster** — confirm whether promoted to Fabric or stay on AegisPreImpl.
6. **Consumer repoint** — no script or model (beyond `Facility.tmdl`) has been rebound yet. That's the bulk of remaining migration work.
