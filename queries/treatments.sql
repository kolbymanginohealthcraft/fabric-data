-- =============================================================================
-- Treatment Tables — Session and CPT detail
--
-- Two grains:
--   Sessions: one row per therapy session (who, when, which track)
--   Details:  one row per session × service code (CPT, minutes, units)
--
-- These are separate facts from the Episode view. Link via TxTrack_ID.
--
-- Analytical use cases:
--   - Types of services rendered (CPT mix)
--   - Frequency (sessions per week/day)
--   - Intensity (minutes per session)
--   - Duration of treatment episode
--   - Discipline tapering/overlap over time
--   - Patient tolerance patterns
-- =============================================================================

-- =============================================
-- SESSIONS (one row per session)
-- =============================================
SELECT
    t.SessionId,
    t.Person_ID,
    t.LaborDate,
    t.AssistantModifier,
    t.TxTrack_ID,
    t.Resident_ID,

    -- Aggregated from detail lines
    SUM(t.Duration) AS TotalDuration,
    SUM(t.Units) AS TotalUnits,
    COUNT(DISTINCT t.ServiceCode) AS DistinctServiceCodes,
    SUM(t.ConcurrentDuration) AS ConcurrentDuration,
    SUM(t.CoTreatmentDuration) AS CoTreatmentDuration

FROM BINetHealthPatientLakehouse.DailyInfo.Treatments t
GROUP BY
    t.SessionId,
    t.Person_ID,
    t.LaborDate,
    t.AssistantModifier,
    t.TxTrack_ID,
    t.Resident_ID


-- =============================================
-- SESSION DETAILS (one row per session × service code)
-- =============================================
SELECT
    t.SessionId,
    t.ServiceCode,
    SUM(t.Duration) AS Duration,
    SUM(t.Units) AS Units,

    -- Service attributes (from Lookups)
    s.Description AS ServiceDescription,
    s.Abbrev AS ServiceAbbrev,
    s.IsTimeBased,
    s.IsGroup,
    s.Billable,
    s.TherapyUsage,
    s.TypeOfCare

FROM BINetHealthPatientLakehouse.DailyInfo.Treatments t
LEFT JOIN BINetHealthGeneralLakehouse.Lookups.Service s
    ON t.ServiceCode = s.ServiceCode
GROUP BY
    t.SessionId,
    t.ServiceCode,
    s.Description,
    s.Abbrev,
    s.IsTimeBased,
    s.IsGroup,
    s.Billable,
    s.TherapyUsage,
    s.TypeOfCare
