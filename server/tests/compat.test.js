import test from 'node:test';
import assert from 'node:assert/strict';
import {fileType, legacyImage, assertBackupTarget, paging, PAGE_SIZES} from '../src/core.js';

test('listed page sizes stay 10, 25, 50 and 100', () => {
  for (const size of PAGE_SIZES) assert.equal(paging({page: 1, pageSize: size}).size, size);
  assert.equal(paging({pageSize: 1000}).size, 100);
  assert.equal(paging({}).size, 25);
});

test('staging JFIF prefix is jpeg and is not rewritten', () => {
  const head = Buffer.from('ffd8ffe000104a464946000101010060', 'hex');
  assert.equal(fileType(head), 'image/jpeg');
  const parsed = legacyImage(head);
  assert.equal(parsed.mime, 'image/jpeg');
  assert.equal(parsed.bytes, head);
});

test('OLE wrapper is sliced only when a real image signature is inside', () => {
  const ole = Buffer.from('d0cf11e0a1b11ae1', 'hex');
  assert.equal(fileType(ole), 'application/octet-stream');
  assert.equal(legacyImage(ole).mime, 'application/octet-stream');
  const wrapped = Buffer.concat([ole, Buffer.from('ffd8ffe000104a464946', 'hex')]);
  const parsed = legacyImage(wrapped);
  assert.equal(parsed.mime, 'image/jpeg');
  assert.equal(parsed.bytes[0], 0xff);
  assert.equal(parsed.bytes[1], 0xd8);
});

test('backup refuses the live Subscriptions database unless explicitly allowed', () => {
  assert.equal(assertBackupTarget('Subscriptions_Staging', 'false'), 'Subscriptions_Staging');
  assert.throws(() => assertBackupTarget('Subscriptions', 'false'), (e) => e.code === 'LIVE_BACKUP_REFUSED');
  assert.throws(() => assertBackupTarget('subscriptions', undefined), (e) => e.code === 'LIVE_BACKUP_REFUSED');
  assert.equal(assertBackupTarget('Subscriptions', 'true'), 'Subscriptions');
  assert.throws(() => assertBackupTarget('Subscriptions]; DROP', 'true'), (e) => e.code === 'BACKUP_PATH');
});
