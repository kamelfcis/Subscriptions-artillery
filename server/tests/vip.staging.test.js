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
const username='vip'+crypto.randomBytes(4).toString('hex');
const stamp=String(Date.now()).slice(-8);
const clients=[];
let server, base;

function track(id){if(id&&!clients.includes(id))clients.push(id);return id;}

function jarClient(){
  const jar=new Map();
  return async function call(url,{method='GET',body}={}){
    const headers={'X-Correlation-Id':'vip-staging'};
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
  await run('DELETE FROM dbo.AppAudit WHERE actor=@user',{user:username});
  await run('DELETE FROM dbo.AppUsers WHERE username=@user',{user:username});
}

test('VIP flag, in-law relations, and free family quote on Subscriptions_Staging only', async()=>{
  const db=await one('SELECT DB_NAME() AS name');
  assert.equal(db.name, 'Subscriptions_Staging');
  await run(`IF COL_LENGTH('dbo.AppClientFlags','is_vip') IS NULL
    ALTER TABLE dbo.AppClientFlags ADD is_vip bit NOT NULL CONSTRAINT DF_AppClientFlags_vip DEFAULT 0`);
  await run(`IF COL_LENGTH('dbo.AppClientFlags','vip_job') IS NULL
    ALTER TABLE dbo.AppClientFlags ADD vip_job nvarchar(50) NULL`);

  const hash=await bcrypt.hash(password, 4);
  await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@username,@hash,@role,1)',{username,hash,role:'admin'});
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening', resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const call=jarClient();

  try{
    const login=await call('/api/auth/login',{method:'POST',body:{username,password}});
    assert.equal(login.status, 200, JSON.stringify(login.data));

    const vipCat='VIP-NO-PRICE-'+stamp;
    const created=await call('/api/members',{method:'POST',body:{
      membership_class:'01',
      Name:'VIP اختبار '+stamp,
      IdCard:'V'+stamp,
      Cat:vipCat,
      age:'1978-05-05',
      jop:'رائد',
      State:'خدمة',
      alive:'نعم',
      vip:true,
      vip_job:'مدير إدارة',
    }});
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const vipId=track(created.data.IdClient);

    const got=await call('/api/members/'+encodeURIComponent(vipId));
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(Boolean(got.data.is_vip), true);
    assert.equal(got.data.vip_job, 'مدير إدارة');
    assert.equal(got.data.jop, 'رائد');
    const flagRow=await one('SELECT is_vip, vip_job FROM dbo.AppClientFlags WHERE client_id=@id',{id:vipId});
    assert.equal(Boolean(flagRow?.is_vip), true);
    assert.equal(flagRow?.vip_job, 'مدير إدارة');
    const onAudit=await one(`SELECT TOP 1 action FROM dbo.AppAudit WHERE actor=@user AND entity_id=@id AND action='VIP_ON' ORDER BY id DESC`,{user:username,id:vipId});
    assert.equal(onAudit?.action, 'VIP_ON');

    const inlaw=await call('/api/members/'+encodeURIComponent(vipId)+'/dependents',{method:'POST',body:{Name:'صهر اختبار '+stamp,realation:'زوج الابنة',age:'1995-01-01'}});
    assert.equal(inlaw.status, 201, JSON.stringify(inlaw.data));

    const end=new Date();end.setUTCFullYear(end.getUTCFullYear()+1);
    const term=end.toISOString().slice(0,10);
    const quote=await call('/api/renewals/quote',{method:'POST',body:{client_id:vipId,service_code:'01',term_to:term}});
    assert.equal(quote.status, 200, JSON.stringify(quote.data));
    assert.notEqual(quote.data.error, 'FEE_NOT_CONFIGURED');
    assert.equal(Number(quote.data.amount_due), 0);
    assert.match(String(quote.data.fee_label), /VIP/);

    const renewed=await call('/api/renewals',{method:'POST',body:{client_id:vipId,service_code:'01',term_to:term,request_key:crypto.randomUUID(),amount_paid:0}});
    assert.equal(renewed.status, 201, JSON.stringify(renewed.data));
    assert.equal(renewed.data.status, 'ACTIVE');

    const depQuote=await call('/api/renewals/quote',{method:'POST',body:{client_id:vipId,dependent_id:inlaw.data.id,service_code:'01',term_to:term}});
    assert.equal(depQuote.status, 200, JSON.stringify(depQuote.data));
    assert.equal(Number(depQuote.data.amount_due), 0);
    assert.match(String(depQuote.data.fee_label), /VIP/);

    const jobPatch=await call('/api/members/'+encodeURIComponent(vipId),{method:'PATCH',body:{vip_job:'مستشار'}});
    assert.equal(jobPatch.status, 200, JSON.stringify(jobPatch.data));
    const afterJob=await call('/api/members/'+encodeURIComponent(vipId));
    assert.equal(afterJob.data.vip_job, 'مستشار');
    assert.equal(afterJob.data.jop, 'رائد');

    const off=await call('/api/members/'+encodeURIComponent(vipId),{method:'PATCH',body:{is_vip:false}});
    assert.equal(off.status, 200, JSON.stringify(off.data));
    const afterOff=await call('/api/members/'+encodeURIComponent(vipId));
    assert.equal(Boolean(afterOff.data.is_vip), false);
    assert.equal(afterOff.data.vip_job, 'مستشار');
    const keptJob=await one('SELECT vip_job, is_vip FROM dbo.AppClientFlags WHERE client_id=@id',{id:vipId});
    assert.equal(keptJob?.vip_job, 'مستشار');
    assert.equal(Boolean(keptJob?.is_vip), false);
    const offAudit=await one(`SELECT TOP 1 action FROM dbo.AppAudit WHERE actor=@user AND entity_id=@id AND action='VIP_OFF' ORDER BY id DESC`,{user:username,id:vipId});
    assert.equal(offAudit?.action, 'VIP_OFF');

    const regular=await call('/api/members',{method:'POST',body:{
      membership_class:'01',
      Name:'عادي اختبار '+stamp,
      IdCard:'N'+stamp,
      Cat:'TEST-SUITE-PRICE',
      age:'1981-06-06',
      jop:'رائد',
      State:'خدمة',
      alive:'نعم',
    }});
    assert.equal(regular.status, 201, JSON.stringify(regular.data));
    const regularId=track(regular.data.IdClient);
    const regularGot=await call('/api/members/'+encodeURIComponent(regularId));
    assert.equal(Boolean(regularGot.data.is_vip), false);
    const denied=await call('/api/members/'+encodeURIComponent(regularId)+'/dependents',{method:'POST',body:{Name:'صهر مرفوض '+stamp,realation:'زوجة الابن',age:'1996-02-02'}});
    assert.equal(denied.status, 409, JSON.stringify(denied.data));
    assert.equal(denied.data.error, 'VIP_RELATION_REQUIRED');
  }finally{
    await cleanup();
    await new Promise(resolve=>server.close(resolve));
    try{await (await pool()).close();}catch{}
  }
});
