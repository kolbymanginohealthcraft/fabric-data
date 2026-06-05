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

async function apiFetch(urlPath, token, method = "GET", body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}/${urlPath}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} ${urlPath}: ${text}`);
  }
  return res.json();
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

  // 1. Tables and columns
  console.log("Fetching tables and columns...");
  try {
    const tables = await apiFetch(
      `groups/${WORKSPACE_ID}/datasets/${DATASET_ID}/tables`,
      token
    );
    writeJson("schema-tables.json", tables);
    console.log(`  Found ${tables.value.length} tables`);
    for (const t of tables.value) {
      const colCount = t.columns ? t.columns.length : 0;
      const measCount = t.measures ? t.measures.length : 0;
      console.log(`    ${t.name}: ${colCount} columns, ${measCount} measures`);
    }
  } catch (err) {
    console.log(`  Tables endpoint failed: ${err.message}`);
    console.log("  (This is common for import-mode models — trying DAX approach...)\n");
  }

  // 2. Datasources
  console.log("\nFetching datasources...");
  try {
    const ds = await apiFetch(
      `groups/${WORKSPACE_ID}/datasets/${DATASET_ID}/datasources`,
      token
    );
    writeJson("schema-datasources.json", ds);
    console.log(`  Found ${ds.value.length} datasource(s)`);
    for (const d of ds.value) {
      console.log(`    ${d.datasourceType}: ${d.connectionDetails?.server || ""} / ${d.connectionDetails?.database || d.connectionDetails?.path || ""}`);
    }
  } catch (err) {
    console.log(`  Datasources failed: ${err.message}`);
  }

  // 3. Refresh history
  console.log("\nFetching refresh history...");
  try {
    const refreshes = await apiFetch(
      `groups/${WORKSPACE_ID}/datasets/${DATASET_ID}/refreshes?$top=5`,
      token
    );
    writeJson("schema-refreshes.json", refreshes);
    console.log(`  Last ${refreshes.value.length} refreshes`);
    for (const r of refreshes.value) {
      console.log(`    ${r.startTime} — ${r.status} (${r.refreshType})`);
    }
  } catch (err) {
    console.log(`  Refreshes failed: ${err.message}`);
  }

  // 4. Parameters
  console.log("\nFetching parameters...");
  try {
    const params = await apiFetch(
      `groups/${WORKSPACE_ID}/datasets/${DATASET_ID}/parameters`,
      token
    );
    writeJson("schema-parameters.json", params);
    console.log(`  Found ${params.value.length} parameter(s)`);
    for (const p of params.value) {
      console.log(`    ${p.name} = ${p.currentValue}`);
    }
  } catch (err) {
    console.log(`  Parameters failed: ${err.message}`);
  }

  // 5. Try DAX queries for richer metadata (measures with expressions, etc.)
  console.log("\nFetching measures via DAX (executeQueries)...");
  const daxQueries = [
    {
      name: "measures",
      file: "schema-measures-dax.json",
      query: `
        EVALUATE
        SELECTCOLUMNS(
          INFO.MEASURES(),
          "TableID", [TableID],
          "MeasureName", [Name],
          "Expression", [Expression],
          "Description", [Description],
          "DataType", [DataType],
          "FormatString", [FormatString],
          "IsHidden", [IsHidden],
          "DisplayFolder", [DisplayFolder]
        )
      `,
    },
    {
      name: "columns",
      file: "schema-columns-dax.json",
      query: `
        EVALUATE
        SELECTCOLUMNS(
          INFO.COLUMNS(),
          "TableID", [TableID],
          "ColumnName", [ExplicitName],
          "DataType", [ExplicitDataType],
          "IsHidden", [IsHidden],
          "Description", [Description],
          "DisplayFolder", [DisplayFolder],
          "SortByColumnID", [SortByColumnID],
          "Type", [Type]
        )
      `,
    },
    {
      name: "tables",
      file: "schema-tables-dax.json",
      query: `
        EVALUATE
        SELECTCOLUMNS(
          INFO.TABLES(),
          "TableID", [ID],
          "TableName", [Name],
          "IsHidden", [IsHidden],
          "Description", [Description]
        )
      `,
    },
    {
      name: "relationships",
      file: "schema-relationships-dax.json",
      query: `
        EVALUATE
        SELECTCOLUMNS(
          INFO.RELATIONSHIPS(),
          "RelationshipID", [ID],
          "FromTableID", [FromTableID],
          "FromColumnID", [FromColumnID],
          "ToTableID", [ToTableID],
          "ToColumnID", [ToColumnID],
          "CrossFilteringBehavior", [CrossFilteringBehavior],
          "IsActive", [IsActive],
          "Cardinality", [Cardinality]
        )
      `,
    },
    {
      name: "partitions (Power Query)",
      file: "schema-partitions-dax.json",
      query: `
        EVALUATE
        SELECTCOLUMNS(
          INFO.PARTITIONS(),
          "TableID", [TableID],
          "PartitionName", [Name],
          "QueryDefinition", [QueryDefinition],
          "SourceType", [SourceType],
          "Mode", [Mode],
          "Type", [Type]
        )
      `,
    },
    {
      name: "expressions (shared Power Query)",
      file: "schema-expressions-dax.json",
      query: `
        EVALUATE
        SELECTCOLUMNS(
          INFO.EXPRESSIONS(),
          "Name", [Name],
          "Expression", [Expression],
          "Description", [Description],
          "Kind", [Kind]
        )
      `,
    },
    {
      name: "calculation groups",
      file: "schema-calcgroups-dax.json",
      query: `
        EVALUATE
        SELECTCOLUMNS(
          INFO.CALCULATIONITEMS(),
          "TableID", [TableID],
          "Name", [Name],
          "Expression", [Expression],
          "Ordinal", [Ordinal]
        )
      `,
    },
  ];

  for (const dq of daxQueries) {
    console.log(`  Querying ${dq.name}...`);
    try {
      const result = await apiFetch(
        `groups/${WORKSPACE_ID}/datasets/${DATASET_ID}/executeQueries`,
        token,
        "POST",
        {
          queries: [{ query: dq.query }],
          serializerSettings: { includeNulls: true },
        }
      );
      const rows = result.results?.[0]?.tables?.[0]?.rows || [];
      writeJson(dq.file, rows);
      console.log(`    ${rows.length} rows`);
    } catch (err) {
      console.log(`    Failed: ${err.message.substring(0, 200)}`);
    }
  }

  console.log("\nDone! All schema files in impact-analysis/");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
