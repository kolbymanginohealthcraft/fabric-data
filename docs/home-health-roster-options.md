# Home Health Field Clinician — roster definition options

**Status: UNDECIDED (options intentionally open).** This documents the candidate ways to define the
"Home Health Field Clinician" scorecard group. No definition is committed. The candidate roster
flags every clinician against **all** definitions at once so populations can be compared before a
choice is made.

- Build: `python -m evaluation.build_hh_candidates`
- Output: `data/hh-clinician-candidates.csv` (one row per candidate clinician, all signals + all flags)

## Why this is a judgment call, not a lookup

There is **no authoritative HR designation for home health.** Workday (Silver `dbo.employee`) exposes
only `JobTitle`, `JobCode`, and `HomeLocation`; the Workday-bronze lakehouse has no worker/position/
cost-center tables. There is **no Home Health division** — clinicians map to Contract Rehab (08450),
Senior Living (05500), HAP (06500), or Closed (05555) via `HomeLocation`, and home-health workers sit
inside CR/SL. So membership must be **inferred** from two imperfect signals:

1. **Job title** — `JobTitle` contains "home health" (the `HH_titled` flag). Noisy: many titled
   employees are terminated or never deliver an HH visit.
2. **Visit activity** — share of a clinician's visits delivered in `HomeHealthAgency`-setting
   facilities (validated 100% concordant with the `HH` place-of-residence code). The two signals
   agree on only ~66 people, so neither alone is sufficient.

Visit identification is solid; *who is "a home health clinician"* is the open business question.

## Candidate definitions and resulting populations

Counts from the current 1-year window. "active" = Status Active; "active & ≥20 HH" applies a
volume floor (below 20 HH visits the share is noisy).

| Definition | Rule | All | Active | Active & ≥20 HH | Character |
|---|---|--:|--:|--:|---|
| `def_AnyHH` | ≥1 HH visit | 299 | 237 | 187 | Broadest — 57% are incidental (<25% HH); mostly CR/SL clinicians |
| `def_MajorityHH` | ≥50% of visits HH | 79 | 62 | 58 | Works mostly in HH |
| `def_PredominantHH` | ≥75% of visits HH | 61 | 50 | **46** | **Recommended core** — clearly HH-focused |
| `def_PureHH` | 100% HH | 48 | 40 | 36 | Dedicated HH only |
| `def_Titled` | HH job title | 149 | 64 | 54 | HR signal; includes non-deliverers |
| `def_TitledAndDelivers` | titled AND delivers HH | 67 | 58 | 54 | High precision (both signals agree) |
| `def_TitledOrPredominant` | titled OR ≥75% HH | 157 | 68 | 57 | High recall (safety net) |

Realistic scorecard populations land in the **~36–58** range. Discipline mix at the recommended core
(active, ≥75% HH) is roughly even PT/PTA/OT, with little ST — consistent with home-health rehab.

## Trade-offs

- **Precision vs recall.** `def_PureHH`/`def_TitledAndDelivers` minimize false positives (won't wrongly
  score a SNF clinician) but may miss clinicians who split time. `def_AnyHH`/`def_TitledOrPredominant`
  catch everyone who touches HH but sweep in incidental/SNF-primary clinicians.
- **Title vs activity.** Title reflects HR intent (what they were hired to do); activity reflects what
  they actually did this period. They diverge — pick which question the scorecard is answering.
- **Volume floor matters.** ~25% of HH deliverers have <20 HH visits; their HH_share and missed rate
  are noisy. Most definitions should be paired with the floor.
- **Mixed-setting clinicians.** A clinician at 60% HH / 40% SNF could be scored in *both* an HH group
  and a CR/SL group. Decide whether membership is exclusive (assign to dominant setting) or overlapping.

## Important: HH gets operational metrics only

Home health has **no clinical outcomes** (validated: 0.33% of HH tracks all-time carry any outcome
scale; 0 in-window). So whichever definition is chosen, this group is scored on **operational** metrics
(`MissedVisitRate`, and satisfaction if/when sourced) — **not** the outcome metrics (Gain, %Improved,
%Valid, %DischWithOutcome), which have no data for HH. This requires a scoped template in `score.py`
distinct from the CR/SL clinical template.

## Using the candidate CSV

`data/hh-clinician-candidates.csv` — one row per clinician in the universe
(HH deliverers ∪ HH-titled). Key columns:

- Identity: `Person_ID, FullName, Discipline, JobTitle, Status, Active, HomeDivision, CurrentScorecardGroup`
- Signals: `HH_titled_flag, HH_visits, HH_missed, HH_missed_rate, Total_visits, HH_share, low_volume, OtherSettings`
- Definition flags: `def_AnyHH, def_MajorityHH, def_PredominantHH, def_PureHH, def_Titled, def_TitledAndDelivers, def_TitledOrPredominant`

To preview any definition's roster: filter the CSV to that flag = TRUE (optionally also `Active` and
`not low_volume`), and read `HH_share` / `OtherSettings` to confirm the people look right.

## When a definition is chosen

1. Add an HH branch to `build_roster.py` `classify()` keyed on the chosen flag(s).
2. Give the group an operational-only metric template in `score.py` (admit HH to scope for those
   metrics only).
3. Scope `missed-visits-feed.csv` to the group and set `INCLUDE_MISSED_VISITS=1` in `build_feed`.

Re-run `build_hh_candidates` whenever the window/data refreshes; the counts will drift.
