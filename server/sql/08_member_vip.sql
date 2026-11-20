/* Member-level VIP flag on AppClientFlags (linked to Client.IdClient).
   Free family renewal, in-law dependent relations, and card without expiry/year.
   Apply on Subscriptions_Staging first. */
USE [Subscriptions_Staging];
-- USE [Subscriptions];
GO
IF DB_NAME() NOT IN (N'Subscriptions_Staging', N'Subscriptions')
  THROW 50008, 'Unexpected database for member VIP migration', 1;
GO
IF OBJECT_ID('dbo.AppClientFlags','U') IS NULL
  THROW 50008, 'AppClientFlags missing; run additive migration first', 1;
GO
IF COL_LENGTH('dbo.AppClientFlags', 'is_vip') IS NULL
  ALTER TABLE dbo.AppClientFlags ADD is_vip bit NOT NULL CONSTRAINT DF_AppClientFlags_vip DEFAULT 0;
GO
IF COL_LENGTH('dbo.AppClientFlags', 'vip_job') IS NULL
  ALTER TABLE dbo.AppClientFlags ADD vip_job nvarchar(50) NULL;
GO
