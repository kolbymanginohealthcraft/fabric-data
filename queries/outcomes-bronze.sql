-- =============================================================================
-- Outcomes Core (Bronze) — outcome-level extraction, medallion-repointed
--
-- Bronze repoint of outcomes-summary.sql. Same scoring logic (EVAL/DISCH pivot,
-- EvalNEW GG-N/A recode, Included gate, Gain), but:
--   • Sources from NetHealth_Bronze_Lakehouse.dbo.* (fresh raw mirror) instead of
--     aegisdataprod. Run with: node queries/pull-outcomes-bronze.js  (--db bronze)
--   • Drops the LibraryItem join (VersionName/Library now comes from library-dim.csv,
--     pulled from aegisdataprod by pull-library-dim.js — cross-host, joined downstream).
--   • Drops the facility joins (DivisionCode/ServiceLine/FacilityName now come from
--     facility-dim.csv on Silver — cross-host, joined downstream). Emits res.Facility_ID
--     as the join key.
--   • Adds raw-layer guards: Bronze is uncurated, so exclude soft-deleted/inactive
--     records the old aegisdataprod views pre-filtered.
--
-- Output is one row per (Case × Track × LibraryItem) Included outcome with Gain,
-- residence, discipline, + LibraryItem_ID and Facility_ID join keys. The consumer
-- (/evaluation/) joins library-dim (→ Library OP/SNF) and facility-dim (→ ServiceLine).
--
-- Placeholders (injected by pull-outcomes-bronze.js): CROSSWALK_CTE_BODY,
-- SCALES_CTE_BODY, YEARS (each wrapped in double underscores in the body below).
-- =============================================================================

WITH
Crosswalk (LibraryItem_ID, Family, Grp, OutcomeName) AS (
    __CROSSWALK_CTE_BODY__
),
CustomScales (LibraryScaleValue_ID, Points, IsNA) AS (
    __SCALES_CTE_BODY__
),

-- Step 1: raw assessment scores, filtered to crosswalked items on EVAL/DISCH docs.
AssessmentScores AS (
    SELECT
        trk.TxTrack_ID,
        trk.PatientCase_ID,
        trk.Discipline,
        doc.DocumentType,
        item.LibraryItem_ID,
        item.LibraryScaleValue_ID,
        cw.Family,
        cw.Grp,
        cw.OutcomeName,
        CASE WHEN cs.IsNA = 1 THEN NULL ELSE cs.Points END AS Points
    FROM dbo.TxDocumentItem item
    JOIN dbo.TxDocument doc
        ON doc.TxDocument_ID = item.TxDocument_ID
    JOIN dbo.TxTrack trk
        ON trk.TxTrack_ID = doc.TxTrack_ID
    JOIN Crosswalk cw
        ON cw.LibraryItem_ID = item.LibraryItem_ID
    LEFT JOIN CustomScales cs
        ON cs.LibraryScaleValue_ID = item.LibraryScaleValue_ID
    WHERE doc.DocumentType IN ('EVAL', 'DISCH')
      AND item.LibraryScaleValue_ID IS NOT NULL
      AND doc.IsInactive = 0           -- raw-layer guard
      AND trk.IsDeletedTrack = 0       -- raw-layer guard
      AND trk.EndDate >= DATEADD(YEAR, __YEARS__, GETDATE())
),

-- Step 2: aggregate to (Case × Track × Item) grain, pivot EVAL/DISCH into columns.
ItemScores AS (
    SELECT
        TxTrack_ID,
        PatientCase_ID,
        Discipline,
        LibraryItem_ID,
        Family,
        Grp,
        OutcomeName,
        AVG(CASE WHEN DocumentType = 'EVAL'  THEN Points END) AS TableEval,
        AVG(CASE WHEN DocumentType = 'DISCH' THEN Points END) AS TableDisch,
        STRING_AGG(
            CASE WHEN DocumentType = 'EVAL'
                 THEN CAST(LibraryScaleValue_ID AS VARCHAR(16))
            END,
            ','
        ) AS StartScoreValues,
        MAX(CASE WHEN DocumentType = 'EVAL'  THEN 1 ELSE 0 END) AS HasEval,
        MAX(CASE WHEN DocumentType = 'DISCH' THEN 1 ELSE 0 END) AS HasDisch
    FROM AssessmentScores
    GROUP BY
        TxTrack_ID, PatientCase_ID, Discipline,
        LibraryItem_ID, Family, Grp, OutcomeName
),

-- Step 3: EvalNEW recode (GG admit N/A → 0). Library classification deferred to the
-- consumer's join with library-dim (VersionName lives only on aegisdataprod LibraryItem).
Scored AS (
    SELECT
        TxTrack_ID, PatientCase_ID, Discipline,
        LibraryItem_ID, Family, Grp, OutcomeName,
        TableEval, TableDisch, HasEval, HasDisch, StartScoreValues,
        CASE
            WHEN Family IN ('(a) Section GG Mobility',
                            '(b) Section GG Self Care')
                 AND (
                     StartScoreValues IS NULL
                     OR StartScoreValues LIKE '%15102%'
                     OR StartScoreValues LIKE '%15103%'
                     OR StartScoreValues LIKE '%15104%'
                     OR StartScoreValues LIKE '%15105%'
                 )
            THEN 0
            ELSE TableEval
        END AS EvalNEW
    FROM ItemScores
),

-- Step 4: Status='Included' gate (both sides present, room to improve).
Included AS (
    SELECT *
    FROM Scored
    WHERE HasEval = 1
      AND HasDisch = 1
      AND EvalNEW IS NOT NULL
      AND TableDisch IS NOT NULL
      AND EvalNEW <> 1.0
)

-- Step 5: attach track/case/residence dims + the Facility_ID join key for facility-dim.
SELECT
    inc.TxTrack_ID,
    inc.PatientCase_ID,
    inc.LibraryItem_ID,
    inc.OutcomeName,
    inc.Family,
    inc.Grp,
    inc.Discipline,
    inc.EvalNEW,
    inc.TableDisch,
    (inc.TableDisch - inc.EvalNEW)  AS Gain,
    isrc.Abbrev                     AS Residence,
    isrc.PlaceOfResidenceUsage,
    res.Facility_ID,
    trk.StartDate                   AS TrackStartDate,
    trk.EndDate                     AS TrackEndDate
FROM Included inc
JOIN dbo.TxTrack trk        ON trk.TxTrack_ID = inc.TxTrack_ID
JOIN dbo.PatientCase pc     ON pc.PatientCase_ID = inc.PatientCase_ID
JOIN dbo.Stay stay          ON stay.Stay_ID = pc.Stay_ID
JOIN dbo.Resident res       ON res.Resident_ID = stay.Resident_ID
LEFT JOIN dbo.IntakeSource isrc ON isrc.IntakeSource_ID = stay.IntakeSource_ID
WHERE pc.IsDeletedCase = 0           -- raw-layer guard
  AND res.IsDeletedResident = 0      -- raw-layer guard
ORDER BY inc.PatientCase_ID, inc.TxTrack_ID, inc.LibraryItem_ID
