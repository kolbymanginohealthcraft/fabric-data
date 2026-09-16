---
name: my-quality-scorecard
description: >-
  Runbook AND preserved methodology for the My Quality Scorecard (therapist
  clinical-outcomes + satisfaction evaluation) — the outcomes_and_satisfaction.xlsx file
  IT ingests for the People Dashboard. The programme is DORMANT as of 2026-09-02, so the
  usual use is explaining or reviving how it worked, not running it. Use whenever the task
  is to run, refresh, rerun or deliver the therapist scorecard, to debug a step of that
  pipeline, or to hand the approach to someone picking it up later. Covers the one-command orchestrator, the
  10th-of-month window rule, the review-before-deliver gate, auth prereqs, and the
  known traps. For Fabric auth/query mechanics see fabric-workflow; for the scoring
  definitions see docs/my-quality-scorecard-methodology.md.
---

# My Quality Scorecard — monthly deliverable runbook

> **Status: dormant, kept deliberately (2026-09-16).** The committee series behind this ended
> **2026-09-02**, so nothing is being delivered monthly right now. This skill is retained as the
> record of HOW it worked, for whoever revives it — Kolby, Billy or someone else. Treat it as a
> design document with a runbook attached, not a live obligation.
>
> **Before trusting any of it again, re-verify:** the trailing-window and 10th-of-month rules
> still match what IT ingests; the auth prereqs (see `fabric-workflow`) still hold; and the
> source tables have not moved. Two things underneath it HAVE already changed — library
> classification now comes from the authoritative `TxDocument.Library_ID` rather than a
> VersionName heuristic, and the outcomes crosswalk gained the OP2025.5 items it had been
> silently dropping (both 2026-09-16). The methodology doc is current on those; this runbook's
> operational steps are the part most likely to have drifted.

Produces `outcomes_and_satisfaction.xlsx` (single sheet `Sheet1`, scored therapists only) and
delivers it to the ITPowerBiFiles OneDrive folder, where IT's ingest picks it up for the People
Dashboard. The methodology (cohorts, metrics, attribution, groups) lives in
`docs/my-quality-scorecard-methodology.md`; the IT-facing column contract in
`docs/outcomes-and-satisfaction-migration-guide.md`. This skill is the *operational* runbook.

**Cadence:** trailing 12 *complete* calendar months. The window **rolls on the 10th** (a 10-day
reconciliation buffer for the just-closed month), NOT the 1st. Deliverable is expected by the
**10th of each month**. On July 17 the window is `Jul 1, 2025 – Jun 30, 2026`.

## The one command

Everything is orchestrated by `evaluation/run_pipeline.py` (dependency-ordered, fail-fast, live
logs, timing summary). Default is **stage-only and safe** — it never touches the live file.

```
python -m evaluation.run_pipeline            # full run: pulls + score + satisfaction + feed + STAGE
python -m evaluation.run_pipeline --deliver  # + overwrite the live OneDrive file
python -m evaluation.run_pipeline --skip-extract   # reuse existing CSVs (rescore only; ~1 min)
python -m evaluation.run_pipeline --list           # print the ordered steps, run nothing
```

The 20-step DAG: 9 Node Fabric pulls → satisfaction Graph pull → clinical chain
(`build_tracks → build_attribution → score → build_roster`) → satisfaction chain
(`extract_satisfaction_lookups → build_planned_discharges → build_satisfaction →
build_satisfaction_feed`) → `build_feed` → `build_deliverable`. Full run ≈ a few minutes
(track-outcomes pull dominates, ~60s + ~2.5M rows).

## The correct monthly flow (recommended)

1. **`az login`** must be current (Fabric pulls). Check: `az account show`. Never surface a device
   code — see fabric-workflow.
2. Run **stage-only** first: `python -m evaluation.run_pipeline`.
3. **Review the staged file before shipping** (`data/outcomes_and_satisfaction.xlsx`) against the
   live file — see the review gate below.
4. If it looks right, ship: `python -m evaluation.build_deliverable --deliver` (or re-run the
   orchestrator with `--deliver`). This backs up the current live file to
   `data/deliverable-backups/` then **atomically replaces** the OneDrive file.
5. **Close the file in Excel first** — the deliver step fails loudly (won't half-write) if Excel or
   OneDrive holds a lock.

## Review gate (before --deliver)

Confirm on the staged `data/outcomes_and_satisfaction.xlsx`:
- **Schema parity:** 71 columns, same order as the live file (IT ingest matches by name).
- **Window rolled:** `Timeframe` / `period_start`/`period_end` reflect the current trailing 12
  months; `as_of_date` is today.
- **Population churn is sane:** OK count moves modestly month-over-month (e.g. 2,077 → 2,019);
  large swings mean an upstream problem.
- **Blank patterns match the methodology (blank = N/A, NEVER 0):** `*_All_Stay` present only for
  Senior Living; `Percent_Tracks_With_Outcome_*` blank for assistants; `Percent_Usage_*` blank for
  SLP; percentiles within [0,100]; raws in sane ranges (Gain can be negative; Response Rate ≤ 1).

## Known traps (learned the hard way)

- **Never mix windows.** Every extract bakes `GETDATE()` into its SQL window (`>= 10th` logic). If
  some CSVs were pulled before the 10th and some after, they span different windows and must NOT be
  combined. A monthly run re-pulls **all** extracts the same day. `--skip-extract` is only safe when
  the existing CSVs are all from one same-day pull.
- **Satisfaction fetch IS automated** via `queries/pull-satisfaction-graph.ps1` (delegated Microsoft
  Graph, `Files.Read.All` already tenant-consented, silent via the Windows token broker; one browser
  sign-in only if no cached token — never device code). The old `pull-satisfaction.js` "download from
  the browser" note is **stale** — ignore it. Files come from Brad Miller's OneDrive by itemId with a
  name-search fallback.
- **The feed CSV is NOT the deliverable.** `build_feed` emits `therapist-scorecard-feed.csv` = the
  FULL audit set (OK + low_volume, ~5,200 rows). `build_deliverable` filters to `data_quality_flag ==
  'OK'` (~2,000 rows) and writes the xlsx. Shipping the raw CSV would leak low-volume/unreliable rows.
- **Percentiles are volatile; raws/weighteds are stable.** Percentiles are rankings across the whole
  evaluated pool, so tiny input changes reshuffle them (some by many points) even when a person's own
  raw is unchanged. Don't chase small percentile diffs between two runs — that's expected. One clean
  full run produces one internally-consistent set.
- **Delivery is reversible:** every `--deliver` snapshots the prior live file to
  `data/deliverable-backups/outcomes_and_satisfaction_<timestamp>.xlsx` (LOCAL + gitignored, not the
  prod folder; the newest `KEEP_BACKUPS=12` are retained, older pruned). To roll back, copy the wanted
  backup over the live file.
- **Schema-change months only:** add `--prod-snapshot` (works on both `build_deliverable` and
  `run_pipeline`) to also leave a dated `outcomes_and_satisfaction_backup_YYYY-MM-DD.xlsx` copy of the
  OUTGOING file *in the prod folder*, so IT's app-builder can diff old-vs-new columns (the March-2026
  courtesy). Do NOT use it on routine same-schema months — it just clutters prod.

## Debugging a failed step

The orchestrator stops at the first non-zero exit and names the step. Fix it, then re-run — use
`--skip-extract` to avoid re-pulling Fabric if the failure was in the consumer chain. Each consumer
step is independently runnable: `python -m evaluation.<step>` from repo root. Inputs/outputs for each
step are in `evaluation/README.md` and the module docstrings.

## Data-source pointers

- Clinical extracts: Bronze/Silver Fabric via `queries/pull-*.js` (see fabric-workflow).
- Satisfaction: Brad Miller's OneDrive via Graph (`pull-satisfaction-graph.ps1`); RR denominator
  from `pull-discharges.js`; scoring lookups decoded from the PatientSatisfaction PBIP.
- Delivery target: `…\ITPowerBiFiles - Documents\People Dashboard Data Sources\outcomes_and_satisfaction.xlsx`
  (override with `build_deliverable --target PATH`).
