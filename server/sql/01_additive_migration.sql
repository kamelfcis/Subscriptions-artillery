/* SUBSCRIPTIONS ENTERPRISE - ADDITIVE MIGRATION
   Apply only on a RESTORED COPY first. Does not DROP, rename, or change any legacy table.
   Backup first. Requires dbo or equivalent permission. Re-runnable. */
USE [Subscriptions];
GO
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.AppUsers','U') IS NULL
CREATE TABLE dbo.AppUsers(username varchar(64) PRIMARY KEY,password_hash varchar(255) NOT NULL,role varchar(24) NOT NULL CHECK (role IN ('admin','supervisor','cashier','clerk','auditor')),enabled bit NOT NULL DEFAULT 1,created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
IF OBJECT_ID('dbo.AppAudit','U') IS NULL
CREATE TABLE dbo.AppAudit(id bigint IDENTITY PRIMARY KEY,actor varchar(64) NOT NULL,action varchar(64) NOT NULL,entity varchar(64) NOT NULL,entity_id nvarchar(80) NULL,details nvarchar(max) NULL,created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
IF OBJECT_ID('dbo.AppClientFlags','U') IS NULL
CREATE TABLE dbo.AppClientFlags(client_id nvarchar(50) PRIMARY KEY,is_archived bit NOT NULL DEFAULT 0,updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
IF OBJECT_ID('dbo.AppDependentFlags','U') IS NULL
CREATE TABLE dbo.AppDependentFlags(dependent_id int PRIMARY KEY,is_archived bit NOT NULL DEFAULT 0,updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
IF OBJECT_ID('dbo.AppFileFlags','U') IS NULL
CREATE TABLE dbo.AppFileFlags(file_id int PRIMARY KEY,is_archived bit NOT NULL DEFAULT 0,updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
IF OBJECT_ID('dbo.AppServices','U') IS NULL
BEGIN
CREATE TABLE dbo.AppServices(code char(2) PRIMARY KEY,label nvarchar(100) NOT NULL,active bit NOT NULL DEFAULT 1);
INSERT dbo.AppServices(code,label) VALUES ('01',N'خدمة — الدار'),('02',N'معاش — الدار'),('03',N'أبناء — الدار'),('04',N'مدنيين — الدار');
END
GO
IF OBJECT_ID('dbo.AppSettings','U') IS NULL
BEGIN
CREATE TABLE dbo.AppSettings(setting_key varchar(64) PRIMARY KEY,setting_value nvarchar(300) NOT NULL);
INSERT dbo.AppSettings(setting_key,setting_value) VALUES ('age_limit_children',N'21'),('age_limit_grandchildren',N'21'),('require_verified_proof_after_age',N'true');
END
GO
IF OBJECT_ID('dbo.AppFeeSchedule','U') IS NULL
CREATE TABLE dbo.AppFeeSchedule(
 id int IDENTITY PRIMARY KEY,service_code char(2) NOT NULL REFERENCES dbo.AppServices(code),
 target_type varchar(12) NOT NULL CHECK(target_type IN ('MAIN','DEPENDENT')),
 label nvarchar(100) NOT NULL,amount decimal(14,2) NOT NULL CHECK(amount>=0),
 valid_from date NOT NULL,valid_until date NULL,
 is_active bit NOT NULL DEFAULT 1,created_by varchar(64) NOT NULL,created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT CK_AppFeeDates CHECK(valid_until IS NULL OR valid_until>=valid_from));
GO
IF OBJECT_ID('dbo.AppEligibility','U') IS NULL
CREATE TABLE dbo.AppEligibility(dependent_id int PRIMARY KEY,
 dependent_kind varchar(20) NOT NULL CHECK(dependent_kind IN ('CHILD','GRANDCHILD','SPOUSE','OTHER')),
 proof_type nvarchar(50) NULL,proof_file_id int NULL,proof_valid_until date NULL,
 verified_by varchar(64) NULL,verified_at datetime2 NULL,review_note nvarchar(300) NULL);
GO
IF OBJECT_ID('dbo.AppFamilyGuardian','U') IS NULL
CREATE TABLE dbo.AppFamilyGuardian(client_id nvarchar(50) PRIMARY KEY,dependent_id int NOT NULL,
 reason nvarchar(200) NOT NULL,proof_file_id int NOT NULL,approved_by varchar(64) NOT NULL,
 approved_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),active bit NOT NULL DEFAULT 1);
GO
IF OBJECT_ID('dbo.AppExemptions','U') IS NULL
CREATE TABLE dbo.AppExemptions(id int IDENTITY PRIMARY KEY,client_id nvarchar(50) NOT NULL,dependent_id int NULL,reason nvarchar(200) NOT NULL,
 type varchar(24) NOT NULL CHECK(type IN ('VIP','DONATION','OTHER')),
 valid_from date NOT NULL,valid_until date NULL,approved_by varchar(64) NOT NULL,
 active bit NOT NULL DEFAULT 1,created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT CK_AppExDates CHECK(valid_until IS NULL OR valid_until>=valid_from));
GO
IF OBJECT_ID('dbo.AppShifts','U') IS NULL
CREATE TABLE dbo.AppShifts(id int IDENTITY PRIMARY KEY,opened_by varchar(64) NOT NULL,opened_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),closed_by varchar(64) NULL,closed_at datetime2 NULL,opening_float decimal(14,2) NOT NULL DEFAULT 0,closing_note nvarchar(300) NULL);
GO
IF OBJECT_ID('dbo.AppRenewals','U') IS NULL
CREATE TABLE dbo.AppRenewals(
 id bigint IDENTITY PRIMARY KEY,request_key uniqueidentifier NOT NULL UNIQUE,
 client_id nvarchar(50) NOT NULL,dependent_id int NULL,
 service_code char(2) NOT NULL REFERENCES dbo.AppServices(code),
 term_from date NOT NULL,term_to date NOT NULL,
 amount_due decimal(14,2) NOT NULL CHECK(amount_due>=0),paid_amount decimal(14,2) NOT NULL DEFAULT 0,
 fee_id int NULL REFERENCES dbo.AppFeeSchedule(id),exemption_id int NULL REFERENCES dbo.AppExemptions(id),
 status varchar(12) NOT NULL CHECK(status IN ('PENDING','ACTIVE','VOID')),
 legacy_subscription_id int NULL,shift_id int NULL REFERENCES dbo.AppShifts(id),
 note nvarchar(300) NULL,created_by varchar(64) NOT NULL,created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),activated_at datetime2 NULL,
 CONSTRAINT CK_AppRenTerm CHECK(term_to>=term_from),CONSTRAINT CK_AppRenPaid CHECK(paid_amount>=0 AND paid_amount<=amount_due));
GO
IF OBJECT_ID('dbo.AppPayments','U') IS NULL
CREATE TABLE dbo.AppPayments(id bigint IDENTITY PRIMARY KEY,request_key uniqueidentifier NOT NULL UNIQUE,
 renewal_id bigint NOT NULL REFERENCES dbo.AppRenewals(id),shift_id int NOT NULL REFERENCES dbo.AppShifts(id),
 amount decimal(14,2) NOT NULL CHECK(amount>0),method varchar(20) NOT NULL CHECK(method IN ('CASH','CARD','TRANSFER')),
 reference nvarchar(80) NULL,collected_by varchar(64) NOT NULL,created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
IF OBJECT_ID('dbo.AppReversals','U') IS NULL
CREATE TABLE dbo.AppReversals(id bigint IDENTITY PRIMARY KEY,renewal_id bigint NOT NULL REFERENCES dbo.AppRenewals(id),
 amount decimal(14,2) NOT NULL CHECK(amount>=0),reason nvarchar(300) NOT NULL,
 reversed_by varchar(64) NOT NULL,created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
IF OBJECT_ID('dbo.AppLegacyBillReviews','U') IS NULL
CREATE TABLE dbo.AppLegacyBillReviews(id bigint IDENTITY PRIMARY KEY,bill_id int NOT NULL,shift_id int NOT NULL,
 recorded_money int NULL,actual_money decimal(14,2) NOT NULL CHECK(actual_money>=0),
 reason nvarchar(300) NOT NULL,reviewed_by varchar(64) NOT NULL,
 reviewed_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 CONSTRAINT UQ_AppBillReview UNIQUE(bill_id,shift_id));
GO
/* Additive finance metadata: no changes to legacy bill or subscriptioninf. */
IF COL_LENGTH('dbo.AppReversals','refund_method') IS NULL
 ALTER TABLE dbo.AppReversals ADD refund_method varchar(20) NULL;
IF COL_LENGTH('dbo.AppReversals','reference') IS NULL
 ALTER TABLE dbo.AppReversals ADD reference nvarchar(80) NULL;
IF COL_LENGTH('dbo.AppReversals','shift_id') IS NULL
 ALTER TABLE dbo.AppReversals ADD shift_id int NULL;
IF COL_LENGTH('dbo.AppShifts','closing_expected') IS NULL
 ALTER TABLE dbo.AppShifts ADD closing_expected decimal(14,2) NULL;
IF COL_LENGTH('dbo.AppShifts','closing_counted') IS NULL
 ALTER TABLE dbo.AppShifts ADD closing_counted decimal(14,2) NULL;
GO
IF OBJECT_ID('dbo.AppBlockedHistory','U') IS NULL
CREATE TABLE dbo.AppBlockedHistory(id bigint IDENTITY PRIMARY KEY,blocked_id int NOT NULL,snapshot nvarchar(max) NOT NULL,unblocked_by varchar(64) NOT NULL,unblocked_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),reason nvarchar(300) NOT NULL);
GO
IF OBJECT_ID('dbo.AppFileLinks','U') IS NULL
CREATE TABLE dbo.AppFileLinks(file_id int PRIMARY KEY,dependent_id int NULL,document_type varchar(40) NOT NULL DEFAULT 'OTHER');
GO
IF OBJECT_ID('dbo.AppCardJobs','U') IS NULL
CREATE TABLE dbo.AppCardJobs(id bigint IDENTITY PRIMARY KEY,client_id nvarchar(50) NOT NULL,dependent_id int NULL,
 printer nvarchar(150) NULL,status varchar(20) NOT NULL CHECK(status IN ('PREPARED','SPOOLED','ERROR')),
 error_message nvarchar(400) NULL,requested_by varchar(64) NOT NULL,created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_AppRenewals_TargetTerm' AND object_id=OBJECT_ID('dbo.AppRenewals'))
 CREATE INDEX IX_AppRenewals_TargetTerm ON dbo.AppRenewals(client_id,dependent_id,term_from,term_to,status);
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_AppPayments_ShiftDate' AND object_id=OBJECT_ID('dbo.AppPayments'))
 CREATE INDEX IX_AppPayments_ShiftDate ON dbo.AppPayments(shift_id,created_at);
GO
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE name='IX_AppAudit_Date' AND object_id=OBJECT_ID('dbo.AppAudit'))
 CREATE INDEX IX_AppAudit_Date ON dbo.AppAudit(created_at DESC);
GO
/* Neither existing dbo.PriceList nor dbo.bill data is migrated or altered automatically.
   Financial reconciliation from 2022-2026 requires staff confirmation and source evidence. */
