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
const username = 'ath' + crypto.randomBytes(4).toString('hex');
const stamp = String(Date.now()).slice(-8);
const clients = [];
let server, base;

function trackClient(idClient) {
  if (idClient && !clients.includes(idClient)) clients.push(idClient);
  return idClient;
}

function jarClient() {
  const jar = new Map();
  return async function call(url, { method = 'GET', body, form, raw } = {}) {
    const headers = { 'X-Correlation-Id': 'attach-hard-delete' };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = decodeURIComponent(jar.get('csrf') || '');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, {
      method,
      headers,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of setCookies) {
      const pair = line.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    if (raw) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, headers: res.headers, buf };
    }
    const text = await res.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (data && typeof data === 'object' && data.csrf) jar.set('csrf', data.csrf);
    return { status: res.status, data, headers: res.headers };
  };
}

async function cleanup() {
  for (const id of clients) {
    await run(`DELETE p FROM dbo.AppPayments p JOIN dbo.AppRenewals r ON r.id=p.renewal_id WHERE r.client_id=@id`, { id });
    await run(`DELETE v FROM dbo.AppReversals v JOIN dbo.AppRenewals r ON r.id=v.renewal_id WHERE r.client_id=@id`, { id });
    await run(`DELETE a FROM dbo.AppRenewalAdjustments a JOIN dbo.AppRenewals r ON r.id=a.renewal_id WHERE r.client_id=@id`, { id });
    await run(`DELETE FROM dbo.AppRenewals WHERE client_id=@id`, { id });
    await run(`DELETE FROM dbo.AppCardJobs WHERE client_id=@id`, { id });
    await run(`DELETE FROM dbo.AppExemptions WHERE client_id=@id`, { id });
    await run(`DELETE e FROM dbo.AppEligibility e JOIN dbo.SubClient s ON s.id=e.dependent_id WHERE s.IdClient=@id`, { id });
    await run(`DELETE FROM dbo.AppFamilyGuardian WHERE client_id=@id`, { id });
    await run(`DELETE l FROM dbo.AppFileLinks l JOIN dbo.Files f ON f.id=l.file_id WHERE f.clientid=@id`, { id });
    await run(`DELETE g FROM dbo.AppFileFlags g JOIN dbo.Files f ON f.id=g.file_id WHERE f.clientid=@id`, { id });
    await run(`DELETE FROM dbo.Files WHERE clientid=@id`, { id });
    await run(`DELETE g FROM dbo.AppDependentFlags g JOIN dbo.SubClient s ON s.id=g.dependent_id WHERE s.IdClient=@id`, { id });
    await run(`DELETE FROM dbo.SubClient WHERE IdClient=@id`, { id });
    await run(`DELETE FROM dbo.AppClientFlags WHERE client_id=@id`, { id });
    await run(`DELETE FROM dbo.Client WHERE IdClient=@id`, { id });
  }
  await run('DELETE FROM dbo.AppAudit WHERE actor=@user', { user: username });
  await run('DELETE FROM dbo.AppUsers WHERE username=@user', { user: username });
}

test('UI: AttachmentThumb + hard-delete labels (no archive/restore for files/deps)', () => {
  const members = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../web/src/pages/Members.jsx'), 'utf8');
  const preview = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../web/src/components/FilePreview.jsx'), 'utf8');
  assert.match(preview, /export function AttachmentThumb/);
  assert.match(preview, /isImage\(mime\)/);
  assert.match(preview, /URL\.revokeObjectURL/);
  assert.match(members, /AttachmentThumb/);
  assert.match(members, /حذف نهائي لهذا المرفق/);
  assert.match(members, /حذف نهائي للتابع/);
  assert.match(members, /onDeleteDep/);
  assert.doesNotMatch(members, /onArchiveDep/);
  assert.doesNotMatch(members, /أرشفة المرفق/);
  assert.doesNotMatch(members, /x\.archived\?'استعادة':'أرشفة'/);
});

test('staging: image/PDF content + hard delete file/dependent', async () => {
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

  try {
    const login = await call('/api/auth/login', { method: 'POST', body: { username, password } });
    assert.equal(login.status, 200, JSON.stringify(login.data));

    const created = await call('/api/members', {
      method: 'POST',
      body: {
        membership_class: '01',
        Name: 'عضو مرفقات ' + stamp,
        IdCard: 'ATH' + stamp,
        Cat: 'TEST-SUITE-PRICE',
        age: '1980-01-01',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const clientId = trackClient(created.data.IdClient);

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const fdImg = new FormData();
    fdImg.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'thumb.jpg');
    fdImg.append('discip', 'صورة اختبار thumbnail');
    fdImg.append('document_type', 'OTHER');
    const imgUp = await call('/api/members/' + encodeURIComponent(clientId) + '/files', { method: 'POST', form: fdImg });
    assert.equal(imgUp.status, 201, JSON.stringify(imgUp.data));
    const imgId = imgUp.data.id;

    const imgContent = await call('/api/files/' + imgId + '/content', { raw: true });
    assert.equal(imgContent.status, 200);
    assert.match(String(imgContent.headers.get('content-type') || ''), /^image\/jpeg/i);

    const pdfBytes = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const fdPdf = new FormData();
    fdPdf.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'doc.pdf');
    fdPdf.append('discip', 'PDF اختبار أيقونة');
    fdPdf.append('document_type', 'OTHER');
    const pdfUp = await call('/api/members/' + encodeURIComponent(clientId) + '/files', { method: 'POST', form: fdPdf });
    assert.equal(pdfUp.status, 201, JSON.stringify(pdfUp.data));
    const pdfId = pdfUp.data.id;

    const pdfContent = await call('/api/files/' + pdfId + '/content', { raw: true });
    assert.equal(pdfContent.status, 200);
    assert.match(String(pdfContent.headers.get('content-type') || ''), /^application\/pdf/i);

    const delImg = await call('/api/files/' + imgId, { method: 'DELETE' });
    assert.equal(delImg.status, 200, JSON.stringify(delImg.data));
    assert.equal(delImg.data.deleted, true);
    const goneRow = await one('SELECT id FROM dbo.Files WHERE id=@id', { id: imgId });
    assert.equal(goneRow, null);
    const goneContent = await call('/api/files/' + imgId + '/content', { raw: true });
    assert.equal(goneContent.status, 404);
    const delImg2 = await call('/api/files/' + imgId, { method: 'DELETE' });
    assert.equal(delImg2.status, 404);
    const listAfter = await call('/api/members/' + encodeURIComponent(clientId) + '/files');
    assert.equal(listAfter.status, 200);
    assert.ok(!(listAfter.data || []).some((f) => f.id === imgId));

    const dep = await call('/api/members/' + encodeURIComponent(clientId) + '/dependents', {
      method: 'POST',
      body: { Name: 'تابع حذف ' + stamp, realation: 'ابن', IdCard: 'D' + stamp, age: '2010-01-01' },
    });
    assert.equal(dep.status, 201, JSON.stringify(dep.data));
    const depId = dep.data.id;

    const elig = await call('/api/dependents/' + depId + '/eligibility', {
      method: 'PUT',
      body: {
        dependent_kind: 'CHILD',
        proof_type: 'بطاقة علاجية عائلية',
        proof_file_id: pdfId,
        proof_valid_until: '2030-01-01',
        review_note: 'smoke proof',
      },
    });
    assert.equal(elig.status, 200, JSON.stringify(elig.data));

    const blockedDel = await call('/api/files/' + pdfId, { method: 'DELETE' });
    assert.equal(blockedDel.status, 400, JSON.stringify(blockedDel.data));
    assert.equal(blockedDel.data.error, 'DOCUMENT_IN_USE');

    await run(
      `INSERT dbo.AppRenewals(client_id,dependent_id,service_code,term_from,term_to,created_by,status,amount_due,paid_amount,request_key)
       VALUES(@client,@dep,'03','2025-01-01','2026-01-01',@who,'ACTIVE',0,0,@key)`,
      { client: clientId, dep: depId, who: username, key: crypto.randomUUID() },
    );

    const delDep = await call('/api/dependents/' + depId, { method: 'DELETE' });
    assert.equal(delDep.status, 200, JSON.stringify(delDep.data));
    assert.equal(delDep.data.deleted, true);
    assert.equal(await one('SELECT id FROM dbo.SubClient WHERE id=@id', { id: depId }), null);
    assert.equal(await one('SELECT dependent_id FROM dbo.AppEligibility WHERE dependent_id=@id', { id: depId }), null);
    assert.equal(await one('SELECT id FROM dbo.AppRenewals WHERE dependent_id=@id', { id: depId }), null);
    const parent = await one('SELECT IdClient FROM dbo.Client WHERE IdClient=@id', { id: clientId });
    assert.ok(parent);

    const link = await one('SELECT dependent_id FROM dbo.AppFileLinks WHERE file_id=@id', { id: pdfId });
    assert.equal(link?.dependent_id ?? null, null);

    const delPdf = await call('/api/files/' + pdfId, { method: 'DELETE' });
    assert.equal(delPdf.status, 200, JSON.stringify(delPdf.data));
    assert.equal(await one('SELECT id FROM dbo.Files WHERE id=@id', { id: pdfId }), null);
  } finally {
    await cleanup();
    await new Promise((resolve) => server.close(resolve));
    try {
      await (await pool()).close();
    } catch {}
  }
});
