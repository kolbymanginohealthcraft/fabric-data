// ANA (Activity Not Attempted) usage at EVAL, by therapist — first-pass analysis.
//
// "ANA" = the four non-performance reason codes on the CMS GG 6-point scale
// (LibraryScale_ID 1360): a clinician marks a GG functional item as not-scored rather
// than picking a performance level (Independent..Dependent). High ANA usage is a
// documentation-quality signal worth surfacing (it also drives the EvalNEW recode-to-0
// in the outcomes/eval pipeline).
//
//   Scale 1360 values (confirmed):
//     15096 Independent | 15097 Setup/clean-up | 15098 Supervision/touch |
//     15099 Partial/mod | 15100 Substantial/max | 15101 Dependent   <- performance levels
//     15102 Refused | 15103 N/A | 15104 Environmental | 15105 Medical/Safety  <- ANA
//
// Denominator for the ANA RATE = all scale-1360 EVAL responses (performance + ANA), i.e.
// "of all GG 6-point assessments at eval, what fraction were coded ANA". Therapist =
// EVAL-document author (TxDocument.Person_ID), the same registered-clinician credit
// source the eval pipeline uses (1:1 with track, 100% registered).
//
// Output: data/ana-usage.csv — one row per (AuthorPerson_ID, TrackDiscipline, code) with
// a count + label + IsANA flag (raw grain; supports the distribution AND per-therapist
// rate rollups). Therapist names merged from Silver dbo.employee. Read-only; touches no
// semantic-model or report files.
//
// Usage: node queries/pull-ana-usage.js [--years N] [--out path]
const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

const REPO_ROOT = path.join(__dirname, "..");

// ANA code -> label (from patient.NetHealthDocumentation.LibraryScaleValue, scale 1360).
const ANA = { 15102: "Refused", 15103: "N/A", 15104: "Environmental", 15105: "Medical/Safety" };
const PERF = {
  15096: "Independent", 15097: "Setup/clean-up", 15098: "Supervision/touch",
  15099: "Partial/moderate", 15100: "Substantial/maximal", 15101: "Dependent",
};
const LABEL = { ...PERF, ...ANA };

function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1, out = path.join(REPO_ROOT, "data", "ana-usage.csv");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--years" && a[i + 1]) years = parseInt(a[++i], 10);
    else if (a[i] === "--out" && a[i + 1]) out = a[++i];
  }
  return { years, out };
}
function csvEscape(v) { if (v == null) return ""; const s = String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { if (!rows.length) return ""; const h = Object.keys(rows[0]); return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n"; }
function pct(num, den) { return den ? (100 * num / den).toFixed(1) + "%" : "-"; }

// Scale-1360 EVAL responses, grouped by eval author + track discipline + response code.
const BRONZE_SQL = `
SELECT d.Person_ID AS AuthorPerson_ID, trk.Discipline AS TrackDiscipline,
       item.LibraryScaleValue_ID AS code, COUNT(*) AS n
FROM dbo.TxDocumentItem item
JOIN dbo.TxDocument d ON d.TxDocument_ID = item.TxDocument_ID
JOIN dbo.TxTrack trk  ON trk.TxTrack_ID = d.TxTrack_ID
WHERE d.DocumentType = 'EVAL' AND d.IsInactive = 0
  AND trk.IsDeletedTrack = 0
  AND trk.EndDate >= DATEADD(YEAR, @YEARS, GETDATE())
  AND item.LibraryScaleValue_ID BETWEEN 15096 AND 15105   -- GG 6-point scale 1360 (perf + ANA)
GROUP BY d.Person_ID, trk.Discipline, item.LibraryScaleValue_ID`;

const EMP_SQL = `
SELECT NetHealthId AS Person_ID, FullName, Discipline, JobTitle, Status
FROM dbo.employee WHERE NetHealthId IS NOT NULL`;

(async () => {
  const { years, out } = parseArgs();
  console.error(`ana-usage pull: last ${years}yr (GG scale 1360 @ EVAL) -> ${out}`);
  const t0 = Date.now();

  const gg = (await query(BRONZE_SQL.replace("@YEARS", `-${years}`), "bronze")).recordset;
  console.error(`bronze rows: ${gg.length} in ${Math.round((Date.now() - t0) / 1000)}s`);

  // Employee name map (prefer Active when a Person_ID has multiple rows).
  const emp = (await query(EMP_SQL, "silver")).recordset;
  const empMap = new Map();
  for (const e of emp) {
    const prev = empMap.get(e.Person_ID);
    if (!prev || (e.Status === "Active" && prev.Status !== "Active")) empMap.set(e.Person_ID, e);
  }

  const rows = gg.map((r) => {
    const e = empMap.get(r.AuthorPerson_ID) || {};
    return {
      AuthorPerson_ID: r.AuthorPerson_ID,
      FullName: e.FullName || "",
      EmpDiscipline: e.Discipline || "",
      JobTitle: e.JobTitle || "",
      Status: e.Status || "",
      TrackDiscipline: r.TrackDiscipline,
      code: r.code,
      CodeLabel: LABEL[r.code] || String(r.code),
      IsANA: ANA[r.code] ? 1 : 0,
      n: r.n,
    };
  });
  fs.writeFileSync(out, toCsv(rows));
  console.error(`wrote ${out} (${rows.length} rows)`);

  // ---- in-script summary -------------------------------------------------
  const tot = rows.reduce((s, r) => s + r.n, 0);
  const totANA = rows.filter((r) => r.IsANA).reduce((s, r) => s + r.n, 0);
  console.error(`\n=== ANA usage, last ${years}yr (GG 6-point scale @ EVAL) ===`);
  console.error(`Total GG eval responses: ${tot.toLocaleString()}   ANA: ${totANA.toLocaleString()}   ANA rate: ${pct(totANA, tot)}\n`);

  console.error(`Which ANA choice is most common:`);
  const byCode = {};
  for (const r of rows) if (r.IsANA) byCode[r.code] = (byCode[r.code] || 0) + r.n;
  Object.entries(byCode).sort((a, b) => b[1] - a[1]).forEach(([c, n]) =>
    console.error(`  ${ANA[c].padEnd(16)} ${String(n).padStart(8)}  (${pct(n, totANA)} of ANA, ${pct(n, tot)} of all GG)`));

  console.error(`\nANA rate by track discipline:`);
  const disc = {};
  for (const r of rows) { const d = disc[r.TrackDiscipline] || (disc[r.TrackDiscipline] = { ana: 0, all: 0 }); d.all += r.n; if (r.IsANA) d.ana += r.n; }
  Object.entries(disc).sort((a, b) => b[1].all - a[1].all).forEach(([d, v]) =>
    console.error(`  ${(d || "(null)").padEnd(8)} ${pct(v.ana, v.all).padStart(6)}   (${v.ana.toLocaleString()} / ${v.all.toLocaleString()})`));

  console.error(`\nTop therapists by ANA rate (min 100 GG eval responses):`);
  const ther = {};
  for (const r of rows) {
    const k = r.AuthorPerson_ID;
    const t = ther[k] || (ther[k] = { ana: 0, all: 0, name: r.FullName, disc: r.EmpDiscipline, title: r.JobTitle });
    t.all += r.n; if (r.IsANA) t.ana += r.n;
  }
  Object.values(ther).filter((t) => t.all >= 100).sort((a, b) => b.ana / b.all - a.ana / a.all).slice(0, 20).forEach((t) =>
    console.error(`  ${pct(t.ana, t.all).padStart(6)}  ${(t.name || "(unmatched)").padEnd(28)} ${(t.disc || "").padEnd(6)} ${t.ana}/${t.all}`));

  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
