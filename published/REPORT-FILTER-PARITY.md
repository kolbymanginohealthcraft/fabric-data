# Why two reports on the same model showed different headline numbers

**Resolved 2026-09-15.**

After the consolidation, `Clinical Outcomes` and `Clinical Outcomes Semantic` both ran on
`Clinical Outcomes Main` over the same date range, and still disagreed:

| | Cases / "Discharges" | Measurements | Facilities |
|---|---|---|---|
| Clinical Outcomes | 24,906 | 339,919 | 278 |
| Clinical Outcomes Semantic | 25,811 | 339,934 | 299 |

## Single cause

`Clinical Outcomes` carried a report-level filter the other did not:

```
DischargeDestination[Setting] is not null
```

Every other filter matched — `ReliableScope`, `Context = FacilityRestricted`,
`Department = "All Other"`, `Contract_Number__c is not null`, and the date range. Reproduced
from the model exactly:

| Filter set | Cases | Measurements | Facilities |
|---|---|---|---|
| Shared filters only | 25,811 | 339,934 | 299 |
| Shared + `Setting is not null` | 24,906 | 339,919 | 278 |
| **Difference** | **905** | **15** | **21** |

## What the 905 excluded cases are

Cases whose discharge destination maps to none of the eleven known settings:

| Setting | Cases |
|---|---|
| SNF | 9,088 |
| Home | 7,823 |
| Hospital | 3,768 |
| ALF | 1,653 |
| ILF | 1,205 |
| **(blank)** | **905** |
| Other | 372 |
| Hospice | 363 |
| Expired | 273 |
| Memory Care | 185 |
| IRF | 108 |
| Left Facility AMA | 68 |

They look like incomplete records rather than real activity:

- **15 measurements across 905 cases.** Effectively empty.
- **None are still open** — every one has a `TherapyEndDate`. Closed cases that never had a
  discharge destination recorded, not work in progress.
- They touch 28 facilities, and **21 of those have nothing but these cases** — which is the
  299 vs 278 gap.

## Resolution

The filter was **added to `Clinical Outcomes Semantic`**, hidden, matching the exclusion
`Clinical Outcomes` already applied. It is hidden there rather than visible because it is a
data-quality exclusion, not a user control, and that report already has a separate visible
Discharge Destination filter on `DischargeDestination[Lookup_ID]`.

Rationale for aligning in that direction: the Semantic report labelled the figure
**"Discharges"** while counting 905 records with no discharge destination and no outcomes, and
reported a 299-facility footprint that included 21 facilities contributing only blank records.

Outcomes math was never affected either way — measurements differed by 15 in ~340,000.

## Worth remembering

Two reports on one model can still disagree, and the model is not where to look. Compare the
report-level filter collections first; hidden filters especially, since they do not appear in
the filter pane and are easy to forget. The two reports here differed in exactly one of twenty.
