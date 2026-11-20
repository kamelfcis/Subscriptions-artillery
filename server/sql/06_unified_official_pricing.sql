/* Official AppFeeSchedule from dbo.PriceList on this database only.
   Imports رسوم الدار (FDar) and تجديد الدار (RDar) per tier (Cat/Jop unchanged).
   FElrada / RElnada are never read or created. */
USE [Subscriptions_Staging];
GO
IF DB_NAME() <> N'Subscriptions_Staging'
  THROW 50006, 'Price import: Subscriptions_Staging only', 1;

IF COL_LENGTH('dbo.AppFeeSchedule', 'tier_cat') IS NULL
  ALTER TABLE dbo.AppFeeSchedule ADD tier_cat nvarchar(50) NULL;
IF COL_LENGTH('dbo.AppFeeSchedule', 'tier_jop') IS NULL
  ALTER TABLE dbo.AppFeeSchedule ADD tier_jop nvarchar(50) NULL;
IF COL_LENGTH('dbo.AppFeeSchedule', 'price_kind') IS NULL
  ALTER TABLE dbo.AppFeeSchedule ADD price_kind varchar(20) NULL;
GO

UPDATE dbo.AppFeeSchedule
SET price_kind = 'RENEWAL'
WHERE price_kind IS NULL
  AND (label LIKE N'%تجديد الدار%' OR label = N'تجديد الدار');
UPDATE dbo.AppFeeSchedule
SET price_kind = 'MEMBERSHIP_FEE'
WHERE price_kind IS NULL
  AND (label LIKE N'%رسوم الدار%' OR label = N'رسوم الدار');
GO

IF OBJECT_ID('dbo.CK_AppFeeSchedule_price_kind', 'C') IS NULL
  ALTER TABLE dbo.AppFeeSchedule
  ADD CONSTRAINT CK_AppFeeSchedule_price_kind
  CHECK (price_kind IS NULL OR price_kind IN ('RENEWAL','MEMBERSHIP_FEE'));
GO

UPDATE dbo.AppServices SET label = N'خدمة — الدار' WHERE code = '01';
UPDATE dbo.AppServices SET label = N'معاش — الدار' WHERE code = '02';
UPDATE dbo.AppServices SET label = N'أبناء — الدار' WHERE code = '03';
UPDATE dbo.AppServices SET label = N'مدنيون — الدار' WHERE code = '04';
GO

UPDATE dbo.AppFeeSchedule
SET is_active = 0,
    valid_until = CASE WHEN valid_until IS NULL THEN CAST(GETDATE() AS date) ELSE valid_until END
WHERE is_active = 1
  AND (
    label LIKE N'%STAGING%'
    OR label LIKE N'%NOT OFFICIAL%'
    OR label LIKE N'%ندو%'
    OR label LIKE N'%الندى%'
    OR created_by IN ('staging-seed', 'test-suite')
  );
GO

;WITH src AS (
  SELECT
    sc.service_code,
    tt.target_type,
    NULLIF(LTRIM(RTRIM(p.Cat)), '') AS tier_cat,
    NULLIF(LTRIM(RTRIM(p.Jop)), '') AS tier_jop,
    v.price_kind,
    v.label,
    v.amount
  FROM dbo.PriceList p
  CROSS APPLY (
    SELECT CASE
      WHEN LTRIM(RTRIM(p.IdPrice)) IN ('01','02','03','04') THEN LTRIM(RTRIM(p.IdPrice))
      WHEN LTRIM(RTRIM(p.IdPrice)) IN ('1','2','3','4') THEN '0' + LTRIM(RTRIM(p.IdPrice))
      ELSE '01'
    END AS service_code
  ) sc
  CROSS APPLY (SELECT x.target_type FROM (VALUES ('MAIN'), ('DEPENDENT')) AS x(target_type)) tt
  CROSS APPLY (
    SELECT 'RENEWAL' AS price_kind, N'تجديد الدار' AS label,
      TRY_CAST(REPLACE(REPLACE(LTRIM(RTRIM(p.RDar)), ',', '.'), N'ج.م', '') AS decimal(14,2)) AS amount
    WHERE TRY_CAST(REPLACE(REPLACE(LTRIM(RTRIM(p.RDar)), ',', '.'), N'ج.م', '') AS decimal(14,2)) IS NOT NULL
    UNION ALL
    SELECT 'MEMBERSHIP_FEE', N'رسوم الدار',
      TRY_CAST(REPLACE(REPLACE(LTRIM(RTRIM(p.FDar)), ',', '.'), N'ج.م', '') AS decimal(14,2))
    WHERE TRY_CAST(REPLACE(REPLACE(LTRIM(RTRIM(p.FDar)), ',', '.'), N'ج.م', '') AS decimal(14,2)) IS NOT NULL
  ) v
)
INSERT dbo.AppFeeSchedule(service_code, target_type, tier_cat, tier_jop, price_kind, label, amount, valid_from, valid_until, is_active, created_by)
SELECT s.service_code, s.target_type, s.tier_cat, s.tier_jop, s.price_kind, s.label, s.amount, '20200101', NULL, 1, 'pricelist-import'
FROM src s
WHERE s.amount >= 0
  AND NOT EXISTS (
    SELECT 1 FROM dbo.AppFeeSchedule x
    WHERE x.is_active = 1
      AND x.service_code = s.service_code
      AND x.target_type = s.target_type
      AND x.price_kind = s.price_kind
      AND ISNULL(x.tier_cat, '') = ISNULL(s.tier_cat, '')
      AND ISNULL(x.tier_jop, '') = ISNULL(s.tier_jop, '')
  );
GO