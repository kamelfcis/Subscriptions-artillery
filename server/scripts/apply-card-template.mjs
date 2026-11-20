import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { sql, pool, one } from '../src/db.js';

const db = await one('SELECT DB_NAME() AS name');
if (db.name !== 'Subscriptions_Staging') {
  console.error('REFUSING', db.name);
  process.exit(2);
}
const p = await pool();
async function exec(text) {
  const req = new sql.Request(p);
  req.timeout = 180000;
  return req.query(text);
}
const raw = fs.readFileSync(path.join('sql', '05_card_template.sql'), 'utf8');
const batches = raw
  .split(/^\s*GO\s*$/gim)
  .map((s) => s.trim())
  .filter((s) => s && !/^USE\s+\[/i.test(s));
for (const batch of batches) {
  if (/^USE\b/i.test(batch)) continue;
  await exec(batch);
}
console.log('applied 05_card_template.sql');
const table = await one(
  "SELECT CASE WHEN OBJECT_ID('dbo.AppCardTemplate','U') IS NULL THEN 0 ELSE 1 END AS ok"
);
console.log(JSON.stringify({ AppCardTemplate: Boolean(table.ok) }));
await p.close();
