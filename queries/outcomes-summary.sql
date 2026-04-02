-- =============================================================================
-- Outcomes Summary Query
-- Replicates the DAX OutcomeSummary calculated table logic in SQL
--
-- Flow:
--   TxDocumentItem (assessments)
--   → JOIN TxDocument (to get DocumentType + TxTrack_ID)
--   → JOIN TxTrack (to get PatientCase_ID)
--   → JOIN Crosswalk (to filter to known outcome items)
--   → JOIN Custom Scales (to get point values)
--   → AGGREGATE by PatientCase_ID, TxTrack_ID, LibraryItem_ID, DocumentType
--   → PIVOT into Admit/Discharge scores
--   → Apply GG exclusion rules and inclusion status
-- =============================================================================

-- Step 1: Base assessment scores with crosswalk + scale points
WITH AssessmentScores AS (
    SELECT
        trk.PatientCase_ID,
        trk.TxTrack_ID,
        doc.DocumentType,
        item.LibraryItem_ID,
        item.LibraryScaleValue_ID,
        cw.Family,
        cw.[Group],
        cw.Name AS OutcomeName,
        -- N/A responses become NULL (excluded from averages)
        CASE WHEN cs.ResponseType = 'N/A' THEN NULL ELSE cs.Points END AS Points
    FROM BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocumentItem item
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocument doc
        ON item.TxDocument_ID = doc.TxDocument_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.TxTrack trk
        ON doc.TxTrack_ID = trk.TxTrack_ID
    JOIN Crosswalk cw
        ON item.LibraryItem_ID = cw.LibraryItem_ID
    JOIN CustomScales cs
        ON item.LibraryScaleValue_ID = cs.LibraryScaleValue
    WHERE doc.DocumentType IN ('EVAL', 'DISCH')
      AND item.LibraryScaleValue_ID IS NOT NULL
),

-- Step 2: Average scores per outcome item, per document type
ItemScores AS (
    SELECT
        PatientCase_ID,
        TxTrack_ID,
        LibraryItem_ID,
        Family,
        [Group],
        OutcomeName,
        AVG(CASE WHEN DocumentType = 'EVAL' THEN Points END) AS TableEval,
        AVG(CASE WHEN DocumentType = 'DISCH' THEN Points END) AS TableDisch,
        -- Track which GG scale values were used at admission (for N/A exclusion)
        STRING_AGG(
            CASE WHEN DocumentType = 'EVAL' THEN CAST(LibraryScaleValue_ID AS VARCHAR) END,
            ','
        ) AS StartScoreValues
    FROM AssessmentScores
    GROUP BY PatientCase_ID, TxTrack_ID, LibraryItem_ID, Family, [Group], OutcomeName
),

-- Step 3: Apply GG N/A exclusion rules (EvalNEW) and inclusion status
OutcomeSummary AS (
    SELECT
        PatientCase_ID,
        TxTrack_ID,
        LibraryItem_ID,
        Family,
        [Group],
        OutcomeName,
        TableEval,
        TableDisch,
        -- EvalNEW: For GG items, zero out scores where admission was N/A
        CASE
            WHEN Family IN ('(a) Section GG Mobility', '(b) Section GG Self Care')
                 AND (
                     StartScoreValues LIKE '%15102%'  -- 07. Resident refused
                     OR StartScoreValues LIKE '%15103%'  -- 09. Not applicable
                     OR StartScoreValues LIKE '%15104%'  -- 10. Environmental limitations
                     OR StartScoreValues LIKE '%15105%'  -- 88. Medical condition/safety
                 )
            THEN 0
            ELSE TableEval
        END AS EvalNEW,
        -- Status: Included only when both admit & discharge exist and admit ≠ 100%
        CASE
            WHEN TableEval IS NOT NULL
                 AND TableDisch IS NOT NULL
                 AND CASE
                        WHEN Family IN ('(a) Section GG Mobility', '(b) Section GG Self Care')
                             AND (
                                 StartScoreValues LIKE '%15102%'
                                 OR StartScoreValues LIKE '%15103%'
                                 OR StartScoreValues LIKE '%15104%'
                                 OR StartScoreValues LIKE '%15105%'
                             )
                        THEN 0
                        ELSE TableEval
                     END <> 1.0  -- Exclude already-independent patients
            THEN 'Included'
            ELSE 'Excluded'
        END AS Status
    FROM ItemScores
)

-- Final output: one row per case × track × outcome item
SELECT
    PatientCase_ID,
    TxTrack_ID,
    LibraryItem_ID,
    Family,
    [Group],
    OutcomeName,
    EvalNEW,
    TableDisch,
    Status
FROM OutcomeSummary
ORDER BY PatientCase_ID, TxTrack_ID, LibraryItem_ID
