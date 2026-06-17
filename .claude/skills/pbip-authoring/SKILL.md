---
name: pbip-authoring
description: >-
  Playbook for hand-editing Power BI Project (PBIP) files — TMDL semantic models
  (.tmdl), report definitions (.json / .pbir / .platform), and the folder layout
  Fabric and Power BI Desktop require. Use BEFORE creating or editing any
  .tmdl, report.json, page.json, visual.json, definition.pbir, .pbip, or .pbism
  file, so Desktop opens the result instead of silently corrupting it. Covers
  folder structure, TMDL syntax, the clone-don't-minimize rule, and a pre-flight
  checklist. For Fabric connection/auth/lakehouse/deployment, see fabric-workflow.
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

- [ ] **Cloned, not composed?** New report/model files originate from a working artifact.
- [ ] **JSON valid?** Every edited `.json` parses (it's necessary, not sufficient).
- [ ] **TMDL indentation?** Single-line = 2-tab props; multi-line = blank line + 3-tab body + 2-tab props.
- [ ] **GUIDs unique & well-formed?** No duplicated or malformed `lineageTag`s.
- [ ] **Folder/index reconciled?** Added/removed pages or visuals are reflected in
      `pages.json` and any referencing index; no orphan folders.
- [ ] **No dangling refs?** Filters/visuals don't reference model entities that don't exist.
- [ ] **StaticResources intact?** `resourcePackages` point at files that are actually present.
- [ ] **Model binding correct?** `definition.pbir` points at the intended `.SemanticModel`.

Then open in Power BI Desktop — that is the only true validation. Schema validity is not
guaranteed by any check short of a successful open.

---

## Pitfalls log (append-only)

One line per gotcha. When we hit a new PBIP/TMDL trap, add it here (and a memory file if
it's a discrete reusable fact). This is how the skill compounds.

- `themeCollection.baseTheme` requires `reportVersionAtImport` — hand-minimized report.json won't open. (2026-06-09)
- Multi-line TMDL DAX without the blank line + 3-tab body → "lineageTag syntax incorrect" parse error.
- `formatString: #,##0` is wrong; Desktop writes `#,0`.

## Related
- **fabric-workflow** — Fabric connection/auth, lakehouse endpoints, repointing, refresh,
  deployment. The seam between the two is model binding (`definition.pbir` → dataset).
- Memory: `feedback_tmdl_formatting`, `feedback_pbip_clone_structure`.
