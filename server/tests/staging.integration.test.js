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
const {one, run, rows, pool}=await import('../src/db.js');
const {legacyImage}=await import('../src/core.js');

const password='Staging-'+crypto.randomBytes(9).toString('hex')+'Aa1';
const username='tst'+crypto.randomBytes(4).toString('hex');
const stamp=String(Date.now()).slice(-8);
const clients=[];
let server, base, shiftId, blockedId;

function nextClient(){
  const n=Number(stamp)+clients.length;
  return {
    card: 'T' + n,
    name: 'عضو اختبار ' + n,
    Cat: 'TEST-SUITE-PRICE',
    membership_class: '01',
  };
}
function trackClient(idClient){if(idClient&&!clients.includes(idClient))clients.push(idClient);return idClient;}

async function ensureStagingObjects(){
  const db=await one('SELECT DB_NAME() AS name');
  assert.equal(db.name, 'Subscriptions_Staging');
  await run(`IF OBJECT_ID('dbo.AppRenewalAdjustments','U') IS NULL
    CREATE TABLE dbo.AppRenewalAdjustments(
      id bigint IDENTITY PRIMARY KEY,
      renewal_id bigint NOT NULL REFERENCES dbo.AppRenewals(id),
      old_due decimal(14,2) NOT NULL,
      new_due decimal(14,2) NOT NULL CHECK(new_due>=0),
      reason nvarchar(300) NOT NULL,
      adjusted_by varchar(64) NOT NULL,
      created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME())`);
  await run(`IF COL_LENGTH('dbo.AppCardJobs','reprint_reason') IS NULL ALTER TABLE dbo.AppCardJobs ADD reprint_reason nvarchar(300) NULL`);
  const testCat = 'TEST-SUITE-PRICE';
  await run(
    `IF NOT EXISTS (SELECT 1 FROM dbo.PriceList WHERE Cat=@cat AND IdPrice=N'01')
     INSERT dbo.PriceList(Cat,Jop,IdPrice,FDar,RDar) VALUES (@cat,NULL,N'01',NULL,N'10')`,
    { cat: testCat },
  );
}

function jarClient(){
  const jar=new Map();
  return async function call(url,{method='GET',body,form}={}){
    const headers={'X-Correlation-Id':'staging-test'};
    const cookie=[...jar.entries()].map(([k,v])=>`${k}=${v}`).join('; ');
    if(cookie) headers.Cookie=cookie;
    if(method!=='GET'&&method!=='HEAD') headers['X-CSRF-Token']=decodeURIComponent(jar.get('csrf')||'');
    if(body!==undefined) headers['Content-Type']='application/json';
    const res=await fetch(base+url,{method,headers,body:form||(body!==undefined?JSON.stringify(body):undefined)});
    const setCookies=typeof res.headers.getSetCookie==='function'?res.headers.getSetCookie():[];
    for(const line of setCookies){const pair=line.split(';')[0];const i=pair.indexOf('=');if(i>0)jar.set(pair.slice(0,i).trim(), pair.slice(i+1).trim());}
    const text=await res.text();
    let data=text;try{data=text?JSON.parse(text):null;}catch{}
    if(data&&typeof data==='object'&&data.csrf) jar.set('csrf', data.csrf);
    return {status:res.status, data, headers:res.headers};
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
    await run(`DELETE l FROM dbo.AppFileLinks l JOIN dbo.Files f ON f.id=l.file_id WHERE f.clientid=@id`,{id});
    await run(`DELETE g FROM dbo.AppFileFlags g JOIN dbo.Files f ON f.id=g.file_id WHERE f.clientid=@id`,{id});
    await run(`DELETE FROM dbo.Files WHERE clientid=@id`,{id});
    await run(`DELETE g FROM dbo.AppDependentFlags g JOIN dbo.SubClient s ON s.id=g.dependent_id WHERE s.IdClient=@id`,{id});
    await run(`DELETE FROM dbo.SubClient WHERE IdClient=@id`,{id});
    await run(`DELETE FROM dbo.subscriptioninf WHERE clientid=@id AND Discription LIKE N'Enterprise #%'`,{id});
    await run(`DELETE FROM dbo.AppClientFlags WHERE client_id=@id`,{id});
    await run(`DELETE FROM dbo.Client WHERE IdClient=@id`,{id});
  }
  if(blockedId) await run('DELETE FROM dbo.Blocked WHERE Id=@id',{id:blockedId});
  if(shiftId) await run('DELETE FROM dbo.AppShifts WHERE id=@id',{id:shiftId});
  await run('DELETE FROM dbo.AppAudit WHERE actor=@user',{user:username});
  await run('DELETE FROM dbo.AppUsers WHERE username=@user',{user:username});
}

test('staging SQL integration: photo, archive, renewals, block, age, fees, receipt', async()=>{
  await ensureStagingObjects();
  const hash=await bcrypt.hash(password, 4);
  await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@username,@hash,@role,1)',{username,hash,role:'admin'});
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening', resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const call=jarClient();
  try{
    const health=await call('/api/health');
    assert.equal(health.status, 200);
    assert.ok(health.headers.get('x-correlation-id'));
    const ready=await call('/api/ready');
    assert.equal(ready.status, 200);

    const sample=await one('SELECT IdClient id, CONVERT(varbinary(16), PicPath) head FROM dbo.Client WHERE id=999');
    assert.ok(sample?.head);
    const parsed=legacyImage(Buffer.from(sample.head));
    assert.equal(parsed.mime, 'image/jpeg');
    const photo=await call('/api/members/'+encodeURIComponent(sample.id)+'/photo');
    assert.equal(photo.status, 401);

    const login=await call('/api/auth/login',{method:'POST',body:{username,password}});
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const authedPhoto=await call('/api/members/'+encodeURIComponent(sample.id)+'/photo');
    assert.equal(authedPhoto.status, 200);
    assert.match(authedPhoto.headers.get('content-type')||'', /image\/jpeg/);

    for(const cls of ['01','02','03','04']){
      const preview=await call('/api/members/next-id?membership_class='+cls);
      assert.equal(preview.status, 200, JSON.stringify(preview.data));
      assert.equal(preview.data.membership_class, cls);
      assert.equal(preview.data.prefix, cls);
      assert.match(preview.data.IdClient, new RegExp('^'+cls+'-\\d+$'));
    }
    const badClass=await call('/api/members/next-id?membership_class=99');
    assert.equal(badClass.status, 400);
    assert.equal(badClass.data.error, 'BAD_CLASS');

    const a=nextClient();
    const preview01=await call('/api/members/next-id?membership_class=01');
    assert.equal(preview01.status, 200, JSON.stringify(preview01.data));
    const created=await call('/api/members',{method:'POST',body:{membership_class:a.membership_class,Name:a.name,IdCard:a.card,Cat:a.Cat,age:'1980-05-01'}});
    assert.equal(created.status, 201, JSON.stringify(created.data));
    a.idClient=trackClient(created.data.IdClient);
    assert.match(a.idClient, /^01-\d+$/);
    assert.equal(a.idClient, preview01.data.IdClient);

    const raceA=nextClient();
    const raceB=nextClient();
    const [r1,r2]=await Promise.all([
      call('/api/members',{method:'POST',body:{membership_class:'01',Name:raceA.name,IdCard:raceA.card,Cat:raceA.Cat,age:'1983-07-07'}}),
      call('/api/members',{method:'POST',body:{membership_class:'01',Name:raceB.name,IdCard:raceB.card,Cat:raceB.Cat,age:'1983-08-08'}}),
    ]);
    assert.equal(r1.status, 201, JSON.stringify(r1.data));
    assert.equal(r2.status, 201, JSON.stringify(r2.data));
    trackClient(r1.data.IdClient);
    trackClient(r2.data.IdClient);
    assert.notEqual(r1.data.IdClient, r2.data.IdClient);
    assert.match(r1.data.IdClient, /^01-\d+$/);
    assert.match(r2.data.IdClient, /^01-\d+$/);
    assert.equal((await one('SELECT DB_NAME() AS name')).name, 'Subscriptions_Staging');

    const archived=await call('/api/members/'+encodeURIComponent(a.idClient),{method:'DELETE'});
    assert.equal(archived.status, 200);
    const restored=await call('/api/members/'+encodeURIComponent(a.idClient)+'/restore',{method:'POST'});
    assert.equal(restored.status, 200);
    const visible=await call('/api/members/'+encodeURIComponent(a.idClient));
    assert.equal(Boolean(visible.data.archived), false);

    const jpeg=Buffer.from([0xFF,0xD8,0xFF,0xD9]);
    const fd=new FormData();
    fd.append('file', new Blob([jpeg],{type:'image/jpeg'}), 'scan.jpg');
    fd.append('discip','staging scan');
    fd.append('document_type','OTHER');
    const uploaded=await call('/api/members/'+encodeURIComponent(a.idClient)+'/files',{method:'POST',form:fd});
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
    const jpeg2=Buffer.from([0xFF,0xD8,0xFF,0x00,0xD9]);
    const fd2=new FormData();
    fd2.append('file', new Blob([jpeg2],{type:'image/jpeg'}), 'replace.jpg');
    const replaced=await call('/api/files/'+uploaded.data.id+'/content',{method:'PUT',form:fd2});
    assert.equal(replaced.status, 200, JSON.stringify(replaced.data));

    const blocked=await call('/api/blocked',{method:'POST',body:{Name:a.name,IdCard:a.card,reason:'اختبار حظر هوية',confirm_identity:false}});
    assert.equal(blocked.status, 201, JSON.stringify(blocked.data));
    blockedId=blocked.data.Id;
    const end=new Date();end.setUTCFullYear(end.getUTCFullYear()+1);
    const term=end.toISOString().slice(0,10);
    const denied=await call('/api/renewals/quote',{method:'POST',body:{client_id:a.idClient,service_code:'01',term_to:term}});
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error, 'SECURITY_BLOCK');
    const removed=await call('/api/blocked/'+blockedId,{method:'DELETE',body:{reason:'اختبار انتهى ولم يعد مطلوباً'}});
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    blockedId=null;

    const quote=await call('/api/renewals/quote',{method:'POST',body:{client_id:a.idClient,service_code:'01',term_to:term}});
    assert.equal(quote.status, 200, JSON.stringify(quote.data));
    assert.equal(Number(quote.data.amount_due), 10);
    const key=crypto.randomUUID();
    const body={client_id:a.idClient,service_code:'01',term_to:term,request_key:key,amount_paid:0};
    const [first,second]=await Promise.all([call('/api/renewals',{method:'POST',body}), call('/api/renewals',{method:'POST',body})]);
    assert.ok([200,201].includes(first.status), JSON.stringify(first.data));
    assert.ok([200,201].includes(second.status), JSON.stringify(second.data));
    assert.equal(first.data.id, second.data.id);
    const copies=await one('SELECT COUNT_BIG(*) n FROM dbo.AppRenewals WHERE request_key=@key',{key});
    assert.equal(Number(copies.n), 1);
    const other=await call('/api/renewals',{method:'POST',body:{...body,request_key:crypto.randomUUID()}});
    assert.equal(other.status, 409);
    assert.equal(other.data.error, 'DUPLICATE_RENEWAL');
    const voided=await call('/api/renewals/'+first.data.id+'/void',{method:'POST',body:{reason:'إلغاء اختبار التكرار بدون مبلغ'}});
    assert.equal(voided.status, 200, JSON.stringify(voided.data));

    const shift=await call('/api/shifts',{method:'POST',body:{opening_float:0}});
    assert.equal(shift.status, 201, JSON.stringify(shift.data));
    shiftId=shift.data.id;
    const b=nextClient();
    const made=await call('/api/members',{method:'POST',body:{membership_class:b.membership_class,Name:b.name,IdCard:b.card,Cat:b.Cat,age:'1982-02-02'}});
    assert.equal(made.status, 201, JSON.stringify(made.data));
    b.idClient=trackClient(made.data.IdClient);
    const partialKey=crypto.randomUUID();
    const partial=await call('/api/renewals',{method:'POST',body:{client_id:b.idClient,service_code:'01',term_to:term,request_key:partialKey,amount_paid:4,method:'CASH',shift_id:shiftId,payment_reference:'partial-test'}});
    assert.equal(partial.status, 201, JSON.stringify(partial.data));
    assert.equal(partial.data.status, 'PENDING');
    const restPay=await call('/api/renewals/'+partial.data.id+'/payments',{method:'POST',body:{request_key:crypto.randomUUID(),amount:6,method:'CASH',reference:'full-test',shift_id:shiftId}});
    assert.equal(restPay.status, 201, JSON.stringify(restPay.data));
    assert.equal(restPay.data.status, 'ACTIVE');
    const over=await call('/api/renewals/'+partial.data.id+'/payments',{method:'POST',body:{request_key:crypto.randomUUID(),amount:1,method:'CASH',reference:'over',shift_id:shiftId}});
    assert.equal(over.status, 409);
    const receipt=await call('/api/renewals/'+partial.data.id+'/receipt');
    assert.equal(receipt.status, 200);
    assert.match(String(receipt.data), /إيصال/);

    const c=nextClient();
    const cCreated=await call('/api/members',{method:'POST',body:{membership_class:c.membership_class,Name:c.name,IdCard:c.card,Cat:c.Cat,age:'1979-03-03'}});
    assert.equal(cCreated.status, 201, JSON.stringify(cCreated.data));
    c.idClient=trackClient(cCreated.data.IdClient);
    const openDue=await call('/api/renewals',{method:'POST',body:{client_id:c.idClient,service_code:'01',term_to:term,request_key:crypto.randomUUID(),amount_paid:0}});
    assert.equal(openDue.status, 201, JSON.stringify(openDue.data));
    const adjusted=await call('/api/renewals/'+openDue.data.id+'/adjust',{method:'POST',body:{new_due:8,reason:'تسوية مبلغ مستحق بموافقة المشرف'}});
    assert.equal(adjusted.status, 200, JSON.stringify(adjusted.data));
    assert.equal(adjusted.data.new_due, 8);
    assert.equal(adjusted.data.remaining, 8);
    const lowered=await call('/api/renewals/'+openDue.data.id+'/payments',{method:'POST',body:{request_key:crypto.randomUUID(),amount:4,method:'CASH',reference:'adj-pay',shift_id:shiftId}});
    assert.equal(lowered.status, 201, JSON.stringify(lowered.data));
    const rejected=await call('/api/renewals/'+openDue.data.id+'/adjust',{method:'POST',body:{new_due:1,reason:'محاولة تخفيض تحت المحصل للاختبار'}});
    assert.equal(rejected.status, 400);
    assert.equal(rejected.data.error, 'OVERPAYMENT');
    const refunded=await call('/api/renewals/'+openDue.data.id+'/void',{method:'POST',body:{reason:'استرداد اختبار الوردية',refund_confirmed:true,refund_method:'CASH',refund_reference:'receipt test 1',shift_id:shiftId}});
    assert.equal(refunded.status, 200, JSON.stringify(refunded.data));
    const reversal=await one('SELECT COUNT_BIG(*) n FROM dbo.AppReversals WHERE renewal_id=@id',{id:openDue.data.id});
    assert.equal(Number(reversal.n), 1);

    const parent=nextClient();
    const parentCreated=await call('/api/members',{method:'POST',body:{membership_class:parent.membership_class,Name:parent.name,IdCard:parent.card,Cat:parent.Cat,age:'1975-04-04'}});
    assert.equal(parentCreated.status, 201, JSON.stringify(parentCreated.data));
    parent.idClient=trackClient(parentCreated.data.IdClient);
    const active=await call('/api/renewals',{method:'POST',body:{client_id:parent.idClient,service_code:'01',term_to:term,request_key:crypto.randomUUID(),amount_paid:10,method:'CASH',shift_id:shiftId,payment_reference:'parent'}});
    assert.equal(active.status, 201, JSON.stringify(active.data));
    assert.equal(active.data.status, 'ACTIVE');
    const dep=await call('/api/members/'+encodeURIComponent(parent.idClient)+'/dependents',{method:'POST',body:{Name:'تابع اختبار '+stamp,realation:'ابن',IdCard:'C'+stamp,age:'1990-01-01'}});
    assert.equal(dep.status, 201, JSON.stringify(dep.data));
    const aged=await call('/api/renewals/quote',{method:'POST',body:{client_id:parent.idClient,dependent_id:dep.data.id,service_code:'03',term_to:term}});
    assert.equal(aged.status, 409);
    assert.equal(aged.data.error, 'PROOF_REQUIRED');

    const overlap=await call('/api/fees',{method:'POST',body:{service_code:'01',target_type:'MAIN',label:'تجديد الدار — اختبار تداخل',amount:99,valid_from:'2024-01-01'}});
    assert.equal(overlap.status, 409);
    assert.equal(overlap.data.error, 'OVERLAPPING_FEE');

    const listed=await call('/api/members'+'?page=1&pageSize=10&cat='+encodeURIComponent('___none___'));
    assert.equal(listed.status, 200);
    assert.equal(listed.data.pageSize, 10);
  }finally{
    await cleanup();
    await new Promise(resolve=>server.close(resolve));
    try{await (await pool()).close();}catch{}
  }
});
