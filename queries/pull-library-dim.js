// Pulls the LibraryItem dimension (LibraryItem_ID → VersionName → OP/SNF library).
//
// SOURCE: aegisdataprod (`patient` alias) — LibraryItem has NO Fabric medallion home
// yet, so this is the one entity still read from the retiring lakehouse. It's a
// near-static reference catalog (item definitions, not patient activity), so reading
// it from aegisdataprod is low-risk until it's ingested to Bronze/Silver. When that
// happens, flip the `--db` target below; nothing else changes.
//
// Used by the outcome pipeline to classify each outcome's library:
//   OP  = VersionName LIKE '%OP%' OR '%GP%'   (outpatient assessment libraries)
//   SNF = everything else (default)
//
// Output: library-dim.csv (LibraryItem_ID, VersionName, Library) — joined to the
// Bronze-sourced outcome rows in the consumer layer on LibraryItem_ID.
//
// Usage: node queries/pull-library-dim.js [--out path]

const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

function parseArgs() {
  const args = process.argv.slice(2);
  let outPath = path.join(__dirname, "..", "data", "library-dim.csv");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) outPath = args[++i];
  }
  return { outPath };
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\n") + "\n";
}

// `patient` = aegisdataprod BINetHealthPatientLakehouse (LibraryItem's only home).
const SQL = `
SELECT
    LibraryItem_ID,
    VersionName,
    CASE WHEN VersionName LIKE '%OP%' OR VersionName LIKE '%GP%'
         THEN 'OP' ELSE 'SNF' END AS Library
FROM NetHealthDocumentation.LibraryItem
`;

(async () => {
  const { outPath } = parseArgs();
  console.error(`Running LibraryItem dim pull (aegisdataprod) → ${outPath}`);
  const result = await query(SQL, "patient");
  const rows = result.recordset;
  console.error(`Query returned ${rows.length} library items`);
  fs.writeFileSync(outPath, toCsv(rows));
  console.error(`Wrote CSV → ${outPath}`);
  await closeAll();
})().catch((err) => {
  console.error("Pull failed:", err.message);
  process.exit(1);
});
