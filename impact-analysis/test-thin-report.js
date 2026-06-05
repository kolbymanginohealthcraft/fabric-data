const { getTokenForScope } = require("../fabric-query");
const fs = require("fs");
const path = require("path");

const POWER_BI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";
const BASE_URL = "https://api.powerbi.com/v1.0/myorg";

// Source model info
const SOURCE_WORKSPACE_ID = "5f4d44ed-7a93-4ca3-961c-d57038f7421d";
const DATASET_ID = "e9a7f4e0-9772-49a4-a4de-c66ad8f9bae6";

async function apiFetch(urlPath, token, method = "GET", body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}/${urlPath}`, opts);
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: text };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: true, data: text };
  }
}

async function main() {
  console.log("Authenticating...");
  const token = await getTokenForScope(POWER_BI_SCOPE);
  console.log("Authenticated.\n");

  // Step 1: Find personal workspace
  console.log("--- Step 1: Personal workspace (My Workspace) ---");
  const myReports = await apiFetch("reports", token);
  if (myReports.ok) {
    console.log(`My Workspace has ${myReports.data.value.length} reports`);
    myReports.data.value.forEach((r) => {
      console.log(`  - ${r.name} (dataset: ${r.datasetId})`);
    });
  } else {
    console.log(`Failed: ${myReports.error}`);
  }

  // Step 2: Check if we can see all workspaces we have access to
  console.log("\n--- Step 2: Accessible workspaces ---");
  const workspaces = await apiFetch("groups", token);
  if (workspaces.ok) {
    workspaces.data.value.forEach((w) => {
      console.log(`  ${w.name} (${w.id}) - isOnDedicatedCapacity: ${w.isOnDedicatedCapacity}`);
    });
  }

  // Step 3: Get dataset details to understand connection string
  console.log("\n--- Step 3: Dataset connection info ---");
  const dataset = await apiFetch(
    `groups/${SOURCE_WORKSPACE_ID}/datasets/${DATASET_ID}`,
    token
  );
  if (dataset.ok) {
    console.log(`Dataset: ${dataset.data.name}`);
    console.log(`Target storage: ${dataset.data.targetStorageMode}`);
    console.log(`Configured by: ${dataset.data.configuredBy}`);
    console.log(JSON.stringify(dataset.data, null, 2));
  }

  // Step 4: Try creating a thin report via Clone API
  // First, find a simple existing report to clone and rebind
  console.log("\n--- Step 4: Attempting to create report in My Workspace ---");

  // Method A: Try CreateReport API (creates blank report bound to dataset)
  const createResult = await apiFetch("reports", token, "POST", {
    name: "Test Thin Report (Claude)",
    datasetId: DATASET_ID,
    targetWorkspaceId: null, // null = My Workspace
  });

  if (createResult.ok) {
    console.log("SUCCESS! Created thin report:");
    console.log(JSON.stringify(createResult.data, null, 2));
  } else {
    console.log(`CreateReport failed (${createResult.status}): ${createResult.error}`);

    // Method B: Try Clone approach
    console.log("\n--- Step 4b: Trying Clone approach ---");
    const sourceReports = await apiFetch(
      `groups/${SOURCE_WORKSPACE_ID}/reports`,
      token
    );
    if (sourceReports.ok) {
      // Pick the smallest report (ANA Reponses - 1 page)
      const ana = sourceReports.data.value.find((r) => r.name === "ANA Reponses");
      if (ana) {
        console.log(`Cloning "${ana.name}" to My Workspace...`);
        const cloneResult = await apiFetch(
          `groups/${SOURCE_WORKSPACE_ID}/reports/${ana.id}/Clone`,
          token,
          "POST",
          {
            name: "Test Thin Report (Claude)",
            targetModelId: DATASET_ID,
          }
        );
        if (cloneResult.ok) {
          console.log("SUCCESS! Cloned report:");
          console.log(JSON.stringify(cloneResult.data, null, 2));
        } else {
          console.log(`Clone failed (${cloneResult.status}): ${cloneResult.error}`);
        }
      }
    }
  }

  // Step 5: Try Fabric Items API as alternative
  console.log("\n--- Step 5: Testing Fabric Items API ---");
  const fabricToken = await getTokenForScope("https://api.fabric.microsoft.com/.default");

  const fabricRes = await fetch("https://api.fabric.microsoft.com/v1/workspaces", {
    headers: { Authorization: `Bearer ${fabricToken}` },
  });
  if (fabricRes.ok) {
    const fabricData = await fabricRes.json();
    console.log("Fabric workspaces accessible:");
    fabricData.value.forEach((w) => {
      console.log(`  ${w.displayName} (${w.id}) - capacity: ${w.capacityId || "none"}`);
    });
  } else {
    console.log(`Fabric API: ${fabricRes.status} ${await fabricRes.text()}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
