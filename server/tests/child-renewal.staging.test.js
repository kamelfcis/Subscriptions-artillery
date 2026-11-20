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
const username='ch'+crypto.randomBytes(4).toString('hex');
const stamp=crypto.randomBytes(4).toString('hex');
const clients=[];
let server, base, shiftId;

function track(id){if(id&&!clients.includes(id))clients.push(id);return id;}

function onDay(monthsAhead){
  const d=new Date();
  d.setUTCDate(15);
  d.setUTCMonth(d.getUTCMonth()+monthsAhead);
  return d.toISOString().slice(0,10);
}

function day(value){return String(value||'').slice(0,10);}

function jarClient(){
  const jar=new Map();
  return async function call(url,{method='GET',body}={}){
    const headers={'X-Correlation-Id':'child-fee-staging'};
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

function assertChildFee(quote){
  assert.equal(quote.status, 200, JSON.stringify(quote.data));
  assert.equal(Number(quote.data.amount_due), 50);
  assert.equal(quote.data.fee_label, 'تجديد أبناء — 50 ج.م');
  assert.equal(quote.data.price_list_id, null);
  assert.equal(quote.data.service_code, '04');
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

test('spouse quote is 0, non-VIP child or grandchild quote is 50 EGP, and a VIP family stays free', async()=>{
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
  const parentTerm=onDay(24);
  const termA=onDay(6);
  const termB=onDay(14);
  const later=onDay(20);
  const pastParent=onDay(30);

  try{
    const login=await call('/api/auth/login',{method:'POST',body:{username,password}});
    assert.equal(login.status, 200, JSON.stringify(login.data));

    const created=await call('/api/members',{method:'POST',body:{
      membership_class:'04',
      Name:'أساسي أبناء '+stamp,
      IdCard:'P'+stamp,
      Cat:'TEST-SUITE-PRICE',
      age:'1980-05-05',
    }});
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const clientId=track(created.data.IdClient);

    const wife=await call('/api/members/'+encodeURIComponent(clientId)+'/dependents',{method:'POST',body:{
      Name:'حرمه اختبار '+stamp,realation:'حرمه',age:'1984-02-02',
    }});
    assert.equal(wife.status, 201, JSON.stringify(wife.data));
    const son=await call('/api/members/'+encodeURIComponent(clientId)+'/dependents',{method:'POST',body:{
      Name:'ابن أول '+stamp,realation:'ابن',age:'2020-01-15',
    }});
    assert.equal(son.status, 201, JSON.stringify(son.data));
    const daughter=await call('/api/members/'+encodeURIComponent(clientId)+'/dependents',{method:'POST',body:{
      Name:'ابنة ثانية '+stamp,realation:'ابنة',age:'2021-03-03',
    }});
    assert.equal(daughter.status, 201, JSON.stringify(daughter.data));
    const grandchild=await call('/api/members/'+encodeURIComponent(clientId)+'/dependents',{method:'POST',body:{
      Name:'حفيد اختبار '+stamp,realation:'حفيد',age:'2022-06-06',
    }});
    assert.equal(grandchild.status, 201, JSON.stringify(grandchild.data));

    const beforeParent=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,dependent_id:son.data.id,service_code:'04',term_to:termA,
    }});
    assert.equal(beforeParent.status, 409, JSON.stringify(beforeParent.data));
    assert.equal(beforeParent.data.error, 'PARENT_NOT_ACTIVE');

    const shift=await call('/api/shifts',{method:'POST',body:{opening_float:0}});
    assert.equal(shift.status, 201, JSON.stringify(shift.data));
    shiftId=shift.data.id;
    const parent=await call('/api/renewals',{method:'POST',body:{
      client_id:clientId,service_code:'01',term_to:parentTerm,request_key:crypto.randomUUID(),
      amount_paid:10,method:'CASH',shift_id:shiftId,payment_reference:'child-fee-parent',
    }});
    assert.equal(parent.status, 201, JSON.stringify(parent.data));
    assert.equal(parent.data.status, 'ACTIVE');

    const spouse=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,dependent_id:wife.data.id,service_code:'04',term_to:parentTerm,
    }});
    assert.equal(spouse.status, 200, JSON.stringify(spouse.data));
    assert.equal(Number(spouse.data.amount_due), 0);
    assert.match(String(spouse.data.fee_label), /زوجة/);
    assert.equal(spouse.data.price_list_id, null);

    const childOnParentService=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,dependent_id:son.data.id,service_code:'04',term_to:termA,
    }});
    assertChildFee(childOnParentService);

    const primaryOn03=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,service_code:'03',term_to:termA,
    }});
    assert.equal(primaryOn03.status, 409, JSON.stringify(primaryOn03.data));
    assert.equal(primaryOn03.data.error, 'WRONG_SERVICE');

    const quoteA=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,dependent_id:son.data.id,service_code:'04',term_to:termA,
    }});
    assertChildFee(quoteA);
    assert.equal(Boolean(quoteA.data.is_vip), false);
    const quoteB=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,dependent_id:daughter.data.id,service_code:'04',term_to:termB,
    }});
    assertChildFee(quoteB);
    assert.equal(day(quoteA.data.term_from), day(quoteB.data.term_from));
    assert.notEqual(day(quoteA.data.term_to), day(quoteB.data.term_to));

    const grand=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,dependent_id:grandchild.data.id,service_code:'04',term_to:parentTerm,
    }});
    assertChildFee(grand);

    const tooFar=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,dependent_id:son.data.id,service_code:'04',term_to:pastParent,
    }});
    assert.equal(tooFar.status, 409, JSON.stringify(tooFar.data));
    assert.equal(tooFar.data.error, 'DEPENDENT_AFTER_PARENT');

    const renewA=await call('/api/renewals',{method:'POST',body:{
      client_id:clientId,dependent_id:son.data.id,service_code:'04',term_to:termA,request_key:crypto.randomUUID(),
      amount_paid:50,method:'CASH',shift_id:shiftId,payment_reference:'child-a',
    }});
    assert.equal(renewA.status, 201, JSON.stringify(renewA.data));
    assert.equal(renewA.data.status, 'ACTIVE');
    const renewB=await call('/api/renewals',{method:'POST',body:{
      client_id:clientId,dependent_id:daughter.data.id,service_code:'04',term_to:termB,request_key:crypto.randomUUID(),
      amount_paid:50,method:'CASH',shift_id:shiftId,payment_reference:'child-b',
    }});
    assert.equal(renewB.status, 201, JSON.stringify(renewB.data));
    assert.equal(renewB.data.status, 'ACTIVE');

    const nextA=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,dependent_id:son.data.id,service_code:'04',term_to:later,
    }});
    const nextB=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:clientId,dependent_id:daughter.data.id,service_code:'04',term_to:later,
    }});
    assertChildFee(nextA);
    assertChildFee(nextB);
    assert.notEqual(day(nextA.data.term_from), day(nextB.data.term_from));
    assert.ok(day(nextA.data.term_from)>day(quoteA.data.term_to));
    assert.ok(day(nextB.data.term_from)>day(quoteB.data.term_to));
    assert.ok(day(nextA.data.term_from)<day(nextB.data.term_from));

    const vip=await call('/api/members',{method:'POST',body:{
      membership_class:'04',
      Name:'VIP أبناء '+stamp,
      IdCard:'V'+stamp,
      Cat:'VIP-NO-PRICE-'+stamp,
      age:'1976-04-04',
      vip:true,
    }});
    assert.equal(vip.status, 201, JSON.stringify(vip.data));
    const vipId=track(vip.data.IdClient);
    const vipPrimary=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:vipId,service_code:'04',term_to:parentTerm,
    }});
    assert.equal(vipPrimary.status, 200, JSON.stringify(vipPrimary.data));
    assert.equal(Number(vipPrimary.data.amount_due), 0);
    assert.match(String(vipPrimary.data.fee_label), /VIP/);
    const vipRenew=await call('/api/renewals',{method:'POST',body:{
      client_id:vipId,service_code:'04',term_to:parentTerm,request_key:crypto.randomUUID(),amount_paid:0,
    }});
    assert.equal(vipRenew.status, 201, JSON.stringify(vipRenew.data));
    assert.equal(vipRenew.data.status, 'ACTIVE');

    const vipWife=await call('/api/members/'+encodeURIComponent(vipId)+'/dependents',{method:'POST',body:{
      Name:'حرمه VIP '+stamp,realation:'حرمه',age:'1981-01-01',
    }});
    assert.equal(vipWife.status, 201, JSON.stringify(vipWife.data));
    const vipSpouse=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:vipId,dependent_id:vipWife.data.id,service_code:'04',term_to:parentTerm,
    }});
    assert.equal(vipSpouse.status, 200, JSON.stringify(vipSpouse.data));
    assert.equal(Number(vipSpouse.data.amount_due), 0);

    const inlaw=await call('/api/members/'+encodeURIComponent(vipId)+'/dependents',{method:'POST',body:{
      Name:'صهر VIP '+stamp,realation:'زوج الابنة',age:'1998-08-08',
    }});
    assert.equal(inlaw.status, 201, JSON.stringify(inlaw.data));
    const inlawQuote=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:vipId,dependent_id:inlaw.data.id,service_code:'04',term_to:parentTerm,
    }});
    assert.equal(inlawQuote.status, 200, JSON.stringify(inlawQuote.data));
    assert.equal(Number(inlawQuote.data.amount_due), 0);
    assert.match(String(inlawQuote.data.fee_label), /VIP/);

    const vipSon=await call('/api/members/'+encodeURIComponent(vipId)+'/dependents',{method:'POST',body:{
      Name:'ابن VIP '+stamp,realation:'ابن',age:'2019-09-09',
    }});
    assert.equal(vipSon.status, 201, JSON.stringify(vipSon.data));
    const vipChild=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:vipId,dependent_id:vipSon.data.id,service_code:'04',term_to:parentTerm,
    }});
    assert.equal(vipChild.status, 200, JSON.stringify(vipChild.data));
    assert.equal(Number(vipChild.data.amount_due), 0);
    assert.match(String(vipChild.data.fee_label), /VIP/);
    assert.equal(vipChild.data.price_list_id, null);
    assert.equal(Boolean(vipChild.data.is_vip), true);

    const vipGrand=await call('/api/members/'+encodeURIComponent(vipId)+'/dependents',{method:'POST',body:{
      Name:'حفيد VIP '+stamp,realation:'حفيدة',age:'2023-01-01',
    }});
    assert.equal(vipGrand.status, 201, JSON.stringify(vipGrand.data));
    const vipGrandQuote=await call('/api/renewals/quote',{method:'POST',body:{
      client_id:vipId,dependent_id:vipGrand.data.id,service_code:'04',term_to:termB,
    }});
    assert.equal(vipGrandQuote.status, 200, JSON.stringify(vipGrandQuote.data));
    assert.equal(Number(vipGrandQuote.data.amount_due), 0);
    assert.match(String(vipGrandQuote.data.fee_label), /VIP/);
    assert.equal(vipGrandQuote.data.price_list_id, null);
    assert.equal(Boolean(vipGrandQuote.data.is_vip), true);
  }finally{
    await cleanup();
    if(server) await new Promise(resolve=>server.close(resolve));
    try{await (await pool()).close();}catch{}
  }
});
