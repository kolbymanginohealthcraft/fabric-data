// Pulls therapist→track attribution contributions from the FRESH Silver lakehouse
// (treatmentsession + treatmentminute). Replaces the aegisdataprod source, where
// TxSession/Treatments went stale (3/30 and 2/26 respectively).
//
// Output: one row per (therapist × track) — exactly the shape evaluation/attribution.py
// expects as its `contributions` input:
//     TxTrack_ID, Person_ID, Total_Visits, Total_Minutes
//
//   Total_Visits  = COUNT(DISTINCT SessionId) the therapist delivered minutes in
//   Total_Minutes = SUM(Duration) of that therapist's minutes on the track
//
// Windowing: a track is included if its LAST session falls within the last N years
// (default 1). All of that track's minutes are then summed — even sessions older than
// the window — so each therapist's contribution share reflects the FULL track, not a
// calendar slice. Pure Silver; no cross-host join.
//
// Usage: node queries/pull-attribution.js [--years N] [--out path]

const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

function parseArgs() {
  const args = process.argv.slice(2);
  let years = 1;
  let outPath = path.join(__dirname, "..", "therapist-attribution.csv");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--years" && args[i + 1]) years = parseInt(args[++i], 10);
    else if (args[i] === "--out" && args[i + 1]) outPath = args[++i];
  }
  return { years, outPath };
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

// EVAL services (Bronze): Service[Type]='Eval' iff Description contains 'eval' (mirrors the
// PBI model's M derivation). Treatment minutes = Duration on NON-eval services. ServiceId in
// silver.treatmentminute is the same ID space as bronze.Service.Service_ID.
const EVAL_IDS_SQL = `SELECT Service_ID FROM dbo.Service WHERE LOWER(Description) LIKE '%eval%'`;

const SQL = (evalIds) => `
WITH track_window AS (
    -- Tracks whose most recent session is within the window.
    SELECT TrackId
    FROM dbo.treatmentsession
    GROUP BY TrackId
    HAVING MAX(SessionDate) >= DATEADD(YEAR, @YEARS, GETDATE())
)
SELECT
    s.TrackId                    AS TxTrack_ID,
    m.PersonId                   AS Person_ID,
    COUNT(DISTINCT m.SessionId)  AS Total_Visits,
    SUM(m.Duration)              AS Total_Minutes,
    SUM(CASE WHEN m.ServiceId NOT IN (${evalIds}) THEN m.Duration ELSE 0 END)
                                 AS Total_Treatment_Minutes
FROM dbo.treatmentminute m
JOIN dbo.treatmentsession s ON s.NetHealthId = m.SessionId
JOIN track_window tw        ON tw.TrackId = s.TrackId
WHERE m.PersonId IS NOT NULL
GROUP BY s.TrackId, m.PersonId
ORDER BY s.TrackId, m.PersonId
`;

(async () => {
  const { years, outPath } = parseArgs();
  // 1) eval Service_IDs from Bronze (separate pool / host)
  const ev = await query(EVAL_IDS_SQL, "bronze");
  const evalIds = ev.recordset.map((r) => r.Service_ID).join(",") || "-1";
  console.error(`eval services excluded from treatment minutes: ${ev.recordset.length}`);
  // 2) attribution from Silver, treatment minutes = non-eval Duration
  const sql = SQL(evalIds).replace("@YEARS", `-${years}`);
  console.error(`Running attribution pull: tracks active in last ${years} year(s) → ${outPath}`);
  const t0 = Date.now();
  const result = await query(sql, "silver");
  const rows = result.recordset;
  console.error(`Query returned ${rows.length} (therapist × track) rows in ${Math.round((Date.now() - t0) / 1000)}s`);
  fs.writeFileSync(outPath, toCsv(rows));
  console.error(`Wrote CSV → ${outPath}`);
  await closeAll();
})().catch((err) => {
  console.error("Pull failed:", err.message);
  process.exit(1);
});
