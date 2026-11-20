import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {removeAuth} from './cleanup.js';
const serverDir=path.resolve(import.meta.dirname,'../../server');
const authPath=path.resolve(import.meta.dirname,'auth.json');
async function db(){
  process.chdir(serverDir);
  const api=await import(pathToFileURL(path.join(serverDir,'src/db.js')).href);
  return api;
}
export default async function(){
  const {one,run}=await db();
  const bcrypt=(await import(pathToFileURL(path.join(serverDir,'node_modules/bcryptjs/index.js')).href)).default;
  const current=await one('SELECT DB_NAME() AS name');
  if(current.name!=='Subscriptions_Staging') throw new Error('E2E refuses non-staging database');
  if(fs.existsSync(authPath)){
    await removeAuth(run, JSON.parse(fs.readFileSync(authPath,'utf8')));
    fs.unlinkSync(authPath);
  }
  await run(`DELETE u FROM dbo.AppUsers u WHERE u.username LIKE 'e2e%' AND LEN(u.username)=11 AND NOT EXISTS (SELECT 1 FROM dbo.Client c WHERE c.Admin=u.username)`);
  const username='e2e'+crypto.randomBytes(4).toString('hex');
  const password='E2e-'+crypto.randomBytes(8).toString('hex')+'Aa1';
  const n=Number(String(Date.now()).slice(-7));
  const clientId='TEST-E2E'+n;
  const name='عضو واجهة '+n;
  const hash=await bcrypt.hash(password,4);
  await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@username,@hash,\'admin\',1)',{username,hash});
  await run('INSERT dbo.Client(IdClient,id,Name,IdCard,age,Admin,CreateOn) VALUES(@idClient,@id,@name,@card,\'1981-01-01\',@username,GETDATE())',{idClient:clientId,id:910000000+n,name,card:'E'+n,username});
  fs.writeFileSync(authPath, JSON.stringify({username,password,clientId,name}));
}
