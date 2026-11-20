import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {sql, pool, one, run} from '../src/db.js';
const db=await one('SELECT DB_NAME() AS name');
if(db.name!=='Subscriptions_Staging'){console.error('REFUSING', db.name);process.exit(2);}
const p=await pool();
async function exec(text){
  const req=new sql.Request(p);
  req.timeout=180000;
  return req.query(text);
}
const dir=path.resolve('sql');
for(const file of ['06_unified_official_pricing.sql','04_renewal_adjustments_and_reprint.sql','05_card_template.sql','07_member_security_block.sql','08_member_vip.sql','09_member_vip_job.sql','10_lost_card_replacement.sql','11_pricelist_relnada_cleanup.sql','02_optional_index_maintenance.sql']){
  const raw=fs.readFileSync(path.join(dir,file),'utf8');
  const batches=raw.split(/^\s*GO\s*$/gim).map(s=>s.trim()).filter(s=>s&&!/^USE\s+\[/i.test(s));
  for(const batch of batches){
    if(/^USE\b/i.test(batch)) continue;
    await exec(batch);
  }
  console.log('applied', file);
}
const before=performance.now();
await run(`SELECT TOP 20 IdClient FROM dbo.Client WHERE Name LIKE N'%ا%' ORDER BY IdClient`);
console.log('name_search_ms', Math.round(performance.now()-before));
const indexes=await run(`SELECT name FROM sys.indexes WHERE name IN ('IX_Client_Name','IX_Client_IdCard','IX_SubClient_IdClient','IX_Subscription_ClientDate','IX_Blocked_IdCard')`);
console.log('indexes', indexes.recordset.map(r=>r.name).join(','));
const fees=await one(`SELECT COUNT_BIG(*) n FROM dbo.AppFeeSchedule WHERE label=N'STAGING TEST — NOT OFFICIAL'`);
console.log('staging_fees', Number(fees.n));
await p.close();
