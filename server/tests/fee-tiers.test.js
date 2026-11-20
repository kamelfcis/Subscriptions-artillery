import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  legacyTierText,
  mapPriceListServiceCode,
  officialFeeLabel,
  parseLegacyMoney,
  parsePriceListLostCardAmount,
  pickPriceListRenewalRow,
  pickPriceListLostCardRow,
  lostCardPriceListCandidateQuery,
  priceListCatAliases,
  priceListImportRows,
  priceListJopAliases,
  priceListRowMatchesService,
  renewalPriceListCandidateQuery,
  PRICE_KIND,
} from '../src/fee-tiers.js';

test('parseLegacyMoney accepts renewal amounts', () => {
  assert.equal(parseLegacyMoney('150'), 150);
  assert.equal(parseLegacyMoney('150,50'), 150.5);
  assert.equal(parseLegacyMoney(''), null);
});

test('legacyTierText preserves Arabic tier labels exactly', () => {
  assert.equal(legacyTierText('  قوات مسلحة '), 'قوات مسلحة');
  assert.equal(legacyTierText('مدني'), 'مدني');
  assert.equal(legacyTierText(''), null);
});

test('priceListImportRows uses RDar only', () => {
  const rows = priceListImportRows({
    Cat: 'قوات مسلحة',
    Jop: 'ضابط',
    IdPrice: '01',
    FDar: '100',
    RDar: '200',
    FElrada: '999',
    RElnada: '888',
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.tier_cat === 'قوات مسلحة'));
  assert.ok(rows.every((r) => r.tier_jop === 'ضابط'));
  assert.ok(rows.every((r) => r.price_kind === PRICE_KIND.RENEWAL && r.amount === 200));
  assert.ok(!rows.some((r) => r.amount === 100 || r.amount === 999 || r.amount === 888));
});

test('officialFeeLabel is تجديد الدار', () => {
  assert.equal(officialFeeLabel(PRICE_KIND.RENEWAL), 'تجديد الدار');
});

test('pickPriceListRenewalRow matches Cat/Jop and IdPrice', () => {
  const list = [
    { id: 1, Cat: 'قوات مسلحة', Jop: 'ضابط', IdPrice: '01', RDar: '200' },
    { id: 2, Cat: 'مدني', Jop: null, IdPrice: '04', RDar: '50' },
  ];
  assert.equal(pickPriceListRenewalRow(list, '01', 'قوات مسلحة', 'ضابط')?.id, 1);
  assert.equal(pickPriceListRenewalRow(list, '04', 'مدني', null)?.id, 2);
});

test('priceListCatAliases maps Client.Cat to pricing PriceList cats including officer ranks', () => {
  assert.deepEqual(priceListCatAliases('عسكرى'), ['عسكرى', 'ضباط خدمة او متقاعد']);
  assert.ok(priceListCatAliases('مدنى').includes('مدنى'));
  assert.ok(priceListCatAliases('مدنى').includes('ضباط خدمة او متقاعد'));
  assert.ok(priceListCatAliases('أبناء').includes('أبناء'));
});

test('pickPriceListRenewalRow uses real PriceList Cat+Jop RDar, not Cat-only staging bridge', () => {
  const list = [
    { id: 1005, Cat: 'ضباط خدمة او متقاعد', Jop: 'رائد', IdPrice: '350', FDar: '700', RDar: '350' },
    { id: 1014, Cat: 'مدنى', Jop: 'عدد (1)', IdPrice: '0', FDar: '2500', RDar: '2200' },
    { id: 2000, Cat: 'مدنى', Jop: null, IdPrice: '01', RDar: '10' },
  ];
  assert.equal(pickPriceListRenewalRow(list, '01', 'عسكرى', 'رائد')?.id, 1005);
  assert.equal(pickPriceListRenewalRow(list, '01', 'مدنى', 'رائد')?.RDar, '350');
  assert.equal(pickPriceListRenewalRow(list, '01', 'مدنى', 'عدد (1)')?.id, 1014);
  // Member with jop must not fall through to Cat-only staging bridge.
  assert.notEqual(pickPriceListRenewalRow(list, '01', 'مدنى', 'رائد')?.id, 2000);
  assert.equal(pickPriceListRenewalRow(list, '02', 'عسكرى', 'رائد')?.id, 1005);
});

test('priceListRowMatchesService treats non-service IdPrice as any service', () => {
  assert.equal(priceListRowMatchesService('01', '01'), true);
  assert.equal(priceListRowMatchesService('01', '02'), false);
  assert.equal(priceListRowMatchesService('350', '01'), true);
  assert.equal(priceListRowMatchesService('350', '04'), true);
  assert.equal(priceListRowMatchesService('0', '01'), true);
});

test('renewalPriceListCandidateQuery joins Cat aliases and Jop', () => {
  const q = renewalPriceListCandidateQuery('عسكرى', 'رائد');
  assert.match(q.statement, /PriceList/);
  assert.equal(q.params.jop0, 'رائد');
  assert.equal(q.params.cat0, 'عسكرى');
  assert.equal(q.params.cat1, 'ضباط خدمة او متقاعد');
});

test('priceListJopAliases strips أركان حرب -اح to base PriceList rank', () => {
  assert.deepEqual(priceListJopAliases('عقيد-اح'), ['عقيد-اح', 'عقيد']);
  assert.ok(priceListJopAliases('عقيد -اح').includes('عقيد'));
  assert.ok(priceListJopAliases('ملازم أول-اح').includes('ملازم أول'));
  assert.deepEqual(priceListJopAliases('رائد'), ['رائد']);
});

test('pickPriceListRenewalRow matches عقيد-اح to PriceList عقيد', () => {
  const list = [
    { id: 1007, Cat: 'ضباط خدمة او متقاعد', Jop: 'عقيد', IdPrice: '450', FDar: '800', RDar: '350' },
    { id: 1005, Cat: 'ضباط خدمة او متقاعد', Jop: 'رائد', IdPrice: '350', FDar: '700', RDar: '350' },
  ];
  assert.equal(pickPriceListRenewalRow(list, '01', 'عسكرى', 'عقيد-اح')?.id, 1007);
  assert.equal(pickPriceListRenewalRow(list, '01', 'عسكرى', 'عقيد -اح')?.RDar, '350');
});

test('renewalPriceListCandidateQuery expands jop aliases for -اح', () => {
  const q = renewalPriceListCandidateQuery('عسكرى', 'عقيد-اح');
  assert.equal(q.params.jop0, 'عقيد-اح');
  assert.equal(q.params.jop1, 'عقيد');
  assert.match(q.statement, /@jop0/);
  assert.match(q.statement, /@jop1/);
});

test('mapPriceListServiceCode normalizes IdPrice', () => {
  assert.equal(mapPriceListServiceCode('03'), '03');
  assert.equal(mapPriceListServiceCode('3'), '03');
});

test('pickPriceListLostCardRow reads RElnada by Cat/Jop', () => {
  const list = [
    { id: 1, Cat: 'مدني', Jop: null, RElnada: '75' },
    { id: 2, Cat: 'ضباط خدمة او متقاعد', Jop: 'رائد', RElnada: '60' },
  ];
  assert.equal(pickPriceListLostCardRow(list, 'عسكرى', 'رائد')?.RElnada, '60');
  assert.equal(pickPriceListLostCardRow(list, 'مدنى', null)?.RElnada, '75');
});

test('lostCardPriceListCandidateQuery selects RElnada', () => {
  const q = lostCardPriceListCandidateQuery('مدنى', null);
  assert.match(q.statement, /RElnada/);
});

test('parsePriceListLostCardAmount ignores RElnada equal to RDar on same row', () => {
  const contaminated = { id: 1005, Cat: 'ضباط خدمة او متقاعد', Jop: 'رائد', RDar: '350', RElnada: '350' };
  assert.equal(parsePriceListLostCardAmount(contaminated), null);
  assert.equal(parsePriceListLostCardAmount({ ...contaminated, RElnada: '50' }), 50);
  assert.equal(parsePriceListLostCardAmount({ ...contaminated, RElnada: '' }), null);
});
