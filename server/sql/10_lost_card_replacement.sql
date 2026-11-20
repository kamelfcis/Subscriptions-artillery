/* Lost card replacement (بدل فاقد) — Subscriptions_Staging only */
IF COL_LENGTH('dbo.AppRenewals','transaction_kind') IS NULL
 ALTER TABLE dbo.AppRenewals ADD transaction_kind varchar(12) NOT NULL CONSTRAINT DF_AppRenewals_transaction_kind DEFAULT 'RENEWAL';
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AppRenewals_transaction_kind')
 ALTER TABLE dbo.AppRenewals DROP CONSTRAINT CK_AppRenewals_transaction_kind;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AppRenewals_transaction_kind')
 ALTER TABLE dbo.AppRenewals ADD CONSTRAINT CK_AppRenewals_transaction_kind CHECK (transaction_kind IN ('RENEWAL','LOST_CARD'));
GO
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE setting_key = 'lost_card_fee_default')
 INSERT dbo.AppSettings(setting_key,setting_value) VALUES ('lost_card_fee_default',N'50');
GO