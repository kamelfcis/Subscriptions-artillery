/* Member-level security block on AppClientFlags (linked to Client.IdClient).
   Keeps legacy dbo.Blocked as an identity watchlist (name / national id, not membership-linked).
   Apply on Subscriptions_Staging first. */
USE [Subscriptions_Staging];
-- USE [Subscriptions];
GO
IF DB_NAME() NOT IN (N'Subscriptions_Staging', N'Subscriptions')
  THROW 50007, 'Unexpected database for member security block migration', 1;
GO
IF OBJECT_ID('dbo.AppClientFlags','U') IS NULL
  THROW 50007, 'AppClientFlags missing; run additive migration first', 1;
GO
IF COL_LENGTH('dbo.AppClientFlags', 'is_security_blocked') IS NULL
  ALTER TABLE dbo.AppClientFlags ADD is_security_blocked bit NOT NULL CONSTRAINT DF_AppClientFlags_security_blocked DEFAULT 0;
IF COL_LENGTH('dbo.AppClientFlags', 'security_block_reason') IS NULL
  ALTER TABLE dbo.AppClientFlags ADD security_block_reason nvarchar(300) NULL;
IF COL_LENGTH('dbo.AppClientFlags', 'security_blocked_at') IS NULL
  ALTER TABLE dbo.AppClientFlags ADD security_blocked_at datetime2 NULL;
IF COL_LENGTH('dbo.AppClientFlags', 'security_blocked_by') IS NULL
  ALTER TABLE dbo.AppClientFlags ADD security_blocked_by varchar(64) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AppClientFlags_SecurityBlocked' AND object_id = OBJECT_ID('dbo.AppClientFlags'))
  CREATE NONCLUSTERED INDEX IX_AppClientFlags_SecurityBlocked
    ON dbo.AppClientFlags(is_security_blocked)
    INCLUDE (security_block_reason, security_blocked_at, security_blocked_by)
    WHERE is_security_blocked = 1;
GO
