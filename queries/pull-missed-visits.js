// Per-clinician missed-visit counts, by health-care setting (Bronze, fresh NetHealth lakehouse).
// Feeds the "% Missed Visits" scorecard metric. NO FR (frequency-ordered) split is possible —
// NetHealth carries no per-visit FR/PRN tag, and home-health tracks carry no ordered frequency
// at all (TxFrequency* is 0% populated for HHA). So this is the plain missed rate only.
//
// Output: one row per (Person_ID x Setting) — the shape build_missed_visits_feed.py expects:
//     Person_ID, Setting, DeliveredVisits, MissedVisits
//
//   MissedVisits   = TxSession rows with a MissedReason, attributed to MissedPerson_ID
//                    (100% populated on missed sessions; delivered sessions have it null).
//   DeliveredVisits= COUNT(DISTINCT TxSession) a clinician logged real minutes in (TxMinute),
//                    excluding missed/deleted sessions and deleted services.
//   % Missed       = MissedVisits / (MissedVisits + DeliveredVisits)   [computed downstream]
//
// Single source on purpose: Silver treatmentsession has NO missed fields, so numerator and
// denominator both come from Bronze to keep the ratio coherent. Setting is resolved via the
// canonical link Resident.Facility_ID -> Facility.PrimaryHealthcareSetting (same as
// pull-track-base.js; PatientCase.FacilityServiceLocation_ID does NOT join to Facility).
//
// Windowing: a session counts if its SessionDate falls in the last N years (default 1),
// matching the trailing-12-months convention of the other pulls.
//
// Usage: node queries/pull-missed-visits.js [--years N] [--out path]

const fs = require("fs");
const path = require("path");
const { query, closeAll } = require("../fabric-query");

function parseArgs() {
  const a = process.argv.slice(2);
  let years = 1, out = path.join(__dirname, "..", "data", "missed-visits.csv");
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--years" && a[i + 1]) years = parseInt(a[++i], 10);
    else if (a[i] === "--out" && a[i + 1]) out = a[++i];
  }
  return { years, out };
}
function csvEscape(v) { if (v == null) return ""; const s = String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows) { if (!rows.length) return ""; const h = Object.keys(rows[0]); return [h.join(",")].concat(rows.map((r) => h.map((k) => csvEscape(r[k])).join(","))).join("\n") + "\n"; }

const SQL = `
WITH sess AS (
  SELECT ts.TxSession_ID,
         ts.MissedPerson_ID,
         CASE WHEN ts.MissedReason IS NOT NULL AND ts.MissedReason <> '' THEN 1 ELSE 0 END AS is_missed,
         f.PrimaryHealthcareSetting AS Setting
  FROM dbo.TxSession ts
  JOIN dbo.TxTrack     t   ON t.TxTrack_ID = ts.TxTrack_ID
  JOIN dbo.PatientCase pc  ON pc.PatientCase_ID = t.PatientCase_ID
  JOIN dbo.Stay        s   ON s.Stay_ID = pc.Stay_ID
  JOIN dbo.Resident    res ON res.Resident_ID = s.Resident_ID
  JOIN dbo.Facility    f   ON f.Facility_ID = res.Facility_ID
  WHERE ts.IsDeletedSession = 0
    AND ts.SessionDate >= DATEADD(YEAR, @YEARS, GETDATE())
),
missed AS (  -- numerator: missed visit owned by the scheduled clinician
  SELECT MissedPerson_ID AS Person_ID, Setting, COUNT(*) AS MissedVisits
  FROM sess
  WHERE is_missed = 1 AND MissedPerson_ID IS NOT NULL
  GROUP BY MissedPerson_ID, Setting
),
delivered AS (  -- denominator part: visits the clinician actually treated (logged minutes in)
  SELECT m.Person_ID, sess.Setting, COUNT(DISTINCT sess.TxSession_ID) AS DeliveredVisits
  FROM sess
  JOIN dbo.TxMinute m ON m.TxSession_ID = sess.TxSession_ID
                     AND m.IsDeletedService = 0 AND m.Duration > 0 AND m.Person_ID IS NOT NULL
  WHERE sess.is_missed = 0
  GROUP BY m.Person_ID, sess.Setting
)
SELECT
  COALESCE(d.Person_ID, mi.Person_ID)  AS Person_ID,
  COALESCE(d.Setting,   mi.Setting)    AS Setting,
  COALESCE(d.DeliveredVisits, 0)       AS DeliveredVisits,
  COALESCE(mi.MissedVisits,   0)       AS MissedVisits
FROM delivered d
FULL OUTER JOIN missed mi ON mi.Person_ID = d.Person_ID AND mi.Setting = d.Setting
ORDER BY Person_ID, Setting`;

(async () => {
  const { years, out } = parseArgs();
  const sql = SQL.replace("@YEARS", `-${years}`);
  console.error(`missed-visits pull: sessions in last ${years}yr (by SessionDate) -> ${out}`);
  const t0 = Date.now();
  const r = await query(sql, "bronze");
  console.error(`rows (Person x Setting): ${r.recordset.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
  fs.writeFileSync(out, toCsv(r.recordset));
  console.error(`wrote ${out}`);
  await closeAll();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
