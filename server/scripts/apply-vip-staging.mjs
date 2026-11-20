import 'dotenv/config';
import {one, run, pool} from '../src/db.js';
const db=await one('SELECT DB_NAME() AS name');
if(db.name!=='Subscriptions_Staging') throw new Error('refusing unexpected database: '+db.name);
await run(`IF COL_LENGTH('dbo.AppClientFlags','is_vip') IS NULL
  ALTER TABLE dbo.AppClientFlags ADD is_vip bit NOT NULL CONSTRAINT DF_AppClientFlags_vip DEFAULT 0`);
await run(`IF COL_LENGTH('dbo.AppClientFlags','vip_job') IS NULL
  ALTER TABLE dbo.AppClientFlags ADD vip_job nvarchar(50) NULL`);
const col=await one(`SELECT COL_LENGTH('dbo.AppClientFlags','is_vip') AS is_vip_n, COL_LENGTH('dbo.AppClientFlags','vip_job') AS vip_job_n`);
console.log(JSON.stringify({db:db.name, is_vip_col:Number(col.is_vip_n), vip_job_col:Number(col.vip_job_n)}));
await (await pool()).close();
