/* Optional indexes on legacy tables. Staging only.
   Schedule outside busy hours. Do not run against live Subscriptions. */
USE [Subscriptions_Staging];
GO
IF DB_NAME() <> N'Subscriptions_Staging'
  THROW 50002, 'Index script is staging-only', 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Client_Name' AND object_id=OBJECT_ID('dbo.Client'))
 CREATE NONCLUSTERED INDEX IX_Client_Name ON dbo.Client([Name]) INCLUDE(IdClient,IdCard,Phone,Cat,age);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Client_IdCard' AND object_id=OBJECT_ID('dbo.Client'))
 CREATE NONCLUSTERED INDEX IX_Client_IdCard ON dbo.Client(IdCard) INCLUDE(IdClient,Name);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_SubClient_IdClient' AND object_id=OBJECT_ID('dbo.SubClient'))
 CREATE NONCLUSTERED INDEX IX_SubClient_IdClient ON dbo.SubClient(IdClient) INCLUDE(id,Name,realation,age);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Subscription_ClientDate' AND object_id=OBJECT_ID('dbo.subscriptioninf'))
 CREATE NONCLUSTERED INDEX IX_Subscription_ClientDate ON dbo.subscriptioninf(clientid,todate DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Blocked_IdCard' AND object_id=OBJECT_ID('dbo.Blocked'))
 CREATE NONCLUSTERED INDEX IX_Blocked_IdCard ON dbo.Blocked(IdCard) INCLUDE(Name,reason);
GO
