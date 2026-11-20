/* VIP civil/official job title, separate from Client.jop (military rank).
   Additive on AppClientFlags. Apply on Subscriptions_Staging first. */
USE [Subscriptions_Staging];
-- USE [Subscriptions];
GO
IF DB_NAME() NOT IN (N'Subscriptions_Staging', N'Subscriptions')
  THROW 50009, 'Unexpected database for VIP job title migration', 1;
GO
IF OBJECT_ID('dbo.AppClientFlags','U') IS NULL
  THROW 50009, 'AppClientFlags missing; run additive migration first', 1;
GO
IF COL_LENGTH('dbo.AppClientFlags', 'vip_job') IS NULL
  ALTER TABLE dbo.AppClientFlags ADD vip_job nvarchar(50) NULL;
GO
