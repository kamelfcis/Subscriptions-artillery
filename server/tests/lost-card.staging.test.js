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
const username = 'lc' + crypto.randomBytes(4).toString('hex');
const stamp = crypto.randomBytes(4).toString('hex');
const clients = [];
let server, base, shiftId;

function track(id) {
  if (id && !clients.includes(id)) clients.push(id);
  return id;
}

function onYearEnd(yearsAhead = 1) {
  return String(new Date().getFullYear() + yearsAhead) + '-12-31';
}

function day(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function jarClient() {
  const jar = new Map();
  return async function call(url, { method = 'GET', body } = {}) {
    const headers = { 'X-Correlation-Id': 'lost-card-staging' };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = decodeURIComponent(jar.get('csrf') || '');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
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

async function ensureSchema() {
  await run(`IF COL_LENGTH('dbo.AppRenewals','transaction_kind') IS NULL
    ALTER TABLE dbo.AppRenewals ADD transaction_kind varchar(12) NOT NULL CONSTRAINT DF_AppRenewals_transaction_kind DEFAULT 'RENEWAL'`);
  await run(`IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE setting_key='lost_card_fee_default')
    INSERT dbo.AppSettings(setting_key,setting_value) VALUES ('lost_card_fee_default',N'50')`);
}

async function cleanup() {
  for (const id of clients) {
    await run(`DELETE p FROM dbo.AppPayments p JOIN dbo.AppRenewals r ON r.id=p.renewal_id WHERE r.client_id=@id`, { id });
    await run(`DELETE FROM dbo.AppRenewals WHERE client_id=@id`, { id });
    await run(`DELETE FROM dbo.AppExemptions WHERE client_id=@id`, { id });
    await run(`DELETE FROM dbo.AppClientFlags WHERE client_id=@id`, { id });
    await run(`DELETE FROM dbo.Client WHERE IdClient=@id`, { id });
  }
  if (shiftId) await run('DELETE FROM dbo.AppShifts WHERE id=@id', { id: shiftId });
  await run('DELETE FROM dbo.AppAudit WHERE actor=@user', { user: username });
  await run('DELETE FROM dbo.AppUsers WHERE username=@user', { user: username });
}

test('LOST_CARD quotes default 50, creates without extending RENEWAL term_to', async () => {
  await ensureSchema();
  const db = await one('SELECT DB_NAME() AS name');
  assert.equal(db.name, 'Subscriptions_Staging');

  const hash = await bcrypt.hash(password, 4);
  await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@user,@hash,@role,1)', {
    user: username,
    hash,
    role: 'admin',
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const call = jarClient();

  try {
    const login = await call('/api/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(login.status, 200, JSON.stringify(login.data));

    const created = await call('/api/members', {
      method: 'POST',
      body: {
        membership_class: '04',
        Name: 'اختبار بدل فاقد ' + stamp,
        IdCard: 'LC' + stamp,
        Cat: 'مدنى',
        age: '1985-06-01',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const clientId = track(created.data.IdClient);

    const empty = await call('/api/members', {
      method: 'POST',
      body: {
        membership_class: '04',
        Name: 'بدون اشتراك ' + stamp,
        IdCard: 'NO' + stamp,
        Cat: 'مدنى',
        age: '1990-01-01',
      },
    });
    assert.equal(empty.status, 201, JSON.stringify(empty.data));
    const noSub = track(empty.data.IdClient);

    const termFrom = new Date().toISOString().slice(0, 10);
    const termTo = onYearEnd(1);
    await run(
      `INSERT dbo.AppRenewals(request_key,client_id,dependent_id,service_code,term_from,term_to,amount_due,paid_amount,status,created_by,transaction_kind)
       VALUES(NEWID(),@client,NULL,'04',@from,@to,0,0,'ACTIVE',@user,'RENEWAL')`,
      { client: clientId, from: termFrom, to: termTo, user: username },
    );

    const blocked = await call('/api/renewals/quote', {
      method: 'POST',
      body: { client_id: noSub, service_code: '04', purpose: 'LOST_CARD' },
    });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
    assert.match(String(blocked.data?.message || ''), /اشتراك ساري/);

    const quote = await call('/api/renewals/quote', {
      method: 'POST',
      body: { client_id: clientId, service_code: '04', purpose: 'LOST_CARD' },
    });
    assert.equal(quote.status, 200, JSON.stringify(quote.data));
    assert.equal(quote.data.purpose, 'LOST_CARD');
    assert.equal(Number(quote.data.amount_due), 50);
    assert.equal(day(quote.data.term_to), termTo);
    assert.equal(quote.data.fee_label, 'بدل فاقد — 50 ج.م');
    assert.equal(quote.data.lost_card_price_source, 'default');

    const openShift = await call('/api/shifts', { method: 'POST', body: { opening_float: 0 } });
    assert.equal(openShift.status, 201, JSON.stringify(openShift.data));
    shiftId = openShift.data?.id;
    const key = crypto.randomUUID();
    const paid = await call('/api/renewals', {
      method: 'POST',
      body: {
        client_id: clientId,
        service_code: '04',
        purpose: 'LOST_CARD',
        request_key: key,
        amount_paid: 50,
        method: 'CASH',
        shift_id: shiftId,
      },
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.data));
    assert.equal(paid.data.status, 'ACTIVE');

    const renewal = await one(
      `SELECT TOP 1 term_to FROM dbo.AppRenewals WHERE client_id=@client AND ISNULL(transaction_kind,N'RENEWAL')=N'RENEWAL' ORDER BY id`,
      { client: clientId },
    );
    assert.equal(day(renewal.term_to), termTo);

    const lost = await one('SELECT transaction_kind, term_to FROM dbo.AppRenewals WHERE id=@id', {
      id: paid.data.id,
    });
    assert.equal(lost.transaction_kind, 'LOST_CARD');
    assert.equal(day(lost.term_to), termTo);

    const tierStamp = 'LC' + stamp;
    let priceListId = null;
    const inserted = await run(
      `INSERT dbo.PriceList(Cat,Jop,IdPrice,FDar,RDar,RElnada)
       OUTPUT INSERTED.id VALUES(@cat,@jop,N'01',N'700',N'350',N'350')`,
      { cat: 'اختبار بدل ' + tierStamp, jop: 'رتبة ' + tierStamp },
    );
    priceListId = inserted.recordset[0].id;

    const contaminated = await call('/api/members', {
      method: 'POST',
      body: {
        membership_class: '04',
        Name: 'تلوث بدل فاقد ' + stamp,
        IdCard: 'CT' + stamp,
        Cat: 'اختبار بدل ' + tierStamp,
        jop: 'رتبة ' + tierStamp,
        age: '1988-03-03',
      },
    });
    assert.equal(contaminated.status, 201, JSON.stringify(contaminated.data));
    const contaminatedId = track(contaminated.data.IdClient);
    await run(
      `INSERT dbo.AppRenewals(request_key,client_id,dependent_id,service_code,term_from,term_to,amount_due,paid_amount,status,created_by,transaction_kind)
       VALUES(NEWID(),@client,NULL,'04',@from,@to,0,0,'ACTIVE',@user,'RENEWAL')`,
      { client: contaminatedId, from: termFrom, to: termTo, user: username },
    );

    const quoteDirty = await call('/api/renewals/quote', {
      method: 'POST',
      body: { client_id: contaminatedId, service_code: '04', purpose: 'LOST_CARD' },
    });
    assert.equal(quoteDirty.status, 200, JSON.stringify(quoteDirty.data));
    assert.equal(Number(quoteDirty.data.amount_due), 50);
    assert.equal(quoteDirty.data.lost_card_price_source, 'default');

    await run('UPDATE dbo.PriceList SET RElnada=@fee WHERE id=@id', { id: priceListId, fee: '55' });
    const quoteRow = await call('/api/renewals/quote', {
      method: 'POST',
      body: { client_id: contaminatedId, service_code: '04', purpose: 'LOST_CARD' },
    });
    assert.equal(quoteRow.status, 200, JSON.stringify(quoteRow.data));
    assert.equal(Number(quoteRow.data.amount_due), 55);
    assert.equal(quoteRow.data.lost_card_price_source, 'row');

    await run('DELETE FROM dbo.PriceList WHERE id=@id', { id: priceListId });
    priceListId = null;
  } finally {
    await cleanup();
    await new Promise((r) => server.close(r));
    await (await pool()).close();
  }
});