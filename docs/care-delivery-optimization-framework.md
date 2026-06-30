# Care Delivery Optimization — Framework & Open Questions

*The data-driven foundation for **how we deliver care** — distinct from how we report outcomes.*

> **Provenance.** This document distills the best thinking from the retired
> `OutcomesIntelligence` project (a standalone repo of working notes, frameworks, and
> exploratory Python on a static Jan-2026 CSV extract). That repo is not being carried
> forward; its *ideas* — the optimization framework, the givens-vs-levers taxonomy, the
> MCID/MDC concept, and the measurement critique below — are. The exploratory *results*
> from it are not authoritative (stale, pre-medallion, and built on the very aggregate
> scale this document argues against).

---

## 1. Two layers of outcomes work — and why this one is different

We do two fundamentally different kinds of outcomes work, and conflating them has caused confusion.

| | **Outcomes reporting** *(what we have)* | **Care delivery optimization** *(this document)* |
|---|---|---|
| **Question it answers** | *How are we doing?* | *How should we deliver care, and when are we done?* |
| **Audience** | Customers, marketing, therapist evaluation | Clinical operations, care model |
| **Unit** | Aggregate, blended outcome score | Individual assessment items, comparable like-for-like |
| **Examples** | My Quality Scorecard, customer outcome decks | Optimal therapy plan, discharge-readiness logic |
| **Good enough?** | Yes — fit for purpose | No — needs a more fundamental measurement basis |

The existing work — unifying every assessment into one 0–100% scale — is **genuinely good for its
purpose**: reporting to customers how we're doing, generating marketing, and evaluating therapists
on a common footing. This document is about a **more fundamental level**: using data to shape how
the company actually *delivers* care. That level cannot stand on the blended scale (see §6).

---

## 2. The two questions everything rests on

The "predictability" framing the committee uses is shorthand for two deeper questions:

1. **What defines a successful outcome, and when have we achieved it?**
   → Understand what "good" looks like and when therapy should *stop*.
   - Functional gain achieved **efficiently, safely, and sustainably** — not just raw gain.
   - Independence appropriate to the patient's *potential*, at appropriate discharge timing.
   - Readiness signals: functional thresholds by destination, **plateau detection**,
     **MCID/MDC met** (§5), goal attainment, safety (falls/adverse events).

2. **What is the optimal therapy plan to get there?**
   → Find the **right inputs** and the **sweet spot before diminishing returns**.
   - Frequency, session intensity, daily intensity, duration/LOS, scheduling pattern.
   - Dose-response curves that locate where marginal gain falls below MCID.
   - Avoid both **over-treatment** (therapy past plateau = wasted resource) and
     **under-treatment** (stopping before plateau = lost potential).
   - "Optimal" varies by patient type — segment, don't average.

> We optimize for **the right therapy, at the right intensity, for the right duration** —
> not maximum minutes and not maximum gain.

---

## 3. Givens vs Levers

The organizing principle. Every variable is either something we **must adjust for** but cannot
change at the case level (a *Given*), or something we **can influence** (a *Lever*). We optimize the
levers, segmented by the givens.

### Givens (Patient & Episode Context) — segment / adjust, cannot change
- **Patient:** baseline function (admit level), age, cognition (BIMS), primary impairment/diagnosis,
  medical complexity/comorbidities, pain at admission, surgical vs medical, prior level of function,
  **and which outcome-measurement tool was used** (determines applicable MCID/MDC — see §6).
- **Payer/administrative:** payer type, authorization limits, expected LOS, PDPM clinical category,
  reimbursement model.
- **Admission context:** source (acute/community/other SNF), days since acute event, timing, reason.
- **Social/environmental:** living situation, caregiver availability, home accessibility, DME needs,
  support network, geography.
- **Facility assignment:** facility id/type/size, region, resources. *(Given per case, but
  improvable system-wide via training, staffing, best practices.)*

### Levers (Therapy Delivery) — actionable
- **Scheduling quality:** weekend coverage, session consistency/gaps, start-of-care lag,
  front-loading, sessions/week, time-of-day.
- **Intensity:** total minutes, minutes/day, minutes/session, daily-intensity (fatigue) threshold,
  intensity progression.
- **Discipline mix:** PT/OT/ST composition and ratios.
- **Intervention type & complexity:** CPT codes, individual vs concurrent vs group, eval complexity
  (97161/2/3), intervention diversity and progression, appropriateness to condition.
- **Continuity & staffing:** therapist continuity, team size, individual therapist, weekend staffing,
  experience.
- **Episode structure:** LOS, total sessions, treatment density, pace (early vs late gains),
  discharge timing relative to plateau.

### Variable priority tiers (from the original framework)
- **Tier 1 (always include):** baseline function, total minutes, LOS, payer, facility.
- **Tier 2 (strong):** weekend coverage, consistency, front-loading, discipline mix,
  **age — for case-mix adjustment** *(note: filed as an adjustment covariate, not a headline
  predictor — see §7).*
- **Tier 3 (refinement):** therapist continuity, sessions/week, daily-intensity pattern, cognition,
  comorbidities, CPT patterns, service-type mix.
- **Tier 4 (contextual):** facility size, region, admission source, discharge destination
  *(an outcome, not a predictor)*.

---

## 4. Primary outcomes & efficiency metrics

- **Functional gain** — blended, **and discipline-specific (PT/OT/ST separately)**, and relative to
  baseline (% of possible improvement). *(The "blended" version is exactly what §6 challenges.)*
- **Efficiency:** gain per minute (FG/min, the payer-neutral primary efficiency measure),
  gain per 1000 min, gain per day.
- **Discharge success:** discharge-to-home, appropriate timing, goal attainment, **MCID/MDC achieved.**
- **Resource utilization:** total minutes, LOS, sessions, cost per functional gain.

---

## 5. Clinical significance: MCID & MDC

- **MDC (Minimal Detectable Change):** the smallest change that exceeds **measurement error** —
  "is this real, or noise?"
- **MCID (Minimal Clinically Important Difference):** the smallest change that is **meaningful** to
  patient/family/clinician — "is this actually worth something?"

These are **discipline- and measure-specific** by nature (gait speed, TUG, GG mobility, GG self-care,
FOIS, etc. each have their own thresholds). Their intended uses:
- **Success/readiness:** don't call a patient "successful/ready" unless gain ≥ MDC *and* ≥ MCID
  (or a plateau with goals met). Prevents "false success" where a numeric gain is below clinical
  meaning.
- **Sweet spot:** stop when marginal gain is unlikely to reach MCID; flag "no detectable improvement"
  when gain < MDC after enough sessions.
- **As outcomes themselves:** model **probability of achieving MCID**, not just any positive change.

> MCID/MDC are the bridge from "a number moved" to "care delivered value," and they only make sense
> **per measure** — which is precisely why the blended scale is a problem.

---

## 6. The measurement flaw — the unified 0–100% scale

**The core critique.** Our outcomes today express improvement by unifying *every* assessment into a
single 0–100% scale (0 = complete dependence, 100 = complete independence), pooling all three
disciplines and all domains — self-care, mobility, ADLs, communication, swallowing — into one number.

This is potentially a **fatal flaw for care-delivery analysis** because **not every patient is
assessed on the same things.** Consequently:

- A **40% gain for one patient is not the same as a 40% gain for another.** One may reflect a few
  basic mobility items; another a communication battery. The *unit of measurement itself varies by
  patient.*
- MCID/MDC (§5) are measure-specific, so a blended % can't be checked against any single threshold.
- Comparisons "like-for-like" are impossible when the things being compared aren't the same things.

The framework half-anticipated this — it lists *"outcome measurement tool used"* as a patient given,
calls for *discipline-/measure-specific* MCID/MDC, and lists discipline-specific gains beside the
blend. The production model collapsed all of it into one scale anyway. For **reporting** (§1) that
trade-off is acceptable. For **deciding how to deliver care**, it is not.

**The direction:** start tracking outcomes at the **individual library-item level** (each assessment
element on its own native scale), so that a gain on item *X* is comparable across every patient
assessed on item *X*. Define item-level outcomes as **% achieving MCID/MDC on that item**, then
re-aggregate deliberately — never by averaging unlike things into one number up front.

---

## 7. Case study — why "age doesn't predict outcomes" is an artifact, not a finding

A quick model on the old aggregate extract (108k episodes) found patient **age had ~0 predictive
power** for blended functional gain (R² ≈ 0.00; mean gain flat ~0.23–0.26 across every age band 50→95+),
while payer, diagnosis, and expected-discharge-destination carried more signal. The committee found
this surprising. It is almost certainly **a measurement/method artifact, not evidence that age
doesn't matter.** Three compounding causes:

1. **The blended scale (§6).** When the outcome unit varies by patient, any genuine age signal is
   averaged into noise *before age ever enters a model.*
2. **Age modeled as a single global linear term.** Age likely matters *within* a homogeneous group
   (e.g., within hip-fracture patients on a specific mobility item) but in directions that cancel
   across groups — a flat main effect hiding real within-cohort effects (interaction / Simpson's
   masking).
3. **Diagnosis absorbs age.** Older patients concentrate in low-gain conditions (dementia, stroke,
   degenerative); once diagnosis is in the model the residual age effect is near zero. That's
   confounding, not irrelevance.

**Honest framing for the committee:** the current analysis *cannot see* age's effect; it does not
disprove it. Fixing the measurement unit is the prerequisite to testing age (or any given) fairly.

**Methodology tweaks that could recover age (and other givens):**
- Analyze at the **library-item level** so a gain is comparable.
- Outcome = **% achieving MCID/MDC on a specific item**, with baseline-on-that-item as recovery
  potential.
- Test givens **within homogeneous item × diagnosis cohorts, with interactions** — not as global
  main effects.

---

## 8. Where the data lives

The retired repo's extracts were **all aggregate** and cannot support item-level work:

- `cases2.csv` — pre-grouped case rows; admit/discharge already normalized to 0–1.
- `tracks.csv` — case × discipline, already-normalized admit/discharge/gain.
- `treatments.csv` — track × labor-date minutes only.
- **No individual library items / assessment elements / scale values anywhere.**

The needed granularity already exists in the **Fabric medallion**:
- Per-item scale values — `LibraryScaleValue` (in the `patient` lakehouse).
- Item/library linkage — `TxDocument.Library_ID`; the track-grain scorecard pipeline already taps
  this layer.

So the two efforts pair cleanly: **this framework supplies the questions; the medallion supplies the
item-level data to answer them in comparable units.**

---

## 9. Proposed path forward

1. **Prove the artifact on existing aggregate data (fast, this-week).** Re-run with age × diagnosis
   interactions and within-cohort stratification on the blended gain. Shows whether interactions
   alone recover age — produces the "here's why age looked flat" answer without new data.
2. **Build the first item-level outcome from the medallion (the real fix).** Pull a slice of
   `LibraryScaleValue` via the fabric pipeline, define a single item's outcome as % achieving
   MCID/MDC, and demonstrate comparable like-for-like results. Reusable foundation for the broader
   care-delivery model.

---

## 10. Glossary

- **Given** — patient/episode factor we adjust for but can't change at the case level.
- **Lever** — therapy-delivery factor we can influence (the optimization target).
- **MDC** — minimal detectable change (exceeds measurement error).
- **MCID** — minimal clinically important difference (meaningful to patient/clinician).
- **Blended scale** — the 0–100% dependence→independence score that unifies all disciplines/domains.
- **Library item** — an individual assessment element on its own native scale (the comparable unit).
- **Plateau** — point where marginal gain per additional therapy falls below MCID.
</content>
</invoke>
