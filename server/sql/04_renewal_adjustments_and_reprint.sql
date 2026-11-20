/* Additive objects. Does not DROP or ALTER legacy tables.
   Applied target is Subscriptions_Staging. The live USE line stays commented until cutover. */
USE [Subscriptions_Staging];
-- USE [Subscriptions];
GO
IF DB_NAME() NOT IN (N'Subscriptions_Staging', N'Subscriptions')
  THROW 50004, 'Refusing AppRenewalAdjustments outside Subscriptions_Staging or Subscriptions.', 1;

IF OBJECT_ID('dbo.AppRenewalAdjustments','U') IS NULL
CREATE TABLE dbo.AppRenewalAdjustments(
 id bigint IDENTITY PRIMARY KEY,
 renewal_id bigint NOT NULL REFERENCES dbo.AppRenewals(id),
 old_due decimal(14,2) NOT NULL,
 new_due decimal(14,2) NOT NULL CHECK(new_due>=0),
 reason nvarchar(300) NOT NULL,
 adjusted_by varchar(64) NOT NULL,
 created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());

IF COL_LENGTH('dbo.AppCardJobs','reprint_reason') IS NULL
 ALTER TABLE dbo.AppCardJobs ADD reprint_reason nvarchar(300) NULL;
