---
name: fabric-service
description: >-
  Playbook for changing what is LIVE in the Power BI service from here, without
  Power BI Desktop — reading and writing item definitions over the REST APIs
  (getDefinition / updateDefinition), polling long-running operations, rebinding a
  report to a different semantic model, rehearsing a push in a sandbox, and auditing
  what depends on a model before deleting it. Use whenever the task touches a
  PUBLISHED artifact: edit a live report or model, repoint/rebind, publish, delete,
  check refresh history, or mirror the service into published/. For editing PBIP
  files on disk see pbip-authoring; for querying lakehouse data see fabric-workflow.
---

# Fabric Service Playbook

`pbip-authoring` covers files on disk. `fabric-workflow` covers reading data out of
lakehouses. **This skill covers the round trip in between: pulling a live artifact's
definition down, changing it, and putting it back — safely.**

This is how the Clinical Outcomes consolidation was done (2026-09-15/16): five reports
repointed, a model rewritten, an orphaned model retired, zero Desktop round-trips.

**Golden rules:**
1. **Never push a definition you have not diffed.** Fetch, change, re-fetch, compare, and
   refuse to push if anything you did not intend has moved. The pattern below.
2. **Rehearse in a sandbox before production.** The service validates server-side, so a
   throwaway copy tells you about a malformed edit before customers do.
3. **A shared lineageTag proves ancestry, not equivalence.** Compare VALUES before assuming
   two measures are the same thing.

---

## 1. Auth — two resources, same `az` session

Same rule as `fabric-workflow`: shell `az` directly, **never** a device code.

| API | Base | Token resource |
|---|---|---|
| Power BI | `https://api.powerbi.com/v1.0/myorg/` | `https://analysis.windows.net/powerbi/api` |
| Fabric | `https://api.fabric.microsoft.com/v1/` | `https://api.fabric.microsoft.com` |

```bash
az account get-access-token --resource "https://analysis.windows.net/powerbi/api" --query accessToken -o tsv > pbi.token
az account get-access-token --resource "https://api.fabric.microsoft.com"          --query accessToken -o tsv > fab.token
```

Tokens expire in ~1 hour; a cached token file WILL go stale mid-session. When a call starts
returning 401, re-mint rather than debugging the request.

**Which API for what:** Fabric's `items/{id}/getDefinition|updateDefinition` is the only way
to read/write an artifact's *definition*. Power BI's API owns everything else — listing
reports and their `datasetId`, `Rebind`, refresh history and schedules, apps, deletion.

## 2. Item definitions — the core round trip

```
POST workspaces/{ws}/items/{id}/getDefinition?format={fmt}
POST workspaces/{ws}/{reports|semanticModels}/{id}/updateDefinition
```

`format` must match what the artifact already is:

| Artifact | format |
|---|---|
| Semantic model | `TMDL` |
| Report, modern | `PBIR` |
| Report, legacy single-file | `PBIR-Legacy` |

**The API will not convert between report formats.** Asking for `PBIR` on a legacy report
fails with `Report_Report_FailedToExportReport` — *"Report is using format '[CurrentFormat]'
and cannot be converted to '[APIFormat]' using the API."* Converting legacy → PBIR requires
Power BI Desktop (open, save as PBIP with PBIR enabled, republish). Check which you have
before writing code against it: legacy is a single `report.json`, PBIR is
`definition/pages/<pageId>/`.

**Deploying a report via REST requires a `byConnection` `datasetReference`, not `byPath`.**
`byPath` is for opening the PBIP locally; over the API only the semantic model id is needed:
`{"datasetReference": {"byConnection": {"connectionString": "semanticmodelid=<id>"}}}`. Our
`published/` mirror deliberately carries `byPath` so the folders open in Desktop — do not push
that copy's `definition.pbir` back to the service unchanged.

Parts come back base64 in `definition.parts[]` as `{path, payload, payloadType}`; send them
back the same shape. **Drop `.pbi/` parts before pushing** — they carry local cache and
credential blobs.

### Long-running operations

Both calls usually return **202** with a `Location` header instead of a result:

```python
r = call('workspaces/%s/items/%s/getDefinition?format=TMDL' % (ws, rid), 'POST')
if r.get('__status') == 202:
    u = r['__headers']['Location']
    while True:
        time.sleep(2)
        s = call(u)
        if s.get('status') in ('Succeeded', 'Failed'):
            break
    if s.get('status') == 'Failed':
        raise SystemExit(s['error'])          # real errorCode + message live here
    r = call(u.rstrip('/') + '/result', 'POST')
    if '__error' in r:                        # some tenants want GET on /result
        r = call(u.rstrip('/') + '/result', 'GET')
```

A `Failed` LRO still returns HTTP 200, so **check `status`, not the status code.** The useful
diagnostic is in `error.errorCode` / `error.message`.

## 3. The guarded push (use this every time)

Never push a blind write. Declare what you expect to change and abort on anything else:

```python
EXPECTED = {'definition/tables/MeasureTable.tmdl'}

svc = fetch(item_id)                                   # re-fetch immediately before pushing
changed = {p for p in local if local[p] != svc.get(p)}
if changed - EXPECTED:
    raise SystemExit('ABORT - unexpected delta: %s' % (changed - EXPECTED))
```

This caught three would-be production problems in one session. Two came from **the service
re-serializing what you push**: blank lines gain indentation, a trailing blank line appears.
That is normal, not corruption — sync the repo copy to the service's serialization once, then
the guard stays quiet and meaningful.

**`.platform` needs special handling.** Its `config.logicalId` differs per workspace, so it
trips the guard on every cross-workspace compare. Compare with that key removed, and keep the
service's copy:

```python
if '.platform' in changed:
    a, b = json.loads(svc['.platform']), json.loads(local['.platform'])
    a['config'].pop('logicalId', None); b['config'].pop('logicalId', None)
    if a != b:
        raise SystemExit('ABORT - .platform differs beyond logicalId')
    local['.platform'] = svc['.platform']
```

## 4. Rebinding a report to a different model

```
POST groups/{groupId}/reports/{reportId}/Rebind    body: {"datasetId": "<target>"}
```

Instant and reversible — record the original `datasetId` first so a rollback is one call.
Rebind alone does NOT fix field references: if the target model names things differently, the
report's `report.json` still points at the old names and visuals break. Apply a rename map
**longest-name-first**, or `Visits per Week` will clobber `Visits per Week BM` and
`Visits per Week Delta` on the way past.

## 5. Rehearse in a sandbox

Item-definition APIs **work on Pro / shared capacity** (`isOnDedicatedCapacity=False`) — no
Fabric capacity needed. So there is no excuse for a first attempt in production:

1. Create the item in **My Workspace** (or any scratch workspace).
2. Push the edited definition there.
3. A malformed edit fails here with a real error. A duplicate `lineageTag` was caught exactly
   this way, which also surfaced six measure rename pairs that would otherwise have shipped.
4. Only then push to the live workspace.

## 6. Before deleting a model, prove nothing uses it

A semantic model's consumers are reports, dashboards, apps, composite models, and Excel over
XMLA. Check all the ones you can:

```python
for w in get('groups')['value']:                        # every workspace you can see
    for rep in get('groups/%s/reports' % w['id'])['value']:
        if rep.get('datasetId') == target: ...
get('groups/%s/dashboards' % ws)                         # tiles can bind straight to a dataset
get('apps')                                              # then apps/{id}/reports
```

**The API cannot see an Excel workbook connected over XMLA.** You cannot prove that negative,
so for anything customer-facing, disable the refresh schedule first and delete after a quiet
period — a hidden consumer goes stale (visible, recoverable) instead of breaking.

Also check `groups/{ws}/datasets/{id}/refreshes` and `/refreshSchedule`: an orphan that still
refreshes daily is costing source-system load for nothing, and that is often the first sign a
model was superseded but never retired.

## 6b. Converting a report to PBIR (tested 2026-09-16)

Service-side conversion **is enabled in this tenant** and works in two clicks. Proven on a
throwaway copy in My Workspace (`360c187f-69a0-4655-b77b-1c61df22dec6`, addressable via the
Fabric API as a normal workspace, type `Personal`):

| probe | before the save | after |
|---|---|---|
| `getDefinition?format=PBIR-Legacy` | OK, 6 parts | **FAILS** |
| `getDefinition?format=PBIR` | FAILS | **OK, 15 parts** |

Lossless on that report: 1 page and 6 visuals both sides, identical visual types.

**The conversion itself cannot be automated from here.** The agent can copy, probe, verify and
commit; only a human Edit + Save in the service (or a Desktop save) performs the translation,
because producing PBIR parts from legacy IS the conversion and the API refuses it.

**One-way at the API level, not just in the UI.** After conversion the service will no longer
return the legacy form at all. So **commit the legacy snapshot to `published/` BEFORE the save** —
git becomes the only remaining copy of it. The service keeps its own 28-day *Restore as
PBIR-Legacy*, but only for reports converted in the service, not ones published from Desktop.

Working split, per report: agent syncs and commits the legacy state -> human opens, edits, saves
-> agent re-fetches as PBIR, writes it down, checks page/visual counts and visual types against
the committed legacy copy, commits. Pick a nudge that is a real improvement where one is
available; a report missing its `ContextTable[Context] = FacilityRestricted` condition is a good
candidate, since several reports carry that card with no condition set.

## 7. Mirroring the service into `published/`

`published/` is a snapshot of what is LIVE, not a build target. When you change a live
artifact, re-fetch and write it back down, or the repo starts lying. Set each report's
`definition.pbir` to `{"datasetReference": {"byPath": {"path": "../<Model>.SemanticModel"}}}`
so the mirror opens locally, and commit the sync **in the same commit as the change** — a doc
describing a reversal while the definitions still hold the pre-revert state is worse than no
doc.

### Removing a field from a report visual is more than its projection

Deleting a field means finding **every** reference to it, and some are bare strings in lists that a
structural walk over field objects will not see. Verified 2026-09-16 removing `Aegis Contract[Tech
Status]` from two pivot tables: after clearing `visual.query.queryState.<role>.projections`, a
fourth reference survived in

```
visual.expansionStates[0].levels[1].queryRefs[0] = "Aegis Contract.Tech Status"
```

the pivot's row-hierarchy collapse/pin state. Both visuals had one. Pushing without it would have
left an expansion level keyed to a column that no longer exists.

So: after removing projections, also strip matching `queryRefs` entries from `expansionStates`,
drop levels that empty out, and drop an `expansionStates` entry with no levels left. Then **assert
the field name does not appear anywhere in the serialized visual** before pushing:

```python
if b'Tech Status' in json.dumps(j, indent=2).encode():
    raise SystemExit('ABORT - reference survives')
```

That raw-string assertion is what caught it; a walk over `field.Column.Property` did not. When a
role's projection list empties entirely, delete the role rather than leaving `projections: []` — a
pivot whose only row field is removed becomes a totals-only visual, which is valid but usually
wants deleting, so say so rather than silently leaving it.

### Syncing the mirror: compare normalized, and never re-fetch `.platform`

Writing service bytes straight into `published/` rewrites line endings on every file, so a sync of
one changed table can show **124 modified paths** and bury the real diff. Two rules, both learned
2026-09-16:

- **Write only files whose content differs with line endings normalized** (`b.replace(b'
', b'
')`).
  Six files changed that day; a naive full write staged 124.
- **Never overwrite `.platform` from a `getDefinition`.** It came back with
  `"logicalId": "00000000-0000-0000-0000-000000000000"` instead of the item's real id. Skip it on
  sync; it is also the field that trips cross-workspace diffs (see the guarded push above).

Also: deleting a mirror folder fails with `PermissionError: WinError 32` if any shell's working
directory is inside it. Run syncs from the repo root.

### `queryBinary` is noise, not drift

When comparing a `published/` mirror against the service, report visuals will differ on
`queryBinary` alone. It is the service's compiled-query cache and it regenerates on its own, so
it changes without anyone editing the report. Verified 2026-09-16 across three reports (17 of 30
visuals on one page of `Clinical Outcomes`): **strip `queryBinary` recursively before comparing**,
and all three were byte-identical afterwards. Do not resync or raise an alarm over it.

```python
def strip_qb(o):
    if isinstance(o, dict):  return {k: strip_qb(v) for k, v in o.items() if k != 'queryBinary'}
    if isinstance(o, list):  return [strip_qb(v) for v in o]
    return o
```

Unrelated but adjacent: print report content with `PYTHONIOENCODING=utf-8`. Page names contain
characters (e.g. a diamond) that crash the default Windows console codepage mid-diff.

## 8. Pre-flight checklist

- [ ] **Fresh token?** Re-minted this session, not a stale cache file.
- [ ] **Right format?** `TMDL` for models; `PBIR` vs `PBIR-Legacy` matches what the report IS.
- [ ] **LRO handled?** Checking `status`, not just the HTTP code.
- [ ] **Guarded?** An `EXPECTED` set, aborting on any other delta; `.pbi/` stripped.
- [ ] **Rehearsed?** Tried in My Workspace first if the edit is structural.
- [ ] **Rollback known?** Original `datasetId` / definition saved before the write.
- [ ] **Consumers checked?** For a delete: reports across all workspaces, dashboards, apps.
- [ ] **Mirror synced?** `published/` updated in the same commit.

---

## Pitfalls log (append-only)

One line per gotcha. Add when we hit a new one (and a memory file if it's a discrete fact).

- A `Failed` long-running operation still returns **HTTP 200**. Check `status`, not the code; the real reason is in `error.errorCode`. (2026-09-15)
- `/result` wants **POST** on some tenants and **GET** on others — try POST, fall back to GET. (2026-09-15)
- The service **re-serializes** pushed TMDL (blank lines gain indentation, trailing blank lines appear). Expect a guard to fire once per file; sync the repo to the service's serialization rather than fighting it. (2026-09-15)
- `.platform` `config.logicalId` differs per workspace and will trip any cross-workspace diff. Compare with it removed; keep the service's copy. (2026-09-15)
- Item-definition APIs work fine on **Pro / shared capacity** — a sandbox rehearsal needs no Fabric capacity. (2026-09-15)
- A **shared `lineageTag` proves ancestry, not equivalence.** Two Gain Axis measures shared a tag and returned 0.330 vs 0.815. Compare VALUES; when in doubt add a new measure with a fresh GUID instead of trusting the tag. (2026-09-15)
- Duplicate `lineageTag`s are rejected by `updateDefinition` — which is a *feature*, and the reason to rehearse in a sandbox. That rejection surfaced six rename pairs. (2026-09-15)
- Report rename maps must be applied **longest-name-first**, or `Visits per Week` clobbers `Visits per Week BM` / `Delta`. (2026-09-15)
- The API **will not convert a report between legacy and PBIR** — `Report_Report_FailedToExportReport`. Only Desktop can. (2026-09-16)
- Conditional formatting with a `"Conditional": {"Cases": [...]}` block and **no else branch** falls through to the theme default, which is how a stray green bar appears. Fixing it model-side beat editing 26 conditional blocks. (2026-09-15)
- Deleting a workspace's usage-metrics report does not keep it gone — Power BI regenerates `Report Usage Metrics Model`. Don't treat its reappearance as a mistake. (2026-09-16)
- **`updateDefinition` validates model STRUCTURE, not that the M query runs.** A partition whose
  native SQL is malformed pushes back `Succeeded`, then fails at the next refresh. Always **dry-run
  the generated SQL against the endpoint** before pushing (`SELECT TOP 1 * FROM (<sql>) AS _p`).
  This caught a `CHARINDEX(eval,...)` that should have been `CHARINDEX('eval',...)`. (2026-09-18)
- **Bash cannot escape a single quote inside a single-quoted string.** `'...''eval''...'` silently
  becomes `eval`, stripping the SQL literal quotes. Pass SQL through a **file**, never an inline
  shell-quoted env var. The push still reports `Succeeded`, so only the dry-run catches it. (2026-09-18)
- **A TMDL `column X` block is not necessarily a source column.** DAX calculated columns match the
  same pattern but have no `sourceColumn:` line; including one in a generated `SELECT` collides with
  itself. Key column extraction off `sourceColumn:`. (2026-09-18)
- **Bronze `varchar` columns can carry trailing padding that the dataflow trimmed.** `dbo.Service`
  returns `'Fitness '` where the model holds `'Fitness'` — and `ServiceCode` is a relationship key, so
  porting without `RTRIM` silently breaks every join. Compare keys, not just row counts. (2026-09-18)
- **Mojibake in a query result may be the CLIENT, not the data.** Bronze `Latin1_General_100_BIN2_UTF8`
  stores a real en dash; the Node mssql reader rendered it `â€“`. Confirm with
  `UNICODE(SUBSTRING(...))` and `DATALENGTH` vs `LEN` before 'fixing' anything. (2026-09-18)
- **`updateDefinition` can fail on capacity, not correctness** — `Dataset_Import_FailedToImportDataset`
- **`executeQueries` TRUNCATES silently.** A 49,306-row x 6-wide-string-column query returned 44,241
  rows with no error and HTTP 200 — a response-size cap, well under the documented 100k-row limit.
  Always chunk and assert each chunk returned the row count you expected. (2026-09-18)
  / 'throttled ... because of insufficient memory'. It rolls back atomically (verify!), and an identical
  retry usually succeeds. Ports run near 03:00 UTC succeeded first try; 13:30 UTC did not. (2026-09-18)

## Related
- **pbip-authoring** — the file formats you are pushing (TMDL syntax, PBIR vs legacy layout).
- **fabric-workflow** — auth background, lakehouse endpoints, and repointing a model's SOURCE
  (as opposed to repointing a REPORT at a model, which is `Rebind`, here).
- `published/README.md` — what is currently live, and the retirement log.
