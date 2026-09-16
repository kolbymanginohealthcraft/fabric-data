-- =============================================================================
-- Track-Outcomes (Bronze) - per (Track x crosswalked Item) measurement, UNGATED.
--
-- Unlike outcomes-bronze.sql (which keeps only Status='Included'), this emits EVERY
-- crosswalked item that has an EVAL or DISCH measurement, with RAW components so the
-- /evaluation/ consumer can derive valid / disregarded / EvalNEW / gain itself:
--   - valid       = numeric start AND numeric end (GG ANA-at-eval allowed -> start 0)
--   - disregarded = start score = 100%  (EvalNEW = 1.0)
--   - included    = valid AND NOT disregarded   (the gain/improved basis)
-- Keeping it ungated + raw is required for % Measurements Valid (needs the invalids).
-- Library (OP/SNF) is assigned downstream from the track's authoritative TxDocument.Library_ID and
-- Library.Name (carried in track-base.csv) via build_tracks.library_group_of -- NOT element VersionNames.
--
-- Placeholders injected by pull-track-outcomes.js: CROSSWALK_CTE_BODY,
-- SCALES_CTE_BODY, YEARS (each wrapped in double underscores in the body below).
-- =============================================================================
WITH
Crosswalk (LibraryItem_ID, Family, Grp, OutcomeName) AS (
    __CROSSWALK_CTE_BODY__
),
CustomScales (LibraryScaleValue_ID, Points, IsNA) AS (
    __SCALES_CTE_BODY__
),
AssessmentScores AS (
    -- TUG remap: outpatient TUG (item 11080, numeric scale 1479) only codes a LibraryScaleValue_ID
    -- when the seconds hit an anchor (10/20/30/31); otherwise null -> would be dropped. Translate the
    -- raw seconds (item.Value) onto the SNF TUG scale 916 ids so the CustomScales join scores it like
    -- the SNF TUG (5-59s -> 9278..9332; 60-120s -> nearest 1/4-min 9333..9337; >120s -> 9338;
    -- blank/<=0 -> null/excluded). Keeps this consumer in parity with the ClinicalOutcomes model.
    SELECT
        trk.TxTrack_ID,
        trk.Discipline,
        doc.DocumentType,
        item.LibraryItem_ID,
        e.EffLSV AS LibraryScaleValue_ID,
        cw.Family,
        CASE WHEN cs.IsNA = 1 THEN NULL ELSE cs.Points END AS Points
    FROM dbo.TxDocumentItem item
    JOIN dbo.TxDocument doc ON doc.TxDocument_ID = item.TxDocument_ID
    JOIN dbo.TxTrack trk    ON trk.TxTrack_ID = doc.TxTrack_ID
    JOIN Crosswalk cw       ON cw.LibraryItem_ID = item.LibraryItem_ID
    CROSS APPLY (SELECT CAST(ROUND(TRY_CAST(item.Value AS float), 0) AS int) AS sec) s
    CROSS APPLY (SELECT CASE WHEN item.LibraryItem_ID = 11080 THEN
                            CASE WHEN s.sec IS NULL OR s.sec <= 0 THEN NULL
                                 WHEN s.sec <= 5   THEN 9278
                                 WHEN s.sec <= 59  THEN 9273 + s.sec
                                 WHEN s.sec <= 67  THEN 9333
                                 WHEN s.sec <= 82  THEN 9334
                                 WHEN s.sec <= 97  THEN 9335
                                 WHEN s.sec <= 112 THEN 9336
                                 WHEN s.sec <= 120 THEN 9337
                                 ELSE 9338 END
                         ELSE item.LibraryScaleValue_ID END AS EffLSV) e
    LEFT JOIN CustomScales cs ON cs.LibraryScaleValue_ID = e.EffLSV
    WHERE doc.DocumentType IN ('EVAL', 'DISCH')
      AND e.EffLSV IS NOT NULL
      AND doc.IsInactive = 0
      AND trk.IsDeletedTrack = 0
      -- window rolls on the 10th (10-day reconciliation lag); days 1-9 still exclude the just-closed month
      AND trk.EndDate >= DATEADD(YEAR, __YEARS__, DATEADD(MONTH, CASE WHEN DAY(GETDATE()) >= 10 THEN 0 ELSE -1 END, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)))
      AND trk.EndDate <  DATEADD(MONTH, CASE WHEN DAY(GETDATE()) >= 10 THEN 0 ELSE -1 END, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
)
SELECT
    TxTrack_ID,
    LibraryItem_ID,
    Family,
    Discipline,
    AVG(CASE WHEN DocumentType = 'EVAL'  THEN Points END) AS TableEval,
    AVG(CASE WHEN DocumentType = 'DISCH' THEN Points END) AS TableDisch,
    STRING_AGG(
        CASE WHEN DocumentType = 'EVAL'
             THEN CAST(LibraryScaleValue_ID AS VARCHAR(16)) END, ','
    ) AS StartScoreValues,
    MAX(CASE WHEN DocumentType = 'EVAL'  THEN 1 ELSE 0 END) AS HasEval,
    MAX(CASE WHEN DocumentType = 'DISCH' THEN 1 ELSE 0 END) AS HasDisch
FROM AssessmentScores
GROUP BY TxTrack_ID, LibraryItem_ID, Family, Discipline
