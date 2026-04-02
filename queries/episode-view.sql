-- =============================================================================
-- Episode View — Unified fact table for all reporting
--
-- The "episode" grain differs by division:
--   Contract Rehab (8450) + HAP (6500): episode = PatientCase
--   Senior Living (5500): episode = TxTrack
--
-- Includes:
--   - Patient demographics + age at episode end
--   - Facility + hierarchy (Area/Region/Division)
--   - Intake source (place of residence)
--   - Stay details (admit/discharge)
--   - Case and track details
--   - Discharge destination + reason (from Lookup)
--   - Planned vs unplanned discharge classification
--   - EDD (Expected Discharge Destination) from eval document
--   - PLE (Prior Living Environment) from eval document
--   - Primary diagnosis from eval document
-- =============================================================================

-- =============================================
-- CONTRACT REHAB + HAP: Episode = Case
-- =============================================
SELECT
    -- === Episode Identity ===
    'Case' AS EpisodeType,
    pc.PatientCase_ID AS EpisodeID,
    pc.PatientCase_ID,
    NULL AS EpisodeTxTrack_ID,

    -- === Patient ===
    s.Resident_ID,
    ri.FirstName,
    ri.LastName,
    r.DOB,
    r.Gender,
    DATEDIFF(YEAR, r.DOB, pc.EndDate) AS AgeAtEpisodeEnd,

    -- === Facility + Hierarchy ===
    f.Facility_ID,
    f.Name AS FacilityName,
    f.FacilityCode,
    f.SiteType,
    f.PrimaryHealthcareSetting,
    f.Chain_ID,
    fh.AreaCode,
    fh.AreaName,
    fh.RegionCode,
    fh.RegionName,
    fh.DivisionCode,
    fh.DivisionName,

    -- === Intake Source (Place of Residence) ===
    isrc.IntakeSource_ID,
    isrc.Name AS IntakeSourceName,
    isrc.SourceType AS IntakeSourceType,
    isrc.IsInstitutional,
    isrc.IsSNF,

    -- === Stay ===
    s.Stay_ID,
    s.AdmitDate,
    s.DischargeDate,
    s.IsCurrent AS StayIsCurrent,

    -- === Case ===
    pc.CaseNumber,
    pc.StartDate AS CaseStartDate,
    pc.EndDate AS CaseEndDate,
    pc.TypeOfCare,

    -- === Episode Dates (case-level for contract rehab) ===
    pc.StartDate AS EpisodeStartDate,
    pc.EndDate AS EpisodeEndDate,
    DATEDIFF(DAY, pc.StartDate, pc.EndDate) AS ALOS,

    -- === Track (NULL for case-level episodes; tracks queried separately) ===
    CAST(NULL AS VARCHAR(10)) AS Discipline,

    -- === Discharge Destination ===
    pc.DischargedTo_ID,
    dd.Abbrev AS DischargeDestAbbrev,
    dd.Descrip AS DischargeDestDescrip,

    -- === Discharge Reason ===
    pc.EndReason_ID,
    dr.Abbrev AS DischargeReasonAbbrev,
    dr.Descrip AS DischargeReasonDescrip,

    -- === Planned vs Unplanned Classification ===
    CASE
        -- Unplanned by destination: Hospital, Expired, Hospice, AMA, Rehab Hospital
        WHEN pc.DischargedTo_ID IN (210, 1522, 1523, 1524, 1538)
            THEN 'Unplanned'
        -- Planned by reason
        WHEN pc.EndReason_ID IN (466, 467, 469, 480, 1544, 1546, 1548, 1553, 1554, 1557)
            THEN 'Planned'
        -- Unplanned reasons (everything else that has a reason)
        WHEN pc.EndReason_ID IS NOT NULL
            THEN 'Unplanned'
        ELSE NULL
    END AS DischargeClassification,

    -- === Primary Payer ===
    pyr.Payer_ID AS PrimaryPayer_ID,
    pyr.Name AS PrimaryPayerName,
    pp.PayorType AS PrimaryPayorType,
    CASE
        WHEN pp.PayorType IN ('Medicare Part A', 'Managed Care Part A')
            THEN 'A/A-Like'
        WHEN pp.PayorType IN ('Medicare Part B', 'Managed Care Part B')
            THEN 'B/HMO-B'
        ELSE 'Other'
    END AS PayerGrouping,

    -- === Primary Medical Diagnosis (from earliest EVAL, lowest DisplayOrder) ===
    pdx.ICD,
    pdx.L4 AS DiagnosisL4,
    pdx.L3 AS DiagnosisL3,
    pdx.L2 AS DiagnosisL2,
    pdx.L1 AS DiagnosisL1,
    pdx.OnsetDate AS DiagnosisOnsetDate,

    -- === EDD (from first EVAL document on any track in this case) ===
    edd_lsv.DisplayValue AS ExpectedDischargeDest,

    -- === PLE (from first EVAL document on any track in this case) ===
    ple_lsv.DisplayValue AS PriorLivingEnvironment

FROM BINetHealthPatientLakehouse.PatientInfo.PatientCase pc

-- Stay → Patient
JOIN BINetHealthPatientLakehouse.PatientInfo.Stay s
    ON pc.Stay_ID = s.Stay_ID
JOIN BINetHealthPatientLakehouse.PatientInfo.Resident r
    ON s.Resident_ID = r.Resident_ID
JOIN BINetHealthPatientLakehouse.PatientInfo.ResidentInfo ri
    ON r.Resident_ID = ri.Resident_ID AND ri.IsCurrent = 1

-- Facility + Hierarchy
JOIN BINetHealthPatientLakehouse.PatientInfo.Facility f
    ON r.Facility_ID = f.Facility_ID
LEFT JOIN BINetHealthGeneralLakehouse.FacilityInfo.FacilityHierarchy fh
    ON f.Facility_ID = fh.Facility_ID

-- Intake Source
LEFT JOIN BINetHealthGeneralLakehouse.Lookups.IntakeSource isrc
    ON s.IntakeSource_ID = isrc.IntakeSource_ID

-- Primary Payer (Sequence = 1)
LEFT JOIN BINetHealthPatientLakehouse.PayerInfo.PatientPayers pp
    ON pc.PatientCase_ID = pp.PatientCase_ID AND pp.Sequence = 1
LEFT JOIN BINetHealthPatientLakehouse.PayerInfo.Payer pyr
    ON pp.Payer_ID = pyr.Payer_ID

-- Discharge Destination
LEFT JOIN BINetHealthGeneralLakehouse.Lookups.Lookup dd
    ON pc.DischargedTo_ID = dd.Lookup_ID

-- Discharge Reason
LEFT JOIN BINetHealthGeneralLakehouse.Lookups.Lookup dr
    ON pc.EndReason_ID = dr.Lookup_ID

-- Primary Medical Diagnosis (earliest EVAL doc, lowest DisplayOrder)
OUTER APPLY (
    SELECT TOP 1
        REPLACE(dc.Code, '.', '') AS ICD,
        dc.Code + ': ' + dc.Description AS L4,
        COALESCE(parent_dc.Code + ': ' + parent_dc.Description, dc.Code + ': ' + dc.Description) AS L3,
        cat.Description AS L2,
        parent_cat.Description AS L1,
        dx.OnsetDate
    FROM BINetHealthPatientLakehouse.NetHealthDocumentation.TxDiagnosis dx
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocument doc
        ON dx.TxDocument_ID = doc.TxDocument_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.TxTrack trk_dx
        ON doc.TxTrack_ID = trk_dx.TxTrack_ID
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.DiagnosisCode dc
        ON dx.DiagnosisCode_ID = dc.DiagnosisCode_ID
    LEFT JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.DiagnosisCode parent_dc
        ON dc.ParentDiagnosisCode_ID = parent_dc.DiagnosisCode_ID
    LEFT JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.DiagnosisCategory cat
        ON dc.DiagnosisCategory_ID = cat.DiagnosisCategory_ID
    LEFT JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.DiagnosisCategory parent_cat
        ON cat.ParentDiagnosisCategory_ID = parent_cat.DiagnosisCategory_ID
    WHERE trk_dx.PatientCase_ID = pc.PatientCase_ID
        AND doc.DocumentType = 'EVAL'
        AND dx.DiagnosisType = 'MEDICAL'
        AND dx.DiagnosisCode_ID IS NOT NULL
    ORDER BY dx.DisplayOrder, doc.CreatedDate
) pdx

-- EDD: Get from the earliest EVAL doc on any track in this case
OUTER APPLY (
    SELECT TOP 1 di.LibraryScaleValue_ID
    FROM BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocumentItem di
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocument doc
        ON di.TxDocument_ID = doc.TxDocument_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.TxTrack trk
        ON doc.TxTrack_ID = trk.TxTrack_ID
    WHERE trk.PatientCase_ID = pc.PatientCase_ID
        AND doc.DocumentType = 'EVAL'
        AND di.LibraryItem_ID = 7614
        AND di.LibraryScaleValue_ID IS NOT NULL
    ORDER BY doc.CreatedDate
) edd
LEFT JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.LibraryScaleValue edd_lsv
    ON edd.LibraryScaleValue_ID = edd_lsv.LibraryScaleValue_ID

-- PLE: Same approach
OUTER APPLY (
    SELECT TOP 1 di.LibraryScaleValue_ID
    FROM BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocumentItem di
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocument doc
        ON di.TxDocument_ID = doc.TxDocument_ID
    JOIN BINetHealthPatientLakehouse.PatientInfo.TxTrack trk
        ON doc.TxTrack_ID = trk.TxTrack_ID
    WHERE trk.PatientCase_ID = pc.PatientCase_ID
        AND doc.DocumentType = 'EVAL'
        AND di.LibraryItem_ID = 7857
        AND di.LibraryScaleValue_ID IS NOT NULL
    ORDER BY doc.CreatedDate
) ple
LEFT JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.LibraryScaleValue ple_lsv
    ON ple.LibraryScaleValue_ID = ple_lsv.LibraryScaleValue_ID

WHERE pc.IsDeletedCase = 0
    AND fh.DivisionCode IN ('8450', '6500')
    -- Date filter (parameterize as needed)
    AND pc.EndDate >= '2026-01-01'
    AND pc.EndDate < '2026-04-01'


UNION ALL


-- =============================================
-- SENIOR LIVING: Episode = Track
-- =============================================
SELECT
    -- === Episode Identity ===
    'Track' AS EpisodeType,
    trk.TxTrack_ID AS EpisodeID,
    trk.PatientCase_ID,
    trk.TxTrack_ID AS EpisodeTxTrack_ID,

    -- === Patient ===
    s.Resident_ID,
    ri.FirstName,
    ri.LastName,
    r.DOB,
    r.Gender,
    DATEDIFF(YEAR, r.DOB, trk.EndDate) AS AgeAtEpisodeEnd,

    -- === Facility + Hierarchy ===
    f.Facility_ID,
    f.Name AS FacilityName,
    f.FacilityCode,
    f.SiteType,
    f.PrimaryHealthcareSetting,
    f.Chain_ID,
    fh.AreaCode,
    fh.AreaName,
    fh.RegionCode,
    fh.RegionName,
    fh.DivisionCode,
    fh.DivisionName,

    -- === Intake Source ===
    isrc.IntakeSource_ID,
    isrc.Name AS IntakeSourceName,
    isrc.SourceType AS IntakeSourceType,
    isrc.IsInstitutional,
    isrc.IsSNF,

    -- === Stay ===
    s.Stay_ID,
    s.AdmitDate,
    s.DischargeDate,
    s.IsCurrent AS StayIsCurrent,

    -- === Case ===
    pc.CaseNumber,
    pc.StartDate AS CaseStartDate,
    pc.EndDate AS CaseEndDate,
    pc.TypeOfCare,

    -- === Episode Dates (track-level for senior living) ===
    trk.StartDate AS EpisodeStartDate,
    trk.EndDate AS EpisodeEndDate,
    DATEDIFF(DAY, trk.StartDate, trk.EndDate) AS ALOS,

    -- === Track ===
    trk.Discipline,

    -- === Discharge Destination (not applicable for SL) ===
    CAST(NULL AS INT) AS DischargedTo_ID,
    CAST(NULL AS VARCHAR(20)) AS DischargeDestAbbrev,
    CAST(NULL AS VARCHAR(50)) AS DischargeDestDescrip,

    -- === Discharge Reason (from upstream CASE for SL) ===
    pc.EndReason_ID,
    dr.Abbrev AS DischargeReasonAbbrev,
    dr.Descrip AS DischargeReasonDescrip,

    -- === Planned vs Unplanned (from case reason; three-way for SL) ===
    CASE
        WHEN pc.EndReason_ID IS NULL OR pc.EndDate IS NULL
            THEN 'Case Not Closed'
        WHEN pc.EndReason_ID IN (466, 467, 469, 480, 1544, 1546, 1548, 1553, 1554, 1557)
            THEN 'Planned'
        ELSE 'Unplanned'
    END AS DischargeClassification,

    -- === Primary Payer (from case) ===
    pyr.Payer_ID AS PrimaryPayer_ID,
    pyr.Name AS PrimaryPayerName,
    pp.PayorType AS PrimaryPayorType,
    CASE
        WHEN pp.PayorType IN ('Medicare Part A', 'Managed Care Part A')
            THEN 'A/A-Like'
        WHEN pp.PayorType IN ('Medicare Part B', 'Managed Care Part B')
            THEN 'B/HMO-B'
        ELSE 'Other'
    END AS PayerGrouping,

    -- === Primary Medical Diagnosis (from EVAL on this track) ===
    pdx.ICD,
    pdx.L4 AS DiagnosisL4,
    pdx.L3 AS DiagnosisL3,
    pdx.L2 AS DiagnosisL2,
    pdx.L1 AS DiagnosisL1,
    pdx.OnsetDate AS DiagnosisOnsetDate,

    -- === EDD / PLE not applicable for SL ===
    CAST(NULL AS VARCHAR(50)) AS ExpectedDischargeDest,
    CAST(NULL AS VARCHAR(50)) AS PriorLivingEnvironment

FROM BINetHealthPatientLakehouse.PatientInfo.TxTrack trk

-- Case → Stay → Patient
JOIN BINetHealthPatientLakehouse.PatientInfo.PatientCase pc
    ON trk.PatientCase_ID = pc.PatientCase_ID
JOIN BINetHealthPatientLakehouse.PatientInfo.Stay s
    ON pc.Stay_ID = s.Stay_ID
JOIN BINetHealthPatientLakehouse.PatientInfo.Resident r
    ON s.Resident_ID = r.Resident_ID
JOIN BINetHealthPatientLakehouse.PatientInfo.ResidentInfo ri
    ON r.Resident_ID = ri.Resident_ID AND ri.IsCurrent = 1

-- Facility + Hierarchy
JOIN BINetHealthPatientLakehouse.PatientInfo.Facility f
    ON r.Facility_ID = f.Facility_ID
LEFT JOIN BINetHealthGeneralLakehouse.FacilityInfo.FacilityHierarchy fh
    ON f.Facility_ID = fh.Facility_ID

-- Intake Source
LEFT JOIN BINetHealthGeneralLakehouse.Lookups.IntakeSource isrc
    ON s.IntakeSource_ID = isrc.IntakeSource_ID

-- Primary Payer (from case, Sequence = 1)
LEFT JOIN BINetHealthPatientLakehouse.PayerInfo.PatientPayers pp
    ON pc.PatientCase_ID = pp.PatientCase_ID AND pp.Sequence = 1
LEFT JOIN BINetHealthPatientLakehouse.PayerInfo.Payer pyr
    ON pp.Payer_ID = pyr.Payer_ID

-- Primary Medical Diagnosis (from EVAL on THIS track)
OUTER APPLY (
    SELECT TOP 1
        REPLACE(dc.Code, '.', '') AS ICD,
        dc.Code + ': ' + dc.Description AS L4,
        COALESCE(parent_dc.Code + ': ' + parent_dc.Description, dc.Code + ': ' + dc.Description) AS L3,
        cat.Description AS L2,
        parent_cat.Description AS L1,
        dx.OnsetDate
    FROM BINetHealthPatientLakehouse.NetHealthDocumentation.TxDiagnosis dx
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.TxDocument doc
        ON dx.TxDocument_ID = doc.TxDocument_ID
    JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.DiagnosisCode dc
        ON dx.DiagnosisCode_ID = dc.DiagnosisCode_ID
    LEFT JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.DiagnosisCode parent_dc
        ON dc.ParentDiagnosisCode_ID = parent_dc.DiagnosisCode_ID
    LEFT JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.DiagnosisCategory cat
        ON dc.DiagnosisCategory_ID = cat.DiagnosisCategory_ID
    LEFT JOIN BINetHealthPatientLakehouse.NetHealthDocumentation.DiagnosisCategory parent_cat
        ON cat.ParentDiagnosisCategory_ID = parent_cat.DiagnosisCategory_ID
    WHERE doc.TxTrack_ID = trk.TxTrack_ID
        AND doc.DocumentType = 'EVAL'
        AND dx.DiagnosisType = 'MEDICAL'
        AND dx.DiagnosisCode_ID IS NOT NULL
    ORDER BY dx.DisplayOrder, doc.CreatedDate
) pdx

-- Discharge Reason (from CASE for senior living)
LEFT JOIN BINetHealthGeneralLakehouse.Lookups.Lookup dr
    ON pc.EndReason_ID = dr.Lookup_ID

WHERE trk.IsDeletedTrack = 0
    AND pc.IsDeletedCase = 0
    AND fh.DivisionCode = '5500'
    -- Date filter on TRACK end date for senior living
    AND trk.EndDate >= '2026-01-01'
    AND trk.EndDate < '2026-04-01'
