// Freshness probe for Fabric lakehouse / warehouse SQL endpoints.
//
// Two modes:
//   (1) Lakehouse scan  — every table in one database.
//       node queries/check-freshness.js --db silver [--schema S] [--table LIKE] [--sort age|name|rows] [--json]
//   (2) Model scope     — only the source objects a semantic model actually binds to,
//       resolved across all the lakehouses it reads, so you can answer "is every
//       source behind ClinicalOutcomes fresh?" Tables with no date column report
//       "(none / ok)"; tables with a date column report rows + latest + age.
//       node queries/check-freshness.js --model ClinicalOutcomes/ClinicalOutcomes.SemanticModel [--json]
//   (3) Script scope    — the lakehouse tables a set of extraction scripts read, e.g.
//       the therapist-eval pipeline. Each FROM/JOIN is attributed to the nearest
//       query(sql,"<alias>") lakehouse, with fallback to any other lakehouse the same
//       file uses (so multi-lakehouse pulls resolve correctly).
//       node queries/check-freshness.js --scripts queries [--json]
//       node queries/check-freshness.js --scripts queries/pull-track-base.js,queries/pull-attribution.js
//
// For each probed object it auto-detects the best "freshness column" by name pattern
// + datetime type, then issues one cheap COUNT_BIG(*) + MAX(col). Built on
// fabric-query.js (silent AzureCliCredential auth, no new deps). The column-scoring
// heuristic is ported/extended from the predecessor fabric-test tooling.

const fs = require("fs");
const path = require("path");
const { query, closeAll, databases } = require("../fabric-query.js");

// ---------------------------------------------------------------------------
// Freshness column heuristic
// ---------------------------------------------------------------------------

// Patterns ranked by how reliable they are as a freshness signal (lower = stronger).
const TIMESTAMP_PATTERNS = [
  [0, /^_commit_timestamp$/i],
  [0, /^_change_timestamp$/i],
  [1, /(load_?date|load_?ts|load_?time|loaded_?at|ingest(ion)?_?(date|ts|time)|ingested_?at)/i],
  [2, /(modified|updated|update|last_?update|lastmodif|change[d]?)/i],
  [3, /(rowversion|version_?ts|valid_?from|effective_?from|created|created_?at|createddate|create_?date)/i],
  // Tier 4 — best-effort fallback for fact tables whose only timestamp is a business-activity
  // date (e.g. SessionDate, ServiceDate). MAX() of these is a good recency proxy for
  // append-only data. Weaker signal (a future-dated/scheduling column can mislead), so it
  // ranks below true load/modified columns and the chosen column is always printed.
  [4, /(session|service|activity|transaction|posting?|entry|event|process(ed)?|admit|discharge|sent|received|complete)_?(date|dt|time|timestamp)?/i],
  [4, /(^|_)(date|dt|datetime|timestamp)$/i],
];

// Names that look date-y but are NOT freshness signals (demographics / lifecycle anchors).
const NON_FRESHNESS_NAMES = /(birth|dob|death|deceased|expir|hire|termination|terminated|graduat|licen[sc]e|certif|due_?date|valid_?to|effective_?to|thru|end_?date)/i;

const TIMESTAMP_TYPES = new Set([
  "datetime", "datetime2", "datetimeoffset", "smalldatetime", "date", "time", "timestamp",
]);

const CONCURRENCY = 8;

function scoreColumn(name, dtype) {
  if (!TIMESTAMP_TYPES.has((dtype || "").toLowerCase())) return null;
  if (NON_FRESHNESS_NAMES.test(name || "")) return null;
  for (const [score, pat] of TIMESTAMP_PATTERNS) {
    if (pat.test(name || "")) return score;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

// One row per table/view with its best-guess freshness column (or null). Covers
// both base tables and views (INFORMATION_SCHEMA.COLUMNS includes both).
async function pickFreshnessColumns(dbName, schemaFilter, tableFilter) {
  let where = "WHERE TABLE_SCHEMA NOT IN ('sys','INFORMATION_SCHEMA','queryinsights','_rsc')";
  if (schemaFilter) where += ` AND TABLE_SCHEMA = '${schemaFilter.replace(/'/g, "''")}'`;
  if (tableFilter) where += ` AND TABLE_NAME LIKE '${tableFilter.replace(/'/g, "''")}'`;

  const res = await query(
    `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS ${where}`,
    dbName
  );

  const tables = new Map();
  for (const r of res.recordset) {
    const key = `${r.TABLE_SCHEMA}.${r.TABLE_NAME}`;
    if (!tables.has(key)) {
      tables.set(key, { schema: r.TABLE_SCHEMA, table: r.TABLE_NAME, bestCol: null, bestType: null, bestScore: null });
    }
    const score = scoreColumn(r.COLUMN_NAME, r.DATA_TYPE);
    if (score === null) continue;
    const t = tables.get(key);
    if (t.bestScore === null || score < t.bestScore) {
      t.bestScore = score;
      t.bestCol = r.COLUMN_NAME;
      t.bestType = r.DATA_TYPE;
    }
  }
  return [...tables.values()];
}

async function probeTable(dbName, t) {
  const full = `[${t.schema}].[${t.table}]`;
  const out = { schema: t.schema, table: t.table, rows: null, maxFreshness: null, freshnessCol: t.bestCol, error: null };
  try {
    const sqlText = t.bestCol
      ? `SELECT COUNT_BIG(*) AS rows, MAX([${t.bestCol}]) AS maxFreshness FROM ${full}`
      : `SELECT COUNT_BIG(*) AS rows FROM ${full}`;
    const res = await query(sqlText, dbName);
    const row = res.recordset[0] || {};
    out.rows = row.rows;
    out.maxFreshness = row.maxFreshness ?? null;
  } catch (e) {
    out.error = (e.message || String(e)).slice(0, 200);
  }
  return out;
}

async function runPool(items, worker, limit) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

function ageDays(maxFreshness, now) {
  if (!maxFreshness) return null;
  const d = maxFreshness instanceof Date ? maxFreshness : new Date(maxFreshness);
  if (isNaN(d)) return null;
  return Math.floor((now - d) / 86400000);
}

function fmtTs(v) {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? String(v) : d.toISOString().replace("T", " ").slice(0, 19);
}

function printTable(rows, cols) {
  const widths = cols.map(([h, get]) => Math.max(h.length, ...rows.map((r) => get(r).length), 1));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(cols.map(([h]) => h)));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) console.log(line(cols.map(([, get]) => get(r))));
}

// ---------------------------------------------------------------------------
// Shared: probe a map of needed objects + print the source-freshness report.
// objUsers: Map "alias|schema.object" -> { alias, schema, object, users:Set }
// ---------------------------------------------------------------------------

async function probeObjUsers(objUsers, now) {
  const objs = [...objUsers.values()];

  // Fetch column metadata once per lakehouse we might touch (primary alias + any candidates).
  const needed = new Set();
  for (const o of objs) { needed.add(o.alias); (o.candidates || []).forEach((a) => needed.add(a)); }
  const metaByAlias = new Map();
  for (const a of needed) {
    metaByAlias.set(a, databases[a] ? new Map((await pickFreshnessColumns(a)).map((t) => [`${t.schema}.${t.table}`.toLowerCase(), t])) : null);
  }
  const has = (a, key) => metaByAlias.get(a) && metaByAlias.get(a).has(key);

  // Candidate fallback: if the guessed (primary) lakehouse doesn't actually contain the
  // object, reassign to whichever other lakehouse referenced by the same file does. This
  // corrects nearest-alias mis-attribution in multi-lakehouse pull scripts.
  for (const o of objs) {
    const key = `${o.schema}.${o.object}`.toLowerCase();
    if (!has(o.alias, key)) {
      const alt = (o.candidates || []).find((a) => a !== o.alias && has(a, key));
      if (alt) o.alias = alt;
    }
  }

  // Merge objects that now share the same (alias, schema, object) after fallback
  // (the same table reached via different files / primary guesses), unioning "used by".
  const merged = new Map();
  for (const o of objs) {
    const k = `${o.alias}|${o.schema}.${o.object}`.toLowerCase();
    if (!merged.has(k)) merged.set(k, { ...o, users: new Set(o.users) });
    else for (const u of o.users) merged.get(k).users.add(u);
  }
  const finalObjs = [...merged.values()];

  const results = await runPool(finalObjs, async (o) => {
    const key = `${o.schema}.${o.object}`.toLowerCase();
    if (!databases[o.alias]) return { ...o, rows: null, maxFreshness: null, freshnessCol: null, tier: null, error: `unknown lakehouse alias "${o.alias}" (add to databases.json)` };
    const t = metaByAlias.get(o.alias) && metaByAlias.get(o.alias).get(key);
    if (!t) return { ...o, rows: null, maxFreshness: null, freshnessCol: null, tier: null, error: "object not found in lakehouse" };
    const r = await probeTable(o.alias, t);
    return { ...o, rows: r.rows, maxFreshness: r.maxFreshness, freshnessCol: r.freshnessCol, tier: t.bestScore, error: r.error };
  }, CONCURRENCY);

  for (const r of results) r.ageDays = ageDays(r.maxFreshness, now);
  const rank = (r) => (r.error ? 0 : r.maxFreshness ? 1 : 2);
  results.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) return (b.ageDays || 0) - (a.ageDays || 0);
    return `${a.alias}.${a.schema}.${a.object}`.localeCompare(`${b.alias}.${b.schema}.${b.object}`);
  });
  return results;
}

function printSourceReport(results) {
  printTable(results, [
    ["lakehouse", (r) => r.alias],
    ["schema.object", (r) => `${r.schema}.${r.object}`],
    ["rows", (r) => (r.rows == null ? "" : String(r.rows))],
    ["latest", (r) => fmtTs(r.maxFreshness)],
    ["age(d)", (r) => (r.ageDays == null ? "" : String(r.ageDays))],
    ["verdict", (r) =>
      r.error ? "ERROR"
        : !r.maxFreshness ? "no date (ok)"
        : r.ageDays <= 2 ? "FRESH"
        : r.ageDays <= 7 ? "ok"
        : (r.tier != null && r.tier <= 2) ? "STALE?"   // old by a load/modified column → real concern
        : "old (created?)"],                            // old by a created/activity column → maybe just no new rows
    ["freshness_col", (r) => r.freshnessCol || "(none)"],
    ["used by", (r) => [...r.users].slice(0, 4).join(", ") + (r.users.size > 4 ? ", …" : "")],
  ]);
  const dated = results.filter((r) => r.maxFreshness);
  const staleHard = dated.filter((r) => r.ageDays > 7 && r.tier != null && r.tier <= 2);
  const staleSoft = dated.filter((r) => r.ageDays > 7 && !(r.tier != null && r.tier <= 2));
  console.log("");
  if (staleHard.length) console.log(`⚠ STALE — old by a load/modified column (real concern): ${staleHard.map((r) => `${r.alias}.${r.schema}.${r.object} (${r.ageDays}d via ${r.freshnessCol})`).join("; ")}`);
  else console.log(`✓ No fact/tracked table is stale by its load/modified column.`);
  if (staleSoft.length) console.log(`ℹ Old by a created/activity date (usually just "no new rows" — expected for reference/dimension data, verify if unexpected): ${staleSoft.map((r) => `${r.alias}.${r.schema}.${r.object} (${r.ageDays}d via ${r.freshnessCol})`).join("; ")}`);
  const nodate = results.filter((r) => !r.maxFreshness && !r.error);
  console.log(`No date column (can't assess — treated as ok): ${nodate.length}${nodate.length ? " → " + nodate.map((r) => `${r.schema}.${r.object}`).join(", ") : ""}`);
  if (results.some((r) => r.error)) console.log(`Errors: ${results.filter((r) => r.error).map((r) => `${r.alias}.${r.schema}.${r.object} [${r.error}]`).join("; ")}`);
}

// ---------------------------------------------------------------------------
// Mode 1: whole-lakehouse scan
// ---------------------------------------------------------------------------

async function lakehouseMode(opts) {
  const now = new Date();
  const targets = await pickFreshnessColumns(opts.db, opts.schema, opts.table);
  if (!targets.length) {
    console.error(`No tables found in "${opts.db}"${opts.schema ? ` schema ${opts.schema}` : ""}${opts.table ? ` matching ${opts.table}` : ""}.`);
    return;
  }
  const probed = await runPool(targets, (t) => probeTable(opts.db, t), CONCURRENCY);
  for (const r of probed) r.ageDays = ageDays(r.maxFreshness, now);

  const rank = (r) => (r.error ? 2 : r.maxFreshness ? 0 : 1);
  probed.sort((a, b) => {
    if (opts.sort === "name") return `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`);
    if (opts.sort === "rows") return (b.rows || 0) - (a.rows || 0);
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (b.ageDays || 0) - (a.ageDays || 0);
    return `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`);
  });

  if (opts.json) return void console.log(JSON.stringify(probed, null, 2));

  console.log(`\n${databases[opts.db].database} (${opts.db}) — ${probed.length} tables, as of ${fmtTs(now)}\n`);
  printTable(probed, [
    ["schema", (r) => r.schema],
    ["table", (r) => r.table],
    ["rows", (r) => (r.rows == null ? "" : String(r.rows))],
    ["latest", (r) => fmtTs(r.maxFreshness)],
    ["age(d)", (r) => (r.ageDays == null ? "" : String(r.ageDays))],
    ["freshness_col", (r) => r.freshnessCol || "(none)"],
    ["error", (r) => r.error || ""],
  ]);
  const dated = probed.filter((r) => r.maxFreshness);
  if (dated.length) {
    const s = dated[0];
    console.log(`\nStalest dated table: ${s.schema}.${s.table} — ${s.ageDays} days old (${fmtTs(s.maxFreshness)})`);
  }
  console.log(`No detectable freshness column: ${probed.filter((r) => !r.maxFreshness && !r.error).length}; errored: ${probed.filter((r) => r.error).length}`);
}

// ---------------------------------------------------------------------------
// Mode 2: semantic-model scope — resolve each M table to its base (lakehouse, object)
// ---------------------------------------------------------------------------

// Map a lakehouse DATABASE name (from Sql.Database(...)) to a databases.json alias.
function dbNameToAlias() {
  const map = {};
  for (const [alias, def] of Object.entries(databases)) map[def.database.toLowerCase()] = alias;
  return map;
}

// Parse expressions.tmdl into named expression bodies.
function parseExpressions(text) {
  const nodes = {};
  // Split on lines that start an expression. Names may be bare or 'single quoted'.
  const re = /^expression\s+('([^']+)'|[^\s=]+)\s*=/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ idx: m.index, name: m[2] || m[1] });
  for (let i = 0; i < marks.length; i++) {
    const body = text.slice(marks[i].idx, i + 1 < marks.length ? marks[i + 1].idx : text.length);
    nodes[marks[i].name] = body;
  }
  return nodes;
}

// Read every tables/*.tmdl → { name, kind: 'm'|'calculated'|'other', body }.
function parseTables(tablesDir) {
  const out = [];
  for (const f of fs.readdirSync(tablesDir).filter((f) => f.endsWith(".tmdl"))) {
    const body = fs.readFileSync(path.join(tablesDir, f), "utf8");
    const nameM = body.match(/^table\s+('([^']+)'|\S+)/m);
    const name = nameM ? (nameM[2] || nameM[1]) : path.basename(f, ".tmdl");
    const partM = body.match(/^\s*partition\s+\S.*=\s*(m|calculated|calculatedTable)\b/m);
    const kind = partM ? (partM[1] === "m" ? "m" : "calculated") : "other";
    out.push({ name, kind, body });
  }
  return out;
}

function buildResolver(exprNodes, tableNodes) {
  const aliasOf = dbNameToAlias();
  const nodes = { ...exprNodes };           // name -> body
  for (const t of tableNodes) nodes[t.name] = t.body;

  // Detect "pure lakehouse" source expressions: Source = Sql.Database(host,"DB") in Source.
  const lakehouseDb = {}; // exprName -> alias
  for (const [name, body] of Object.entries(exprNodes)) {
    const sd = body.match(/Source\s*=\s*Sql\.Database\("[^"]+",\s*"([^"]+)"\)\s*in\s*Source/s);
    if (sd) lakehouseDb[name] = aliasOf[sd[1].toLowerCase()] || `?${sd[1]}`;
  }

  const allNames = Object.keys(nodes);
  const refRe = {}; // cache name -> RegExp
  function referenced(text, name) {
    if (!refRe[name]) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      refRe[name] = /^[A-Za-z_]\w*$/.test(name)
        ? new RegExp(`(?:#")?\\b${esc}\\b"?`)   // bare identifier or #"id"
        : new RegExp(`#"${esc}"`);               // quoted name (has spaces)
    }
    return refRe[name].test(text);
  }

  function collectSql(text, alias, out) {
    const re = /\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g;
    let m;
    while ((m = re.exec(text))) out.push({ alias, schema: m[1], object: m[2] });
  }

  // Sql.Database(...) literal + Schema/Item navigation (e.g. excel* expressions).
  function collectItemNavs(body, out) {
    const sd = body.match(/Sql\.Database\("[^"]+",\s*"([^"]+)"\)/);
    if (!sd) return;
    const alias = aliasOf[sd[1].toLowerCase()] || `?${sd[1]}`;
    let m;
    const re1 = /Schema="([^"]+)",\s*Item="([^"]+)"/g;
    while ((m = re1.exec(body))) out.push({ alias, schema: m[1], object: m[2] });
    const re2 = /\[Item="([^"]+)"\]/g;
    while ((m = re2.exec(body))) {
      if (!out.some((o) => o.object === m[1])) out.push({ alias, schema: "dbo", object: m[1] });
    }
  }

  function walk(name, hint, out, visited) {
    if (visited.has(name)) return;
    visited.add(name);
    if (lakehouseDb[name]) return;           // pure lakehouse expr → provides db, no object
    const body = nodes[name];
    if (!body) return;

    // Value.NativeQuery(_Expr, "...SQL...") windows — attribute FROM/JOIN to that lakehouse.
    const nvqRe = /Value\.NativeQuery\(\s*(_[A-Za-z]\w*)/g;
    const marks = [];
    let m;
    while ((m = nvqRe.exec(body))) marks.push({ idx: m.index, expr: m[1] });
    for (let i = 0; i < marks.length; i++) {
      const win = body.slice(marks[i].idx, i + 1 < marks.length ? marks[i + 1].idx : body.length);
      const alias = lakehouseDb[marks[i].expr] || hint;
      collectSql(win, alias, out);
      for (const n of allNames) {
        if (n !== name && !lakehouseDb[n] && referenced(win, n)) walk(n, alias, out, visited);
      }
    }

    collectItemNavs(body, out);

    // References to other expressions / model tables anywhere in the body
    // (e.g. `Source = excelOutcomesCrosswalk` or `= _QualifyingCases`).
    for (const n of allNames) {
      if (n !== name && !lakehouseDb[n] && referenced(body, n)) walk(n, hint, out, visited);
    }
  }

  return function resolve(tableName) {
    const out = [];
    walk(tableName, null, out, new Set());
    const seen = new Set();
    return out.filter((o) => {
      const k = `${o.alias}|${o.schema}.${o.object}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
}

async function modelMode(opts) {
  const now = new Date();
  let defDir = opts.model;
  if (fs.existsSync(path.join(defDir, "definition"))) defDir = path.join(defDir, "definition");
  const exprFile = path.join(defDir, "expressions.tmdl");
  const tablesDir = path.join(defDir, "tables");
  if (!fs.existsSync(exprFile) || !fs.existsSync(tablesDir)) {
    console.error(`Not a semantic-model definition dir (need expressions.tmdl + tables/): ${defDir}`);
    process.exit(1);
  }

  const exprNodes = parseExpressions(fs.readFileSync(exprFile, "utf8"));
  const tableNodes = parseTables(tablesDir);
  const resolve = buildResolver(exprNodes, tableNodes);

  // Resolve each M-import table to its base objects; collect calc/other tables separately.
  const objUsers = new Map();   // "alias|schema.object" -> { alias, schema, object, users:Set }
  const derived = [];           // calculated tables
  const external = [];          // M tables sourced from SharePoint/Excel (not a lakehouse)
  const staticInline = [];      // M tables with data baked into the model
  const unresolved = [];        // M tables we genuinely couldn't trace
  for (const t of tableNodes) {
    if (t.kind === "calculated") { derived.push(t.name); continue; }
    if (t.kind !== "m") { derived.push(t.name); continue; }
    const deps = resolve(t.name);
    if (!deps.length) {
      if (/Excel\.Workbook|Web\.Contents|SharePoint/.test(t.body)) external.push(t.name);
      else if (/Table\.FromRows\(\s*Json\.Document\(\s*Binary\.Decompress|#table\(/.test(t.body)) staticInline.push(t.name);
      else unresolved.push(t.name);
      continue;
    }
    for (const d of deps) {
      const k = `${d.alias}|${d.schema}.${d.object}`.toLowerCase();
      if (!objUsers.has(k)) objUsers.set(k, { alias: d.alias, schema: d.schema, object: d.object, users: new Set() });
      objUsers.get(k).users.add(t.name);
    }
  }

  const results = await probeObjUsers(objUsers, now);

  if (opts.json) {
    return void console.log(JSON.stringify({
      asOf: now.toISOString(),
      sources: results.map((r) => ({ ...r, users: [...r.users] })),
      derived, external, staticInline, unresolved,
    }, null, 2));
  }

  console.log(`\nClinicalOutcomes model source freshness — ${results.length} base objects across ${new Set(results.map((r) => r.alias)).size} lakehouses, as of ${fmtTs(now)}\n`);
  printSourceReport(results);
  if (external.length) console.log(`SharePoint/Excel sources (freshness = file mod date, not SQL-checkable): ${external.join(", ")}`);
  if (staticInline.length) console.log(`Inline static tables (data baked into the model — n/a): ${staticInline.join(", ")}`);
  if (unresolved.length) console.log(`M tables whose source could not be auto-resolved (REVIEW): ${unresolved.join(", ")}`);
  console.log(`Derived/calculated tables (no external source — n/a): ${derived.length}`);
}

// ---------------------------------------------------------------------------
// Mode 3: pull-script scope — freshness of the lakehouse tables a set of
// extraction scripts read (e.g. the therapist-eval pipeline's queries/pull-*.js).
// Each FROM/JOIN is attributed to the nearest lakehouse alias literal (the 2nd
// arg of the query(sql, "<alias>") call) in the same file.
// ---------------------------------------------------------------------------

function resolveScriptFiles(arg) {
  const out = [];
  for (const part of arg.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (fs.existsSync(part) && fs.statSync(part).isDirectory()) {
      for (const f of fs.readdirSync(part)) if (/^pull-.*\.js$/.test(f)) out.push(path.join(part, f));
    } else {
      out.push(part);
    }
  }
  return out;
}

function parseScriptsToObjUsers(files) {
  const aliases = Object.keys(databases);
  const objUsers = new Map();
  const skipped = [];
  for (const file of files) {
    if (!fs.existsSync(file)) { skipped.push(`${file} (not found)`); continue; }
    let text = fs.readFileSync(file, "utf8");
    const dir = path.dirname(file);
    for (const s of [...text.matchAll(/['"`]([\w-]+\.sql)['"`]/g)].map((m) => m[1])) {
      const p = path.join(dir, s);
      if (fs.existsSync(p)) text += "\n" + fs.readFileSync(p, "utf8");
    }
    // Strip comments so FROM/JOIN inside `//` or `/* */` (e.g. doc notes) aren't parsed as
    // real sources. The [^:] guard avoids eating `://` inside URLs.
    text = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    // Positions of every lakehouse-alias string literal in the file.
    const aliasPos = [];
    for (const a of aliases) {
      const re = new RegExp(`["']${a}["']`, "g");
      let mm;
      while ((mm = re.exec(text))) aliasPos.push({ a, idx: mm.index });
    }
    const label = path.basename(file);
    if (!aliasPos.length) { skipped.push(`${label} (no lakehouse alias — not a Fabric SQL pull)`); continue; }
    const candidates = [...new Set(aliasPos.map((x) => x.a))];

    // FROM/JOIN, capturing an optional 3rd part for cross-db `db.schema.object` names.
    const re = /\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/gi;
    let m;
    while ((m = re.exec(text))) {
      let schema, object, dbAlias = null;
      if (m[3]) { dbAlias = aliases.includes(m[1]) ? m[1] : null; schema = m[2]; object = m[3]; }
      else { schema = m[1]; object = m[2]; }
      // primary alias: a 3-part db qualifier if it's a known alias, else nearest alias literal.
      let best = dbAlias;
      if (!best) { let bd = Infinity; for (const ap of aliasPos) { const d = Math.abs(ap.idx - m.index); if (d < bd) { bd = d; best = ap.a; } } }
      const k = `${best}|${schema}.${object}`.toLowerCase();
      if (!objUsers.has(k)) objUsers.set(k, { alias: best, schema, object, candidates, users: new Set() });
      objUsers.get(k).users.add(label);
    }
  }
  return { objUsers, skipped };
}

async function scriptsMode(opts) {
  const now = new Date();
  const files = resolveScriptFiles(opts.scripts);
  const { objUsers, skipped } = parseScriptsToObjUsers(files);
  if (!objUsers.size) {
    console.error(`No Fabric SQL sources found in: ${files.join(", ")}`);
    return;
  }
  const results = await probeObjUsers(objUsers, now);
  if (opts.json) {
    return void console.log(JSON.stringify({
      asOf: now.toISOString(),
      sources: results.map((r) => ({ ...r, users: [...r.users] })),
      skipped,
    }, null, 2));
  }
  console.log(`\nScript source freshness — ${results.length} base objects across ${new Set(results.map((r) => r.alias)).size} lakehouses, from ${files.length} script(s), as of ${fmtTs(now)}\n`);
  printSourceReport(results);
  if (skipped.length) console.log(`Skipped (no Fabric SQL source / not found): ${skipped.join("; ")}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { db: null, schema: null, table: null, json: false, sort: "age", model: null, scripts: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") opts.db = argv[++i];
    else if (a === "--schema") opts.schema = argv[++i];
    else if (a === "--table") opts.table = argv[++i];
    else if (a === "--model") opts.model = argv[++i];
    else if (a === "--scripts") opts.scripts = argv[++i];
    else if (a === "--json") opts.json = true;
    else if (a === "--sort") opts.sort = argv[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.model) {
    await modelMode(opts);
  } else if (opts.scripts) {
    await scriptsMode(opts);
  } else if (opts.db && databases[opts.db]) {
    await lakehouseMode(opts);
  } else {
    console.error("Usage:");
    console.error("  node queries/check-freshness.js --db <name> [--schema S] [--table LIKE] [--sort age|name|rows] [--json]");
    console.error("  node queries/check-freshness.js --model <semanticModelDir> [--json]");
    console.error("  node queries/check-freshness.js --scripts <dir|file.js|a.js,b.js> [--json]");
    console.error(`\nAvailable databases: ${Object.keys(databases).join(", ")}`);
    process.exit(1);
  }
  await closeAll();
}

main().catch((err) => {
  console.error("check-freshness failed:", err.message);
  closeAll().finally(() => process.exit(1));
});
