import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {sql} from '../src/db.js';
const windows=(process.env.SQL_AUTH||'windows')==='windows';
const serverName=process.env.SQL_SERVER+(process.env.SQL_INSTANCE?'\\'+process.env.SQL_INSTANCE:'');
const encrypt=process.env.SQL_ENCRYPT!=='false';
const trust=process.env.SQL_TRUST_CERT==='true';
const database=process.env.SQL_DATABASE||'Subscriptions';
const odbc=process.env.SQL_ODBC_DRIVER||'ODBC Driver 18 for SQL Server';
const yesNo=v=>v?'Yes':'No';
const config=windows?{
  server:serverName,database,driver:odbc,
  connectionString:`Driver={${odbc}};Server=${serverName};Database=${database};Trusted_Connection=Yes;Encrypt=${yesNo(encrypt)};TrustServerCertificate=${yesNo(trust)};`,
  options:{trustedConnection:true,encrypt,trustServerCertificate:trust},
  requestTimeout:0,connectionTimeout:20000
}:{
  server:serverName,database,user:process.env.SQL_USER,password:process.env.SQL_PASSWORD,
  options:{encrypt,trustServerCertificate:trust},requestTimeout:0,connectionTimeout:20000
};
const p=await new sql.ConnectionPool(config).connect();
const db=(await new sql.Request(p).query('SELECT DB_NAME() AS name')).recordset[0];
if(db.name!=='Subscriptions_Staging'){console.error('REFUSING', db.name);process.exit(2);}
const directory=process.env.SQL_BACKUP_DIR||'D:\\SubscriptionsBackups';
fs.mkdirSync(directory,{recursive:true});
const existing=fs.readdirSync(directory).filter(n=>n.startsWith('Subscriptions_Staging_COPYONLY_')&&n.endsWith('.bak')).map(n=>({n,t:fs.statSync(path.win32.join(directory,n)).mtimeMs,size:fs.statSync(path.win32.join(directory,n)).size})).sort((a,b)=>b.t-a.t)[0];
const reuse=existing&&Date.now()-existing.t<60*60*1000&&existing.size>0;
const bak=reuse?path.win32.join(directory, existing.n):path.win32.join(directory, `Subscriptions_Staging_COPYONLY_${new Date().toISOString().replace(/[:.]/g,'-')}.bak`);
const mdf=path.win32.join(directory, 'Subscriptions_RestoreTest.mdf');
const ldf=path.win32.join(directory, 'Subscriptions_RestoreTest.ldf');
async function exec(text, params={}){
  const req=new sql.Request(p);
  for(const [k,v] of Object.entries(params)) req.input(k, v);
  return req.query(text);
}
const evidence={database:db.name, backup:bak, reused:Boolean(reuse), steps:[]};
try{
  if(!reuse){
    const t=performance.now();
    await exec(`BACKUP DATABASE [Subscriptions_Staging] TO DISK=@path WITH COPY_ONLY, INIT, CHECKSUM, STATS=10`,{path:bak});
    evidence.steps.push({step:'COPY_ONLY', ms:Math.round(performance.now()-t)});
  }else evidence.steps.push({step:'COPY_ONLY', reused:true, bytes:existing.size});
  const v=performance.now();
  await exec(`RESTORE VERIFYONLY FROM DISK=@path WITH CHECKSUM`,{path:bak});
  evidence.steps.push({step:'VERIFYONLY', ms:Math.round(performance.now()-v)});
  const files=(await exec(`RESTORE FILELISTONLY FROM DISK=@path`,{path:bak})).recordset;
  const data=files.find(f=>f.Type==='D');
  const log=files.find(f=>f.Type==='L');
  if(!data||!log) throw new Error('backup file list missing data or log');
  await exec(`IF DB_ID(N'Subscriptions_RestoreTest') IS NOT NULL BEGIN ALTER DATABASE [Subscriptions_RestoreTest] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [Subscriptions_RestoreTest]; END`);
  const r=performance.now();
  const quote=s=>String(s).replaceAll("'","''");
  await exec(`RESTORE DATABASE [Subscriptions_RestoreTest] FROM DISK=@path WITH REPLACE, RECOVERY, MOVE N'${quote(data.LogicalName)}' TO @mdf, MOVE N'${quote(log.LogicalName)}' TO @ldf`,{path:bak,mdf,ldf});
  const check=(await exec(`SELECT COUNT(*) n FROM [Subscriptions_RestoreTest].sys.tables WHERE name=N'Client'`)).recordset[0];
  evidence.steps.push({step:'RESTORE', ms:Math.round(performance.now()-r), clientTable:Number(check?.n||0)});
  await exec(`ALTER DATABASE [Subscriptions_RestoreTest] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [Subscriptions_RestoreTest];`);
  const gone=(await exec(`SELECT DB_ID(N'Subscriptions_RestoreTest') AS id`)).recordset[0];
  evidence.steps.push({step:'DROP', dropped:gone?.id==null});
  evidence.ok=evidence.steps.every(s=>s.step!=='RESTORE'||s.clientTable===1)&&evidence.steps.at(-1).dropped===true;
  console.log(JSON.stringify(evidence));
  process.exitCode=evidence.ok?0:1;
}catch(e){
  evidence.ok=false;
  evidence.error=e.originalError?.message||e.message;
  console.log(JSON.stringify(evidence));
  try{await exec(`IF DB_ID(N'Subscriptions_RestoreTest') IS NOT NULL BEGIN ALTER DATABASE [Subscriptions_RestoreTest] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [Subscriptions_RestoreTest]; END`);}catch{}
  process.exitCode=1;
}finally{
  try{await p.close();}catch{}
}
