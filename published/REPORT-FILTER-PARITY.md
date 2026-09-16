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

**The exclusion was removed from both reports**, so both now report 25,811 cases / 339,934
measurements / 299 facilities.

It was first added to `Clinical Outcomes Semantic` to match `Clinical Outcomes`, but that put a
long list of every non-null Setting value into the report's "Filters Applied" panel. Aligning
the other way is cleaner and costs nothing analytically.

- `Clinical Outcomes Semantic` - the added filter was deleted outright.
- `Clinical Outcomes` - the **visible filter card was kept but its condition cleared**, so users
  still have Discharge Destination available in the filter pane and nothing is excluded by
  default. It now matches the shape of the other unfiltered cards.

Note this means the 905 incomplete records are now counted in both reports, including in a
figure labelled "Discharges", and the facility footprint reads 299 rather than 278. That is a
deliberate trade for a cleaner filter description, and outcomes math is unaffected either way -
measurements differ by 15 in ~340,000.

## Worth remembering

Two reports on one model can still disagree, and the model is not where to look. Compare the
report-level filter collections first; hidden filters especially, since they do not appear in
the filter pane and are easy to forget. The two reports here differed in exactly one of twenty.
