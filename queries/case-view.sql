-- =============================================================================
-- Case-Level View — Core fact table for all reporting
--
-- Joins across both lakehouses to produce one row per therapy case with:
--   - Patient demographics
--   - Facility + hierarchy (Area/Region/Division)
--   - Intake source (place of residence)
--   - Stay details (admit/discharge)
--   - Case details (start/end, type of care)
--   - Discharge destination + reason (from Lookup)
--   - Track summary (disciplines, counts)
--   - Utilization (visits, minutes)
--   - Outcomes scoring (admit/discharge levels, gain)
--
-- Note: Crosswalk and CustomScales are local CSV references for now.
--       Replace with Fabric table references once they are loaded.
-- =============================================================================

-- Aliases:
--   G = BINetHealthGeneralLakehouse
--   P = BINetHealthPatientLakehouse

SELECT
    -- === Case Identity ===
    pc.PatientCase_ID,
    pc.Stay_ID,
    pc.CaseNumber,

    -- === Patient ===
    s.Resident_ID,
    ri.FirstName,
    ri.LastName,
    r.DOB,
    r.Gender,
    DATEDIFF(YEAR, r.DOB, pc.EndDate) AS AgeAtCaseEnd,

    -- === Facility ===
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
    s.AdmitDate,
    s.DischargeDate,
    s.IsCurrent AS StayIsCurrent,

    -- === Case ===
    pc.StartDate AS CaseStartDate,
    pc.EndDate AS CaseEndDate,
    pc.TypeOfCare,
    DATEDIFF(DAY, pc.StartDate, pc.EndDate) AS ALOS,

    -- === Discharge Destination ===
    pc.DischargedTo_ID,
    dd.Abbrev AS DischargeDestAbbrev,
    dd.Descrip AS DischargeDestDescrip,

    -- === Discharge Reason ===
    pc.EndReason_ID,
    dr.Abbrev AS DischargeReasonAbbrev,
    dr.Descrip AS DischargeReasonDescrip,

    -- === Planned vs Unplanned (placeholder — rules TBD) ===
    -- Will be a CASE expression based on DischargeDestination + DischargeReason
    -- May differ by DivisionCode (8450 vs 5500)
    CAST(NULL AS VARCHAR(20)) AS DischargeClassification

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

-- Discharge Destination (Lookup type DISCHRGTO)
LEFT JOIN BINetHealthGeneralLakehouse.Lookups.Lookup dd
    ON pc.DischargedTo_ID = dd.Lookup_ID

-- Discharge Reason (Lookup type CASEEND)
LEFT JOIN BINetHealthGeneralLakehouse.Lookups.Lookup dr
    ON pc.EndReason_ID = dr.Lookup_ID

WHERE pc.IsDeletedCase = 0
    AND fh.DivisionCode IN ('8450', '5500', '6500')  -- Active divisions only
    -- Date filter (parameterize as needed)
    -- AND pc.EndDate >= '2026-01-01'
    -- AND pc.EndDate < '2026-04-01'
