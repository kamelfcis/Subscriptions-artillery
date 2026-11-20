/* RUN READ-ONLY IN SSMS on a RESTORED TEST COPY before changes.
   Does not export personal data, images, card numbers, passwords or names. */
SET NOCOUNT ON;
SELECT DB_NAME() AS [Database],@@SERVERNAME AS [Instance],GETDATE() AS [ServerTime];
SELECT t.name AS TableName,SUM(p.rows) AS ApproxRows
FROM sys.tables t
JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1)
WHERE SCHEMA_NAME(t.schema_id)='dbo'
  AND t.name IN ('Client','SubClient','Files','subscriptioninf','bill','Blocked','PriceList','tbluser','admin')
GROUP BY t.name ORDER BY t.name;
SELECT t.name AS TableName,c.name AS ColumnName,TYPE_NAME(c.user_type_id) AS DataType,
 c.max_length,c.is_nullable
FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id
WHERE SCHEMA_NAME(t.schema_id)='dbo' AND (
 (t.name='Client' AND c.name IN ('IdClient','id','PicPath','age','alive','Rfid')) OR
 (t.name='SubClient' AND c.name IN ('id','IdClient','PicPath','age','realation')) OR
 (t.name='Files' AND c.name IN ('id','clientid','filename')) OR
 (t.name='bill' AND c.name IN ('id','shiftid','money','CId')) OR
 (t.name='subscriptioninf' AND c.name IN ('clientid','todate','count','MCount','active')))
ORDER BY t.name,c.column_id;
-- Count duplicate ID card identifiers and missing DOBs. No personal information returned.
SELECT COUNT_BIG(*) AS MembersWithoutDOB FROM dbo.Client WHERE age IS NULL;
SELECT COUNT_BIG(*) AS DependentsWithoutDOB FROM dbo.SubClient WHERE age IS NULL;
SELECT COUNT_BIG(*) AS DuplicateMemberIdentities FROM (
 SELECT IdCard FROM dbo.Client WHERE IdCard IS NOT NULL AND LTRIM(RTRIM(IdCard))<>'' GROUP BY IdCard HAVING COUNT(*)>1
) d;
SELECT COUNT_BIG(*) AS NonPositiveHistoricalAmounts FROM dbo.bill WHERE money<0;
SELECT COUNT_BIG(*) AS HistRowsWithoutEndDate FROM dbo.subscriptioninf WHERE todate IS NULL;
SELECT COUNT_BIG(*) AS MemberPhotosPresent FROM dbo.Client WHERE PicPath IS NOT NULL;
SELECT COUNT_BIG(*) AS DependentPhotosPresent FROM dbo.SubClient WHERE PicPath IS NOT NULL;
SELECT COUNT_BIG(*) AS DocumentsPresent FROM dbo.Files WHERE filename IS NOT NULL;
