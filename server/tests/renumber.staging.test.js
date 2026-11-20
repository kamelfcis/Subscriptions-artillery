import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

if (process.env.SQL_DATABASE !== 'Subscriptions_Staging') {
  throw new Error('Integration tests refuse to run unless SQL_DATABASE=Subscriptions_Staging');
}
process.env.NODE_APP_LISTEN = 'false';
process.env.SERVE_WEB = 'false';

const { app } = await import('../src/index.js');
const { one, run, pool } = await import('../src/db.js');

const password = 'Staging-' + crypto.randomBytes(9).toString('hex') + 'Aa1';
const username = 'ren' + crypto.randomBytes(4).toString('hex');
const stamp = String(Date.now()).slice(-8);
const clients = [];
let server, base;

function jarClient() {
  const jar = new Map();
  return async function call(url, { method = 'GET', body } = {}) {
    const headers = { 'X-Correlation-Id': 'renumber-staging' };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = decodeURIComponent(jar.get('csrf') || '');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of setCookies) {
      const pair = line.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const text = await res.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (data && typeof data === 'object' && data.csrf) jar.set('csrf', data.csrf);
    return { status: res.status, data };
  };
}

async function assertChildrenOn(id) {
  const subMoved = await one(
    `SELECT clientid FROM dbo.subscriptioninf WHERE clientid=@id AND Discription=N'renumber staging'`,
    { id }
  );
  assert.equal(subMoved?.clientid, id);
  const depMoved = await one(`SELECT IdClient FROM dbo.SubClient WHERE IdClient=@id AND Name=N'تابع اختبار'`, {
    id,
  });
  assert.equal(depMoved?.IdClient, id);
  const flagMoved = await one(`SELECT client_id FROM dbo.AppClientFlags WHERE client_id=@id`, { id });
  assert.equal(flagMoved?.client_id, id);
}

test('PATCH renumbers 01↔02 both ways; deceased stays 02 (staging only)', async () => {
  assert.equal((await one('SELECT DB_NAME() AS name')).name, 'Subscriptions_Staging');
  const hash = await bcrypt.hash(password, 4);
  await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@username,@hash,@role,1)', {
    username,
    hash,
    role: 'admin',
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const call = jarClient();

  try {
    const login = await call('/api/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(login.status, 200, JSON.stringify(login.data));

    const created = await call('/api/members', {
      method: 'POST',
      body: {
        membership_class: '01',
        Name: 'renumber test ' + stamp,
        IdCard: 'RN' + stamp + crypto.randomBytes(2).toString('hex'),
        age: '1985-07-27',
        jop: 'عقيد',
        State: 'خدمة',
        alive: 'نعم',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.match(created.data.IdClient, /^01-\d+$/);
    const id01a = created.data.IdClient;
    clients.push(id01a);

    // Child rows exercise ON UPDATE CASCADE FKs (bug was child-first UPDATE → EREQUEST).
    await run(
      `INSERT dbo.subscriptioninf(clientid,todate,CreateOn,admin,Discription,[count],MCount,active,cat)
       VALUES(@id,'2030-06-01',GETDATE(),@user,N'renumber staging',1,1,N'نعم',N'01')`,
      { id: id01a, user: username }
    );
    await run(
      `INSERT dbo.SubClient(IdClient,Name,realation,CreateOn,Admin) VALUES(@id,N'تابع اختبار',N'ابن',GETDATE(),@user)`,
      { id: id01a, user: username }
    );
    await run(`INSERT dbo.AppClientFlags(client_id,is_archived) VALUES(@id,0)`, { id: id01a });

    // 1) خدمة → متوفى → 02-
    const toDeceased = await call('/api/members/' + encodeURIComponent(id01a), {
      method: 'PATCH',
      body: { alive: 'متوفى' },
    });
    assert.equal(toDeceased.status, 200, JSON.stringify(toDeceased.data));
    assert.match(toDeceased.data.IdClient, /^02-\d+$/);
    assert.notEqual(toDeceased.data.IdClient, id01a);
    const id02 = toDeceased.data.IdClient;
    clients.push(id02);

    assert.equal(await one('SELECT IdClient FROM dbo.Client WHERE IdClient=@id', { id: id01a }), null);
    const row02 = await one('SELECT IdClient,State,alive FROM dbo.Client WHERE IdClient=@id', { id: id02 });
    assert.equal(row02.State, 'معاش');
    assert.match(String(row02.alive), /متوف/);
    await assertChildrenOn(id02);

    // 2) Still متوفى + pick خدمة → forced معاش, stay on 02-
    const forceServiceWhileDead = await call('/api/members/' + encodeURIComponent(id02), {
      method: 'PATCH',
      body: { State: 'خدمة' },
    });
    assert.equal(forceServiceWhileDead.status, 200, JSON.stringify(forceServiceWhileDead.data));
    assert.equal(forceServiceWhileDead.data.IdClient, id02);
    const stillDead = await one('SELECT State,alive FROM dbo.Client WHERE IdClient=@id', { id: id02 });
    assert.equal(stillDead.State, 'معاش');
    assert.match(String(stillDead.alive), /متوف/);

    // 3) Undo deceased + خدمة → allocate next 01- (reverse)
    const backToService = await call('/api/members/' + encodeURIComponent(id02), {
      method: 'PATCH',
      body: { State: 'خدمة', alive: 'نعم' },
    });
    assert.equal(backToService.status, 200, JSON.stringify(backToService.data));
    assert.match(backToService.data.IdClient, /^01-\d+$/);
    assert.notEqual(backToService.data.IdClient, id02);
    const id01b = backToService.data.IdClient;
    clients.push(id01b);

    assert.equal(await one('SELECT IdClient FROM dbo.Client WHERE IdClient=@id', { id: id02 }), null);
    const row01 = await one('SELECT IdClient,State,alive FROM dbo.Client WHERE IdClient=@id', { id: id01b });
    assert.equal(row01.State, 'خدمة');
    assert.equal(String(row01.alive).trim(), 'نعم');
    await assertChildrenOn(id01b);

    assert.equal((await one('SELECT DB_NAME() AS name')).name, 'Subscriptions_Staging');
  } finally {
    const ids = [...new Set(clients)];
    for (const id of ids) {
      await run(`DELETE FROM dbo.subscriptioninf WHERE clientid=@id AND Discription=N'renumber staging'`, { id });
      await run(`DELETE FROM dbo.SubClient WHERE IdClient=@id AND Name=N'تابع اختبار'`, { id });
      await run('DELETE FROM dbo.AppClientFlags WHERE client_id=@id', { id });
      await run('DELETE FROM dbo.Client WHERE IdClient=@id', { id });
    }
    await run('DELETE FROM dbo.AppAudit WHERE actor=@user', { user: username });
    await run('DELETE FROM dbo.AppUsers WHERE username=@user', { user: username });
    await new Promise((resolve) => server.close(resolve));
    try {
      await (await pool()).close();
    } catch {}
  }
});
