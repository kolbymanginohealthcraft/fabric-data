// Pulls the employee dimension from Silver: NetHealthId -> identity + role.
// Keyed by NetHealthId, which equals treatmentminute.PersonId, so the consumer joins
// the therapist ratings (Person_ID) to attach name/discipline/job and to filter the
// eval population to actual treating clinicians (PersonId in treatment minutes sweeps in
// admins/execs who occasionally logged minutes).
//
// Replaces the old EmployeeBasicInfo (security db). dbo.employee is a superset.
// NOTE: Status is 'Active'/'Terminated' (old code used 'A'); Discipline is
// PT/OT/ST/PTA/COTA (assistants included); JobTitle/JobCode for role filtering + the
// future `job` cohort dimension.
//
// Usage: node queries/pull-employee-dim.js [--out path]

const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

function parseArgs() {
  const args = process.argv.slice(2);
  let outPath = path.join(__dirname, "..", "employee-dim.csv");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) outPath = args[++i];
  }
  return { outPath };
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\n") + "\n";
}

const SQL = `
SELECT
    NetHealthId AS Person_ID,
    FullName,
    Discipline,
    JobCode,
    JobTitle,
    Status
FROM dbo.employee
WHERE NetHealthId IS NOT NULL
`;

(async () => {
  const { outPath } = parseArgs();
  console.error(`Running employee dim pull (Silver) → ${outPath}`);
  const result = await query(SQL, "silver");
  const rows = result.recordset;
  console.error(`Query returned ${rows.length} employees`);
  fs.writeFileSync(outPath, toCsv(rows));
  console.error(`Wrote CSV → ${outPath}`);
  await closeAll();
})().catch((err) => {
  console.error("Pull failed:", err.message);
  process.exit(1);
});
