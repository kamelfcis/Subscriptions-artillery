/* Staging: clear RElnada copied from RDar (lost card must use dedicated column or default). */
UPDATE dbo.PriceList
SET RElnada = NULL
WHERE RElnada IS NOT NULL
  AND LTRIM(RTRIM(ISNULL(RElnada, N''))) <> N''
  AND LTRIM(RTRIM(ISNULL(RDar, N''))) <> N''
  AND LTRIM(RTRIM(RElnada)) = LTRIM(RTRIM(RDar));
GO