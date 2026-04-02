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

async function getToken() {
  // Check file-based token cache first
  if (fs.existsSync(TOKEN_CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, "utf8"));
      if (cached.expiresOn > Date.now() + 60000) {
        return cached.token;
      }
    } catch {}
  }

  const tokenResponse = await credential.getToken("https://database.windows.net/.default");

  // Save to file cache for cross-process reuse
  fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify({
    token: tokenResponse.token,
    expiresOn: tokenResponse.expiresOnTimestamp,
  }));

  return tokenResponse.token;
}

async function getPool(dbName) {
  if (pools[dbName]) return pools[dbName];

  const db = databases[dbName];
  if (!db) {
    const available = Object.keys(databases).join(", ");
    throw new Error(`Unknown database "${dbName}". Available: ${available}`);
  }

  const token = await getToken();

  pools[dbName] = await sql.connect({
    server: db.endpoint,
    database: db.database,
    port: 1433,
    options: {
      encrypt: true,
    },
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token },
    },
  });

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

module.exports = { query, closeAll, databases };
