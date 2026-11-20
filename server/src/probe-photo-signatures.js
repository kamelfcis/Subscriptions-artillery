import {pool, one, rows} from './db.js';
import {fileType} from './core.js';
// Read-only signature probe. Prints MIME counts and 4-byte headers, never row identifiers or image bodies.
const db = await one('SELECT DB_NAME() AS name');
if (db.name !== 'Subscriptions_Staging') {
  console.error('REFUSE', db.name);
  process.exitCode = 2;
} else {
  const queries = [
    ['Client.PicPath', 'SELECT TOP 25 CAST(SUBSTRING(PicPath,1,8) AS varbinary(8)) head FROM dbo.Client WHERE DATALENGTH(PicPath)>=4 ORDER BY IdClient'],
    ['SubClient.PicPath', 'SELECT TOP 25 CAST(SUBSTRING(PicPath,1,8) AS varbinary(8)) head FROM dbo.SubClient WHERE DATALENGTH(PicPath)>=4 ORDER BY id'],
    ['Files.filename', 'SELECT TOP 25 CAST(SUBSTRING(filename,1,8) AS varbinary(8)) head FROM dbo.Files WHERE filename IS NOT NULL AND DATALENGTH(filename)>=4 ORDER BY id']
  ];
  for (const [label, sql] of queries) {
    const mime = {};
    const sig = {};
    for (const row of await rows(sql)) {
      const buf = Buffer.isBuffer(row.head) ? row.head : Buffer.from(row.head);
      const kind = fileType(buf);
      mime[kind] = (mime[kind] || 0) + 1;
      const hex = buf.subarray(0, 4).toString('hex');
      sig[hex] = (sig[hex] || 0) + 1;
    }
    console.log(label, JSON.stringify({mime, sig}));
  }
}
try { (await pool()).close(); } catch {}
