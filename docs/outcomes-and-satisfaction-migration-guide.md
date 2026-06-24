# `outcomes_and_satisfaction.xlsx` — File Change Guide for IT

*How the refreshed file differs from the version currently ingested, and what to check downstream.*

> **Purpose:** This file (`outcomes_and_satisfaction.xlsx`, single sheet `Sheet1`) is being replaced
> with output from the rebuilt **My Quality Scorecard** methodology. The file name, location, and
> sheet name are unchanged — but the columns and some semantics have changed. This guide lists every
> difference and the specific things to verify in any ingest or report that consumes it. The full
> reasoning behind the methodology lives in `my-quality-scorecard-methodology.md`.

---

## At a glance

| | Old file | New file |
|---|---|---|
| File name / sheet | `outcomes_and_satisfaction.xlsx` / `Sheet1` | **unchanged** |
| Rows | 2,023 | **2,077** (scored therapists only) |
| Columns | 57 | **71** |
| Column overlap | — | **54 retained** (same names, same scales) |
| Removed | — | **3 columns** |
| Added | — | **17 columns** |

The shared columns keep their **original names, order, and value scales** (percentiles 0–100;
raw/weighted on their native scale, e.g. Gain can be negative). The legacy block is intact; new
columns are appended at the end.

---

## 1. Columns REMOVED (3)

| Removed column | What it was | What to do instead |
|---|---|---|
| `Clinical_Excellence_Rating` | 1–5 star rating | Use **`Clinical_Excellence_Avg_Percentile`** (0–100, retained). The methodology now reports percentiles/composites rather than a 1–5 bucket. |
| `Patient_Satisfaction_Rating` | 1–5 star rating | Use **`Patient_Satisfaction_Avg_Percentile`** (0–100, retained). |
| `Peer_Group` | Old discipline-based peer grouping | Closest analog is **`ScorecardGroup`** (added) — but it is defined differently (it identifies *which metrics apply* to a therapist, not a discipline peer set). Re-point any slicer/filter and verify. |

**Action:** any report visual or measure that references one of these four must be re-pointed
before the new file is ingested, or it will error / go blank.

---

## 2. Columns ADDED (17)

**New Senior Living metrics** (all-patients basis — see §4):

| Column | Meaning |
|---|---|
| `Gain_All_Stay_raw` / `_weighted` / `_percentile` | Gain over **all** of a Senior Living therapist's patients (no stay split). Blank for Contract Rehab / Telehealth. |
| `Percent_Tracks_Improved_All_Stay_raw` / `_weighted` / `_percentile` | % Tracks Improved over all patients, Senior Living only. Blank for CR / Telehealth. |

**New context / metadata columns:**

| Column | Meaning |
|---|---|
| `Discipline` | Credential discipline (PT / OT / SLP). |
| `Role` | Registered / Assistant / Manager (attribution role). |
| `ScorecardGroup` | Which scorecard the therapist is graded on (Contract Rehab Field Clinician, SL Field Clinician, Telehealth Field Clinician, SL Area Manager). |
| `Template` | `A` (CR / Telehealth) or `B` (Senior Living) — the metric set that applies. |
| `UPN` | User principal name (for per-therapist security / identity). |
| `data_quality_flag` | `OK` = meets the reliability threshold (shown on a scorecard); `low_volume` = below it. |
| `scoring_version` | Methodology version stamp. |
| `as_of_date` / `computed_at` | When the file was generated. |
| `period_start` / `period_end` | Exact bounds of the evaluation window (see §4). |

**Action:** if the ingest enforces a strict/fixed column list, add these. If it matches by column
name, no change is needed (extra columns are simply available).

---

## 3. Columns RETAINED (54)

All other columns keep their **exact names, order, and scales** — identity (`Timeframe`,
`Person_ID`, `EmployeeNo`, `Name`, `StaffTitle`, `JobCodeId`, `Cohort`, `All_Disciplines`,
`Primary_Discipline`), the volume block, the per-metric `raw` / `weighted` / `percentile` triplets
for the stay-split and flat metrics, and the two `*_Avg_Percentile` composites. Percentiles remain
**0–100**; raw/weighted remain on their native scale. No rescaling is required on these columns.

`JobCodeId` (the Workday job code) is retained, in the same integer format and position. Its values
are **refreshed to current** — a small share of therapists (~1%) will show a different code than the
prior file because their role changed since it was last produced; the new value is the correct one.

---

## 4. Behavioral changes to be aware of (even on retained columns)

These do not change column names, but they change how values should be **read**. Getting these
wrong is where false conclusions can creep in.

1. **A blank metric cell means "not applicable," not zero.** Under the new methodology each therapist
   carries only the metrics that apply to their scorecard; the rest are intentionally blank. **Never
   coerce a blank to 0** in an average or aggregation — treat it as N/A.
   - **Senior Living** therapists: the stay-split columns (`Gain_Short/Long_Stay_*`,
     `Gain_Per_Hour_*`, `Percent_Tracks_Improved_Short/Long_Stay_*`) **and** the `Short_Stay_*` /
     `Long_Stay_*` volume columns are blank — SL is graded on all patients (use the `*_All_Stay`
     columns).
   - **Contract Rehab / Telehealth** therapists: the `*_All_Stay` columns are blank — they are graded
     stay-split.
   - `Percent_Usage_Of_Required_Measure_*` is blank for **Speech (SLP)** — it applies to PT/OT only.
   - `Percent_Tracks_With_Outcome_*` is blank for **assistants** — it applies to registered
     therapists and managers only.

2. **Composites reflect only applicable metrics.** `Clinical_Excellence_Avg_Percentile` and
   `Patient_Satisfaction_Avg_Percentile` are each averaged over only the metrics that apply to that
   therapist — so they are directly comparable across therapists without adjustment.

3. **Population = scored therapists only.** The file contains therapists who meet the reliability
   threshold (`data_quality_flag = "OK"`). If your ingest ever receives `low_volume` rows, **filter
   to `OK`** before reporting — low-volume scores are not reliable enough to display.

4. **Evaluation window.** Values cover the **trailing 12 complete calendar months**. The window rolls
   forward on the **10th of each month** (a 10-day reconciliation buffer for the just-closed month),
   not the 1st. `period_start` / `period_end` give the exact bounds; `Timeframe` is the display label.

5. **Percentiles are within-cohort, volume-weighted.** A percentile compares a therapist to peers in
   the same Discipline × assessment-library × setting cohort. (Details in the methodology doc.)

---

## 5. IT checklist before going live

- [ ] Re-point any visual/measure using `Clinical_Excellence_Rating` or `Patient_Satisfaction_Rating`
      (1–5) to the corresponding `*_Avg_Percentile` column (0–100).
- [ ] Replace `Peer_Group` references with `ScorecardGroup` (verify slicers — the grouping differs).
- [ ] Confirm blank metric cells are treated as **N/A**, never 0, in all aggregations.
- [ ] If any `low_volume` rows arrive, filter to `data_quality_flag = "OK"`.
- [ ] Use the `*_All_Stay` columns for Senior Living; expect them blank for CR / Telehealth.
- [ ] Confirm joins key on `EmployeeNo` or `Person_ID`.

---

*Questions on any metric definition: see `my-quality-scorecard-methodology.md` (or its Word version).*
