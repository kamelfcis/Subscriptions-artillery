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
const username='nid'+crypto.randomBytes(4).toString('hex');
const stamp=String(Date.now()).slice(-8);
const clients=[];
let server, base;

function jarClient(){
  const jar=new Map();
  return async function call(url,{method='GET',body}={}){
    const headers={'X-Correlation-Id':'next-id-staging'};
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

test('GET /members/next-id preview + create on Subscriptions_Staging only', async()=>{
  const db=await one('SELECT DB_NAME() AS name');
  assert.equal(db.name, 'Subscriptions_Staging');

  const hash=await bcrypt.hash(password, 4);
  await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@username,@hash,@role,1)',{username,hash,role:'admin'});
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening', resolve));
  base=`http://127.0.0.1:${server.address().port}`;
  const call=jarClient();

  try{
    const login=await call('/api/auth/login',{method:'POST',body:{username,password}});
    assert.equal(login.status, 200, JSON.stringify(login.data));

    const examples={};
    for(const cls of ['01','02','03','04']){
      const preview=await call('/api/members/next-id?membership_class='+cls);
      assert.equal(preview.status, 200, JSON.stringify(preview.data));
      assert.deepEqual(
        {membership_class:preview.data.membership_class,prefix:preview.data.prefix},
        {membership_class:cls,prefix:cls},
      );
      assert.match(preview.data.IdClient, new RegExp('^'+cls+'-\\d+$'));
      examples[cls]=preview.data;

      const body={
        membership_class:cls,
        Name:'next-id '+cls+' '+stamp,
        IdCard:'N'+cls+stamp+crypto.randomBytes(2).toString('hex'),
        age:'1984-04-04',
        Cat:cls==='04'?'مدنى':cls==='03'?'أبناء':'TEST-SUITE-PRICE',
      };
      if(cls==='01'||cls==='02'){body.jop='رائد';body.State=cls==='02'?'معاش':'خدمة';body.alive='نعم';}
      if(cls==='03'){body.State='أبناء';}
      const created=await call('/api/members',{method:'POST',body});
      assert.equal(created.status, 201, JSON.stringify(created.data));
      clients.push(created.data.IdClient);
      assert.equal(created.data.IdClient, preview.data.IdClient);
      assert.equal(created.data.membership_class, cls);
      assert.match(created.data.IdClient, new RegExp('^'+cls+'-\\d+$'));

      const after=await call('/api/members/next-id?membership_class='+cls);
      assert.equal(after.status, 200);
      assert.equal(Number(after.data.IdClient.split('-')[1]), Number(preview.data.IdClient.split('-')[1])+1);
    }

    console.log('example_preview_response_01', JSON.stringify(examples['01']));
    console.log('example_preview_response_03', JSON.stringify(examples['03']));

    const bad=await call('/api/members/next-id?membership_class=99');
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'BAD_CLASS');

    const [c1,c2]=await Promise.all([
      call('/api/members',{method:'POST',body:{membership_class:'01',Name:'race A '+stamp,IdCard:'RA'+stamp+crypto.randomBytes(2).toString('hex'),Cat:'TEST-SUITE-PRICE',age:'1980-01-01'}}),
      call('/api/members',{method:'POST',body:{membership_class:'01',Name:'race B '+stamp,IdCard:'RB'+stamp+crypto.randomBytes(2).toString('hex'),Cat:'TEST-SUITE-PRICE',age:'1980-02-02'}}),
    ]);
    assert.equal(c1.status, 201, JSON.stringify(c1.data));
    assert.equal(c2.status, 201, JSON.stringify(c2.data));
    clients.push(c1.data.IdClient, c2.data.IdClient);
    assert.notEqual(c1.data.IdClient, c2.data.IdClient);

    assert.equal((await one('SELECT DB_NAME() AS name')).name, 'Subscriptions_Staging');
  }finally{
    for(const id of clients){
      await run('DELETE FROM dbo.AppClientFlags WHERE client_id=@id',{id});
      await run('DELETE FROM dbo.Client WHERE IdClient=@id',{id});
    }
    await run('DELETE FROM dbo.AppAudit WHERE actor=@user',{user:username});
    await run('DELETE FROM dbo.AppUsers WHERE username=@user',{user:username});
    await new Promise(resolve=>server.close(resolve));
    try{await (await pool()).close();}catch{}
  }
});
