const sql = require("mssql");
const { DeviceCodeCredential, useIdentityPlugin } = require("@azure/identity");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const databases = require("./databases.json");

// Enable persistent token cache so you only authenticate once
try {
  const { cachePersistencePlugin } = require("@azure/identity-cache-persistence");
  useIdentityPlugin(cachePersistencePlugin);
} catch {
  // Plugin not installed — tokens still cache in-memory for this process
}

const credential = new DeviceCodeCredential({
  tenantId: process.env.AZURE_TENANT_ID,
  userPromptCallback: (info) => {
    console.error(info.message);
  },
  tokenCachePersistenceOptions: {
    enabled: true,
    name: "fabric-data",
  },
});

const TOKEN_CACHE_FILE = path.join(__dirname, ".token-cache.json");

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

  const tokenResponse = await credential.getToken(scope);
  cache[scope] = {
    token: tokenResponse.token,
    expiresOn: tokenResponse.expiresOnTimestamp,
  };
  writeTokenCache(cache);
  return tokenResponse.token;
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

module.exports = { query, closeAll, databases, getTokenForScope, credential };
