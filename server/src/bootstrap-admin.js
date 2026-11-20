import 'dotenv/config';
import {pool,run,one} from './db.js';
import bcrypt from 'bcryptjs';

/** Default demo/admin password: digits 1–8 in order. Override with BOOTSTRAP_PASSWORD. */
export const DEFAULT_ADMIN_PASSWORD='12345678';

const username=process.argv[2]||'admin';
const password=process.env.BOOTSTRAP_PASSWORD||DEFAULT_ADMIN_PASSWORD;
if(password.length<8)throw new Error('Password must be >= 8 chars');
const hash=await bcrypt.hash(password,12);
const existing=await one('SELECT username FROM dbo.AppUsers WHERE username=@username',{username});
if(existing){
 await run('UPDATE dbo.AppUsers SET password_hash=@hash,role=\'admin\',enabled=1 WHERE username=@username',{username,hash});
 console.log('Updated administrator password. Username:',username,'Password:',password);
}else{
 await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@username,@hash,\'admin\',1)',{username,hash});
 console.log('Created initial administrator. Username:',username,'Password:',password);
}
(await pool()).close();
