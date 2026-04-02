const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

// Parse CSV helpers (same as test-outcomes.js)
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
  // Load local lookups
  const crosswalk = parseCSV(path.join(__dirname, "..", "Outcomes Crosswalk.csv"));
  const customScales = parseCSV(path.join(__dirname, "..", "Outcomes Custom Scales.csv"));

  const cwMap = {};
  crosswalk.forEach((r) => (cwMap[r.LibraryItem_ID] = r));
  const cwSet = new Set(Object.keys(cwMap));

  const scaleMap = {};
  customScales.forEach((r) => {
    const pts = parseFloat(r.Points) / 100;
    scaleMap[r["Library Scale Value"]] = {
      points: r["Response Type"] === "N/A" ? null : pts,
      responseType: r["Response Type"],
      scaleValueId: r["Library Scale Value"],
    };
  });

  console.log(`Loaded ${crosswalk.length} crosswalk items, ${customScales.length} scale mappings`);

  // =========================================================================
  // Step 1: Case + Stay + Patient + Facility context
  // =========================================================================
  console.log("\n[1/4] Querying case context...");
  const caseData = await query(`
    SELECT
      pc.PatientCase_ID,
      pc.Stay_ID,
      pc.StartDate AS CaseStartDate,
      pc.EndDate AS CaseEndDate,
      pc.IsDeletedCase,
      pc.TypeOfCare,
      s.Resident_ID,
      s.AdmitDate,
      s.DischargeDate,
      s.IsCurrent AS StayIsCurrent,
      s.IntakeSource_ID,
      ri.FirstName,
      ri.LastName,
      r.DOB,
      r.Gender,
      r.Facility_ID,
      f.Name AS FacilityName,
      f.FacilityCode,
      f.SiteType,
      f.PrimaryHealthcareSetting,
      f.Chain_ID,
      isrc.Name AS IntakeSourceName,
      isrc.SourceType AS IntakeSourceType,
      isrc.IsInstitutional,
      isrc.IsSNF
    FROM BINetHealthPatientLakehouse.PatientInfo.PatientCase pc
    JOIN BINetHealthPatientLakehouse.PatientInfo.Stay s
      ON pc.Stay_ID = s.Stay_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.Resident r
      ON s.Resident_ID = r.Resident_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.ResidentInfo ri
      ON r.Resident_ID = ri.Resident_ID AND ri.IsCurrent = 1
    JOIN BINetHealthPatientLakehouse.PatientInfo.Facility f
      ON r.Facility_ID = f.Facility_ID
    LEFT JOIN BINetHealthGeneralLakehouse.Lookups.IntakeSource isrc
      ON s.IntakeSource_ID = isrc.IntakeSource_ID
    WHERE pc.EndDate >= '2026-01-01'
      AND pc.EndDate < '2026-04-01'
      AND pc.IsDeletedCase = 0
  `, "patient");

  console.log(`  ${caseData.recordset.length} cases`);

  // =========================================================================
  // Step 2: Tracks per case (join via case date filter — no IN clause needed)
  // =========================================================================
  console.log("[2/4] Querying tracks...");
  const trackResult = await query(`
    SELECT
      trk.TxTrack_ID,
      trk.PatientCase_ID,
      trk.Discipline,
      trk.StartDate AS TrackStartDate,
      trk.EndDate AS TrackEndDate
    FROM BINetHealthPatientLakehouse.PatientInfo.TxTrack trk
    JOIN BINetHealthPatientLakehouse.PatientInfo.PatientCase pc
      ON trk.PatientCase_ID = pc.PatientCase_ID
    WHERE pc.EndDate >= '2026-01-01'
      AND pc.EndDate < '2026-04-01'
      AND pc.IsDeletedCase = 0
      AND trk.IsDeletedTrack = 0
  `, "patient");
  const trackData = trackResult.recordset;
  console.log(`  ${trackData.length} tracks`);

  // =========================================================================
  // Step 3: Visits and minutes per track + per therapist
  // =========================================================================
  console.log("[3/4] Querying sessions and treatment minutes...");
  const [sessionResult, treatmentResult] = await Promise.all([
    query(`
      SELECT
        sess.TxTrack_ID,
        sess.TxSession_ID,
        sess.SessionDate
      FROM BINetHealthPatientLakehouse.PatientInfo.TxSession sess
      JOIN BINetHealthPatientLakehouse.PatientInfo.TxTrack trk
        ON sess.TxTrack_ID = trk.TxTrack_ID
      JOIN BINetHealthPatientLakehouse.PatientInfo.PatientCase pc
        ON trk.PatientCase_ID = pc.PatientCase_ID
      WHERE pc.EndDate >= '2026-01-01'
        AND pc.EndDate < '2026-04-01'
        AND pc.IsDeletedCase = 0
        AND trk.IsDeletedTrack = 0
        AND sess.IsDeletedSession = 0
    `, "patient"),
    query(`
      SELECT
        tx.TxTrack_ID,
        tx.Person_ID,
        tx.SessionId,
        tx.LaborDate,
        tx.Duration,
        tx.Units,
        tx.ServiceCode
      FROM BINetHealthPatientLakehouse.DailyInfo.Treatments tx
      JOIN BINetHealthPatientLakehouse.PatientInfo.TxTrack trk
        ON tx.TxTrack_ID = trk.TxTrack_ID
      JOIN BINetHealthPatientLakehouse.PatientInfo.PatientCase pc
        ON trk.PatientCase_ID = pc.PatientCase_ID
      WHERE pc.EndDate >= '2026-01-01'
        AND pc.EndDate < '2026-04-01'
        AND pc.IsDeletedCase = 0
        AND trk.IsDeletedTrack = 0
    `, "patient"),
  ]);
  const sessionData = sessionResult.recordset;
  const treatmentData = treatmentResult.recordset;
  console.log(`  ${sessionData.length} sessions, ${treatmentData.length} treatment lines`);

  // =========================================================================
  // Step 4: Assessment items for outcomes scoring
  // =========================================================================
  console.log("[4/4] Querying assessments for outcomes...");
  const assessmentResult = await query(`
    SELECT
      doc.TxTrack_ID,
      doc.TxDocument_ID,
      doc.DocumentType,
      item.LibraryItem_ID,
      item.LibraryScaleValue_ID
    FROM BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocumentItem item
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocument doc
      ON item.TxDocument_ID = doc.TxDocument_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.TxTrack trk
      ON doc.TxTrack_ID = trk.TxTrack_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.PatientCase pc
      ON trk.PatientCase_ID = pc.PatientCase_ID
    WHERE pc.EndDate >= '2026-01-01'
      AND pc.EndDate < '2026-04-01'
      AND pc.IsDeletedCase = 0
      AND trk.IsDeletedTrack = 0
      AND doc.DocumentType IN ('EVAL', 'DISCH')
      AND item.LibraryScaleValue_ID IS NOT NULL
  `, "patient");
  const assessmentData = assessmentResult.recordset;
  console.log(`  ${assessmentData.length} assessment rows`);

  // =========================================================================
  // Compute: Track-level aggregations
  // =========================================================================
  console.log("\nComputing aggregations...");

  // Sessions per track
  const sessionsPerTrack = {};
  for (const s of sessionData) {
    if (!sessionsPerTrack[s.TxTrack_ID]) sessionsPerTrack[s.TxTrack_ID] = 0;
    sessionsPerTrack[s.TxTrack_ID]++;
  }

  // Minutes per track, and minutes per therapist per track
  const minutesPerTrack = {};
  const minutesPerTherapistTrack = {};
  for (const t of treatmentData) {
    minutesPerTrack[t.TxTrack_ID] = (minutesPerTrack[t.TxTrack_ID] || 0) + t.Duration;
    const key = `${t.TxTrack_ID}|${t.Person_ID}`;
    minutesPerTherapistTrack[key] = (minutesPerTherapistTrack[key] || 0) + t.Duration;
  }

  // =========================================================================
  // Compute: Outcomes scoring (same logic as test-outcomes.js)
  // =========================================================================
  const GG_NA_VALUES = new Set([15102, 15103, 15104, 15105]);
  const GG_FAMILIES = new Set(["(a) Section GG Mobility", "(b) Section GG Self Care"]);

  // Score and group assessments
  const itemGroups = {};
  for (const a of assessmentData) {
    if (!cwSet.has(String(a.LibraryItem_ID))) continue;
    const scale = scaleMap[String(a.LibraryScaleValue_ID)];
    if (!scale) continue;

    const k = `${a.TxTrack_ID}|${a.LibraryItem_ID}`;
    if (!itemGroups[k]) {
      const cw = cwMap[String(a.LibraryItem_ID)];
      itemGroups[k] = {
        TxTrack_ID: a.TxTrack_ID,
        LibraryItem_ID: a.LibraryItem_ID,
        Family: cw.Family,
        evalPoints: [],
        dischPoints: [],
        evalScaleValues: [],
      };
    }
    if (a.DocumentType === "EVAL") {
      if (scale.points !== null) itemGroups[k].evalPoints.push(scale.points);
      itemGroups[k].evalScaleValues.push(a.LibraryScaleValue_ID);
    } else if (a.DocumentType === "DISCH") {
      if (scale.points !== null) itemGroups[k].dischPoints.push(scale.points);
    }
  }

  // Build OutcomeSummary rows with inclusion status
  const outcomeSummary = Object.values(itemGroups).map((g) => {
    const tableEval = g.evalPoints.length > 0
      ? g.evalPoints.reduce((a, b) => a + b, 0) / g.evalPoints.length
      : null;
    const tableDisch = g.dischPoints.length > 0
      ? g.dischPoints.reduce((a, b) => a + b, 0) / g.dischPoints.length
      : null;
    const hasGGNA = GG_FAMILIES.has(g.Family) &&
      g.evalScaleValues.some((v) => GG_NA_VALUES.has(v));
    const evalNEW = hasGGNA ? 0 : tableEval;
    const status =
      evalNEW !== null && tableDisch !== null && evalNEW !== 1.0
        ? "Included"
        : "Excluded";
    return { TxTrack_ID: g.TxTrack_ID, evalNEW, tableDisch, status };
  });

  // Aggregate outcomes to track level
  const trackOutcomes = {};
  for (const o of outcomeSummary) {
    if (o.status !== "Included") continue;
    if (!trackOutcomes[o.TxTrack_ID]) {
      trackOutcomes[o.TxTrack_ID] = { evalScores: [], dischScores: [] };
    }
    if (o.evalNEW !== null) trackOutcomes[o.TxTrack_ID].evalScores.push(o.evalNEW);
    if (o.tableDisch !== null) trackOutcomes[o.TxTrack_ID].dischScores.push(o.tableDisch);
  }

  // =========================================================================
  // Compute: Therapist contribution per case (for future people dashboard)
  // =========================================================================
  // Build case → total minutes, and case → therapist → minutes
  const trackToCase = {};
  for (const t of trackData) {
    trackToCase[t.TxTrack_ID] = t.PatientCase_ID;
  }

  const minutesPerTherapistCase = {};
  const totalMinutesPerCase = {};
  for (const t of treatmentData) {
    const caseId = trackToCase[t.TxTrack_ID];
    if (!caseId) continue;
    totalMinutesPerCase[caseId] = (totalMinutesPerCase[caseId] || 0) + t.Duration;
    const key = `${caseId}|${t.Person_ID}`;
    minutesPerTherapistCase[key] = (minutesPerTherapistCase[key] || 0) + t.Duration;
  }

  // =========================================================================
  // Assemble: Case-level view
  // =========================================================================
  const tracksByCase = {};
  for (const t of trackData) {
    if (!tracksByCase[t.PatientCase_ID]) tracksByCase[t.PatientCase_ID] = [];
    tracksByCase[t.PatientCase_ID].push(t);
  }

  const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const caseView = caseData.recordset.map((c) => {
    const tracks = tracksByCase[c.PatientCase_ID] || [];
    const disciplines = [...new Set(tracks.map((t) => t.Discipline))].sort();

    const totalVisits = tracks.reduce((sum, t) => sum + (sessionsPerTrack[t.TxTrack_ID] || 0), 0);
    const totalMinutes = tracks.reduce((sum, t) => sum + (minutesPerTrack[t.TxTrack_ID] || 0), 0);

    // Outcomes: aggregate across all tracks in the case
    const allEval = [];
    const allDisch = [];
    for (const t of tracks) {
      const o = trackOutcomes[t.TxTrack_ID];
      if (o) {
        allEval.push(...o.evalScores);
        allDisch.push(...o.dischScores);
      }
    }
    const admitLevel = avg(allEval);
    const dischLevel = avg(allDisch);
    const gain = admitLevel !== null && dischLevel !== null ? dischLevel - admitLevel : null;
    const pctImprovement = gain !== null && admitLevel > 0 ? gain / admitLevel : null;
    const caseResult = gain === null ? "N/A" : gain > 0 ? "Improved" : gain < 0 ? "Declined" : "No Change";

    // ALOS
    const caseStart = c.CaseStartDate ? new Date(c.CaseStartDate) : null;
    const caseEnd = c.CaseEndDate ? new Date(c.CaseEndDate) : null;
    const alos = caseStart && caseEnd ? Math.round((caseEnd - caseStart) / 86400000) : null;

    // Analysis eligibility
    const analysisEligible = alos !== null && alos >= 7 && totalVisits >= 5;

    return {
      PatientCase_ID: c.PatientCase_ID,
      Resident_ID: c.Resident_ID,
      Facility_ID: c.Facility_ID,
      FacilityName: c.FacilityName,
      SiteType: c.SiteType,
      PrimaryHealthcareSetting: c.PrimaryHealthcareSetting,
      TypeOfCare: c.TypeOfCare,
      IntakeSourceName: c.IntakeSourceName,
      IntakeSourceType: c.IntakeSourceType,
      IsInstitutional: c.IsInstitutional,
      IsSNF: c.IsSNF,
      PatientName: `${c.LastName}, ${c.FirstName}`,
      Gender: c.Gender,
      DOB: c.DOB,
      AdmitDate: c.AdmitDate,
      DischargeDate: c.DischargeDate,
      CaseStartDate: c.CaseStartDate,
      CaseEndDate: c.CaseEndDate,
      ALOS: alos,
      Disciplines: disciplines.join(", "),
      DisciplineCount: disciplines.length,
      TotalVisits: totalVisits,
      TotalMinutes: totalMinutes,
      AdmitLevel: admitLevel,
      DischargeLevel: dischLevel,
      Gain: gain,
      PctImprovement: pctImprovement,
      CaseResult: caseResult,
      AnalysisEligible: analysisEligible,
    };
  });

  // =========================================================================
  // Report
  // =========================================================================
  const eligible = caseView.filter((c) => c.AnalysisEligible);
  const withOutcomes = eligible.filter((c) => c.CaseResult !== "N/A");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`CASE-LEVEL SUMMARY — Q1 2026`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total cases: ${caseView.length}`);
  console.log(`Analysis eligible (ALOS≥7, visits≥5): ${eligible.length}`);
  console.log(`With scorable outcomes: ${withOutcomes.length}`);

  if (withOutcomes.length > 0) {
    const improved = withOutcomes.filter((c) => c.CaseResult === "Improved").length;
    const declined = withOutcomes.filter((c) => c.CaseResult === "Declined").length;
    console.log(`\nOutcomes:`);
    console.log(`  Improved: ${improved} (${(100 * improved / withOutcomes.length).toFixed(1)}%)`);
    console.log(`  Declined: ${declined} (${(100 * declined / withOutcomes.length).toFixed(1)}%)`);
    console.log(`  Avg Admit: ${(avg(withOutcomes.map((c) => c.AdmitLevel)) * 100).toFixed(1)}%`);
    console.log(`  Avg Discharge: ${(avg(withOutcomes.map((c) => c.DischargeLevel)) * 100).toFixed(1)}%`);
    console.log(`  Avg Gain: ${(avg(withOutcomes.map((c) => c.Gain)) * 100).toFixed(1)}pp`);
  }

  console.log(`\nALOS & Utilization (eligible cases):`);
  console.log(`  Avg ALOS: ${avg(eligible.map((c) => c.ALOS))?.toFixed(1)} days`);
  console.log(`  Avg Visits: ${avg(eligible.map((c) => c.TotalVisits))?.toFixed(1)}`);
  console.log(`  Avg Minutes: ${avg(eligible.map((c) => c.TotalMinutes))?.toFixed(0)}`);

  // Site type breakdown
  const siteTypes = {};
  for (const c of caseView) {
    const st = c.SiteType || "Unknown";
    if (!siteTypes[st]) siteTypes[st] = 0;
    siteTypes[st]++;
  }
  console.log(`\nBy Site Type:`);
  Object.entries(siteTypes).sort((a, b) => b[1] - a[1]).forEach(([st, cnt]) => {
    console.log(`  ${st}: ${cnt.toLocaleString()}`);
  });

  // Intake source breakdown
  const intakeSources = {};
  for (const c of caseView) {
    const src = c.IntakeSourceName || "Unknown";
    if (!intakeSources[src]) intakeSources[src] = 0;
    intakeSources[src]++;
  }
  console.log(`\nBy Intake Source:`);
  Object.entries(intakeSources).sort((a, b) => b[1] - a[1]).forEach(([src, cnt]) => {
    console.log(`  ${src}: ${cnt.toLocaleString()}`);
  });

  // Discipline breakdown
  const discCounts = {};
  for (const c of caseView) {
    const d = c.Disciplines || "None";
    discCounts[d] = (discCounts[d] || 0) + 1;
  }
  console.log(`\nBy Discipline Combination (top 10):`);
  Object.entries(discCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([d, cnt]) => {
    console.log(`  ${d}: ${cnt.toLocaleString()}`);
  });

  // Therapist contribution sample
  console.log(`\nTherapist Contribution Sample (first 5 cases):`);
  for (const c of caseView.slice(0, 5)) {
    const caseMins = totalMinutesPerCase[c.PatientCase_ID] || 0;
    if (caseMins === 0) continue;
    console.log(`  Case ${c.PatientCase_ID} (${caseMins} total mins):`);
    // Find all therapists for this case
    const therapists = [];
    for (const [key, mins] of Object.entries(minutesPerTherapistCase)) {
      const [cid, pid] = key.split("|");
      if (parseInt(cid) === c.PatientCase_ID) {
        therapists.push({ Person_ID: pid, minutes: mins, pct: mins / caseMins });
      }
    }
    therapists.sort((a, b) => b.minutes - a.minutes);
    therapists.slice(0, 5).forEach((t) => {
      console.log(`    Person ${t.Person_ID}: ${t.minutes} mins (${(t.pct * 100).toFixed(1)}%)`);
    });
  }

  await closeAll();
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
