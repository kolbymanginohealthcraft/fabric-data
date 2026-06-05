const { getTokenForScope } = require("../fabric-query");
const fs = require("fs");
const path = require("path");

const POWER_BI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";
const BASE_URL = "https://api.powerbi.com/v1.0/myorg";

const WORKSPACE_ID = "5f4d44ed-7a93-4ca3-961c-d57038f7421d";
const REPORT_ID = "7975c6fd-112e-44dd-8f50-f62dd098c46d";
const OUT_DIR = __dirname;

async function getToken() {
  return getTokenForScope(POWER_BI_SCOPE);
}

async function apiFetch(urlPath, token) {
  const res = await fetch(`${BASE_URL}/${urlPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

async function apiFetchRaw(urlPath, token) {
  const res = await fetch(`${BASE_URL}/${urlPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function writeJson(filename, data) {
  const filepath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`Saved ${filepath}`);
}

async function main() {
  console.log("Authenticating...");
  const token = await getToken();
  console.log("Authenticated.\n");

  // 1. Get report metadata (includes datasetId)
  console.log("Fetching report metadata...");
  const report = await apiFetch(
    `groups/${WORKSPACE_ID}/reports/${REPORT_ID}`,
    token
  );
  writeJson("report-metadata.json", report);
  console.log(`  Report: ${report.name}`);
  console.log(`  Dataset ID: ${report.datasetId}\n`);

  const datasetId = report.datasetId;

  // 2. Get dataset/semantic model metadata
  console.log("Fetching semantic model metadata...");
  const dataset = await apiFetch(
    `groups/${WORKSPACE_ID}/datasets/${datasetId}`,
    token
  );
  writeJson("dataset-metadata.json", dataset);
  console.log(`  Model: ${dataset.name}\n`);

  // 3. Get all reports in the workspace to find others using same dataset
  console.log("Fetching all reports in workspace...");
  const allReports = await apiFetch(
    `groups/${WORKSPACE_ID}/reports`,
    token
  );
  const dependentReports = allReports.value.filter(
    (r) => r.datasetId === datasetId
  );
  writeJson("dependent-reports.json", dependentReports);
  console.log(`  Total reports in workspace: ${allReports.value.length}`);
  console.log(`  Reports using this semantic model: ${dependentReports.length}`);
  dependentReports.forEach((r) => {
    console.log(`    - ${r.name} (${r.id})`);
  });
  console.log();

  // 4. Get report pages for each dependent report
  console.log("Fetching pages for each dependent report...");
  const reportDetails = [];
  for (const r of dependentReports) {
    try {
      const pages = await apiFetch(
        `groups/${WORKSPACE_ID}/reports/${r.id}/pages`,
        token
      );
      reportDetails.push({ ...r, pages: pages.value });
      console.log(`  ${r.name}: ${pages.value.length} pages`);
    } catch (err) {
      reportDetails.push({ ...r, pages: [], error: err.message });
      console.log(`  ${r.name}: error fetching pages - ${err.message}`);
    }
  }
  writeJson("dependent-reports-detail.json", reportDetails);

  // 5. Export the target report as .pbix
  console.log("\nExporting report as .pbix...");
  try {
    const pbix = await apiFetchRaw(
      `groups/${WORKSPACE_ID}/reports/${REPORT_ID}/Export`,
      token
    );
    const pbixPath = path.join(OUT_DIR, `${report.name}.pbix`);
    fs.writeFileSync(pbixPath, pbix);
    console.log(`Saved ${pbixPath} (${(pbix.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.log(`  Export failed: ${err.message}`);
    console.log("  (This is normal for thin reports that can't be exported as .pbix)");
  }

  console.log("\nDone! Check the impact-analysis/ folder.");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
