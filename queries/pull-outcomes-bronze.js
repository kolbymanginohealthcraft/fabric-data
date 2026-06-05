// Bronze repoint of pull-outcomes.js. Injects Outcomes Crosswalk + Custom Scales
// (SharePoint CSVs) as VALUES CTEs into outcomes-bronze.sql and runs it against the
// FRESH Bronze lakehouse (--db bronze). Output: outcomes-core.csv — one row per
// Included (Case × Track × LibraryItem) outcome with Gain + dims + join keys
// (LibraryItem_ID, Facility_ID) for the downstream library-dim / facility-dim joins.
//
// Default window: last 1 year by TxTrack.EndDate. Override with --years N.

const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

const REPO_ROOT = path.join(__dirname, "..");
const CROSSWALK_CSV = path.join(REPO_ROOT, "Outcomes Crosswalk.csv");
const SCALES_CSV    = path.join(REPO_ROOT, "Outcomes Custom Scales.csv");
const SQL_TEMPLATE  = path.join(__dirname, "outcomes-bronze.sql");

function parseArgs() {
  const args = process.argv.slice(2);
  let years = 1;
  let outPath = path.join(REPO_ROOT, "outcomes-core.csv");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--years" && args[i + 1]) years = parseInt(args[++i], 10);
    else if (args[i] === "--out" && args[i + 1]) outPath = args[++i];
  }
  return { years, outPath };
}

// Minimal CSV parser handling double-quoted fields with embedded commas.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
function readCsvObjects(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(raw).filter((r) => r.some((c) => c !== ""));
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i] : ""; });
    return o;
  });
}

function sqlStr(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function sqlInt(s) {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) throw new Error(`Expected int, got: ${s}`);
  return String(n);
}
function sqlPct(s) {
  if (s === null || s === undefined || String(s).trim() === "") return "NULL";
  const n = parseFloat(String(s).replace("%", ""));
  if (!Number.isFinite(n)) return "NULL";
  return (n / 100).toFixed(6);
}
function sqlBool(b) { return b ? "1" : "0"; }

// Fabric Warehouse needs `SELECT * FROM (VALUES ...) AS v(cols)`; VALUES caps at 1000 rows.
const VALUES_CHUNK_SIZE = 1000;
function buildValuesCteBody(tuples, colList) {
  const chunks = [];
  for (let i = 0; i < tuples.length; i += VALUES_CHUNK_SIZE) {
    chunks.push(tuples.slice(i, i + VALUES_CHUNK_SIZE));
  }
  return chunks
    .map((chunk) => `SELECT * FROM (VALUES\n        ${chunk.join(",\n        ")}\n    ) AS v(${colList})`)
    .join("\n    UNION ALL\n    ");
}
function buildCrosswalkCteBody() {
  const rows = readCsvObjects(CROSSWALK_CSV);
  const tuples = rows.map(
    (r) => `(${sqlInt(r.LibraryItem_ID)}, ${sqlStr(r.Family)}, ${sqlStr(r.Group)}, ${sqlStr(r.Name)})`
  );
  return buildValuesCteBody(tuples, "LibraryItem_ID, Family, Grp, OutcomeName");
}
function buildScalesCteBody() {
  const rows = readCsvObjects(SCALES_CSV);
  const tuples = rows.map((r) => {
    const id = sqlInt(r["Library Scale Value"]);
    const points = sqlPct(r.Points);
    const isNA = sqlBool((r["Response Type"] || "").trim() === "N/A");
    return `(${id}, ${points}, ${isNA})`;
  });
  return buildValuesCteBody(tuples, "LibraryScaleValue_ID, Points, IsNA");
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

(async () => {
  const { years, outPath } = parseArgs();
  const tmpl = fs.readFileSync(SQL_TEMPLATE, "utf8");
  const sql = tmpl
    .replace(/__CROSSWALK_CTE_BODY__/g, buildCrosswalkCteBody())
    .replace(/__SCALES_CTE_BODY__/g,    buildScalesCteBody())
    .replace(/__YEARS__/g,              `-${years}`);

  if (process.env.DUMP_SQL) {
    fs.writeFileSync(path.join(__dirname, ".rendered-bronze.sql"), sql);
    console.error("Dumped rendered SQL → queries/.rendered-bronze.sql");
    return;
  }

  console.error(`Running outcomes-core (Bronze) pull: last ${years} year(s) → ${outPath}`);
  const t0 = Date.now();
  const result = await query(sql, "bronze");
  const rows = result.recordset;
  console.error(`Query returned ${rows.length} Included-outcome rows in ${Math.round((Date.now() - t0) / 1000)}s`);
  fs.writeFileSync(outPath, toCsv(rows));
  console.error(`Wrote CSV → ${outPath}`);
  await closeAll();
})().catch((err) => {
  console.error("Pull failed:", err.message);
  process.exit(1);
});
