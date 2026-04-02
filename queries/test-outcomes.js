const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

// Parse CSV into array of objects
function parseCSV(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => (obj[h.trim()] = values[i]?.trim() ?? ""));
    return obj;
  });
}

// Handle quoted CSV fields (commas inside quotes)
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

async function run() {
  const crosswalk = parseCSV(path.join(__dirname, "..", "Outcomes Crosswalk.csv"));
  const customScales = parseCSV(path.join(__dirname, "..", "Outcomes Custom Scales.csv"));

  // Build lookup maps
  const cwSet = new Set(crosswalk.map((r) => r.LibraryItem_ID));
  const cwMap = {};
  crosswalk.forEach((r) => {
    cwMap[r.LibraryItem_ID] = r;
  });

  const scaleMap = {};
  customScales.forEach((r) => {
    const pts = parseFloat(r.Points) / 100; // Convert "85.0%" → 0.85
    scaleMap[r["Library Scale Value"]] = {
      points: r["Response Type"] === "N/A" ? null : pts,
      responseType: r["Response Type"],
      scaleValueId: r["Library Scale Value"],
    };
  });

  console.log(`Loaded ${crosswalk.length} crosswalk items, ${customScales.length} scale mappings`);

  // Pull assessment data from Fabric — scoped to a sample of recent cases
  console.log("\nQuerying Fabric for assessment data...");
  const result = await query(`
    SELECT
      trk.PatientCase_ID,
      trk.TxTrack_ID,
      doc.DocumentType,
      doc.TxDocument_ID,
      item.LibraryItem_ID,
      item.LibraryScaleValue_ID
    FROM BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocumentItem item
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocument doc
      ON item.TxDocument_ID = doc.TxDocument_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.TxTrack trk
      ON doc.TxTrack_ID = trk.TxTrack_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.PatientCase pc
      ON trk.PatientCase_ID = pc.PatientCase_ID
    WHERE doc.DocumentType IN ('EVAL', 'DISCH')
      AND item.LibraryScaleValue_ID IS NOT NULL
      AND pc.EndDate >= '2026-01-01'
      AND pc.EndDate < '2026-04-01'
  `, "patient");

  console.log(`Fetched ${result.recordset.length} assessment rows`);

  // Filter to crosswalked items and assign points
  const scored = result.recordset
    .filter((r) => cwSet.has(String(r.LibraryItem_ID)))
    .map((r) => {
      const cw = cwMap[String(r.LibraryItem_ID)];
      const scale = scaleMap[String(r.LibraryScaleValue_ID)];
      return {
        PatientCase_ID: r.PatientCase_ID,
        TxTrack_ID: r.TxTrack_ID,
        DocumentType: r.DocumentType,
        LibraryItem_ID: r.LibraryItem_ID,
        LibraryScaleValue_ID: r.LibraryScaleValue_ID,
        Family: cw.Family,
        Group: cw.Group,
        OutcomeName: cw.Name,
        Points: scale ? scale.points : null,
        ResponseType: scale ? scale.responseType : "UNMAPPED",
      };
    });

  console.log(`After crosswalk filter: ${scored.length} scored rows`);
  console.log(`Unmapped scale values: ${scored.filter((r) => r.ResponseType === "UNMAPPED").length}`);

  // Aggregate: AVG points per PatientCase_ID × TxTrack_ID × LibraryItem_ID × DocumentType
  const itemKey = (r) => `${r.PatientCase_ID}|${r.TxTrack_ID}|${r.LibraryItem_ID}`;
  const groups = {};
  for (const r of scored) {
    const k = itemKey(r);
    if (!groups[k]) {
      groups[k] = {
        PatientCase_ID: r.PatientCase_ID,
        TxTrack_ID: r.TxTrack_ID,
        LibraryItem_ID: r.LibraryItem_ID,
        Family: r.Family,
        Group: r.Group,
        OutcomeName: r.OutcomeName,
        evalPoints: [],
        dischPoints: [],
        evalScaleValues: [],
      };
    }
    if (r.DocumentType === "EVAL") {
      if (r.Points !== null) groups[k].evalPoints.push(r.Points);
      groups[k].evalScaleValues.push(r.LibraryScaleValue_ID);
    } else if (r.DocumentType === "DISCH") {
      if (r.Points !== null) groups[k].dischPoints.push(r.Points);
    }
  }

  const GG_NA_VALUES = new Set([15102, 15103, 15104, 15105]);
  const GG_FAMILIES = new Set(["(a) Section GG Mobility", "(b) Section GG Self Care"]);

  const summary = Object.values(groups).map((g) => {
    const tableEval = g.evalPoints.length > 0
      ? g.evalPoints.reduce((a, b) => a + b, 0) / g.evalPoints.length
      : null;
    const tableDisch = g.dischPoints.length > 0
      ? g.dischPoints.reduce((a, b) => a + b, 0) / g.dischPoints.length
      : null;

    // GG N/A exclusion
    const hasGGNA = GG_FAMILIES.has(g.Family) &&
      g.evalScaleValues.some((v) => GG_NA_VALUES.has(v));
    const evalNEW = hasGGNA ? 0 : tableEval;

    // Inclusion status
    const status =
      evalNEW !== null && tableDisch !== null && evalNEW !== 1.0
        ? "Included"
        : "Excluded";

    return {
      PatientCase_ID: g.PatientCase_ID,
      TxTrack_ID: g.TxTrack_ID,
      LibraryItem_ID: g.LibraryItem_ID,
      Family: g.Family,
      Group: g.Group,
      OutcomeName: g.OutcomeName,
      EvalNEW: evalNEW,
      TableDisch: tableDisch,
      Status: status,
    };
  });

  const included = summary.filter((r) => r.Status === "Included");
  const excluded = summary.filter((r) => r.Status === "Excluded");
  console.log(`\nOutcomeSummary: ${summary.length} rows (${included.length} included, ${excluded.length} excluded)`);

  // Case-level aggregation
  const cases = {};
  for (const r of included) {
    if (!cases[r.PatientCase_ID]) {
      cases[r.PatientCase_ID] = { evalScores: [], dischScores: [] };
    }
    if (r.EvalNEW !== null) cases[r.PatientCase_ID].evalScores.push(r.EvalNEW);
    if (r.TableDisch !== null) cases[r.PatientCase_ID].dischScores.push(r.TableDisch);
  }

  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const caseResults = Object.entries(cases).map(([caseId, c]) => {
    const admitLevel = avg(c.evalScores);
    const dischLevel = avg(c.dischScores);
    const gain = dischLevel - admitLevel;
    const pctImprovement = admitLevel > 0 ? gain / admitLevel : null;
    const result = gain > 0 ? "Improved" : gain < 0 ? "Declined" : "No Change";
    return { PatientCase_ID: caseId, admitLevel, dischLevel, gain, pctImprovement, result };
  });

  const improved = caseResults.filter((r) => r.result === "Improved").length;
  const declined = caseResults.filter((r) => r.result === "Declined").length;
  const noChange = caseResults.filter((r) => r.result === "No Change").length;

  console.log(`\n=== Case-Level Results ===`);
  console.log(`Total cases with outcomes: ${caseResults.length}`);
  console.log(`Improved: ${improved} (${(100 * improved / caseResults.length).toFixed(1)}%)`);
  console.log(`Declined: ${declined} (${(100 * declined / caseResults.length).toFixed(1)}%)`);
  console.log(`No Change: ${noChange}`);

  if (caseResults.length > 0) {
    const avgGain = avg(caseResults.map((r) => r.gain));
    const avgAdmit = avg(caseResults.map((r) => r.admitLevel));
    const avgDisch = avg(caseResults.map((r) => r.dischLevel));
    console.log(`\nAvg Admit Level: ${(avgAdmit * 100).toFixed(1)}%`);
    console.log(`Avg Discharge Level: ${(avgDisch * 100).toFixed(1)}%`);
    console.log(`Avg Gain: ${(avgGain * 100).toFixed(1)} percentage points`);

    // Show a few sample cases
    console.log(`\nSample cases:`);
    caseResults.slice(0, 5).forEach((r) => {
      console.log(`  Case ${r.PatientCase_ID}: Admit ${(r.admitLevel * 100).toFixed(1)}% → Discharge ${(r.dischLevel * 100).toFixed(1)}% | Gain ${(r.gain * 100).toFixed(1)}pp | ${r.result}`);
    });
  }

  await closeAll();
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
