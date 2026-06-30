# What Our Outcomes Data Actually Tells Us

*Plain-language findings for the Outcome Considerations Team. Companion to
[care-delivery-optimization-framework.md](care-delivery-optimization-framework.md).*

> **Status:** Working findings, June 2026. Based on the trailing 12 months of Section GG
> functional outcomes (~1.1M item measurements, ~230k therapy episodes), analyzed at the
> individual assessment-item level. All figures are exploratory and observational — see
> *Honest caveats* before quoting any number externally.

---

## The one-paragraph version

We set out to answer whether patient outcomes are "predictable" from things like age,
diagnosis, payer, and how much therapy we deliver. The honest answer is **two answers**:
**No, we cannot predict how much any one patient will improve** — and we never should expect
to; recovery is too individual. **But yes, the data can reliably tell better care apart from
worse care** — it consistently distinguishes which *facilities* and which *therapists* get
better results than expected for the patients they serve. That second finding is the
valuable one: it means the outcomes we've been collecting are trustworthy for measuring
**who delivers good care**, even though they can't forecast an individual's recovery. The
"knobs" the industry obsesses over — minutes per week especially — turned out to be weak and
mostly beside the point.

---

## The key idea: two very different questions

People hear "the data didn't predict outcomes well" and assume the data is bad. It isn't.
The confusion is that "predict" means two different things:

- **Predicting one patient** — *"How much will Mrs. Jones improve?"* This is genuinely hard,
  for everyone, everywhere. Recovery depends on a thousand things we don't capture (mood,
  family support, a good or bad week, biology). We explain only ~10–20% of it. **That's
  normal and expected — not a flaw.**
- **Measuring a provider** — *"Does this facility / therapist get better results than
  expected, over many patients?"* This we can do **reliably.**

**The baseball analogy:** you can't predict whether a hitter gets a hit in any single
at-bat — too random. But over a season, you can reliably tell a .300 hitter from a .220
hitter. Our data is the same: useless for one at-bat, dependable over a provider's caseload.
A good quality measure is *supposed* to look like this — low single-patient predictability,
high provider-level reliability. It's exactly how CMS's own quality measures behave.

---

## How we measure "good care" fairly

We don't just ask "who has the best raw outcomes," because that would punish whoever treats
the sickest patients. Instead, for every episode we calculate an **expected** result based on
the patient's starting point (their admission function, age, diagnosis, payer) — think of it
as **par for the course for that patient**. Then we compare what actually happened to that
expectation. Finishing **above expected** is the signal of good care. It's the same
observed-vs-expected, risk-adjusted logic CMS uses for its Discharge Function Score — a golf
**handicap** for patient difficulty, so a facility full of hard cases is compared fairly.

We also measure each outcome **one assessment item at a time** on its native scale (e.g., the
6-point "toilet transfer" score), rather than blending everything into a single 0–100% number.
That blended number was our old approach, and it quietly compared apples to oranges (a 40%
gain meant different things for different patients). Measuring item by item fixed that.

---

## What we found

### 1. Where you're treated, and who treats you, reliably matters

This is the headline. After adjusting for patient difficulty:

- **Facilities reliably differ.** Split a facility's patients randomly in half and rank
  facilities by each half — the same facilities come out on top both times (a reproducibility
  score of **0.79**, where 1.0 is perfect). Top facilities finish well above their expected
  function; bottom facilities well below. This is a real, stable difference in care, not luck.
- **Individual therapists reliably differ too — even within the same building.** Crediting the
  registered therapist who owns the evaluation and plan of care, some therapists consistently
  get better-than-expected results than their *own colleagues down the hall* (reproducibility
  **0.52** within a facility, **0.75** overall). The clinician matters, and measurably so.
- **"Manager" turned out to be the same thing as "facility."** A rehab manager essentially
  *is* their building's results — we couldn't separate a manager effect from the facility
  effect, because each leader runs one site.

**Why this matters:** it validates building a fair, risk-adjusted scorecard for facilities and
therapists. The data can support "this site / this clinician delivers measurably better
functional outcomes for comparable patients" — a defensible, credible claim.

### 2. The "knobs" we expected to matter… mostly don't

- **Patient age does not predict improvement.** Older patients improve about as much as
  younger ones. We tested this carefully (even comparing like-for-like on the same assessment
  item) — age is essentially flat. A common assumption, not supported by our data.
- **Minutes per week barely relates to outcomes.** Of all the dose measures, weekly minutes is
  the *weakest* predictor of whether a patient beats expectation. This fits its real role:
  minutes/week is an **industry signal**, not a care lever. (Under the old RUG payment system,
  rehab was paid by volume, so minutes ran 500+/week; PDPM shifted payment to value, and
  minutes fell toward ~400 and below. Customers read high or low minutes as a quality or
  cost signal — but that reading isn't grounded in actual functional results either way.)
- **Dose and length of stay looked important but were mostly an illusion.** Longer/more
  therapy correlated with better outcomes — until we removed episodes that ended for reasons
  outside our control (the patient went to the hospital, declined care, ran out of benefits).
  Those bad endings are *short* and *bad*, and they were inflating the "more is better" story.
  On clean episodes, the effect shrank by ~40%.
- **What therapy you deliver carries some signal, but it's tangled up with the patients.** More
  varied interventions, group therapy, and assistant-delivered care all *looked* positive — but
  that's mostly because they're chosen for steadier, higher-functioning patients, not because
  they cause better outcomes. The one clean point: **passive modalities (e-stim, ultrasound)
  are already nearly gone** (<1% of minutes), so the old "modalities are wasteful" worry is moot.

### 3. A note on assistants vs. registered therapists

Cases delivered mostly by assistants do **not** show worse outcomes — if anything they look
slightly better, because assistants tend to be assigned the steadier, recovering patients.
*However*, facilities that lean heavily on assistants overall tend to do **worse**. So the
honest read is: assistant delivery isn't harmful at the patient level, but heavy
assistant-reliance at the facility level is associated with weaker results. Useful nuance for
the registered-vs-assistant staffing conversation.

---

## What this means for us

1. **The data is trustworthy for what matters most — comparing providers.** That's the
   foundation for the My Quality Scorecard work and for any quality story we tell customers.
2. **Lead with risk-adjusted outcomes, not minutes.** We can credibly say "we judge our care
   by whether patients beat their expected function, fairly adjusted for who they are" — and
   we have a measure that does it. Minutes/week is a signal to manage perceptions, not a
   driver of results.
3. **The improvement lever is people and place, not a dose dial.** Since facilities and
   therapists reliably differ, the payoff is identifying what the top performers do and
   spreading it — not turning a minutes knob.
4. **Set expectations honestly.** We will never predict an individual's recovery well, and we
   shouldn't promise to. We *can* measure care quality reliably across caseloads.

---

## Honest caveats (please read before quoting)

- **Everything here is observational.** We can say a facility/therapist *reliably* gets
  better results; we cannot prove *why* (skill, culture, or unmeasured patient differences).
- **Risk adjustment is good but not perfect.** We adjust for admission function, age,
  diagnosis, and payer. We do *not* fully capture severity within a diagnosis, prior level of
  function, cognition, or social support. If harder-than-they-look patients cluster at a
  facility or therapist, some of their "below expected" is case-mix, not quality.
- **Comorbidity data is shallow** in therapy documentation (we see ~2 conditions per case, not
  the full medical picture), so our case-mix adjustment is a floor, not a ceiling.
- **These are internal functional-outcome measures, not CMS quality measures.** Our
  "discharge destination" and improvement numbers are **not** the CMS Discharge-to-Community or
  rehospitalization measures — different populations, different rules, not comparable. Don't
  present them as CMS measures.
- **Numbers will move** as the 12-month window rolls and as we refine the model.

---

## How it was built (for the curious)

- **Source:** Section GG functional items from the NetHealth medallion (Bronze), trailing 12
  complete months, true measured scores only (we excluded "not assessed" responses rather than
  treating them as full dependence).
- **Outcome:** observed minus expected discharge function, item-level, native 6-point scale.
- **Expected:** a risk-adjustment model on patient givens only (admission function, age,
  diagnosis, payer) — never on the things we control, so the residual reflects our care.
- **Provider credit:** the registered therapist who authored the evaluation (the plan-of-care
  owner) — the same attribution the therapist scorecard uses, which we confirmed gives a
  cleaner signal than crediting whoever logged the most minutes.
- **Reliability** = split the caseload in half at random and check whether the two halves rank
  providers the same way. High agreement = real signal, not noise.

*Analysis code: `analysis/` (Python) and `queries/` (Fabric pulls) in this repo.*
