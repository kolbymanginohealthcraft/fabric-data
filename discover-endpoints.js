// Discovers SQL analytics endpoints for Fabric lakehouses + warehouses across
// all workspaces you can access, by calling the Fabric REST API with the same
// device-code credential used by fabric-query.js.
//
// Usage:
//   node discover-endpoints.js                 # dump everything as a table
//   node discover-endpoints.js --json          # full JSON
//   node discover-endpoints.js --emit-db       # print a databases.json-shaped block
//   node discover-endpoints.js --filter Silver # only workspaces whose name matches
//
// Read-only. Does not write any files.

const { getTokenForScope } = require("./fabric-query");

const FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default";
const API = "https://api.fabric.microsoft.com/v1";

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    json: args.includes("--json"),
    emitDb: args.includes("--emit-db"),
    filter: (() => {
      const i = args.indexOf("--filter");
      return i >= 0 ? args[i + 1] : null;
    })(),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, token, attempt = 0) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429 && attempt < 6) {
    // Honor Retry-After (seconds); fall back to exponential backoff.
    const ra = parseInt(res.headers.get("retry-after") || "", 10);
    const waitMs = Number.isFinite(ra) ? ra * 1000 : Math.min(2 ** attempt * 1000, 30000);
    console.error(`    (429 — backing off ${Math.round(waitMs / 1000)}s, attempt ${attempt + 1})`);
    await sleep(waitMs);
    return fetchWithRetry(url, token, attempt + 1);
  }
  return res;
}

async function api(path, token) {
  // Fabric REST paginates via continuationToken / continuationUri.
  let url = path.startsWith("http") ? path : `${API}${path}`;
  const all = [];
  while (url) {
    const res = await fetchWithRetry(url, token);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${res.statusText} on ${url}\n${body}`);
    }
    const data = await res.json();
    if (Array.isArray(data.value)) all.push(...data.value);
    url = data.continuationUri || null;
    await sleep(250); // pace pagination
  }
  return all;
}

(async () => {
  const { json, emitDb, filter } = parseArgs();

  const token = await getTokenForScope(FABRIC_SCOPE);

  // Default scope: the medallion workspaces only. DocAudit + Salesforce
  // are intentionally excluded. Override with --filter to scan others.
  const DEFAULT_TARGETS = [
    "Fabric - Bronze",
    "Fabric - Silver",
    "Fabric - Gold",
    "Fabric - Silver Warehouses",
  ];

  const workspaces = await api("/workspaces", token);
  const targets = filter
    ? workspaces.filter((w) => w.displayName.toLowerCase().includes(filter.toLowerCase()))
    : workspaces.filter((w) => DEFAULT_TARGETS.includes(w.displayName));

  console.error(`Scanning ${targets.length} of ${workspaces.length} workspace(s)...`);
  const rows = [];
  for (const ws of targets) {
    console.error(`- ${ws.displayName} (${ws.id})`);
    // Lakehouses — SQL endpoint lives under properties.sqlEndpointProperties
    let lakehouses = [];
    let warehouses = [];
    try { lakehouses = await api(`/workspaces/${ws.id}/lakehouses`, token); }
    catch (e) { console.error(`  ! lakehouses [${ws.displayName}]: ${e.message.split("\n")[0]}`); }
    try { warehouses = await api(`/workspaces/${ws.id}/warehouses`, token); }
    catch (e) { console.error(`  ! warehouses [${ws.displayName}]: ${e.message.split("\n")[0]}`); }

    for (const lh of lakehouses) {
      const ep = lh.properties?.sqlEndpointProperties || {};
      rows.push({
        workspace: ws.displayName,
        type: "Lakehouse",
        name: lh.displayName,
        database: lh.displayName,
        endpoint: ep.connectionString || "(provisioning?)",
        sqlEndpointId: ep.id || "",
      });
    }
    for (const wh of warehouses) {
      rows.push({
        workspace: ws.displayName,
        type: "Warehouse",
        name: wh.displayName,
        database: wh.displayName,
        endpoint: wh.properties?.connectionString || "(unknown)",
        sqlEndpointId: wh.id || "",
      });
    }
  }

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (emitDb) {
    // Suggest short aliases; you'll likely rename these by hand.
    const block = {};
    for (const r of rows) {
      const alias = `${r.workspace} / ${r.name}`;
      block[alias] = { endpoint: r.endpoint, database: r.database };
    }
    console.log(JSON.stringify(block, null, 2));
    return;
  }

  // Human-readable
  for (const r of rows) {
    console.log(`[${r.workspace}] ${r.type}: ${r.name}`);
    console.log(`    db:       ${r.database}`);
    console.log(`    endpoint: ${r.endpoint}`);
  }
  console.log(`\n${rows.length} SQL endpoints discovered across ${targets.length} workspace(s).`);
})().catch((err) => {
  console.error("Discovery failed:", err.message);
  process.exit(1);
});
