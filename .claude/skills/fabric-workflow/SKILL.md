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

- **Silver** (`Aegis_Core_Silver_Lakehouse`, alias `silver`): conformed + fresh. Activity/labor/
  census/people → here NOW. `dbo.treatmentsession`, `dbo.treatmentminute`, `dbo.labor`,
  `dbo.employee` (UPN→security, JobCode→peer group), org spine (region/area/district/facility/
  facilityhierarchy). Case/stay/track tables are SKELETAL (keys only).
- **Bronze** (`NetHealth_Bronze_Lakehouse`, alias `bronze`): full near-real-time mirror, current to
  the hour. Has what Silver lacks: `dbo.TxDocument`/`TxDocumentItem` (271M), `dbo.PatientCase`,
  `dbo.Stay` (Admit/Discharge/DischargedTo/IsCurrent), `dbo.TxTrack` (Discipline, dates,
  **IsUnplannedDischarge bit**), `Billing.*`, `dbo.Lookup`. Clinical outcomes/case-episode → Bronze.
- **Gold:** EMPTY — nothing to bind to yet.
- **The one orphan:** `LibraryItem` / `LibraryScaleValue` exist in NEITHER bronze nor silver — still
  pulled ONLY from aegisdataprod `BINetHealthPatientLakehouse.NetHealthDocumentation`. This is the
  single confirmed hard blocker to fully retiring aegisdataprod for the outcomes model. → Scott's list.
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

## Related
- **pbip-authoring** — PBIP file structure & TMDL syntax. The seam between the two is model binding
  (`definition.pbir` → dataset; a repointed .tmdl table's source partition).
- Memory: `project_fabric_connection`, `feedback_never_device_code`, `project_fabric_medallion`,
  `project_fabric_data_freshness`, `project_salesforce_removal`.
