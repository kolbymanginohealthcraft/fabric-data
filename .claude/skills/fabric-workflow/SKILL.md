---
name: fabric-workflow
description: >-
  Playbook for working against Microsoft Fabric in this repo — authenticating
  (Azure CLI token delegation, never device code), querying lakehouse/warehouse
  SQL endpoints via fabric-query.js, repointing semantic-model tables from the
  retiring aegisdataprod onto the medallion (Bronze/Silver), reconciling old-vs-new
  row counts, and reasoning about data freshness. Use BEFORE running fabric-query.js,
  writing a pull/query script, or repointing a .tmdl table's source. For PBIP file
  structure and TMDL syntax, see pbip-authoring.
---

# Fabric Workflow Playbook

This repo queries Fabric SQL endpoints directly (T-SQL over Node) and migrates the
ClinicalOutcomes model off the retiring `aegisdataprod` band-aid onto the medallion stack.
Two recurring traps: **re-prompting for auth** (unacceptable to the user) and **assuming a
repoint is a hostname swap** (it isn't — keys, level-shifts, and cross-host joins bite).

**Golden rules:**
1. **Never surface a device code.** If auth fails, the fix is *the user runs `az login` once* — full stop.
2. **A repoint is a mapping, not a swap.** Always reconcile old-vs-new before trusting it.

---

## 1. Authentication (silent, persistent — NEVER device code)

- `fabric-query.js` mints tokens by **shelling the Azure CLI directly**:
  `execSync("az account get-access-token --resource https://database.windows.net/ --output json")`
  in `acquireTokenViaAzCli()`. Do NOT switch to `@azure/identity` `AzureCliCredential` (returned
  empty output / `Unexpected end of JSON input` on this machine) and NEVER `DeviceCodeCredential`
  (in-memory cache → re-prompts every run).
- `az login` is run **once** by the user; the CLI holds a rolling ~90-day refresh token, renewed on
  use → with regular use the session never expires and **no device code is ever shown**.
- `.token-cache.json` (repo root) caches the access token until ~1 min before expiry, then `az` is
  silently re-spawned. Deleting it just forces a fresh mint (harmless if `az` is logged in).
- **Windows gotcha:** `az` is `az.cmd` → must use `execSync` (shell). `execFileSync('az.cmd', …)`
  throws `EINVAL` on modern Node.
- **The ONLY reconnect case** (rare — >90 days idle / revoked / wrong tenant): a query throws
  "Azure CLI token acquisition failed. Run `az login` once…". Fix = USER runs `az login`. Verify
  with `node fabric-query.js "SELECT 1 AS ok"`. Non-interactive state check: `az account show`.

## 2. Querying endpoints

- CLI: `node fabric-query.js [--db <name>] "SELECT ..."`. Programmatic: `require("./fabric-query").query(sql, db)`.
- `databases.json` aliases: `general, patient, security, silver, silver-wh, bronze, bronze-workday`
  (plus `silver`/`bronze` family). One token covers all DBs (shared endpoint family).
- **One pool per db:** `fabric-query.js` uses a dedicated `new sql.ConnectionPool()` per dbName.
  The old global `sql.connect()` could only hold ONE db per process — a second db silently reused
  the first pool ("Invalid object name" / wrong-db compares). Keep the per-db pool when editing.
- **Cross-host joins don't work.** Bronze, Silver, and aegisdataprod are on DIFFERENT endpoint
  hosts. The legacy single-NativeQuery cross-DB join (BINetHealthPatientLakehouse ⨝ GeneralLakehouse)
  worked only because both lived in one aegisdataprod host. After repoint, source from ONE layer or
  split into model partitions.

## 3. Where the data lives (medallion)

Medallion is the DEFAULT source; the ClinicalOutcomes migration onto it is largely complete.
`aegisdataprod` / `AegisPreImplementationLakehouse` / PBI dataflows are now RARE exceptions.

- **Silver** — conformed + fresh. Activity/labor/census/people → here NOW. **As of 2026-08-14 Silver
  is SPLIT ACROSS DOMAIN LAKEHOUSES** (see the pitfalls log); the old alias `silver`
  (`Aegis_Core_Silver_Lakehouse`) is now nearly empty. Use, on the same endpoint host:
  - `silver-employee` → `dbo.employee` (UPN→security, JobCode→peer group), `dbo.labor`, `dbo.professionallicense`
  - `silver-facility` → org spine: `dbo.facility`, `dbo.facilityhierarchy`, `dbo.region/area/district`
  - `silver-treatment` → `dbo.treatmentsession`, `dbo.treatmentminute`, `dbo.service`
  - `silver-patient` → `dbo.patient`, `dbo.patientcase`, `dbo.patientstay`, `dbo.track` (still SKELETAL — keys only)
  - `silver-payers`, `silver-reference`
  - **`silver-aggregate` (`Silver_Aegis_Aggregate_Lakehouse`) — despite the name, NOT rollups.** It
    carries ALL 23 `dbo` tables from every domain in ONE database, verified row-for-row identical and
    equally fresh. It is therefore the **1:1 drop-in replacement for the old `silver` alias**, and the
    ONLY Silver option that can join across domains (e.g. employee ⨝ facility) in a single query —
    the domain lakehouses are separate databases, so cross-domain NativeQuery joins fail there.
    Prefer it for semantic-model expressions and any multi-domain query; per-domain aliases are fine
    for single-domain pulls where explicit provenance is nicer.
- **Bronze** (`NetHealth_Bronze_Lakehouse`, alias `bronze`): full near-real-time mirror, current to
  the hour. Has what Silver lacks: `dbo.TxDocument`/`TxDocumentItem` (271M), `dbo.PatientCase`,
  `dbo.Stay` (Admit/Discharge/DischargedTo/IsCurrent), `dbo.TxTrack` (Discipline, dates,
  **IsUnplannedDischarge bit**), `Billing.*`, `dbo.Lookup`. Clinical outcomes/case-episode → Bronze.
- **Gold:** nothing wired up — there is no `gold` alias in `databases.json`. Do not plan against it.
- **The orphan is RESOLVED (2026-09-16).** `Library`, `LibraryItem` and `LibraryScaleValue` are all
  in Bronze now (11 / 56 / 16 columns), so the outcomes models no longer read aegisdataprod at all.
  This entry previously called it "the single confirmed hard blocker to fully retiring aegisdataprod";
  that is no longer true. `dbo.Library` also gives an authoritative `Library_ID` per track via
  `TxDocument`, which replaced the old `VersionName LIKE '%OP%'` heuristic. **Re-verify before
  trusting any 'X is not in Bronze' claim here — this one silently became false.**
- **Bronze caveat:** raw layer = dirty data (e.g. TxDocument max CompletedDate = 2051). Bronze-bound
  reports need defensive date filtering; prefer Silver where conformed.

## 4. The proven repoint pattern (aegisdataprod → medallion)

Established value-for-value on the Facility table. Follow it for every remaining table:

1. **Find** the Silver-conformed (or Bronze, for clinical) table that replaces the aegisdataprod source.
2. **Map columns** — watch two traps:
   - **Key type changes** (e.g. `Facility_ID` int → `FacilityNumber` varchar; model key → `NetHealthId`).
   - **Level-shifts** — NetHealth's native hierarchy is labeled one level off the old curated one:
     old Division = Silver **Region**, old Region = Silver Area, old Area = Silver District.
   - **Division** = `facilityhierarchy.RegionNumber` zero-padded to 5 (`'08450'/'05500'/'06500'/'05555'`);
     filter `WHERE fh.RegionNumber IN ('08450','05500','06500')`.
3. **Use LEFT joins** where the new hierarchy has gaps (e.g. 12 facilities lack a hierarchy row).
4. **Reconcile counts** old-vs-new (dual-pool now supports this in one process). Expect Silver to be
   FRESHER (current closures + new sites), so a delta is usually freshness, not error — verify which.
5. **Drop** columns with no clean new source if nothing consumes them (e.g. PrimaryHealthcareSetting).

Helper scripts that embody this: `discover-endpoints.js`, `queries/reconcile-facility.js`,
`queries/verify-hierarchy.js`.

## 5. Pre-flight checklist

- [ ] **Auth path intact?** Still shelling `az` directly; no device-code or `@azure/identity` credential reintroduced.
- [ ] **Per-db pool?** Any fabric-query.js edit keeps a dedicated ConnectionPool per dbName.
- [ ] **Single-host query?** No cross-host (Bronze↔Silver↔aegisdataprod) join in one NativeQuery.
- [ ] **Freshness checked?** Don't trust "Live"/"Hourly" labels — recency-check before relying on a table.
- [ ] **Repoint reconciled?** Old-vs-new row counts compared; deltas explained (freshness vs. genuine miss).
- [ ] **Keys & level-shifts handled?** int↔varchar key changes and the Division=Region level-shift accounted for.
- [ ] **Orphan respected?** Anything needing LibraryItem/LibraryScaleValue still sources aegisdataprod (no Fabric home yet).

---

## Pitfalls log (append-only)

One line per gotcha. Add to it whenever we hit a new Fabric trap (and a memory file if it's a discrete fact).

- `@azure/identity` `AzureCliCredential` returns empty (`Unexpected end of JSON input`) here — shell `az` directly. (2026-06-06)
- `execFileSync('az.cmd', …)` throws `EINVAL` on modern Node/Windows — must use `execSync` (shell).
- Global `sql.connect()` holds only one db per process → second db silently reused first pool. Use per-db ConnectionPool.
- Cross-host single-query joins fail post-medallion (different endpoint hosts) — source from one layer or split partitions.
- Bronze raw dates are dirty (CompletedDate = 2051) — filter defensively; prefer Silver where conformed.
- Repoint is NOT a hostname swap: int↔varchar key changes + Division=Region level-shift will silently corrupt joins if missed.
- **Silver was split into DOMAIN lakehouses (2026-08-14).** `Aegis_Core_Silver_Lakehouse` kept only `reportdailyinfo` + `control.*`; everything else moved to `Silver_Aegis_{Employee,Facility,Treatment,Patient,Payers,Reference,Aggregate}_Lakehouse` in the same workspace (same endpoint host, different `database` → aliases `silver-employee`, `silver-facility`, …). **Table and column names are UNCHANGED (`dbo.employee`, `dbo.facility`, `dbo.treatmentsession`), so a repoint is an ALIAS SWAP ONLY.** Use these domain lakehouses, NOT the `silver-wh` mirror (`A_SilverWarehousesLakehouse`), which serves the same rows under schema `Aegis_Core_Silver_Lakehouse__dbo` with PascalCase renames and forces needless SQL rewrites. Each domain lakehouse also has an `inter.*` staging schema — always read `dbo.*`. Symptom when stale: `Invalid object name 'dbo.employee'`. (2026-08-14)
- **Silver `employee.NetHealthId` is now `bigint`, which the mssql driver returns as a STRING** while Bronze person ids are `int` → NUMBER. JS `Map` lookups use strict equality, so employee joins in Node **silently match nothing** (pull-clocking wrote 0 therapists; pull-ana-usage showed every name as "(unmatched)"). Key on `String(id)` both sides. Python/pandas consumers are immune because the CSV round-trip normalizes types — so this hides from the eval pipeline and only bites the JS pulls. (2026-08-14)
- Post-split `employee` grew ~10.2k → ~23k rows: ~94% of the added rows are historical **Terminated** Workday records (deeper history), plus `SourceType` (Workday/Special/Contractor) and `JobDiscipline` columns. NOT Broad River employees — UPN domains are still 99.8% `@aegistherapies.com`. `NetHealthId` stays unique, so no join fan-out. (2026-08-14)
- Bronze lands NetHealth GUID `varbinary` Id columns in TWO encodings — 16-byte binary AND the 36-byte ASCII text of the GUID string — and they don't join. `PatientLevelOptionalServices.Instance` flipped binary→text on 2026-06-01 while `.Service` stayed mixed, silently dropping ~98% of category lookups. Detect with `DATALENGTH(col)` (16 vs 36); normalize both sides to a canonical GUID string before joining. Assume ANY varbinary Id join can hit this. (2026-07-27)

## Related
- **fabric-service** — changing what is LIVE: item definitions over REST, rebinding,
  publishing, deleting, and auditing a model's consumers. This skill gets data OUT of Fabric;
  that one changes what is IN the service.
- **pbip-authoring** — PBIP file structure & TMDL syntax. The seam between the two is model binding
  (`definition.pbir` → dataset; a repointed .tmdl table's source partition).
- Memory: `project_fabric_connection`, `feedback_never_device_code`, `project_fabric_medallion`,
  `project_fabric_data_freshness`, `project_salesforce_removal`.
- `Service.MinutesPerUnit` is NULL on every high-volume service code (29 of 634 populated) and `Service.Billable` is a varchar `Always`/`Never`/`User Discretion`, not a bit. `Billing.ARCharge` is a ~8.6%-coverage direct-bill slice, NOT billing of record — never treat it as "what we billed". Minutes/unit is only comparable WITHIN `IsTimeBased` (14.4 vs 28.9 min/unit, July 2026). (2026-09-02)
- **`Billing.ARCharge` is Aegis OUTPATIENT ONLY** (all top facilities are "Aegis OP/GP at …", Division 5500; 3,395 of 39,419 July tracks; zero Contract Rehab SNF sessions). Never use it as a company-wide billing fact. And `Billing.ARClaimDetail` fans out ~1.54 rows per charge (26,524 of 47,967 July charges have 2), so `SUM(ARCharge.Duration)` across that join double-counts (+58%). (2026-09-02)
- **Silver `facility.LicenseNumber` IS the CMS CCN.** Silver has no column called CCN (only `NPI` and `LicenseNumber`), so CCN looks Salesforce-only and isn't. Verified 2026-09-15 against Salesforce `Account.CCN__c`: 232/232 overlapping facilities agree, ZERO contradictions; it is never wrong, only missing (1,781/2,713 populated, gaps are termed sites + `- PES - Teamworkers` screening sites). Use `COALESCE(NULLIF(LTRIM(RTRIM(LicenseNumber)),''), FacilityNumber)` when you need full coverage. This is what let PatientSatisfaction drop Salesforce entirely. (2026-09-15)
- **`FacilityNumber` is a CONTRACT LINE, not a building.** Silver `dbo.facility` has ~1.54 rows per physical building (666 distinct Salesforce Accounts vs 1,025 active `Contract_Number__c`), because a building carries separate SNF/OP/etc. contracts. Any measure ported from a Salesforce-era `DISTINCTCOUNT(Account[Id])` must count a building key (LicenseNumber, falling back to FacilityNumber) or it inflates ~50%. (2026-09-15)
