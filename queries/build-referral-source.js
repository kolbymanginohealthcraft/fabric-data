// Build the Referral Source feed for the ClinicalOutcomes model.
//
// THE UNLOCK: referral source ("where was the patient referred from") does NOT exist in
// NetHealth — it is only in the customer's EMR export. This script matches that export to our
// stays and emits a Stay_ID-keyed feed the model joins to PatientStays, so every existing
// outcomes measure can be sliced by referral source.
//
// Match key = MedicalRecordNumber + facility + admit date (validated ~99% same-day). MRN alone is
// NOT safe: bare-numeric MRNs are facility-local and collide across buildings, so we MUST pin the
// facility via the per-customer facility-code crosswalk below.
//
// Input: the customer's PCC "Admission/Discharge To/From" CSV.
//   Cols used: "Facility Code", "Resident Number" (=MRN), "Effective Date", "To/From location",
//              "To/From type".
// Output: data/referral-source-stays.csv  (Stay_ID, ReferralSource, ReferralType,
//              ReferralFacilityNumber, AdmitDate, ResidentNumber, Customer)
//
// Usage: node queries/build-referral-source.js [--src "C:\\path\\to\\export.csv"] [--window 14]
const fs = require("fs");
const path = require("path");
const os = require("os");
const { query } = require("../fabric-query");

// --- Per-customer facility-code crosswalk -------------------------------------------------
// CSV "Facility Code" -> our facility. Codes are the CUSTOMER's internal facility numbering
// (meaningless to us on their own) but are a stable per-customer key. SNFs only — the customer's
// ALF / Adult-Day / Care-Home codes (Ohana 2,8,11,12) have no NetHealth therapy data, so they are
// intentionally absent and their rows are reported as "excluded (non-SNF)".
const CUSTOMERS = {
  Ohana: {
    inputMatch: /Enterprise_Admission_Discharge_To_From/i,
    facilities: {
      1:  { nethealthId: 1212, facilityNumber: "92520", name: "Ann Pearl" },
      3:  { nethealthId: 1211, facilityNumber: "95684", name: "Legacy of Hilo" },
      4:  { nethealthId: 1194, facilityNumber: "95993", name: "The Ching Villas" },
      5:  { nethealthId: 1199, facilityNumber: "92519", name: "Garden Isle" },
      6:  { nethealthId: 1217, facilityNumber: "92521", name: "Hale Kupuna Heritage Home" },
      7:  { nethealthId: 1214, facilityNumber: "92518", name: "Pu'uwai 'O Makaha" },
      9:  { nethealthId: 1209, facilityNumber: "93215", name: "Hale Makua - Kahului" },
      10: { nethealthId: 1180, facilityNumber: "93214", name: "Hale Makua - Wailuku" },
    },
  },
};

// --- tiny RFC4180-ish CSV parser (handles quoted fields w/ embedded commas) ---------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function toIso(d) {
  // "Apr 2, 2026" -> "2026-04-02"
  const m = /^([A-Za-z]{3})\w*\s+(\d{1,2}),\s*(\d{4})$/.exec((d || "").trim());
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
}

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

(async () => {
  const customerName = arg("--customer", "Ohana");
  const cust = CUSTOMERS[customerName];
  if (!cust) { console.error(`FATAL: unknown customer '${customerName}'`); process.exit(1); }
  const window = parseInt(arg("--window", "14"), 10);

  // locate the export (explicit --src, else newest matching file in Downloads)
  let src = arg("--src", null);
  if (!src) {
    const dl = path.join(os.homedir(), "Downloads");
    let best = null;
    for (const n of fs.readdirSync(dl)) {
      if (!cust.inputMatch.test(n) || !/\.csv$/i.test(n)) continue;
      const st = fs.statSync(path.join(dl, n));
      if (st.isFile() && (!best || st.mtimeMs > best.mtimeMs)) best = { full: path.join(dl, n), mtimeMs: st.mtimeMs };
    }
    if (!best) { console.error(`FATAL: no ${cust.inputMatch} CSV in ${dl} — pass --src`); process.exit(1); }
    src = best.full;
  }
  console.log(`Customer : ${customerName}`);
  console.log(`Input    : ${src}`);

  const rows = parseCsv(fs.readFileSync(src, "utf8"));
  const header = rows.shift().map(h => h.trim());
  const col = (name) => header.indexOf(name);
  const cCode = col("Facility Code"), cMrn = col("Resident Number"), cEff = col("Effective Date"),
        cLoc = col("To/From location"), cType = col("To/From type");
  if ([cCode, cMrn, cEff, cLoc].some(i => i < 0)) {
    console.error("FATAL: input is missing expected columns (Facility Code / Resident Number / Effective Date / To/From location)");
    process.exit(1);
  }

  // build candidate match rows; skip non-SNF facility codes
  const cand = [];
  let excludedNonSnf = 0, badDate = 0;
  for (const r of rows) {
    const code = parseInt((r[cCode] || "").trim(), 10);
    const fac = cust.facilities[code];
    if (!fac) { excludedNonSnf++; continue; }
    const mrn = (r[cMrn] || "").trim();
    const eff = toIso(r[cEff]);
    if (!mrn || !eff) { badDate++; continue; }
    cand.push({
      mrn, fid: fac.nethealthId, facilityNumber: fac.facilityNumber, eff,
      refloc: ((r[cLoc] || "").trim()) || "(Unknown)",
      reftype: (r[cType] || "").trim() || "(Unknown)",
    });
  }
  console.log(`Rows: ${rows.length} | matchable ${cand.length} | excluded non-SNF ${excludedNonSnf} | bad/blank date ${badDate}`);

  // match against Bronze in one query (nearest stay within window, MRN+facility pinned)
  const values = cand.map((c, i) =>
    `(${i},'${c.mrn.replace(/'/g, "''")}',${c.fid},'${c.eff}','${c.refloc.replace(/'/g, "''")}','${c.reftype.replace(/'/g, "''")}','${c.facilityNumber}')`
  ).join(",");
  const sql = `
    WITH csv(idx, mrn, fid, eff, refloc, reftype, facnum) AS (
      SELECT idx, mrn, fid, CAST(eff AS date), refloc, reftype, facnum
      FROM (VALUES ${values}) v(idx, mrn, fid, eff, refloc, reftype, facnum)),
    cand AS (
      SELECT csv.idx, csv.refloc, csv.reftype, csv.facnum, csv.mrn,
             s.Stay_ID, s.AdmitDate,
             ROW_NUMBER() OVER (PARTITION BY csv.idx ORDER BY ABS(DATEDIFF(day, s.AdmitDate, csv.eff)), s.Stay_ID) AS rn
      FROM csv
      JOIN dbo.Stay s     ON s.MedicalRecordNumber = csv.mrn
      JOIN dbo.Resident r ON r.Resident_ID = s.Resident_ID AND r.Facility_ID = csv.fid
      WHERE ABS(DATEDIFF(day, s.AdmitDate, csv.eff)) <= ${window})
    SELECT Stay_ID, refloc AS ReferralSource, reftype AS ReferralType, facnum AS ReferralFacilityNumber,
           CONVERT(varchar(10), AdmitDate, 23) AS AdmitDate, mrn AS ResidentNumber
    FROM cand WHERE rn = 1
    ORDER BY Stay_ID`;
  const matched = (await query(sql, "bronze")).recordset;

  // de-dupe by Stay_ID (a stay maps to one referral; keep first)
  const seen = new Set(), out = [];
  for (const m of matched) { if (seen.has(m.Stay_ID)) continue; seen.add(m.Stay_ID); out.push(m); }

  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const outPath = path.join(dataDir, "referral-source-stays.csv");
  const cols = ["Stay_ID", "ReferralSource", "ReferralType", "ReferralFacilityNumber", "AdmitDate", "ResidentNumber", "Customer"];
  const lines = [cols.join(",")];
  for (const m of out) lines.push([m.Stay_ID, m.ReferralSource, m.ReferralType, m.ReferralFacilityNumber, m.AdmitDate, m.ResidentNumber, customerName].map(csvCell).join(","));
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

  console.log(`Matched stays: ${out.length} / ${cand.length} matchable (${(100 * out.length / cand.length).toFixed(1)}%)`);
  console.log(`Wrote ${outPath}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
