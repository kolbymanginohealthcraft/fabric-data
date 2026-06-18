const sql = require("mssql");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ quiet: true }); // quiet: keep stdout pure JSON for programmatic callers

const databases = require("./databases.json");

// DURABLE auth, no interactive reauth ever (with regular use):
// We shell out to the Azure CLI directly — `az account get-access-token` — for a database
// access token. `az login` (run ONCE) issues a ROLLING refresh token: ~90-day lifetime that
// is renewed on every use, so as long as this tooling is used periodically the session never
// expires and NO device code is ever shown. The token is cached in .token-cache.json and
// reused until ~1 min before expiry; only then do we re-spawn az (which refreshes silently).
//
// Why call az ourselves instead of @azure/identity's AzureCliCredential: that wrapper
// intermittently returned EMPTY output here ("Unexpected end of JSON input") while the direct
// `az account get-access-token --resource https://database.windows.net/` call always works.
// DO NOT switch to DeviceCodeCredential (caches only in-memory → re-prompts every run).
// If `az` ever IS logged out (e.g. >90 days idle), the fix is one command the USER runs:
// `az login`. There is no device-code flow in this script.
const TOKEN_CACHE_FILE = path.join(__dirname, ".token-cache.json");

function acquireTokenViaAzCli(scope) {
  // resource is derived from a fixed scope constant (no user input) -> safe to interpolate.
  const resource = scope.replace(/\/\.default$/, "/"); // CLI wants --resource, not a scope
  let raw;
  try {
    raw = execSync(
      `az account get-access-token --resource ${resource} --output json`,
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (e) {
    throw new Error(
      "Azure CLI token acquisition failed. Run `az login` once in your shell, then retry. " +
      "(underlying: " + (e.stderr || e.message || e).toString().trim().split("\n").pop() + ")"
    );
  }
  const t = JSON.parse(raw);
  return { token: t.accessToken, expiresOn: Number(t.expires_on) * 1000 };
}

const pools = {};

function readTokenCache() {
  if (fs.existsSync(TOKEN_CACHE_FILE)) {
    try { return JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, "utf8")); } catch {}
  }
  return {};
}

function writeTokenCache(cache) {
  fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function getTokenForScope(scope) {
  const cache = readTokenCache();
  const cached = cache[scope];
  if (cached && cached.expiresOn > Date.now() + 60000) {
    return cached.token;
  }

  const fresh = acquireTokenViaAzCli(scope);
  cache[scope] = fresh;
  writeTokenCache(cache);
  return fresh.token;
}

async function getToken() {
  return getTokenForScope("https://database.windows.net/.default");
}

async function getPool(dbName) {
  if (pools[dbName]) return pools[dbName];

  const db = databases[dbName];
  if (!db) {
    const available = Object.keys(databases).join(", ");
    throw new Error(`Unknown database "${dbName}". Available: ${available}`);
  }

  const token = await getToken();

  // Use a dedicated ConnectionPool per database (NOT the global sql.connect(),
  // which only supports one connection per process — opening a second db would
  // silently reuse the first pool and run queries against the wrong database).
  const pool = new sql.ConnectionPool({
    server: db.endpoint,
    database: db.database,
    port: 1433,
    requestTimeout: 600000,
    options: {
      encrypt: true,
    },
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token },
    },
  });
  pools[dbName] = await pool.connect();

  return pools[dbName];
}

async function query(sqlText, dbName = "general") {
  const p = await getPool(dbName);
  return p.request().query(sqlText);
}

async function closeAll() {
  for (const [name, pool] of Object.entries(pools)) {
    await pool.close();
    delete pools[name];
  }
}

// CLI mode: node fabric-query.js [--db <name>] "SELECT ..."
if (require.main === module) {
  const args = process.argv.slice(2);
  let dbName = "general";
  let sqlText;

  if (args[0] === "--db" && args[1]) {
    dbName = args[1];
    sqlText = args[2];
  } else {
    sqlText = args[0];
  }

  if (!sqlText) {
    console.error("Usage: node fabric-query.js [--db <name>] \"SELECT ...\"");
    console.error(`\nAvailable databases: ${Object.keys(databases).join(", ")}`);
    process.exit(1);
  }

  query(sqlText, dbName)
    .then((result) => {
      console.log(JSON.stringify(result.recordset, null, 2));
    })
    .catch((err) => {
      console.error("Query failed:", err.message);
      process.exit(1);
    })
    .finally(() => closeAll());
}

module.exports = { query, closeAll, databases, getTokenForScope, acquireTokenViaAzCli };
