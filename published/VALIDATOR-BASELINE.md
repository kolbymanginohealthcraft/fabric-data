# Microsoft PBIR validator — baseline for this estate

Captured **2026-09-16**, immediately after every report in the Clinical Outcomes workspace was
converted to PBIR. Tool:

```bash
npx --yes @microsoft/powerbi-report-authoring-cli@latest validate "<path>.Report"
```

From Microsoft's [skills-for-fabric](https://github.com/microsoft/skills-for-fabric) work
(plugin `powerbi-authoring`), which Scott demoed in the 2026-07-23 Aegis/BRR developer meeting.

## Read the delta, not the result

**Every report here reports `failed`, including ones the Power BI service itself converted minutes
earlier and that work correctly in production.** The validator is stricter than Desktop and than
the service. A green run is not achievable on this estate and is not the goal.

Use it as a **before/after diff** when hand-editing PBIR: validate, edit, validate, and treat only
*new* diagnostic codes as signal.

| Report | Pages | result | errors | warnings | dominant code |
|---|---|---|---|---|---|
| ANA Reponses | 1 | failed | 1 | 1 | theme name mismatch |
| Ohana Villas Stroke | 2 | failed | 1 | 14 | `FILTER_NAME_DUPLICATE_GLOBAL` ×11 |
| Clinical Outcomes | 5 | failed | 1 | 32 | `FILTER_NAME_DUPLICATE_GLOBAL` ×29 |
| Patient-Level Outcomes | 5 | failed | 7 | 54 | `FILTER_NAME_DUPLICATE_GLOBAL` ×53 |
| Total Care Through Transitions | 3 | failed | 17 | 94 | `FILTER_NAME_DUPLICATE_GLOBAL` ×92 |
| SL Outcomes Report | 15 | failed | 87 | 495 | `FILTER_NAME_DUPLICATE_GLOBAL` ×493 |
| Clinical Outcomes Semantic | 22 | failed | 137 | 830 | `FILTER_NAME_DUPLICATE_GLOBAL` ×825 |

Counts scale with report size, which is the tell that most of it is serialization noise rather
than defects.

## What the codes mean here

- **`PBIR_FILTER_NAME_DUPLICATE_GLOBAL`** — the overwhelming majority (825 of 830 warnings on the
  largest report). This is how Desktop serializes filters. Noise.
- **`PBIR_THEME_FILE_NAME_MISMATCH`** — exactly one on nearly every report, and the only error on
  the three smallest. The theme file's internal `name` (`Custom`, `Aegis`) does not match the
  registered filename (`Custom35591434884558026.json`). Themes load correctly in production, so
  treat as a false positive from Desktop's name+hash resource convention.
- **`PBIR_ROLE_MAX_EXCEEDED`** / **`PBIR_ROLE_REQUIRED_MISSING`** — the ones plausibly worth
  reading. A slicer with 2 projections where the role allows 1, or a chart missing a required
  `Category`. Not investigated; they predate the conversion.
- **`PBIR_SCHEMA_UNREACHABLE`** — see below. Important.

## Caveat that limits the tool here

`PBIR_SCHEMA_UNREACHABLE` appeared on the first run: the validator could not fetch
`https://developer.microsoft.com/json-schemas/.../visualContainer/2.12.0/schema.json`, so **JSON
Schema validation was skipped entirely** for those visuals. Behind the corporate network the
richest check may silently not run, and the tool still prints a result. Check for that code before
trusting a clean-ish run, and do not treat this validator as a replacement for the sandbox
`updateDefinition` rehearsal in `fabric-service` — it is a cheaper first pass, not the same check.
