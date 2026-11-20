import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

if(process.env.SQL_DATABASE!=='Subscriptions_Staging'){
  throw new Error('Integration tests refuse to run unless SQL_DATABASE=Subscriptions_Staging');
}
process.env.NODE_APP_LISTEN='false';
process.env.SERVE_WEB='false';

const {app}=await import('../src/index.js');
const {one, run, pool}=await import('../src/db.js');

const password='Staging-'+crypto.randomBytes(9).toString('hex')+'Aa1';
const username='sp'+crypto.randomBytes(4).toString('hex');
const stamp=String(Date.now()).slice(-8);
const clients=[];
let server, base, shiftId;

function track(id){if(id&&!clients.includes(id))clients.push(id);return id;}

function jarClient(){
  const jar=new Map();
  return async function call(url,{method='GET',body}={}){
    const headers={'X-Correlation-Id':'spouse-staging'};
    const cookie=[...jar.entries()].map(([k,v])=>`${k}=${v}`).join('; ');
    if(cookie) headers.Cookie=cookie;
    if(method!=='GET'&&method!=='HEAD') headers['X-CSRF-Token']=decodeURIComponent(jar.get('csrf')||'');
    if(body!==undefined) headers['Content-Type']='application/json';
    const res=await fetch(base+url,{method,headers,body:body!==undefined?JSON.stringify(body):undefined});
    const setCookies=typeof res.headers.getSetCookie==='function'?res.headers.getSetCookie():[];
    for(const line of setCookies){const pair=line.split(';')[0];const i=pair.indexOf('=');if(i>0)jar.set(pair.slice(0,i).trim(), pair.slice(i+1).trim());}
    const text=await res.text();
    let data=text;try{data=text?JSON.parse(text):null;}catch{}
    if(data&&typeof data==='object'&&data.csrf) jar.set('csrf', data.csrf);
    return {status:res.status, data};
  };
}

async function cleanup(){
  for(const id of clients){
    await run(`DELETE p FROM dbo.AppPayments p JOIN dbo.AppRenewals r ON r.id=p.renewal_id WHERE r.client_id=@id`,{id});
    await run(`DELETE v FROM dbo.AppReversals v JOIN dbo.AppRenewals r ON r.id=v.renewal_id WHERE r.client_id=@id`,{id});
    await run(`DELETE a FROM dbo.AppRenewalAdjustments a JOIN dbo.AppRenewals r ON r.id=a.renewal_id WHERE r.client_id=@id`,{id});
    await run(`DELETE FROM dbo.AppRenewals WHERE client_id=@id`,{id});
    await run(`DELETE FROM dbo.AppCardJobs WHERE client_id=@id`,{id});
    await run(`DELETE FROM dbo.AppExemptions WHERE client_id=@id`,{id});
    await run(`DELETE e FROM dbo.AppEligibility e JOIN dbo.SubClient s ON s.id=e.dependent_id WHERE s.IdClient=@id`,{id});
    await run(`DELETE g FROM dbo.AppDependentFlags g JOIN dbo.SubClient s ON s.id=g.dependent_id WHERE s.IdClient=@id`,{id});
    await run(`DELETE FROM dbo.SubClient WHERE IdClient=@id`,{id});
    await run(`DELETE FROM dbo.AppClientFlags WHERE client_id=@id`,{id});
    await run(`DELETE FROM dbo.Client WHERE IdClient=@id`,{id});
  }
  if(shiftId) await run('DELETE FROM dbo.AppShifts WHERE id=@id',{id:shiftId});
  await run('DELETE FROM dbo.AppAudit WHERE actor=@user',{user:username});
  await run('DELETE FROM dbo.AppUsers WHERE username=@user',{user:username});
}

test('حرمه spouse quote is free without eligibility on Subscriptions_Staging only', async()=>{
  const db=await one('SELECT DB_NAME() AS name');
  assert.equal(db.name, 'Subscriptions_Staging');
  await run(
    `IF NOT EXISTS (SELECT 1 FROM dbo.PriceList WHERE Cat=@cat AND IdPrice=N'01')
     INSERT dbo.PriceList(Cat,Jop,IdPrice,FDar,RDar) VALUES (@cat,NULL,N'01',NULL,N'10')`,
    {cat:'TEST-SUITE-PRICE'},
  );

  const hash=await bcrypt.hash(password, 4);
  await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@username,@hash,@role,1)',{username,hash,role:'admin'});
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening', resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const call=jarClient();

  try{
    const login=await call('/api/auth/login',{method:'POST',body:{username,password}});
    assert.equal(login.status, 200, JSON.stringify(login.data));

    const created=await call('/api/members',{method:'POST',body:{
      membership_class:'04',
      Name:'زوج اختبار '+stamp,
      IdCard:'S'+stamp,
      Cat:'TEST-SUITE-PRICE',
      age:'1978-05-05',
    }});
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const clientId=track(created.data.IdClient);
    assert.match(clientId, /^04-\d+$/);

    const shift=await call('/api/shifts',{method:'POST',body:{opening_float:0}});
    assert.equal(shift.status, 201, JSON.stringify(shift.data));
    shiftId=shift.data.id;

    const end=new Date();end.setUTCFullYear(end.getUTCFullYear()+1);
    const term=end.toISOString().slice(0,10);
    const parent=await call('/api/renewals',{method:'POST',body:{
      client_id:clientId,service_code:'01',term_to:term,request_key:crypto.randomUUID(),
      amount_paid:10,method:'CASH',shift_id:shiftId,payment_reference:'spouse-parent',
    }});
    assert.equal(parent.status, 201, JSON.stringify(parent.data));
    assert.equal(parent.data.status, 'ACTIVE');

    const wife=await call('/api/members/'+encodeURIComponent(clientId)+'/dependents',{method:'POST',body:{
      Name:'مريم اختبار '+stamp,realation:'حرمه',age:'1982-01-01',
    }});
    assert.equal(wife.status, 201, JSON.stringify(wife.data));
    const elig=await one('SELECT dependent_id FROM dbo.AppEligibility WHERE dependent_id=@dep',{dep:wife.data.id});
    assert.equal(elig, null);

    const quote=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,dependent_id:wife.data.id,service_code:'04',term_to:term,
    }});
    assert.equal(quote.status, 200, JSON.stringify(quote.data));
    assert.notEqual(quote.data.error, 'DEPENDENT_KIND_REQUIRED');
    assert.equal(Number(quote.data.amount_due), 0);
    assert.match(String(quote.data.fee_label), /زوجة/);
    assert.equal(quote.data.price_list_id, null);
    assert.equal(quote.data.service_code, '04');

    const live=await one(`SELECT TOP 1 s.id dep FROM dbo.SubClient s WHERE s.IdClient=N'04-1288' AND REPLACE(ISNULL(s.realation,N''),N' ',N'') LIKE N'%حرمه%'`);
    if(live){
      const parentEnd=await one(`SELECT CONVERT(varchar(10), MAX(end_date), 23) last_date FROM (
        SELECT MAX(todate) end_date FROM dbo.subscriptioninf WHERE clientid=N'04-1288' AND (active IS NULL OR active NOT IN (N'لا',N'0'))
        UNION ALL SELECT MAX(term_to) end_date FROM dbo.AppRenewals WHERE client_id=N'04-1288' AND status='ACTIVE' AND dependent_id IS NULL
      ) x`);
      const liveTerm=parentEnd?.last_date||term;
      const liveQuote=await call('/api/renewals/quote',{method:'POST',body:{
        client_id:'04-1288',dependent_id:live.dep,service_code:'04',term_to:liveTerm,
      }});
      assert.equal(liveQuote.status, 200, JSON.stringify(liveQuote.data));
      assert.notEqual(liveQuote.data.error, 'DEPENDENT_KIND_REQUIRED');
      assert.equal(Number(liveQuote.data.amount_due), 0);
    }
  }finally{
    await cleanup();
    await new Promise(resolve=>server.close(resolve));
    try{await (await pool()).close();}catch{}
  }
});
