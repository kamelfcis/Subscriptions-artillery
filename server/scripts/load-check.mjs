import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
if(process.env.SQL_DATABASE!=='Subscriptions_Staging'){console.error('REFUSING', process.env.SQL_DATABASE);process.exit(2);}
process.env.NODE_APP_LISTEN='false';
const {app}=await import('../src/index.js');
const {run,pool}=await import('../src/db.js');
const username='load'+crypto.randomBytes(4).toString('hex');
const password='Load-'+crypto.randomBytes(8).toString('hex')+'Aa1';
const hash=await bcrypt.hash(password,4);
await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@username,@hash,\'auditor\',1)',{username,hash});
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening', r));
const base=`http://127.0.0.1:${server.address().port}`;
function percentile(values, p){const s=[...values].sort((a,b)=>a-b);return s[Math.min(s.length-1, Math.ceil((p/100)*s.length)-1)]||0;}
try{
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
  const set=login.headers.getSetCookie?.()||[];
  const cookie=set.map(line=>line.split(';')[0]).join('; ');
  if(!login.ok) throw new Error('login failed '+login.status);
  const paths=['/api/health','/api/members?page=1&pageSize=10','/api/dashboard'];
  async function phase(concurrency, loops){
    const times=[];
    async function worker(){
      for(let i=0;i<loops;i++){
        for(const path of paths){
          const t=performance.now();
          const res=await fetch(base+path,{headers:{Cookie:cookie}});
          times.push({path,ms:performance.now()-t,status:res.status});
          await res.arrayBuffer();
        }
      }
    }
    await Promise.all(Array.from({length:concurrency}, worker));
    const summary={};
    for(const path of paths){
      const group=times.filter(x=>x.path===path);
      summary[path]={n:group.length,p95:Math.round(percentile(group.map(x=>x.ms),95)),maxStatus:Math.max(...group.map(x=>x.status))};
    }
    return summary;
  }
  const vu5=await phase(5,4);
  const vu20=await phase(20,2);
  console.log(JSON.stringify({database:'Subscriptions_Staging',vu5,vu20}));
}finally{
  await run('DELETE FROM dbo.AppAudit WHERE actor=@username',{username});
  await run('DELETE FROM dbo.AppUsers WHERE username=@username',{username});
  await new Promise(r=>server.close(r));
  try{await (await pool()).close();}catch{}
}
