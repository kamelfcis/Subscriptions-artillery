/* Additive: membership card layout JSON (admin-designed).
   Apply on Subscriptions_Staging (or Subscriptions after cutover). Re-runnable. */
USE [Subscriptions_Staging];
-- USE [Subscriptions];
GO
IF DB_NAME() NOT IN (N'Subscriptions_Staging', N'Subscriptions')
  THROW 50005, 'Refusing AppCardTemplate outside Subscriptions_Staging or Subscriptions.', 1;
GO
IF OBJECT_ID('dbo.AppCardTemplate','U') IS NULL
CREATE TABLE dbo.AppCardTemplate(
 id int NOT NULL CONSTRAINT PK_AppCardTemplate PRIMARY KEY CONSTRAINT CK_AppCardTemplate_singleton CHECK (id = 1),
 template_json nvarchar(max) NOT NULL,
 updated_by varchar(64) NOT NULL,
 updated_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
