/* Read-only signature histogram on Subscriptions_Staging — sampled by id, not full table scan */
SET NOCOUNT ON;
DECLARE @n int = 500;

WITH clientS AS (
  SELECT 'Client.PicPath' AS src,
    CASE WHEN PicPath IS NULL THEN 'NULL'
         WHEN DATALENGTH(PicPath) < 8 THEN 'SHORT'
         ELSE CONVERT(varchar(16), CAST(SUBSTRING(PicPath, 1, 8) AS varbinary(8)), 2) END AS sig,
    DATALENGTH(PicPath) AS ln
  FROM dbo.Client c
  WHERE c.id IN (
    SELECT TOP (@n) id FROM dbo.Client WHERE PicPath IS NOT NULL ORDER BY id ASC
    UNION
    SELECT TOP (@n) id FROM dbo.Client WHERE PicPath IS NOT NULL ORDER BY id DESC
  )
),
depS AS (
  SELECT 'SubClient.PicPath' AS src,
    CASE WHEN PicPath IS NULL THEN 'NULL'
         WHEN DATALENGTH(PicPath) < 8 THEN 'SHORT'
         ELSE CONVERT(varchar(16), CAST(SUBSTRING(PicPath, 1, 8) AS varbinary(8)), 2) END AS sig,
    DATALENGTH(PicPath) AS ln
  FROM dbo.SubClient s
  WHERE s.id IN (
    SELECT TOP (@n) id FROM dbo.SubClient WHERE PicPath IS NOT NULL ORDER BY id ASC
    UNION
    SELECT TOP (@n) id FROM dbo.SubClient WHERE PicPath IS NOT NULL ORDER BY id DESC
  )
),
fileS AS (
  SELECT 'Files.filename' AS src,
    CASE WHEN filename IS NULL THEN 'NULL'
         WHEN DATALENGTH(filename) < 8 THEN 'SHORT'
         ELSE CONVERT(varchar(16), CAST(SUBSTRING(filename, 1, 8) AS varbinary(8)), 2) END AS sig,
    DATALENGTH(filename) AS ln
  FROM dbo.Files f
  WHERE f.id IN (
    SELECT TOP (@n) id FROM dbo.Files WHERE filename IS NOT NULL ORDER BY id ASC
    UNION
    SELECT TOP (@n) id FROM dbo.Files WHERE filename IS NOT NULL ORDER BY id DESC
  )
),
s AS (SELECT * FROM clientS UNION ALL SELECT * FROM depS UNION ALL SELECT * FROM fileS)
SELECT src, sig, COUNT_BIG(*) AS n, MIN(ln) AS min_len, MAX(ln) AS max_len
FROM s
GROUP BY src, sig
ORDER BY src, n DESC;
