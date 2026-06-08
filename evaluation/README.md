# Therapist Evaluation — scoring pipeline (consumer side)

Computes per-therapist clinical-outcome metrics from the Fabric medallion. Methodology
(attribution rules, cohorts, metrics, scorecard groups) is documented in the project memory;
this README is the operational run-book.

## Run order

Extraction (Node, from repo root — pulls Fabric → gitignored CSVs):

```
node queries/pull-track-base.js        # track-base.csv      (discharged-track universe + dims + Stay)
node queries/pull-track-outcomes.js    # track-outcomes.csv  (ungated per-outcome measurements)
node queries/pull-eval-author.js       # eval-author.csv     (registered-credit source)
node queries/pull-employee-dim.js      # employee-dim.csv    (roles + supervisor edge + HomeLocation)
node queries/pull-attribution.js       # therapist-attribution.csv (treatment minutes, eval excluded)
node queries/pull-library-dim.js       # library-dim.csv     (LibraryItem -> OP/SNF)
node queries/pull-facility-dim.js      # facility-dim.csv    (Facility_ID -> DivisionCode)
node queries/pull-facility-hier.js     # facility-hier.csv   (District/Area/Region ledgers)
node queries/pull-missed-visits.js     # missed-visits.csv   (per Person x Setting missed/delivered counts)
```

Consumer (Python, `python -m evaluation.<step>` from repo root):

```
build_tracks       # tracks.csv        one row/track: cohort dims, Stay, 6 metric components
build_attribution  # contributions.csv role-based track->therapist credit
score              # therapist-metrics.csv  per (therapist x metric x stay) Raw/Weighted/Percentile
build_roster       # employee-roster.csv    per-employee audit (role, group, template, ...)
build_missed_visits_feed  # missed-visits-feed.csv  MissedVisitRate, long schema (ready, gated off)
build_hh_candidates       # hh-clinician-candidates.csv  HH-group roster options (see docs/home-health-roster-options.md)
build_feed         # therapist-scorecard-feed.csv  wide app feed (the IT handoff surface)
```

## What each consumer step does

- **build_tracks** — assembles the per-track table; derives valid/disregarded/included/gain,
  dominant library, ServiceLine, PoR bucket, hours (treatment minutes).
- **build_attribution** — Registered = full credit for tracks they authored the eval on;
  Assistant = treatment-minute share; SL Area Manager = building credit over territory (shared
  `territory_codes` ledger rule). CR DORs + the leadership tier are PARKED.
- **score** — in-scope = Contract Rehab + Senior Living only; percentile within Outcome Cohort
  (Discipline × Library × PoR); stay-split metrics rank within cohort ∩ stay.
- **build_roster** — implements the scorecard-group classifier; one auditable row per employee.
- **build_missed_visits_feed** — % missed visits (MissedVisitRate = missed / (missed+delivered)) per
  clinician per setting, from missed-visits.csv. Plain rate only — no FR/frequency split exists in the
  data (see project memory). Emits the same long schema as satisfaction so build_feed can fold it in.
- **build_feed** — pivots metrics wide + joins identity/group + stamps version metadata. Folds in
  satisfaction always; folds in missed-visits only when `INCLUDE_MISSED_VISITS=1` (off by default —
  the metric is ready but HH clinicians aren't a scored group yet, and it currently spans all settings).

Auth: `fabric-query.js` shells `az` directly; run `az login` once (rolling refresh → no re-auth).
Install deps: `pip install -r evaluation/requirements.txt`.
