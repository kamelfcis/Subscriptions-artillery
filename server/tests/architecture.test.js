import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const load=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=load('sql/01_additive_migration.sql');
const legacy=load('src/legacy.js');
const renewals=load('src/renewals.js');

test('legacy schema remains untouched by additive migration',()=>{
  const old=['Client','SubClient','Files','subscriptioninf','bill','Blocked','PriceList','tbluser','admin'];
  for(const table of old){
    assert.doesNotMatch(migration,new RegExp(`\\b(?:ALTER|DROP|TRUNCATE)\\s+TABLE\\s+(?:dbo\\.)?\\[?${table}\\]?\\b`,'i'));
  }
  assert.match(migration,/IF OBJECT_ID\('dbo.AppRenewals'/);
});
test('transactional and idempotent renewal code exists',()=>{
 assert.match(renewals,/sp_getapplock/);
 assert.match(renewals,/request_key/);
 assert.match(renewals,/conflictRows/);
 assert.match(renewals,/assertOpenShift/);
 assert.match(renewals,/await audit/);
});
test('images remain in original SQL Server binary fields',()=>{
 assert.match(legacy,/SELECT PicPath image FROM dbo.Client/);
 assert.match(legacy,/UPDATE dbo.Client SET PicPath=/);
 assert.match(legacy,/SELECT f.filename image FROM dbo.Files/);
});
