// Fetch the Patient Satisfaction survey xlsx files from SharePoint/OneDrive via Microsoft Graph,
// using the az-CLI delegated token (same session as Fabric). Saves to data/. Automated, no manual
// download. Uses the Graph /shares endpoint (access a file by its web URL when you have permission).
// Usage: node queries/pull-satisfaction.js
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const FILES = [
  { url: "https://aegis-my.sharepoint.com/personal/brad_miller_aegistherapies_com/Documents/Patient Satisfaction Survey.xlsx", out: "satisfaction-main.xlsx" },
  { url: "https://aegis-my.sharepoint.com/personal/brad_miller_aegistherapies_com/Documents/Ohana Survey.xlsx", out: "satisfaction-ohana.xlsx" },
];

function graphToken() {
  const raw = execSync('az account get-access-token --resource https://graph.microsoft.com --output json',
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(raw).accessToken;
}
function shareId(url) {
  const b64 = Buffer.from(url, "utf8").toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  return "u!" + b64;
}
function get(url, token) {
  return new Promise((resolve, reject) => {
    const opts = token ? { headers: { Authorization: "Bearer " + token } } : {};
    https.get(url, opts, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) { // pre-signed download URL, no auth
        res.resume(); return resolve(get(res.headers.location, null));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

(async () => {
  const token = graphToken();
  console.error("got Graph token");
  for (const f of FILES) {
    const u = `https://graph.microsoft.com/v1.0/shares/${shareId(f.url)}/driveItem/content`;
    try {
      const r = await get(u, token);
      const magic = r.body.slice(0, 2).toString("latin1"); // 'PK' = xlsx/zip
      if (r.status === 200 && magic === "PK") {
        fs.writeFileSync(path.join(__dirname, "..", "data", f.out), r.body);
        console.error(`OK  ${f.out}: ${r.body.length} bytes`);
      } else {
        console.error(`FAIL ${f.out}: HTTP ${r.status}, first120=${r.body.slice(0, 120).toString("utf8")}`);
      }
    } catch (e) { console.error(`ERR ${f.out}: ${e.message}`); }
  }
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
