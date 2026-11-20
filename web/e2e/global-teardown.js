import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {removeAuth} from './cleanup.js';
const authPath=path.resolve(import.meta.dirname,'auth.json');
export default async function(){
  if(!fs.existsSync(authPath)) return;
  const auth=JSON.parse(fs.readFileSync(authPath,'utf8'));
  const serverDir=path.resolve(import.meta.dirname,'../../server');
  process.chdir(serverDir);
  const {run,pool}=await import(pathToFileURL(path.join(serverDir,'src/db.js')).href);
  await removeAuth(run, auth);
  fs.unlinkSync(authPath);
  await (await pool()).close();
}
