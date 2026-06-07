# BINetHealthGeneralLakehouse Schema

Employees.EmployeeUserNames
  AppUser_ID : int
  Application_ID : int (nullable)
  Person_ID : int (nullable)
  UserName : varchar
  Password : varchar (nullable)
  PasswordSalt : varchar (nullable)
  Modified : varbinary
  ModifiedBy : varchar
  LastPasswordChange : datetime2 (nullable)
  PasswordChangeCountdown : int (nullable)
  PasswordLockoutDate : datetime2 (nullable)
  LastBadPasswordAttempt : datetime2 (nullable)
  BadPasswordCount : int (nullable)
  LastSuccessfulLogin : datetime2
  PasswordNeverExpires : bit
  LoginToken : varchar
  LastLogout : datetime2 (nullable)
  CreatedDate : datetime2
  PIN : varchar (nullable)
  IsInactive : bit
  PasswordResetExpiration : datetime2 (nullable)
  SisenseToken : varchar (nullable)
  CurrentHashAlgorithm : varchar
  CurrentEncryptionAlgorithm : varchar
  IgnoreInactivityLockout : bit

Employees.Employees
  Person_ID : int
  UpdatedBy_ID : int (nullable)
  FirstName : varchar
  LastName : varchar
  MiddleInitial : varchar (nullable)
  StaffTitle : varchar (nullable)
  IsStaff : bit
  IsUser : bit
  IsVisitor : bit
  IsInactive : bit
  SSN : varchar (nullable)
  CompanyName : varchar (nullable)
  Phone1 : varchar (nullable)
  Phone2 : varchar (nullable)
  Phone3 : varchar (nullable)
  Fax : varchar (nullable)
  EmailAddress : varchar (nullable)
  Address1 : varchar (nullable)
  Address2 : varchar (nullable)
  Address3 : varchar (nullable)
  City : varchar (nullable)
  State : varchar (nullable)
  PostalCode : varchar (nullable)
  County : varchar (nullable)
  Country : varchar (nullable)
  Updated : datetime2
  Modified : varbinary
  ModifiedBy : varchar
  PrimaryFacility_ID : int (nullable)
  SupervisorPerson_ID : int (nullable)
  EmployeeNo : varchar (nullable)
  NPI : varchar (nullable)
  IsRemoteUser : bit (nullable)
  IsGiftRAPStaff : bit
  LockoutDate : datetime2 (nullable)
  SignatureText : varchar
  Messaging : varchar
  CreatedDate : datetime2
  ProductivityTarget : decimal (nullable)
  EfficiencyTarget : decimal (nullable)
  ExternalUpdateRule : varchar
  IsCustomerStaff : bit
  IsChainAdmin : bit
  Chain_ID : int (nullable)
  MobileCarrier_ID : int (nullable)
  AllowSMS : varchar
  NPIVerified : bit
  ASHAMemberID : varchar (nullable)
  NOMSCertificationDate : date (nullable)
  Taxonomy_ID : int (nullable)
  ClinicianPointQuota : int (nullable)
  IsSalesRepresentative : bit

FacilityInfo.Facilities
  FacilityID : varchar (nullable)
  FacilityName : varchar (nullable)
  ChainName : varchar (nullable)
  FacilityType : varchar (nullable)
  Address1 : varchar (nullable)
  Address2 : varchar (nullable)
  City : varchar (nullable)
  State : varchar (nullable)
  Zip : varchar (nullable)
  Phone : varchar (nullable)
  FaxNumber : varchar (nullable)
  SiteType : varchar (nullable)
  TimeZoneName : varchar (nullable)
  PrimaryHealthcareSetting : varchar (nullable)
  NPI : varchar (nullable)
  County : varchar (nullable)
  WageIndexLocation_ID : int (nullable)

FacilityInfo.FacilityHierarchy
  Facility_ID : int (nullable)
  AreaCode : varchar (nullable)
  AreaName : varchar (nullable)
  RegionCode : varchar (nullable)
  RegionName : varchar (nullable)
  DivisionCode : varchar (nullable)
  DivisionName : varchar (nullable)

FacilityInfo.FacilityMap
  Facility_ID : int (nullable)
  FacilityID : varchar (nullable)

FacilityInfo.FacilityTags
  FacilityTag_ID : int (nullable)
  Facility_ID : int (nullable)
  Name : varchar (nullable)
  CreatedDate : datetime2 (nullable)
  ModifiedBy : varchar (nullable)

FacilityInfo.NHAegisFacilities
  Id : varchar (nullable)
  FacilityId : varchar (nullable)
  FacilityName : varchar (nullable)
  DistrictId : varchar (nullable)
  DistrictName : varchar (nullable)
  AreaId : varchar (nullable)
  Regionid : varchar (nullable)
  IsActive : int (nullable)
  EffectiveDate : datetime2 (nullable)
  SystemType : varchar (nullable)
  ChainName : varchar (nullable)
  FacilityType : varchar (nullable)
  AH_Affiliated : varchar (nullable)
  AH_Address1 : varchar (nullable)
  AH_Address2 : varchar (nullable)
  AH_City : varchar (nullable)
  AH_State : varchar (nullable)
  AH_Zip : varchar (nullable)
  AH_Phone : varchar (nullable)
  AH_Fax : varchar (nullable)
  AH_IsTest : bit (nullable)
  AH_DefaultAccess : bit (nullable)
  AH_ContractType : varchar (nullable)
  SiteType : varchar (nullable)
  ClosedDate : datetime2 (nullable)
  DirectBill : int (nullable)

FacilityInfo.NHAegisHierarchy
  Id : varchar (nullable)
  Level : smallint (nullable)
  LocId : varchar (nullable)
  LocType : varchar (nullable)
  LocParentId : int (nullable)
  LocName : varchar (nullable)
  SystemType : varchar (nullable)
  IsActive : bit (nullable)
  EffectiveOn : datetime2 (nullable)
  ParentId : varchar (nullable)

Lookups.BillDateLookup
  Date : date (nullable)

Lookups.IntakeSource
  IntakeSource_ID : int
  Name : varchar
  Abbrev : varchar
  SourceType : varchar
  Modified : varbinary
  ModifiedBy : varchar
  CreatedDate : datetime2
  FieldSet_ID : int
  PlanUsage : varchar
  PlaceOfResidenceUsage : varchar
  IsInstitutional : bit
  IsSNF : bit

Lookups.Lookup
  Lookup_ID : int
  Type : varchar
  Abbrev : varchar
  Descrip : varchar (nullable)
  Category : varchar (nullable)
  Updated : datetime2
  FromDate : datetime2
  ThruDate : datetime2 (nullable)
  DisplaySequence : int (nullable)
  IsSystem : bit
  Modified : varbinary
  ModifiedBy : varchar
  IsCommon : bit

Lookups.Physician
  Physician_ID : int
  LastName : varchar
  FirstName : varchar (nullable)
  MiddleInitial : varchar (nullable)
  Specialty : varchar (nullable)
  Title : varchar (nullable)
  UPIN : varchar (nullable)
  LicenseNumber : varchar (nullable)
  Company : varchar (nullable)
  Address1 : varchar (nullable)
  Address2 : varchar (nullable)
  Address3 : varchar (nullable)
  City : varchar (nullable)
  State : varchar (nullable)
  PostalCode : varchar (nullable)
  County : varchar (nullable)
  Country : varchar (nullable)
  Fax : varchar (nullable)
  Phone1 : varchar (nullable)
  Phone2 : varchar (nullable)
  Phone3 : varchar (nullable)
  EmailAddress : varchar (nullable)
  Updated : datetime2
  IsInactive : bit
  Modified : varbinary
  ModifiedBy : varchar
  NPI : varchar (nullable)
  EIN : varchar (nullable)
  SSN : varchar
  HoldBills : bit
  CreatedDate : datetime2
  NPIVerified : bit
  MasterPhysician_ID : int (nullable)
  DoNotFax : bit
  DoNotCall : bit
  MobilePhone : varchar

Lookups.Service
  Service_ID : int
  ServiceSet_ID : int (nullable)
  ServiceCode : varchar
  VendorCode : varchar
  Description : varchar (nullable)
  Abbrev : varchar (nullable)
  FromDate : datetime2 (nullable)
  ThruDate : datetime2 (nullable)
  IsTimeBased : bit
  Modified : varbinary
  ModifiedBy : varchar
  IsGroup : bit
  IsExcludedFromExport : bit
  PrintCodeOnDoc : bit
  CreatedDate : datetime2
  ProcessingOrder : int (nullable)
  MDSAllowed : varchar
  Billable : varchar
  ExcludedInPlanOfTreatmentSelection : bit
  AlwaysIncludeInTreatmentEncounter : bit
  ProductivityCap : int (nullable)
  TherapyUsage : varchar
  IsModifier52Allowed : bit
  TypeOfCare : varchar
  MinutesPerUnit : int (nullable)
  VisitUsage : varchar
  UnitsCap : int (nullable)
  ExcludeFromMedicareRoundingRules : bit
  IsTypeOfVisitCode : bit
  EligibleForBillFRP : bit
  IsProgressiveUnitAllocation : bit

sys.dm_db_external_tables_log_status
  object_id : int
  latest_log_version : bigint (nullable)
  latest_checkpoint_version : bigint (nullable)
  last_update_time_utc : datetime
  is_blocked : bit

