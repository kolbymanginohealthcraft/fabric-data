# BINetHealthPatientLakehouse Schema

DailyInfo.Treatments
  Person_ID : int
  SessionId : int
  LaborDate : date
  FacilityID : varchar (nullable)
  TxMinute_ID : int
  Duration : int
  Units : int
  Modifier59 : bit
  AssistantModifier : bit (nullable)
  Resident_ID : int
  Service_ID : int
  TxTrack_ID : int
  StartTime : varchar (nullable)
  EndTime : varchar (nullable)
  ServiceCode : varchar
  ConcurrentDuration : int
  CoTreatmentDuration : int
  CoTreatmentDiscipline : varchar (nullable)
  AdditionalConcurrentDuration : int (nullable)
  Modified : varbinary
  MinuteCreated : datetime2
  MinuteLastModifiedDate : datetime2

NetHealthDocumentation.DiagnosisCategory
  DiagnosisCategory_ID : int
  CodeSet : varchar
  Type : varchar
  Name : varchar
  DisplayOrder : int
  Description : varchar
  Includes : varchar
  Type1Excludes : varchar
  Type2Excludes : varchar
  UseAdditionalCode : varchar
  ParentDiagnosisCategory_ID : int (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2

NetHealthDocumentation.DiagnosisCode
  DiagnosisCode_ID : int
  CodeSet : varchar
  Code : varchar
  Description : varchar
  InclusionTerm : varchar
  Includes : varchar
  Type1Excludes : varchar
  Type2Excludes : varchar
  UseAdditionalCode : varchar
  IsSpecific : bit
  EffectiveDate : date (nullable)
  InactiveDate : date (nullable)
  PTCommon : bit
  OTCommon : bit
  STCommon : bit
  IsTreatmentDiagnosis : bit
  ParentDiagnosisCode_ID : int (nullable)
  DiagnosisCategory_ID : int
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2

NetHealthDocumentation.LibraryItem
  LibraryItem_ID : int
  Name : varchar
  VersionName : varchar
  SectionName : varchar
  GroupName : varchar
  SubLevel : int
  Caption : varchar
  ShortCaption : varchar
  PrintCaption : varchar
  LibraryScale_ID : int
  ProblemType : varchar
  Description : varchar
  CopyRule : varchar
  VisibleExpr : varchar
  RequiredExpr : varchar
  GoalMetExpr : varchar
  CommentsAllowed : bit
  CommentsExpr : varchar
  CommentInstructions : varchar
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  LayoutType : varchar
  LayoutSize : int
  PrintExpr : varchar
  PrintOnOwnLine : bit
  SubGroupName : varchar
  RequireGoal : varchar
  CollectPriorStatus : bit
  IsOnDemand : bit
  AutoCopyRule : varchar
  PrintSectionName : varchar
  PrintGroupName : varchar
  IsPLOFNarrative : bit
  IsPrecaution : bit
  MeasurementMeaning : varchar
  IsFunctionalOutcome : bit
  HostEntity_ID : int
  HostEntityColumnName : varchar
  InputMask : varchar
  AppContext : varchar
  ReadOnlyExpr : varchar
  RequireNewValueExpr : varchar
  Tags : varchar
  IsSystem : bit
  FunctionalAssessmentDefinition_ID : int (nullable)
  RowName : varchar
  ColumnName : varchar
  AutoCopyConfirmationRequired : bit
  CopyFromHostEntity_ID : int (nullable)
  CopyFromColumnName : varchar
  CMSIdentifier : varchar
  ExcludeFromHistory : bit
  FormulaExpr : varchar
  LinkedItemName : varchar (nullable)
  ExportCaption : varchar (nullable)

NetHealthDocumentation.LibraryScale
  LibraryScale_ID : int
  Name : varchar
  ScaleType : varchar
  UnitOfMeasure : varchar
  MinValue : decimal (nullable)
  MaxValue : decimal (nullable)
  MinValue2 : decimal (nullable)
  MaxValue2 : decimal (nullable)
  NumDecimals : int (nullable)
  SpinnerIncrement : decimal (nullable)
  LowerIsBetter : bit
  AllowWithinNormalLimits : bit
  DisplayLayout : varchar
  PrintLayout : varchar
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  IsSystem : bit
  AppContext : varchar
  HostEntity_ID : int (nullable)
  HostEntitySource : varchar (nullable)
  Tags : varchar

NetHealthDocumentation.LibraryScaleValue
  LibraryScaleValue_ID : int
  LibraryScale_ID : int
  DisplayValue : varchar
  PrintValue : varchar
  Abbrev : varchar
  PhraseValue : varchar
  NumValue : decimal
  DisplayOrder : int
  Severity : varchar
  Description : varchar
  IsNoneOfAbove : bit
  ButtonWidth : int
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  CMSIdentifier : varchar

NetHealthDocumentation.SectionGGAssessment
  SectionGGAssessment_ID : int
  SectionGGAssessmentDefinition_ID : int
  AssessmentDate : date (nullable)
  AssessedByPerson_ID : int
  Occasion : varchar
  IsComplete : bit
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  PPSTrack_ID : int (nullable)
  VersionID : varchar (nullable)
  Resident_ID : int
  TxDocument_ID : int (nullable)
  SignaturePerson_ID : int (nullable)
  SignatureText : varchar (nullable)
  SignatureNotes : varchar (nullable)
  SignatureDate : datetime2 (nullable)
  SignatureAttestationStatement : varchar (nullable)
  ModifiedByPerson_ID : int (nullable)
  ModifiedDate : datetime2 (nullable)

NetHealthDocumentation.SectionGGItem
  SectionGGItem_ID : int
  LibraryScaleValue_ID : int (nullable)
  TextValue : varchar
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2

NetHealthDocumentation.SectionGGItemCollection
  SectionGGItemCollection_ID : int
  SectionGGAssessment_ID : int
  SectionGGItemCollectionDefinition_ID : int
  CurrentSectionGGItem_ID : int
  ProjectedSectionGGItem_ID : int (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2

NetHealthDocumentation.TxDiagnosis
  TxDiagnosis_ID : int
  TxDocument_ID : int
  ICD9Code : varchar (nullable)
  DiagnosisType : varchar
  DisplayOrder : int
  OnsetDate : datetime2 (nullable)
  IsInactive : bit
  Modified : varbinary
  ModifiedBy : varchar
  PatientCase_ID : int (nullable)
  CreatedDate : datetime2
  DiagnosisCode_ID : int (nullable)
  RatingLookup_ID : int (nullable)

NetHealthDocumentation.TxDocument
  TxDocument_ID : int
  TxTrack_ID : int
  Physician_ID : int (nullable)
  Hospital_ID : int (nullable)
  Sequence : int
  DocumentType : varchar
  TxFrequencyType : varchar (nullable)
  TxFrequencyLow : int (nullable)
  TxFrequencyHigh : int (nullable)
  TxDurationType : varchar (nullable)
  TxDuration : int (nullable)
  PhysicianDate : datetime2 (nullable)
  PhysicianFirstName : varchar (nullable)
  PhysicianLastName : varchar (nullable)
  SessionsPerDay : int (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  LibraryDocument_ID : int (nullable)
  RevisionNum : int
  RevisionNotes : varchar
  OriginalTxDocument_ID : int (nullable)
  FromDate : datetime2 (nullable)
  ThruDate : datetime2 (nullable)
  Person_ID : int (nullable)
  CompletedDate : datetime2 (nullable)
  CreatedDate : datetime2
  Library_ID : int (nullable)
  IsInactive : bit
  IsEvalOnly : bit
  SessionIdentifier : varchar (nullable)
  SupervisorPerson_ID : int (nullable)
  DocumentCollection_ID : int (nullable)
  CurrentPhysicianDocument_ID : int (nullable)
  LibraryDocumentCustomization_ID : int (nullable)
  SigningPhysician_ID : int (nullable)
  PathwayCategory_ID : int (nullable)
  PathwayInformation : varchar (nullable)
  MDSignatureDate : datetime2 (nullable)

NetHealthDocumentation.TxDocumentItem
  TxDocumentItem_ID : bigint
  TxDocument_ID : int
  LibraryItem_ID : int
  LibraryScaleValue_ID : int (nullable)
  Value : varchar (nullable)
  Comments : varchar (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  PriorValue : varchar (nullable)
  PriorLibraryScaleValue_ID : int (nullable)
  CreatedDate : datetime2

NonCareCharge.NonCareCharge
  NonCareCharge_ID : int
  Facility_ID : int
  Person_ID : int
  NonCareChargeItem_ID : int
  Duration : int
  IsBillable : bit
  IsInactive : bit
  OtherCharge : varchar (nullable)
  ChargeDate : datetime2
  BillableNotes : varchar (nullable)
  Notes : varchar (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  Subcategory : varchar (nullable)
  SignaturePerson_ID : int (nullable)
  SignatureDate : datetime2 (nullable)
  CreatedDate : datetime2

NonCareCharge.NonCareChargeItem
  NonCareChargeItem_ID : int
  Name : varchar
  Code : varchar
  Category : varchar
  DisplayOrder : int
  StartDate : datetime2
  EndDate : datetime2 (nullable)
  IsInactive : bit
  Modified : varbinary
  ModifiedBy : varchar
  IsOtherCharge : bit
  Billable : varchar
  Administrative : bit
  CreatedDate : datetime2
  CapacityPoints : decimal
  IsExcludeFromPBJ : bit

PatientInfo.Chain
  Chain_ID : int
  Name : varchar
  ContactName : varchar (nullable)
  Address1 : varchar (nullable)
  Address2 : varchar (nullable)
  Address3 : varchar (nullable)
  City : varchar (nullable)
  State : varchar (nullable)
  PostalCode : varchar (nullable)
  Phone1 : varchar (nullable)
  Fax : varchar (nullable)
  County : varchar (nullable)
  Country : varchar (nullable)
  Website : varchar (nullable)
  CreatedDate : datetime2
  Modified : varbinary
  ModifiedBy : varchar
  IsInactive : bit
  LastModifiedDate : datetime2
  Code : varchar (nullable)

PatientInfo.Facility
  Facility_ID : int
  HealthCareSetting_ID : int (nullable)
  ConfigSet_ID : int
  FeeSchedule_ID : int (nullable)
  Company_ID : int (nullable)
  Name : varchar
  FacilityCode : varchar (nullable)
  FacilityID : varchar (nullable)
  Address1 : varchar (nullable)
  Address2 : varchar (nullable)
  Address3 : varchar (nullable)
  City : varchar (nullable)
  County : varchar (nullable)
  State : varchar (nullable)
  PostalCode : varchar (nullable)
  Country : varchar (nullable)
  TimeZone : int (nullable)
  Phone : varchar (nullable)
  Fax : varchar (nullable)
  ContactName : varchar (nullable)
  OrganizationType : varchar (nullable)
  IsInactive : bit
  IsInpatient : bit
  IsOutpatient : bit
  LicenseNumber : varchar (nullable)
  MSA : varchar (nullable)
  NPI : varchar (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  ValidIPList : varchar (nullable)
  Chain_ID : int (nullable)
  ExportKey : varchar
  CreatedDate : datetime2
  LastModifiedDate : datetime2
  ShortName : varchar (nullable)
  RehabManager_ID : int (nullable)
  SchedulingCoordinator_ID : int (nullable)
  DirectorOfNursing_ID : int (nullable)
  ClaimsCoordinator_ID : int (nullable)
  TierNode_ID : int (nullable)
  MaxAdministrativeMinutesPerDay : int (nullable)
  MMRGoLiveDate : datetime2 (nullable)
  BusinessUnit : varchar (nullable)
  NPIVerified : bit
  RequireAssistantsBeSupervised : bit
  RequireCFsBeSupervised : bit
  FieldSet_ID : int (nullable)
  ExternalDisplayName : varchar
  SiteType : varchar
  KeyContactCollection_ID : int (nullable)
  CMSCertificationNumber : varchar
  StartDayOfWeek : varchar
  Taxonomy_ID : int (nullable)
  FeeScheduleSource : varchar
  IsZoneCustomer : bit
  ReferralRequirement : varchar
  TimeZoneName : varchar (nullable)
  ClinicLocation_ID : int (nullable)
  PrimaryHealthcareSetting : varchar
  NoShowFee : decimal (nullable)
  CancellationFee : decimal (nullable)
  CancellationAcceptableNotice : int
  ServiceAllocationSet_ID : int (nullable)
  CancellationText : varchar
  OUCode : varchar
  WorkingHoursStartTime : varchar
  WorkingHoursEndTime : varchar
  CapturePatientSignatures : varchar
  AppointmentTemplateGroup_ID : int (nullable)
  IsProspect : bit
  TreatmentPreferencesTemplate_ID : int (nullable)
  WageIndexLocation_ID : int (nullable)

PatientInfo.PatientCase
  PatientCase_ID : int
  Stay_ID : int
  PPSTrack_ID : int (nullable)
  CaseNumber : varchar
  Description : varchar (nullable)
  StartDate : datetime2
  EndDate : datetime2 (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  EndReason_ID : int (nullable)
  DischargedTo_ID : int (nullable)
  IsDeletedCase : bit
  DocumentCollection_ID : int (nullable)
  ExternalStay_ID : int (nullable)
  Accident_ID : int (nullable)
  InformationSource : varchar (nullable)
  InformationSourceDetail : varchar (nullable)
  FacilityServiceLocation_ID : int (nullable)
  Zone_ID : int (nullable)
  TypeOfCare : varchar
  ConcurrentCaseReason : varchar (nullable)
  EpisodeNumber : int (nullable)
  MedicalHistory : varchar
  PatientProblems : varchar
  CareCollection_ID : int (nullable)

PatientInfo.PatientLevelOptionalServices_Instance
  Instance_ID : int
  Id : varchar
  Facility_ID : int
  Person_ID : int
  Resident_ID : int
  Service_ID : varchar
  Duration : int
  IsActive : bit
  ChargeDate : datetime2
  BillableNotes : varchar (nullable)
  Notes : varchar (nullable)
  ModifiedBy : varchar
  CreatedDate : datetime2
  EpochTimestamp : bigint

PatientInfo.PatientLevelOptionalServices_Service
  Service_ID : int
  Id : varchar
  Name : varchar
  Category : varchar
  DisplayOrder : int
  StartDate : datetime2
  EndDate : datetime2 (nullable)
  IsActive : bit
  ModifiedBy : varchar
  CreatedDate : datetime2
  EpochTimestamp : bigint

PatientInfo.Resident
  Resident_ID : int
  Facility_ID : int
  SSN : varchar (nullable)
  IsSSNUnknown : bit
  DOB : varchar (nullable)
  PlaceOfBirth : varchar (nullable)
  Gender : varchar
  CreatedDate : datetime2
  RefCount : int
  Modified : varbinary
  ModifiedBy : varchar
  ADTPatientIdentifier : varchar
  DataConsumer_ID : int (nullable)
  ReferredBy : varchar
  Race_ID : int (nullable)
  Notes : varchar (nullable)
  ADTPatientNumber : varchar
  DocumentCollection_ID : int (nullable)
  IsDeletedResident : bit
  MasterRecord_ID : int (nullable)

PatientInfo.ResidentInfo
  ResidentInfo_ID : int
  Resident_ID : int
  IsCurrent : bit
  EffectiveDate : datetime2
  LastName : varchar
  FirstName : varchar
  MiddleInitial : varchar (nullable)
  Suffix : varchar (nullable)
  MedicareEligibility : varchar (nullable)
  MedicaidEligibility : varchar (nullable)
  MedicareNumber : varchar (nullable)
  MedicaidNumber : varchar (nullable)
  MedicaidCode : varchar (nullable)
  VANumber : varchar (nullable)
  EntitlementDateMCA : datetime2 (nullable)
  EntitlementDateMCB : datetime2 (nullable)
  EntitlementDateMCD : datetime2 (nullable)
  IsMilitaryService : bit (nullable)
  MilitaryBranch : varchar (nullable)
  MilitaryFromDate : datetime2 (nullable)
  MilitaryThruDate : datetime2 (nullable)
  IsCitizenUSA : bit (nullable)
  CitizenCountry : varchar (nullable)
  Religion : varchar (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  MaritalStatus_ID : int (nullable)
  EmploymentStatus_ID : int (nullable)
  Title : varchar
  EmailAddress : varchar
  HomePhone : varchar
  OfficePhone : varchar
  MobilePhone : varchar
  Nickname : varchar
  PrimaryLanguage : varchar (nullable)
  NeedsInterpreter : bit

PatientInfo.Schedule
  Schedule_ID : int
  Resident_ID : int (nullable)
  Person_ID : int (nullable)
  Discipline : varchar
  ScheduleDate : datetime2 (nullable)
  StartTime : varchar (nullable)
  IndividualDuration : int
  IsInactive : bit
  Notes : varchar (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  PatientCase_ID : int (nullable)
  EndTime : varchar (nullable)
  SupervisorPerson_ID : int (nullable)
  CreatedDate : datetime2
  RecurrencePattern : varchar
  EvalDuration : int
  GroupDuration : int
  ConcurrentDuration : int
  NonBillableLeadMinuteDuration : int
  IsCoTreatment : bit
  AddressDocumentType : varchar (nullable)
  AddressDocumentDueOn : datetime2 (nullable)
  GroupContainer_ID : int (nullable)
  Comments : varchar (nullable)
  CareCollection_ID : int (nullable)
  Facility_ID : int (nullable)
  AppointmentType : varchar (nullable)
  SeriesIdentifier : varchar (nullable)
  AppointmentTemplate_ID : int (nullable)
  TherapyGroupEvent_ID : int (nullable)
  IntakeSource_ID : int (nullable)

PatientInfo.Stay
  Stay_ID : int
  Resident_ID : int
  AdmittedBy_ID : int (nullable)
  DischargedBy_ID : int (nullable)
  Referral_ID : int (nullable)
  DischargeHospital_ID : int (nullable)
  CreatedDate : datetime2
  Updated : datetime2
  AdmitDate : datetime2
  AdmitTime : varchar (nullable)
  DischargeDate : datetime2 (nullable)
  DischargeTime : varchar (nullable)
  PatientType : varchar (nullable)
  IsCurrent : bit
  IsPending : bit
  IsReadmit : bit (nullable)
  IsInactive : bit
  HealthCareSetting : varchar (nullable)
  AdmittedFromOther : varchar (nullable)
  TransferredBy : varchar (nullable)
  TransferredByOther : varchar (nullable)
  DischargeType : varchar (nullable)
  DischargedTo : varchar (nullable)
  DischargedToOther : varchar (nullable)
  FamilyReferralSource : varchar (nullable)
  MedicalRecordNumber : varchar (nullable)
  LivedAlone : varchar (nullable)
  PriorPostalCode : varchar (nullable)
  ResidentialHistory : varchar (nullable)
  Occupations : varchar (nullable)
  Education : varchar (nullable)
  PrimaryLanguage : varchar (nullable)
  PrimaryLanguageOther : varchar (nullable)
  MentalHealthHistory : varchar (nullable)
  MRDDConditions : varchar (nullable)
  BackgroundCompletedDate : datetime2 (nullable)
  DailyEventsCycle : varchar (nullable)
  EatingPatterns : varchar (nullable)
  ADLPatterns : varchar (nullable)
  InvolvementPatterns : varchar (nullable)
  IsRoutineUnknown : bit
  RefCount : int
  Modified : varbinary
  ModifiedBy : varchar
  DeniedBy_ID : int (nullable)
  IsDenied : bit
  DenialReason : varchar (nullable)
  DenialReasonOther : varchar (nullable)
  IntakeSource_ID : int
  ADTStayIdentifier : varchar
  AdmitSource_ID : int (nullable)
  AdmitType_ID : int (nullable)
  AdmittedFrom_ID : int (nullable)
  Bed_ID : int (nullable)
  Branch_ID : int (nullable)
  AdmitDiagnosisICD9_ID : int (nullable)
  AdmitDiagnosisCode_ID : int (nullable)
  TherapyTeam_ID : int (nullable)

PatientInfo.TxSession
  TxSession_ID : int
  TxTrack_ID : int
  SessionDate : datetime2
  StartTime : varchar (nullable)
  EndTime : varchar (nullable)
  IsBID : bit
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  MissedReason : varchar (nullable)
  MissedReasonOther : varchar (nullable)
  MissedPerson_ID : int (nullable)
  SupervisingTherapist_ID : int (nullable)
  IsDeletedSession : bit
  SessionIdentifier : varchar
  ConcurrentDuration : int
  LastModifiedDate : datetime2
  VisitNumber : int
  AdditionalConcurrentDuration : int (nullable)
  Notes : varchar (nullable)
  CoTreatmentDuration : int
  CoTreatmentDiscipline : varchar (nullable)
  BillableMileage : int (nullable)
  TravelTime : int (nullable)
  ClientStartTime : varchar (nullable)
  StartTimeVarianceReason : varchar (nullable)
  ClientStopTime : varchar (nullable)
  StopTimeVarianceReason : varchar (nullable)
  Flowsheet_ID : int (nullable)
  ResidentAddress_ID : int (nullable)
  TravelStartTime : varchar (nullable)
  TravelStopTime : varchar (nullable)
  MissedReasonActionsTaken : varchar (nullable)
  InteractionMethod : varchar (nullable)
  PathwayInformation : varchar (nullable)
  PlaceOfServiceLookup_ID : int (nullable)

PatientInfo.TxTrack
  TxTrack_ID : int
  PatientCase_ID : int
  HospitalStay_ID : int (nullable)
  Name : varchar (nullable)
  Discipline : varchar
  StartDate : datetime2
  EndDate : datetime2 (nullable)
  OrderDate : datetime2 (nullable)
  EndReasonOther : varchar (nullable)
  LastWPNDate : datetime2 (nullable)
  VisitCount : int
  TimePreference : varchar (nullable)
  IsOneOnOneTxRequired : bit
  IsIgnoreEvalWarning : bit
  IsHospitalStayNA : bit
  PlannedDischargeDate : datetime2 (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  EndReason_ID : int (nullable)
  CreatedDate : datetime2
  IsDeletedTrack : bit
  LastModifiedDate : datetime2
  DocumentCollection_ID : int (nullable)
  IsUnplannedDischarge : bit
  InformationSource : varchar (nullable)
  InformationSourceDetail : varchar (nullable)

PatientPDPM.AssessmentReasonA
  AssessmentReasonA_ID : int
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  Reason : varchar

PatientPDPM.AssessmentReasonB
  AssessmentReasonB_ID : int
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  Reason : varchar
  ReferenceDayRestrictionPPSDayMin : int (nullable)
  ReferenceDayRestrictionPPSDayMax : int (nullable)
  HippsCharacter : varchar

PatientPDPM.CaseMixGroup
  CaseMixGroup_ID : int
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  Name : varchar

PatientPDPM.GroupCode
  GroupCode_ID : int
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  Code : varchar
  CaseMixGroup_ID : int
  HippsCharacter : varchar

PatientPDPM.PDPMAssessment
  PDPMAssessment_ID : int
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  ReferenceDate : datetime2
  PPSTrack_ID : int
  ReasonA_ID : int
  ReasonB_ID : int
  PTOTCaseMixGroup_ID : int
  SLPCaseMixGroup_ID : int
  NursingCaseMixGroup_ID : int (nullable)
  NTACaseMixGroup_ID : int (nullable)
  IsEstimate : bit
  IsInactive : bit

PatientPDPM.PPSTrack
  PPSTrack_ID : int
  Resident_ID : int
  EffectiveDate : datetime2
  DaysAvailable : int (nullable)
  LastCoveredDay : datetime2 (nullable)
  DiscontinueReason : varchar (nullable)
  DiscontinueReasonOther : varchar (nullable)
  IsInactive : bit
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  InformationSource : varchar (nullable)
  InformationSourceDetail : varchar (nullable)
  PlannedDischarge : bit (nullable)
  CFSLevel : varchar (nullable)

PayerInfo.PatientPayers
  CasePayerSet_ID : int (nullable)
  ResidentPayerSet_ID : int (nullable)
  Sequence : int (nullable)
  PatientCase_ID : int (nullable)
  FromDate : datetime2 (nullable)
  ThruDate : datetime2 (nullable)
  Discipline : varchar (nullable)
  HICN : varchar (nullable)
  PayorType : varchar (nullable)
  PayerType_ID : int (nullable)
  Payer_ID : int (nullable)
  PPSTrack_ID : int (nullable)

PayerInfo.Payer
  Payer_ID : int
  Name : varchar
  ContactName : varchar (nullable)
  ProviderNumber : varchar (nullable)
  Address1 : varchar (nullable)
  Address2 : varchar (nullable)
  Address3 : varchar (nullable)
  City : varchar (nullable)
  State : varchar (nullable)
  PostalCode : varchar (nullable)
  Phone1 : varchar (nullable)
  Fax : varchar (nullable)
  County : varchar (nullable)
  Country : varchar (nullable)
  Website : varchar (nullable)
  BedHolds : int (nullable)
  Prorated : varchar (nullable)
  CreatedDate : datetime2
  Updated : datetime2
  Modified : varbinary
  ModifiedBy : varchar
  PayerAgency_ID : int (nullable)
  ContactEmailAddress : varchar (nullable)
  ContactPhone1 : varchar (nullable)
  IsNonTherapyPlan : bit
  IsHICNRequired : bit
  FieldSet_ID : int (nullable)
  PlanUsage : varchar
  PlanCode : varchar
  PartnerAgreement_ID : int (nullable)
  BillForm_ID : int (nullable)
  BillByDiscipline : varchar
  ApplyModifierKXEntireClaim : varchar
  IncludeModifierKXOnClaim : varchar
  IncludeModifier59OnClaim : varchar
  RebillRequiresDCN : varchar
  DisplayOnInvoiceAs : varchar (nullable)
  Comments : varchar (nullable)
  SubsequentElectronicClaimSubmission : varchar
  ClaimFilingIndicatorCodeLookup_ID : int (nullable)
  ICD10EffectiveDate : date (nullable)
  IncludeGCodePennyChgOnProfClmAfterPrimaryInst : varchar
  WeekDefinition : varchar (nullable)
  BillByNPI : varchar
  RIMHoldsPreventClaimRelease : varchar
  PayerExportCode : varchar (nullable)
  RendProvCredentialRequirement : varchar
  PhysRequireNPI : bit
  PhysRequireUseAgencyDefault : bit
  RendProvRequireNPI : bit
  RendProvRequireStateLicense : bit
  RendProvRequireTaxonomyCode : bit
  RendProvRequireUseAgencyDefault : bit
  ApplySequestrationAdj : varchar
  PlanUsedForHomeHealth : bit
  PhoneNumberForAuthorization : varchar (nullable)
  TimelyFilingLimit : int (nullable)
  HomeHealthBillingMethod : varchar (nullable)
  PriorAuthorizationRequiredHomeHealthService : bit
  PriorAuthorizationRequiredHomeHealthSupply : bit
  SuppliesBilledSeparately : bit
  SuppliesBillForm_ID : int (nullable)
  PriorAuthorizationRequiredOutpatientService : bit
  FaceToFaceRequired : bit
  DaysBeforeSecClmAutoSub : smallint (nullable)
  OASISRequired : varchar (nullable)
  OASISSubmissionRequired : varchar (nullable)
  BillableSuppliesRoutineStartDate : date (nullable)
  BillableSuppliesNonRoutineStartDate : date (nullable)
  OASISPayerLookup_ID : int (nullable)
  IncludeHIPPSCodeOnClaimForNonEpisodic : bit
  IncludeQCodesOnClaimForNonEpisodic : bit
  PriorAuthNeededToStartHomeServiceVisit : bit
  PriorAuthNeededToScheduleHomeService : bit
  HomecareTypeOfBill : varchar
  BillingCycleType_ID : int (nullable)
  LevelPayerChoice : varchar
  AlwaysUseGeneralClassRevCodeOnHomeHealthClaims : bit
  AlwaysUseGeneralClassRevCodeStartDate : date (nullable)

Reports.ReportMissingPayor
  FacilityID : varchar (nullable)
  Resident_ID : int (nullable)
  FirstName : varchar (nullable)
  LastName : varchar (nullable)
  Date : date (nullable)

Reports.TherapyCensus
  Resident_ID : int
  SortBy : int
  SubSortBy : int
  Facility_ID : int (nullable)
  FacilityName : varchar (nullable)
  PatientName : varchar (nullable)
  Discipline : varchar (nullable)
  PayerType_ID : int (nullable)
  PayerTypeDescrip : varchar (nullable)
  StartOfCare : date (nullable)
  PlannedDischargeDate : date (nullable)
  PrimaryCareProvider_ID : int (nullable)
  PrimaryCareProvider : varchar (nullable)
  ResponsibleTherapist_ID : int (nullable)
  ResponsibleTherapist : varchar (nullable)
  Cert_EndDate : date (nullable)
  CreatedOn : datetime2
  UpdatedOn : datetime2

sys.dm_db_external_tables_log_status
  object_id : int
  latest_log_version : bigint (nullable)
  latest_checkpoint_version : bigint (nullable)
  last_update_time_utc : datetime
  is_blocked : bit

