-- =============================================================================
-- Outcomes Summary — outcome-level cohort extraction
--
-- Replicates the ClinicalOutcomes PBIP's OutcomeSummary logic in SQL, plus the
-- cohort dimensions needed for outcome-level percentile computation in
-- /evaluation/ (see memory/project_therapist_evaluation.md for design).
--
-- Returns one row per (Case × Track × LibraryItem) Included outcome with:
--   Gain (= TableDisch − EvalNEW), library, service line, residence, discipline,
--   LibraryItem_ID — the full set of outcome-level cohort dims.
--
-- Job code is a THERAPIST attribute, not an outcome attribute; it's joined at
-- percentile-computation time in /evaluation/, not here.
--
-- Template placeholders (replaced by the JS wrapper pull-outcomes.js):
--   CROSSWALK_CTE_BODY placeholder -> VALUES(...) or chunked UNION ALL over
--                                      Outcomes Crosswalk.csv rows
--                                      cols: LibraryItem_ID, Family, Grp, OutcomeName
--   SCALES_CTE_BODY placeholder    -> VALUES(...) or chunked UNION ALL over
--                                      Outcomes Custom Scales.csv rows (>1000 rows
--                                      must be chunked — SQL Server VALUES cap)
--                                      cols: LibraryScaleValue_ID, Points, IsNA
--   YEARS placeholder              -> TxTrack.EndDate window, e.g. -1 for 1 year
--
-- Phase 2 migration: replace the VALUES CTEs with real Fabric lakehouse tables
-- and point the PBIP model at the same source for single-source-of-truth.
-- =============================================================================

WITH
Crosswalk (LibraryItem_ID, Family, Grp, OutcomeName) AS (
    __CROSSWALK_CTE_BODY__
),
CustomScales (LibraryScaleValue_ID, Points, IsNA) AS (
    __SCALES_CTE_BODY__
),

-- Step 1: raw assessment scores, filtered to crosswalked items on EVAL/DISCH docs.
-- N/A responses have their Points nulled (matches the PBIP's AdjPoints M-step),
-- which keeps them out of TableEval/TableDisch averages while still letting their
-- LibraryScaleValue_IDs surface in StartScoreValues for the GG N/A recode.
AssessmentScores AS (
    SELECT
        trk.TxTrack_ID,
        trk.PatientCase_ID,
        trk.Discipline,
        doc.DocumentType,
        item.LibraryItem_ID,
        item.LibraryScaleValue_ID,
        li.VersionName,
        cw.Family,
        cw.Grp,
        cw.OutcomeName,
        CASE WHEN cs.IsNA = 1 THEN NULL ELSE cs.Points END AS Points
    FROM BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocumentItem item
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocument doc
        ON doc.TxDocument_ID = item.TxDocument_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.TxTrack trk
        ON trk.TxTrack_ID = doc.TxTrack_ID
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.LibraryItem li
        ON li.LibraryItem_ID = item.LibraryItem_ID
    JOIN Crosswalk cw
        ON cw.LibraryItem_ID = item.LibraryItem_ID
    LEFT JOIN CustomScales cs
        ON cs.LibraryScaleValue_ID = item.LibraryScaleValue_ID
    WHERE doc.DocumentType IN ('EVAL', 'DISCH')
      AND item.LibraryScaleValue_ID IS NOT NULL
      AND trk.EndDate >= DATEADD(YEAR, __YEARS__, GETDATE())
),

-- Step 2: aggregate to (Case × Track × Item) grain, pivot EVAL/DISCH into columns.
ItemScores AS (
    SELECT
        TxTrack_ID,
        PatientCase_ID,
        Discipline,
        LibraryItem_ID,
        VersionName,
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
        LibraryItem_ID, VersionName, Family, Grp, OutcomeName
),

-- Step 3: EvalNEW recode + Library classification.
--
-- NOTE on DAX parity: the active EvalNEW DAX in OutcomeSummary.tmdl reads
--   `(GG && ISBLANK(StartScoreValues)) || contains(N/A codes)` per DAX
--   operator precedence (&& binds tighter than ||). That interpretation
--   recodes non-GG items whenever their admit contains N/A codes, which
--   looks unintentional. The commented-out earlier version reads
--   `GG && Criteria Start IN ("ANA","Missing")` — i.e. GG items whose admit
--   is either missing OR contains N/A codes. This SQL follows the
--   commented-out ORIGINAL INTENT. Verify with stakeholder before lock-in.
Scored AS (
    SELECT
        TxTrack_ID, PatientCase_ID, Discipline,
        LibraryItem_ID, VersionName, Family, Grp, OutcomeName,
        TableEval, TableDisch, HasEval, HasDisch, StartScoreValues,
        CASE
            WHEN Family IN ('(a) Section GG Mobility',
                            '(b) Section GG Self Care')
                 AND (
                     StartScoreValues IS NULL                 -- admit missing entirely
                     OR StartScoreValues LIKE '%15102%'       -- 07. Resident refused
                     OR StartScoreValues LIKE '%15103%'       -- 09. Not applicable
                     OR StartScoreValues LIKE '%15104%'       -- 10. Environmental limits
                     OR StartScoreValues LIKE '%15105%'       -- 88. Medical/safety
                 )
            THEN 0
            ELSE TableEval
        END AS EvalNEW,
        CASE
            WHEN VersionName LIKE '%OP%' OR VersionName LIKE '%GP%' THEN 'OP'
            ELSE 'SNF'
        END AS Library
    FROM ItemScores
),

-- Step 4: apply Status='Included' gate (both sides present, room to improve).
Included AS (
    SELECT *
    FROM Scored
    WHERE HasEval = 1
      AND HasDisch = 1
      AND EvalNEW IS NOT NULL
      AND TableDisch IS NOT NULL
      AND EvalNEW <> 1.0
)

-- Step 5: join cohort dimensions attached to the track/case (not the item).
SELECT
    inc.TxTrack_ID,
    inc.PatientCase_ID,
    inc.LibraryItem_ID,
    inc.OutcomeName,
    inc.Family,
    inc.Grp,
    inc.Library,
    inc.VersionName,
    inc.Discipline,
    inc.EvalNEW,
    inc.TableDisch,
    (inc.TableDisch - inc.EvalNEW)            AS Gain,
    isrc.Abbrev                               AS Residence,
    isrc.PlaceOfResidenceUsage,
    CASE
        WHEN isrc.PlaceOfResidenceUsage = 'HHA' THEN 'Home Health'
        WHEN fh.DivisionCode = '8450' THEN 'Contract Rehab'
        WHEN fh.DivisionCode = '5500' THEN 'Senior Living'
        WHEN fh.DivisionCode = '6500' THEN 'HAP'
        WHEN fh.DivisionCode = '5555' THEN 'Closed'
        ELSE CONCAT('Other/', ISNULL(fh.DivisionCode, 'null'))
    END                                       AS ServiceLine,
    fh.DivisionCode,
    fm.FacilityID,
    fac.FacilityName,
    fac.PrimaryHealthcareSetting,
    trk.StartDate                             AS TrackStartDate,
    trk.EndDate                               AS TrackEndDate
FROM Included inc
JOIN BINetHealthPatientLakehouse.PatientInfo.TxTrack trk
    ON trk.TxTrack_ID = inc.TxTrack_ID
JOIN BINetHealthPatientLakehouse.PatientInfo.PatientCase pc
    ON pc.PatientCase_ID = inc.PatientCase_ID
JOIN BINetHealthPatientLakehouse.PatientInfo.Stay stay
    ON stay.Stay_ID = pc.Stay_ID
JOIN BINetHealthPatientLakehouse.PatientInfo.Resident res
    ON res.Resident_ID = stay.Resident_ID
LEFT JOIN BINetHealthGeneralLakehouse.Lookups.IntakeSource isrc
    ON isrc.IntakeSource_ID = stay.IntakeSource_ID
LEFT JOIN BINetHealthGeneralLakehouse.FacilityInfo.FacilityMap fm
    ON fm.Facility_ID = res.Facility_ID
LEFT JOIN BINetHealthGeneralLakehouse.FacilityInfo.Facilities fac
    ON fac.FacilityID = fm.FacilityID
LEFT JOIN BINetHealthGeneralLakehouse.FacilityInfo.FacilityHierarchy fh
    ON fh.Facility_ID = res.Facility_ID
ORDER BY inc.PatientCase_ID, inc.TxTrack_ID, inc.LibraryItem_ID
