/* Optional AppFeeSchedule seed when empty. Renewals quote تجديد الدار from dbo.PriceList.RDar
   (pricing module list: Cat / Jop / IdPrice / FDar / RDar) — do not seed Cat-only PriceList bridges. */
USE [Subscriptions_Staging];
-- USE [Subscriptions];
GO
IF DB_NAME() <> N'Subscriptions_Staging'
  THROW 50003, 'Fee seed is staging-only', 1;
IF OBJECT_ID('dbo.AppFeeSchedule','U') IS NULL
  THROW 50003, 'AppFeeSchedule missing; run additive migration on staging first', 1;

DECLARE @fees TABLE(service_code char(2), target_type varchar(12), amount decimal(14,2));
INSERT @fees VALUES
 ('01','MAIN',10.00),('01','DEPENDENT',11.00),
 ('02','MAIN',12.00),('02','DEPENDENT',13.00),
 ('03','MAIN',14.00),('03','DEPENDENT',15.00),
 ('04','MAIN',16.00),('04','DEPENDENT',17.00);

INSERT dbo.AppFeeSchedule(service_code,target_type,label,amount,valid_from,valid_until,is_active,created_by)
SELECT f.service_code,f.target_type,N'تجديد الدار',f.amount,'20200101',NULL,1,'system'
FROM @fees f
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.AppFeeSchedule x
  WHERE x.service_code=f.service_code AND x.target_type=f.target_type AND x.is_active=1
);
