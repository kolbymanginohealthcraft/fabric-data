---
name: pbip-authoring
description: >-
  Playbook for hand-editing Power BI Project (PBIP) files — TMDL semantic models
  (.tmdl), report definitions (.json / .pbir / .platform), and the folder layout
  Fabric and Power BI Desktop require. Use BEFORE creating or editing any
  .tmdl, report.json, page.json, visual.json, definition.pbir, .pbip, or .pbism
  file, so Desktop opens the result instead of silently corrupting it. Covers
  folder structure, TMDL syntax, the clone-don't-minimize rule, and a pre-flight
  checklist. For Fabric connection/auth/lakehouse, see fabric-workflow; for pushing
  a definition to a LIVE artifact in the service, see fabric-service.
---

# PBIP Authoring Playbook

The PBIP format is unforgiving: a file can be **valid JSON / valid text and still fail
to open in Power BI Desktop** because it's missing a schema-required property or a
character is indented one tab off. The errors are cryptic and point at the wrong line.
This skill is the gauntlet to run so that doesn't happen.

**Golden rule that subsumes most others: clone, don't compose.** When in doubt, copy a
working artifact and change only what must change. Hand-authoring "minimal" versions
drops required properties that aren't visible until Desktop rejects the file.

---

## 1. Folder & file structure

A PBIP report + model is a fixed tree. Fabric/Desktop will not discover misplaced files.

```
<Name>.SemanticModel/
  definition.pbism                  # model project file
  definition/
    model.tmdl                      # model header, culture, annotations
    relationships.tmdl
    database.tmdl
    cultures/en-US.tmdl
    tables/<Table>.tmdl             # one file per table
<Name>.Report/
  .platform                         # workspace metadata
  definition.pbir                   # report project file — points at the model
  StaticResources/                  # themes, images — copy WHOLESALE when cloning
  definition/
    report.json
    pages/pages.json                # page index (order + active page)
    pages/<pageId>/page.json        # one folder per page
    pages/<pageId>/visuals/<visualId>/visual.json
<Name>.pbip                         # top-level project file
```

- One `.tmdl` file per table; the filename should match the table name.
- A page lives in its own `pages/<pageId>/` folder with a `page.json`; every visual lives
  in `pages/<pageId>/visuals/<visualId>/visual.json`. Deleting a visual means deleting its
  folder AND removing its reference if any index lists it.
- `pages/pages.json` is the index — page order and the active page. If you add/remove a
  page folder, reconcile this file.

## 1b. Two report formats — know which one you have FIRST

The tree above is **PBIR** (modern): a folder per page, a folder per visual. Older reports are
**PBIR-Legacy**: the whole report is ONE `report.json`, and there is no `definition/` folder.
Both are live in this repo, so check before writing any code against a report.

```
PBIR      <Name>.Report/definition/pages/<pageId>/visuals/<visualId>/visual.json
Legacy    <Name>.Report/report.json          <- single file, no definition/ folder
```

As of 2026-09-16: all 17 local reports are PBIR; of the 9 published, **3 are PBIR**
(Clinical Outcomes Main, SL Outcomes Report, Patient Satisfaction Report) and **6 are legacy**
(Clinical Outcomes Semantic at 2.4 MB, Patient-Level Outcomes, Clinical Outcomes, Ohana Villas
Stroke, Patient Satisfaction Report - Ohana, ANA Reponses).

**The API cannot convert between them** (`Report_Report_FailedToExportReport`). Only Desktop
can: open, save as PBIP with PBIR enabled, republish. See `fabric-service`.

### Converting legacy -> PBIR

**This will stop being optional.** Microsoft: *"When PBIR reaches General Availability, it will
become the only supported report format, and conversion will be mandatory."* PBIR is still in
preview, so convert on our timing, with verification, rather than having it happen to us.

Two routes. **The API is not one of them** (`Report_Report_FailedToExportReport`).

**A. In the Service (no Desktop).** Editing an existing report in the service auto-converts it.
A PBIR-Legacy backup is kept **28 days**; restore from the workspace via report settings ->
*Restore as PBIR-Legacy*. Requires the tenant setting *"Automatically convert and store reports
in the Power BI enhanced metadata format (PBIR)"* and the rollout to have reached the tenant.
Reading tenant settings needs Fabric admin, which Kolby is not — so test empirically on a small
report rather than trying to confirm it up front.

**B. In Power BI Desktop (controlled).**
1. File > Options and settings > Options > **Preview features**
2. Check **"Store reports using enhanced metadata format (PBIR)"**
   (PBIX files use the separate *"Store PBIR reports using enhanced metadata format (PBIR)"*)
3. Open the PBIP and **Save** → a prompt appears → **Upgrade**

`report.json` is replaced by the `definition\` folder. **One-way from the UI.** Desktop keeps a
backup for **30 days**:
```
%USERPROFILE%\AppData\Local\Microsoft\Power BI Desktop\TempSaves\Backups   (exe installer)
%USERPROFILE%\Microsoft\Power BI Desktop Store App\TempSaves\Backups         (Store version)
```

Note the service backup exists **only** for reports upgraded in the service. Upgrade by
publishing from Desktop and the Desktop backup is the only one you get.

Service-enforced PBIR ceilings: 1,000 pages/report, 1,000 visuals/page, 300 MB of report files,
300 MB of resource packages, 1,000 resource files.

### Legacy `report.json` anatomy

```
report.json
  config              STRING of escaped JSON
  filters             STRING of escaped JSON   <- report-level filters live here
  theme, resourcePackages, publicCustomVisuals, layoutOptimization
  sections[]                                   <- PAGES
    name, displayName, ordinal, width, height, displayOption
    config            STRING of escaped JSON
    filters           STRING of escaped JSON   <- page-level filters
    visualContainers[]
      x, y, z, width, height
      filters         STRING of escaped JSON   <- visual-level filters
      config          STRING of escaped JSON -> { name, layouts, singleVisual }
                                                singleVisual.visualType
```

**The trap that defines this format: `config` and `filters` are JSON *strings*, not objects.**
You must `json.loads` them, edit the object, and `json.dumps` back. Editing the outer file with
a regex will corrupt the escaping. Round-trip with `json.loads` / `json.dumps` at every level.

Other legacy specifics:
- Field references appear as `"Property"` on a `Column`/`Measure` with a `SourceRef.Entity`, and
  measures also as `"MeasureTable.<name>"` aliases. A rename map must handle both spellings, and
  must be applied **longest-name-first** so `Visits per Week` cannot clobber `Visits per Week BM`.
- `NativeReferenceName` is the DISPLAY label. Changing the underlying field does not change it,
  so a repointed visual can keep showing the old caption until you update it too.
- Conditional formatting is `"Conditional": {"Cases": [...]}`. **A case list with no else branch
  falls through to the theme default** — that is how an unexplained green bar appears. Fixing the
  measure model-side is usually cheaper than editing every conditional block.
- There is no `pages.json`; page order is `sections[].ordinal`.

## 2. TMDL measure syntax (the indentation trap)

Wrong indentation makes Desktop read `lineageTag` as part of the DAX and throw
"lineageTag syntax incorrect." Tabs, not spaces, for structural indent.

**Single-line DAX** — expression on the same line as `=`, properties at **2 tabs**:
```
	measure 'Total Facilities' = COUNTROWS(Facility)
		formatString: #,0
		lineageTag: de02e475-22e0-4ffd-9682-602f87e12fca
```

**Multi-line DAX** — `=` at end of the `measure` line, **blank line**, DAX body at
**3 tabs**, then properties drop back to **2 tabs**:
```
	measure 'My Measure' =

			CALCULATE(
			    COUNTROWS(MyTable),
			    FILTER(MyTable, MyTable[Col] = "X")
			)
		formatString: #,0
		lineageTag: de02e475-22e0-4ffd-9682-602f87e12fca
```

Rules:
- `lineageTag` must be a real GUID (8-4-4-4-12 hex). Every measure/column/table needs a unique one.
- Property order after Desktop round-trips: `lineageTag` → `summarizeBy` → `sourceColumn`.
  Match that order to minimize diff churn.
- `formatString` uses `#,0`, not `#,##0`.
- When unsure, open an existing table .tmdl in this repo and mirror it exactly.

## 3. The clone-don't-minimize rule (reports & models)

Hand-written "minimal" `report.json` fails to open: `themeCollection.baseTheme` REQUIRES a
`reportVersionAtImport` object (`{visual, report, page}` version strings) that a minimal
version omits. **JSON-valid ≠ schema-valid — only a working clone guarantees the full
required-property set.**

For a new thin report:
- `cp` a sibling report's `report.json` and ONLY empty `filterConfig.filters` (filters that
  reference entities absent from the new model cause dangling-ref errors). Keep
  `themeCollection` / `objects` / `publicCustomVisuals` / `resourcePackages` / `settings` intact.
- Copy `StaticResources/` **wholesale** so `resourcePackages` resolve.
- Base `page.json` / `pages.json` / `visual.json` on real working files, not from scratch.
- For a from-scratch semantic model, clone the `.pbism` / `database.tmdl` / `model.tmdl`
  header and a table+partition shape from a working model (e.g. ClinicalOutcomes).

## 4. Pre-flight checklist (run BEFORE opening in Desktop)

- [ ] **Which report format?** PBIR (folder-per-page) or legacy (single `report.json`)?
      Legacy `config`/`filters` are escaped JSON STRINGS — parse them, never regex them.
- [ ] **Cloned, not composed?** New report/model files originate from a working artifact.
- [ ] **JSON valid?** Every edited `.json` parses (it's necessary, not sufficient).
- [ ] **TMDL indentation?** Single-line = 2-tab props; multi-line = blank line + 3-tab body + 2-tab props.
- [ ] **GUIDs unique & well-formed?** No duplicated or malformed `lineageTag`s.
- [ ] **Folder/index reconciled?** Added/removed pages or visuals are reflected in
      `pages.json` and any referencing index; no orphan folders.
- [ ] **No dangling refs?** Filters/visuals don't reference model entities that don't exist.
- [ ] **StaticResources intact?** `resourcePackages` point at files that are actually present.
- [ ] **Model binding correct?** `definition.pbir` points at the intended `.SemanticModel`.

Then validate. Desktop is one way, but **not the only one, and usually not the fastest**: the
service validates server-side, so `updateDefinition` rejects malformed TMDL with a real error
(a duplicate `lineageTag` was caught exactly this way on 2026-09-15, in a sandbox copy, before it
could reach production). Rehearsing a push against a throwaway workspace item is a full schema
check without a Desktop round-trip. Desktop remains the only way to check that a report *renders*
as intended. See the service round-trip notes in this repo's `published/` docs.

---

## Pitfalls log (append-only)

One line per gotcha. When we hit a new PBIP/TMDL trap, add it here (and a memory file if
it's a discrete reusable fact). This is how the skill compounds.

- `themeCollection.baseTheme` requires `reportVersionAtImport` — hand-minimized report.json won't open. (2026-06-09)
- Multi-line TMDL DAX without the blank line + 3-tab body → "lineageTag syntax incorrect" parse error.
- `formatString: #,##0` is wrong; Desktop writes `#,0`.
- A measure and a column in the SAME table cannot share a name → Desktop open fails with `PFE_XL_MEASURE_COLUMN_ALREADY_EXIST`. When exposing a hidden raw column via an aggregation, give the measure a distinct name (column `Observed` → measure `Avg Observed`), like the therapist model's `Raw`→`Raw Value`. (2026-06-30)
- An invented `visualType` fails as **`CustomVisualNotFound`** ("add it to this report first: X"), NOT as an unknown-type error — Desktop assumes any unrecognized name is a marketplace visual. There is no `stackedColumnChart`: the built-in **stacked** column is `columnChart` and stacked bar is `barChart` (`clustered*` are the unstacked ones). Verify a new visualType against a working report in this repo before generating it. (2026-08-07)
- When cloning report.json, empty `publicCustomVisuals` too if the new page uses only built-ins — it's inherited like `filterConfig.filters` and makes Desktop register unused AppSource visuals. (2026-08-07)

## Related
- **fabric-service** — pushing these files to a LIVE artifact: getDefinition /
  updateDefinition, the guarded push, rebinding, sandbox rehearsal.
- **fabric-workflow** — Fabric connection/auth, lakehouse endpoints, repointing a model's
  SOURCE, refresh. The seam is model binding (`definition.pbir` → dataset).
- Memory: `feedback_tmdl_formatting`, `feedback_pbip_clone_structure`.
