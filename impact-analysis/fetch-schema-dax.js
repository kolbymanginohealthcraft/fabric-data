const { getTokenForScope } = require("../fabric-query");
const fs = require("fs");
const path = require("path");

const POWER_BI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";
const BASE_URL = "https://api.powerbi.com/v1.0/myorg";
const WORKSPACE_ID = "5f4d44ed-7a93-4ca3-961c-d57038f7421d";
const DATASET_ID = "e9a7f4e0-9772-49a4-a4de-c66ad8f9bae6";
const OUT_DIR = __dirname;

async function getToken() {
  return getTokenForScope(POWER_BI_SCOPE);
}

async function runDax(token, daxQuery) {
  const res = await fetch(
    `${BASE_URL}/groups/${WORKSPACE_ID}/datasets/${DATASET_ID}/executeQueries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queries: [{ query: daxQuery }],
        serializerSettings: { includeNulls: true },
      }),
    }
  );
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: text };
  }
  const data = JSON.parse(text);
  return { ok: true, rows: data.results?.[0]?.tables?.[0]?.rows || [] };
}

function writeJson(filename, data) {
  const filepath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`  Saved ${filename}`);
}

async function main() {
  console.log("Authenticating...");
  const token = await getToken();
  console.log("Authenticated.\n");

  // Attempt 1: Try INFO.TABLES() raw to see the real error
  console.log("Testing INFO.TABLES() raw...");
  const infoTest = await runDax(token, "EVALUATE INFO.TABLES()");
  if (infoTest.ok) {
    console.log("  INFO functions work! Getting full schema...");
    writeJson("schema-tables-info.json", infoTest.rows);

    // If INFO works, get everything
    const infoQueries = {
      "schema-measures-info.json": "EVALUATE INFO.MEASURES()",
      "schema-columns-info.json": "EVALUATE INFO.COLUMNS()",
      "schema-relationships-info.json": "EVALUATE INFO.RELATIONSHIPS()",
      "schema-partitions-info.json": "EVALUATE INFO.PARTITIONS()",
      "schema-expressions-info.json": "EVALUATE INFO.EXPRESSIONS()",
      "schema-calcitems-info.json": "EVALUATE INFO.CALCULATIONITEMS()",
    };
    for (const [file, query] of Object.entries(infoQueries)) {
      const result = await runDax(token, query);
      if (result.ok) {
        writeJson(file, result.rows);
        console.log(`    ${result.rows.length} rows`);
      } else {
        console.log(`    ${file} failed: ${result.error.substring(0, 150)}`);
      }
    }
  } else {
    console.log(`  INFO.TABLES() error: ${infoTest.error.substring(0, 300)}`);
    console.log("\n  Falling back to alternative DAX approaches...\n");

    // Attempt 2: COLUMNSTATISTICS() — returns table/column/cardinality
    console.log("Trying COLUMNSTATISTICS()...");
    const colStats = await runDax(token, "EVALUATE COLUMNSTATISTICS()");
    if (colStats.ok) {
      writeJson("schema-columnstats.json", colStats.rows);
      console.log(`  ${colStats.rows.length} columns found`);

      // Extract unique table names
      const tables = [...new Set(colStats.rows.map((r) => r["[Table Name]"]))];
      console.log(`  Tables: ${tables.join(", ")}`);
    } else {
      console.log(`  COLUMNSTATISTICS failed: ${colStats.error.substring(0, 200)}`);
    }

    // Attempt 3: Try to enumerate tables/measures using UNION of known DAX metadata
    console.log("\nTrying catalog views via DMV-style...");

    // Try $SYSTEM views through executeQueries (long shot)
    const dmvQueries = [
      { name: "TMSCHEMA_TABLES", query: "SELECT [Name], [ID], [IsHidden], [Description] FROM $SYSTEM.TMSCHEMA_TABLES" },
      { name: "TMSCHEMA_MEASURES", query: "SELECT [Name], [TableID], [Expression], [Description], [FormatString], [IsHidden], [DisplayFolder] FROM $SYSTEM.TMSCHEMA_MEASURES" },
      { name: "TMSCHEMA_COLUMNS", query: "SELECT [ExplicitName], [TableID], [ExplicitDataType], [IsHidden], [Type], [Description], [DisplayFolder], [SortByColumnID] FROM $SYSTEM.TMSCHEMA_COLUMNS" },
      { name: "TMSCHEMA_RELATIONSHIPS", query: "SELECT [ID], [FromTableID], [FromColumnID], [ToTableID], [ToColumnID], [CrossFilteringBehavior], [IsActive], [FromCardinality], [ToCardinality] FROM $SYSTEM.TMSCHEMA_RELATIONSHIPS" },
      { name: "TMSCHEMA_PARTITIONS", query: "SELECT [Name], [TableID], [QueryDefinition], [SourceType], [Mode], [Type] FROM $SYSTEM.TMSCHEMA_PARTITIONS" },
      { name: "TMSCHEMA_EXPRESSIONS", query: "SELECT [Name], [Expression], [Description], [Kind] FROM $SYSTEM.TMSCHEMA_EXPRESSIONS" },
      { name: "TMSCHEMA_CALCULATIONITEMS", query: "SELECT [Name], [TableID], [Expression], [Ordinal] FROM $SYSTEM.TMSCHEMA_CALCULATION_ITEMS" },
    ];

    for (const dq of dmvQueries) {
      const result = await runDax(token, dq.query);
      if (result.ok) {
        const filename = `schema-${dq.name.toLowerCase()}.json`;
        writeJson(filename, result.rows);
        console.log(`  ${dq.name}: ${result.rows.length} rows`);
      } else {
        console.log(`  ${dq.name}: failed (${result.status})`);
      }
    }
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
