# My Quality Scorecard — Methodology

*Therapist clinical-outcomes and satisfaction evaluation. Committee reference.*

> **Status:** Working draft for committee review. Figures reflect the current trailing window
> (**Jun 1, 2025 – May 31, 2026**) and will move as the window rolls. This document explains
> *how* the scorecard is built — the definitions, the grouping rules, and the decisions behind
> them — so the committee can review and ratify the methodology, not just the numbers.

---

## 1. The two questions everything rests on

The entire evaluation depends on answering two questions cleanly and defensibly:

1. **How is a treatment *track* categorized?** — so that like is compared with like.
2. **How is a *therapist* categorized?** — so that each person lands on exactly one scorecard.

Most of this document is about getting those two right. The metrics themselves are
straightforward ratios; the credibility lives in the categorization.

---

## 2. The evaluation window

We evaluate the **trailing 12 *complete* calendar months**. The current partial month is always
excluded, and the window rolls forward automatically — but **not on the 1st**. Because the start of
a new month carries a data-reconciliation lag for the month that just closed, the window holds for a
**10-day reconciliation period** and **rolls forward on the 10th** of the following month.

- Today (late June 2026) the window is **Jun 1, 2025 – May 31, 2026**.
- On June 1–9 it would *still* read through **April 30** (May is not yet reconciled).
- On **July 10** it rolls to **Jul 1, 2025 – Jun 30, 2026** — no manual change required.

A track is "in the window" if its **discharge (track end) date** falls inside it. This keeps every
refresh comparing a full, stable, reconciled year and never mixes in a half-finished or
still-reconciling month. The same rule governs the satisfaction-survey window, so the clinical and
satisfaction numbers always cover the same period.

---

## 3. What is a "track"?

A **track** is one discipline's episode of care for one patient case — e.g. the PT track, the OT
track, and the SLP track within a single stay are three separate tracks. The track is the unit we
score, because it is the level at which a discipline's clinical work and outcomes actually live.

In the current window there are **~230,000** discharged tracks; **~195,800** fall inside our scope
(Contract Rehab + Senior Living — see §6). **95%** of in-scope tracks carry at least one recorded
outcome.

---

## 4. How a track is categorized — the cohort

Every track is placed in a **cohort** defined by exactly three dimensions:

> ### Discipline × Library × Place of Residence

A therapist is only ever compared against peers in the *same* cohort. The three dimensions are
defined below. **Division (Contract Rehab vs. Senior Living) is deliberately *not* a fourth
cohort dimension** — see §6 for why, and the one nuance it creates.

### 4.1 Discipline

The track's clinical discipline:

| Reported credentials | Cohort discipline |
|---|---|
| PT, PTA | **PT** |
| OT, OTA, COTA | **OT** |
| ST, SLP, CF-SLP, CFY, SLP-CF | **SLP** |

Assistants (PTA / COTA / OTA) are scored within their discipline's cohort. Consolidating the
speech variants to **SLP** prevents thin, fragmented speech cohorts and matches how the
satisfaction survey already labels the discipline.

### 4.2 Library (the assessment "version")

NetHealth assessment libraries come in outpatient and skilled-nursing flavors. We classify each
library item by its **version name**, using a single rule:

> **OP** (outpatient) if the version name contains `OP` or `GP`; otherwise **SNF** (the default).

A *track* can technically touch more than one library, so we assign each track the **dominant
library** — the one used by the majority of its outcomes, with ties broken to **SNF**.

**A key validation for the committee:** the long-standing assumption has been that a track draws
on a single library. We can now confirm how well that holds:

| | All charted outcomes | **Scored (included) outcomes** |
|---|---|---|
| Single library (assumption holds) | **94.4%** | **98.8%** |
| Mixed OP + SNF | 5.6% | 1.2% |
| ↳ of which a *genuine tie* (the SNF tiebreak actually decides) | 1.6% | 0.3% |

So the assumption holds **94.4%** of the time across all charted outcomes — and **98.8%** when
restricted to the *scored* (included) outcomes that actually drive cohorts. It gets *stronger* on the
data that matters because invalid and one-sided charting accounted for much of the apparent mixing;
once you require a valid, improvable outcome, the libraries separate almost completely. The tiebreak
rule decides at most **1.6%** of tracks (0.3% on the scored basis). We tested whether flipping it
(SNF-wins → OP-wins) changes any ratings: among the therapists who actually get scored, the composite
percentile moves **0.4 points on average**, and exactly **one** person moves more than 10 points.
**The tiebreak is immaterial** — the single-library assumption is sound, and the rare exceptions
don't sway results.

### 4.3 Place of Residence (PoR)

Where the patient was living during care, folded from NetHealth's intake-source codes into five
buckets:

| PoR bucket | Includes |
|---|---|
| **SNF** | Skilled nursing |
| **AL/MC** | Assisted living, memory care |
| **IL/OP** | Independent living, outpatient, continuing-care retirement communities (CCRC) |
| **Hospital** | Hospital |
| **Other** | Anything not recognized above (residual catch-all) |

**Complete code mapping.** Every intake-source code present in the current window, its NetHealth
`Name`, and the bucket it maps to. Counts are this window, all divisions. **Scored tracks** =
*included* outcomes (valid at both eval and discharge **and** improvable, i.e. not started at 100%) —
this is the basis for Gain and % Tracks Improved, and the honest clinical sample size. It is well
below the total wherever charting is sparse or outcomes are invalid (notably Home Health, and
Outpatient Clinic where it nearly halves). The looser *valid* tier (the basis for % Discharges-with-
Outcome and % Valid) sits a few percent above this.

| Code | NetHealth Name | → PoR bucket | Total tracks | Scored tracks (included) |
|---|---|---|---|---|
| `SNF` | Skilled Nursing Facility | SNF | 190,332 | 160,228 |
| `OC` | Outpatient Clinic | IL/OP | 11,474 | 5,769 |
| `HH` | Home Health | Other | 8,042 | **0** |
| `ALF` | Assisted Living Facility | AL/MC | 6,586 | 4,976 |
| `ILF` | Independent Living Facility | IL/OP | 5,236 | 3,374 |
| `OUT` | Outpatient | IL/OP | 3,367 | 2,140 |
| `HOS` | Hospital | Hospital | 3,203 | 1,474 |
| `CCR` | CCRC (continuing-care retirement community) | IL/OP | 1,092 | 948 |
| `MC` | Memory Care | AL/MC | 335 | 209 |
| `OTR` | Other | Other | 278 | 19 |
| `HSP` | Hospice | Other | 21 | 3 |
| `COM` | Community | Other | 19 | **0** |
| `CON` | Consulting | Other | 9 | 8 |

Notes the committee should know:

- **`Other` is dominated by Home Health** (`HH`, 8,042 tracks — Home Health stays carry their own
  residence code and have no crosswalked outcome library, so they are not cohortable anyway). The
  rest of `Other` is a handful of rare codes. It is the safe landing spot for any residence type we
  have not explicitly mapped — and the place to watch for data drift (e.g. the catalog also contains
  `ALD` "Assisted Living Facility - OP", which currently has zero in-window tracks but would fall to
  `Other` rather than `AL/MC` if it appeared, and would warrant an explicit mapping).
- **`OC` (Outpatient Clinic) is the source of the OP/SNF blend in IL/OP** — 62% of OC tracks use the
  outpatient library and 77% carry outcomes from *both* libraries; it is overwhelmingly Senior
  Living. The other IL/OP codes (`ILF`, `OUT`, `CCR`) are SNF-library-dominant.
- **`CCR` (CCRC) is clean, not a mixer:** 100% SNF library, 0% mixed, and flagged `Inpatient` /
  institutional — it behaves like skilled nursing and is entirely Contract Rehab. It is kept in
  IL/OP for stability; because Library is its own cohort dimension, its tracks already sit in
  SNF-library cohorts regardless of the PoR label, so its placement does not affect comparability.
  (If ever reclassified on semantic grounds, the data would point to SNF, not AL/MC.)

---

## 5. Outcome scoring rules (within a track)

The clinical metrics are built from individual recorded outcomes. The rules that decide which
outcomes count:

- **Valid** — the outcome has a numeric score at *both* evaluation and discharge. Only valid
  outcomes can produce a gain.
- **Disregarded** — the patient started at 100% (a perfect initial score). Improvement is
  impossible, so these are excluded from gain/improvement to avoid unfairly penalizing the
  clinician.
- **Included** — valid *and* not disregarded. This is the basis for **Gain** and **% Improved**.
- **GG imputation** — for the Section GG Mobility and Self-Care families, a blank or
  "not-assessed-at-eval" starting score is recoded to **0**, mirroring CMS's own imputation rules
  for those measures. *(Committee-endorsed; scoped only to GG Mobility/Self-Care.)*

---

## 6. Division (ServiceLine) — scope, not cohort

A facility's **division** is derived from its division code:

| Code | Division (ServiceLine) | In scope? |
|---|---|---|
| 08450 | Contract Rehab | ✅ |
| 05500 | Senior Living | ✅ |
| 06500 | HAP | ❌ |
| 05555 | Closed | ❌ |
| *(other)* | Other / unmapped | ❌ |

Division does **two** things — and *neither* is to define a cohort:

1. **Scope gate.** Only Contract Rehab and Senior Living tracks enter the evaluation. HAP, Closed
   facilities, and unmapped sites are excluded entirely.
2. **The Senior Living all-patients pool.** Because Senior Living is graded on its full caseload with
   no stay split (see §9), its Gain and % Tracks Improved are emitted under an "all-stay" label that
   the stay-split divisions never use — which naturally lands SL clinicians in a pool by themselves.
   This is the *one* place division membership produces a separate peer group, and it is a **side
   effect of the all-patients grading rule, not a deliberate segregation**.

**There is no corresponding "Contract Rehab–only" pool** — and that asymmetry is intentional, not an
omission. Contract Rehab (and Telehealth) clinicians are *always* ranked within the shared
Discipline × Library × PoR cohorts, alongside each other and any SL peers who share the cohort. SL
stands alone only on the two all-patients metrics; on every other metric it is pooled with everyone
else, exactly like CR. The reason we call the SL pool out so often is precisely *because* it is the
sole exception to "everyone shares the cohort pools" — exceptions need flagging so they don't read
as bugs.

### Why PoR mostly separates the divisions on its own

Because cohorts use Place of Residence, the divisions naturally fall into different cohorts most of
the time — but **not perfectly**:

| PoR bucket | % Contract Rehab | % Senior Living |
|---|---|---|
| SNF | 100% | 0% |
| AL/MC | 100% | 0% |
| Hospital | 100% | 0% |
| **IL/OP** | **45%** | **55%** |
| Other | 75% | 25% |

SNF, AL/MC, and Hospital are cleanly one division. **IL/OP is genuinely mixed** — Contract Rehab
outpatient and Senior Living independent-living land in the same bucket by design. The net effect:
about **12% of in-scope tracks** sit in a cohort that contains both divisions, almost all of it in
IL/OP. In those cohorts a CR clinician and an SL clinician are ranked against each other on the
non-Gain metrics. **This is a known, deliberate behavior and an open decision for the committee**
(see §11).

---

## 7. How a therapist is categorized — one scorecard, one bucket

Every clinician lands in **exactly one** scorecard group. The rule is intentionally a **1:1
employee attribute**, not an inference from where they happened to treat — so cross-coverage can
never put someone on two scorecards. The decision order:

1. **Role** is determined first (from job code and title): Manager, Registered, Assistant, or
   Excluded (non-clinical).
2. **Managers** → by job code: **SL Area Managers** are scored (Template B); Contract Rehab DORs
   and higher leadership are **parked** (recognized but not yet scored — see §10).
3. **Field clinicians** (Registered / Assistant):
   - Title says "telehealth" → **Telehealth Field Clinician** (Template A).
   - Otherwise, **home location → facility hierarchy → region → division**:
     - Home in Contract Rehab → **Contract Rehab Field Clinician** (Template A)
     - Home in Senior Living → **SL Field Clinician** (Template B)
   - **Fallback** (home is blank, HAP, or a Closed facility): use treatment footprint instead, and
     flag the row for spot-checking.

### How the population resolves

How each field clinician's group was decided:

| Basis | Count | Meaning |
|---|---|---|
| **Home division** | 5,298 | Clean 1:1 assignment (the intended path) |
| No scored tracks | 1,738 | Non-clinical / no activity in window — not scored |
| **Work-fallback** | 1,018 | Home blank/HAP/Closed → footprint used (flagged) |
| Telehealth (title) | 60 | |

**The multi-department concern, quantified:** among field clinicians who actually have scored work,
about **93% practice in a single division** (~7% straddle more than one) on their scored tracks.
*(An earlier "4.5% straddle" figure measured this over the entire roster — including ~3,400
clinicians with no scored activity, who trivially cannot straddle — which diluted the rate; on a
consistent "has real work" denominator it is ~7% whether measured on credited or scored tracks.)*
Either way it is a small minority, and **every straddler is resolved cleanly by home division** —
the 1:1 rule assigns one bucket regardless of footprint, so the home rule rarely even contradicts
the footprint; it mostly just *settles* the ambiguous cases. Same encouraging pattern as the
single-library finding: the messy exceptions are a small, identifiable minority.

---

## 8. Roles and attribution — who gets credit for a track

Credit for a track depends on the clinician's role:

| Role | Who | Credit (weight) |
|---|---|---|
| **Registered** | PT, OT, SLP | **1.0** for tracks where they authored the **evaluation** |
| **Assistant** | PTA, OTA | Their **share of treatment minutes** on tracks they treated |
| **Manager** | SL Area Manager | **1.0** for **every track in their building/territory** |

**Attribution does not sum to 1.0 per track — by design.** A single track can credit its treating
assistant, its evaluating registered therapist, *and* the building manager, because each is
accountable for a different facet of the outcome. This is a deliberate committee-endorsed choice:
managers own building-level results; it is not double-counting in the sense of inflating any one
person's own work.

**One role per person — overlapping real-world actions resolve cleanly.** Each clinician carries
exactly one role, and credit follows that role, so the common overlaps neither double-count nor
under-credit:

- A **registered therapist who also treats** already earns full credit (1.0) for that track by
  authoring its evaluation; their treatment minutes on it add nothing and are not separately counted.
- A **manager who also treats or authors an evaluation** already earns full building credit (1.0)
  for that track; the higher role subsumes the lower-level action.

The lone case this does not capture is a registered therapist who *treats* a track whose evaluation
they did *not* author — that treatment earns them no credit. It is rare enough to be immaterial and
is intentionally left as-is.

---

## 9. The metrics and where each applies

Each metric is a ratio rolled up per therapist. **Stay-split** metrics are reported separately for
**Short stay** (Medicare A / Managed Care A — payer types 1, 6) and **Long stay** (Medicare B /
Managed Care B — payer types 2, 7).

| Metric | Stay-split? | Applies to | Cohort | Notes |
|---|---|---|---|---|
| **Gain** | CR: Short/Long · SL: All patients | All clinical roles | Disc × Lib × PoR | SL graded on full caseload, SL-only pool |
| **Gain per Hour** | Short/Long | CR / Telehealth only | Disc × Lib × PoR | Not applied to Senior Living |
| **% Tracks Improved** | CR: Short/Long · SL: All patients | All clinical roles | Disc × Lib × PoR | SL graded on full caseload, SL-only pool |
| **% Usage of Required Measure** | No | **PT / OT only** | Disc × Lib × PoR | Counts a *valid* use, not mere presence |
| **% Valid** | No | All clinical roles | Disc × Lib × PoR | Quality of the outcomes recorded |
| **% Discharges with Outcome** | No | **Registered + Manager only** | Disc × PoR | Committee decision; N/A for assistants |
| **Advocacy Score** (satisfaction) | No | Discipline-specific | Facility × discipline | |
| **Response Rate** (satisfaction) | No | Discipline-specific | Facility × discipline | Capped at 100% |

**Senior Living is never stay-split.** Both SL field clinicians *and* SL area managers are graded on
**Gain** and **% Tracks Improved** over their entire caseload — all stays, all payers — and ranked in
the SL-only pool described in §6. Only Contract Rehab and Telehealth carry the Short/Long split.
**Gain per Hour does not apply to Senior Living at all.**

A few definitions worth stating plainly:

- **% Usage of Required Measure** asks whether the discipline's required measure (e.g. Gait Speed
  for PT, Barthel for OT) was actually used *validly* — scored at both eval and discharge — not
  merely present somewhere in the chart. Counting mere presence put this metric near 90%; counting
  *valid use* puts it around 44% and makes it genuinely discriminating.
- **% Discharges with Outcome** and **% Valid** measure two different things. **% Discharges with
  Outcome** = what share of discharges had a valid outcome captured (a documentation-completeness
  measure, owned by the evaluating therapist and the building — hence Registered + Manager only).
  **% Valid** = of the outcomes that *were* recorded, what share are usable.
- **Satisfaction metrics are discipline-specific.** Response Rate's denominator counts only the
  surveys for patients who actually received that discipline — so speech is never penalized for
  non-response on patients who never received speech therapy.

---

## 10. Output — Raw, Weighted, Percentile

For every applicable metric, each therapist gets three numbers:

- **Raw** — the metric with each of their tracks counted fully (no attribution weighting).
- **Weighted** — the metric after attribution weighting (each track scaled by their credit share).
- **Percentile** — their Weighted value ranked **within cohort**, then **volume-weighted across all
  the cohorts** they practiced in. A clinician who works across several cohorts gets a percentile
  that reflects each cohort's ranking, weighted by how much of their work was in it.

**Managers are ranked in a manager-only pool.** A building-level aggregate is inherently less
variable than an individual's numbers, so mixing the two would compress managers toward the middle.
Ranking managers against managers keeps their percentiles meaningful.

Two **composite** percentiles summarize the detail:

- **Clinical Excellence (Avg Percentile)** — the average of the clinical-metric percentiles.
- **Patient Satisfaction (Avg Percentile)** — the average of Advocacy Score and Response Rate.

All percentiles are reported on a **0–100** scale.

---

## 11. The reliability (volume) gate

A percentile built on very few tracks is noisy. Each therapist therefore carries a
**data-quality flag** based on their **effective track volume** — the sum of their attribution
weights over in-scope tracks (so for an assistant it reflects treatment-time share, for a
registered therapist it reflects eval authorship, and for a manager it reflects the whole
building):

- **≥ 25 effective tracks → `OK`** (shown on the scorecard).
- **< 25 → `low_volume`** (retained in the data and flagged, but not presented as a rated result).

The floor was raised from 10 to 25 after testing showed the 10–25 band carried roughly double the
extreme-percentile rate and high sampling error — i.e. it was letting noise through.

A useful side effect: the floor also screens out most **PRN (as-needed) staff**, whose intermittent
caseloads naturally fall below the threshold. So transient, low-commitment coverage does not surface
as a rated result — the scorecard reflects clinicians with a sustained patient load.

### Current population

| | Count |
|---|---|
| Evaluated rows (all clinicians touched) | 5,236 |
| **Scored (`OK`, ≥25 tracks)** | **2,077** |
| Low-volume (flagged, not scored) | 3,159 |

Scored therapists by group: Contract Rehab Field 1,829 · SL Field 207 · Telehealth 24 · SL Area
Manager 17. By discipline (scored): PT 989 · OT 824 · SLP 264.

---

## 12. Design principles (the through-line)

A few principles recur and are worth stating as the committee's guardrails:

- **Small explicit allow-lists with a safe default.** Both grouping rules — Library (OP vs. SNF)
  and Place of Residence (5 buckets) — map known values explicitly and send everything unrecognized
  to a default bucket (SNF / Other). Deterministic and auditable, with a clear place to watch for
  data drift.
- **One therapist, one scorecard.** Bucketing is a 1:1 employee attribute (home → division), never
  an inference that could straddle.
- **Like compared with like.** Cohorts hold discipline, setting, and assessment type constant.
- **Credit follows accountability.** Treaters, evaluators, and managers each earn credit for their
  facet; attribution is not forced to sum to 1.0.
- **Reliability before ranking.** A volume floor keeps thin samples out of the rated results.
- **Honest exceptions.** The categorization assumptions hold the vast majority of the time
  (~99% single-library and ~93% single-division on the scored data); the exceptions are measured,
  flagged, and small — not hidden.

---

## 13. Known nuances and open decisions

Items the committee may want to weigh in on:

1. **IL/OP cross-division pooling.** ~12% of tracks sit in cohorts containing both Contract Rehab
   and Senior Living (overwhelmingly the IL/OP bucket). On the non-Gain metrics, CR and SL
   clinicians are ranked together there. *Options:* leave it (same discipline/setting/assessment is
   arguably comparable) or add division as a fourth cohort dimension (cleaner, but thins the pools).
2. **Home Health absorption.** There is no Home Health scorecard yet, so ~95 HH-titled clinicians
   currently fold into the Contract Rehab group. A future HH bucket would separate them.
3. **Work-fallback rows (1,018).** Clinicians whose home location is blank/HAP/Closed are bucketed
   by treatment footprint and flagged. These are the rows most worth a periodic human review.
4. **Parked manager tiers.** Contract Rehab DORs and higher leadership are recognized but not yet
   scored; the same building-credit rule is ready to apply when the committee chooses to include
   them.
5. **Percentile vs. compliance framing** for the percentage metrics (% Usage, % Valid, %
   Discharges with Outcome), and whether the satisfaction metrics should be percentiled at all or
   presented as raw facility-level rates — both still open for committee discussion.

---

*This methodology is implemented in the `/queries/` (data extraction) and `/evaluation/` (scoring)
pipeline; figures are reproducible by re-running it against the current window.*
