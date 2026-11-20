import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';

if (process.env.SQL_DATABASE !== 'Subscriptions_Staging') {
  throw new Error('Integration tests refuse to run unless SQL_DATABASE=Subscriptions_Staging');
}
process.env.NODE_APP_LISTEN = 'false';
process.env.SERVE_WEB = 'false';

const { app } = await import('../src/index.js');
const { one, run, pool } = await import('../src/db.js');

const password = 'Staging-' + crypto.randomBytes(9).toString('hex') + 'Aa1';
const username = 'prc' + crypto.randomBytes(4).toString('hex');
let server, base;

function jarClient() {
  const jar = new Map();
  return async function call(url, { method = 'GET', body } = {}) {
    const headers = { 'X-Correlation-Id': 'price-hard-delete-test' };
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

test('UI Pricing page shows read-only كود السعر, hides surrogate ID column, form is Cat/Jop/RDar only', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../web/src/pages/Pricing.jsx');
  const src = readFileSync(root, 'utf8');
  assert.match(src, /كود السعر/);
  assert.match(src, /x\.IdPrice/);
  assert.doesNotMatch(src, /heads=\[[^\]]*['"]ID['"]/);
  assert.doesNotMatch(src, /pricefields[^\n]*IdPrice/);
  assert.doesNotMatch(src, /key:\s*['"]IdPrice['"]/);
  assert.match(src, /method:\s*['"]DELETE['"]/);
  assert.match(src, /حذف نهائي/);
  assert.match(src, /useDebounced/);
  assert.match(src, /Pager/);
  assert.match(src, /pageSize/);
});

test('staging API: auto IdPrice, paginated GET, then hard DELETE', async () => {
  const db = await one('SELECT DB_NAME() AS name');
  assert.equal(db.name, 'Subscriptions_Staging');

  const hash = await bcrypt.hash(password, 4);
  await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@username,@hash,@role,1)', {
    username,
    hash,
    role: 'admin',
  });

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const call = jarClient();
  let createdId = null;
  let createdId2 = null;

  try {
    const login = await call('/api/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(login.status, 200, JSON.stringify(login.data));

    const stamp = String(Date.now()).slice(-8);
    const maxBefore = await one(
      `SELECT ISNULL(MAX(TRY_CAST(LTRIM(RTRIM(IdPrice)) AS bigint)), 0) AS m FROM dbo.PriceList`,
    );
    const expectedCode = String(Number(maxBefore.m) + 1);

    const created = await call('/api/legacy/prices', {
      method: 'POST',
      body: {
        Cat: 'TEST-HARD-DEL-' + stamp,
        Jop: 'اختبار حذف',
        RDar: '9',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    createdId = created.data.id;
    assert.ok(createdId);

    const row = await one('SELECT id, Cat, Jop, IdPrice, RDar FROM dbo.PriceList WHERE id=@id', { id: createdId });
    assert.ok(row);
    assert.equal(row.Cat, 'TEST-HARD-DEL-' + stamp);
    assert.ok(row.IdPrice != null && String(row.IdPrice).trim() !== '');
    assert.equal(String(row.IdPrice), expectedCode);
    assert.equal(String(row.RDar), '9');

    const created2 = await call('/api/legacy/prices', {
      method: 'POST',
      body: {
        Cat: 'TEST-HARD-DEL2-' + stamp,
        Jop: 'اختبار تزايد',
        RDar: '11',
      },
    });
    assert.equal(created2.status, 201, JSON.stringify(created2.data));
    createdId2 = created2.data.id;
    const row2 = await one('SELECT IdPrice FROM dbo.PriceList WHERE id=@id', { id: createdId2 });
    assert.equal(String(row2.IdPrice), String(Number(expectedCode) + 1));

    const listed = await call('/api/legacy/prices?page=1&pageSize=10');
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(listed.data?.items));
    assert.equal(typeof listed.data.total, 'number');
    assert.ok(listed.data.total >= 1);
    assert.equal(listed.data.page, 1);
    assert.equal(listed.data.pageSize, 10);
    assert.ok(listed.data.items.length <= 10);

    const listedByCat = await call(
      '/api/legacy/prices?page=1&pageSize=10&search=' + encodeURIComponent('TEST-HARD-DEL-' + stamp),
    );
    assert.equal(listedByCat.status, 200);
    assert.ok(listedByCat.data.items.some((x) => x.id === createdId));

    const searched = await call(
      '/api/legacy/prices?page=1&pageSize=25&search=' + encodeURIComponent('TEST-HARD-DEL-' + stamp),
    );
    assert.equal(searched.status, 200);
    assert.ok(searched.data.items.some((x) => x.id === createdId));
    assert.ok(searched.data.items.every((x) => String(x.Cat || '').includes('TEST-HARD-DEL-' + stamp)));
    assert.ok(!searched.data.items.some((x) => x.id === createdId2));

    const byCode = await call(
      '/api/legacy/prices?page=1&pageSize=10&search=' + encodeURIComponent(expectedCode),
    );
    assert.equal(byCode.status, 200);
    assert.ok(byCode.data.items.some((x) => x.id === createdId && String(x.IdPrice) === expectedCode));

    const deleted = await call('/api/legacy/prices/' + createdId, { method: 'DELETE' });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.equal(deleted.data?.ok, true);

    const gone = await one('SELECT id FROM dbo.PriceList WHERE id=@id', { id: createdId });
    assert.equal(gone, null);

    const listedAfter = await call(
      '/api/legacy/prices?page=1&pageSize=50&search=' + encodeURIComponent('TEST-HARD-DEL-' + stamp),
    );
    assert.equal(listedAfter.status, 200);
    assert.ok(!(listedAfter.data.items || []).some((x) => x.id === createdId));

    const again = await call('/api/legacy/prices/' + createdId, { method: 'DELETE' });
    assert.equal(again.status, 404);
    createdId = null;

    if (createdId2) {
      await call('/api/legacy/prices/' + createdId2, { method: 'DELETE' });
      createdId2 = null;
    }
  } finally {
    if (createdId) await run('DELETE dbo.PriceList WHERE id=@id', { id: createdId });
    if (createdId2) await run('DELETE dbo.PriceList WHERE id=@id', { id: createdId2 });
    await run('DELETE FROM dbo.AppAudit WHERE actor=@user', { user: username });
    await run('DELETE FROM dbo.AppUsers WHERE username=@user', { user: username });
    await new Promise((r) => server.close(r));
    try {
      await (await pool()).close();
    } catch {}
  }
});
