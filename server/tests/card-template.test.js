import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCardTemplate, deepMerge, normalizeCardTemplate, cardTemplateSchema } from '../src/card-template.js';

test('default card template matches CR80 overlay for pre-printed stock', () => {
  assert.equal(defaultCardTemplate.width, 1012);
  assert.equal(defaultCardTemplate.height, 638);
  assert.equal(defaultCardTemplate.duplex, false);
  assert.equal(defaultCardTemplate.overlay, true);
  assert.equal(defaultCardTemplate.backSide?.enabled, false);
  assert.ok(defaultCardTemplate.expiry?.label);
  assert.equal(defaultCardTemplate.job?.y, 404);
  assert.equal(defaultCardTemplate.job?.label, 'الوظيفـــــة');
  assert.equal(defaultCardTemplate.number?.y, 404);
  assert.equal(defaultCardTemplate.expiry?.y, 468);
  assert.ok(Array.isArray(defaultCardTemplate.signature?.lines));
});

test('deepMerge keeps defaults for omitted fields', () => {
  const merged = deepMerge(defaultCardTemplate, { name: { y: 300 } });
  assert.equal(merged.name.y, 300);
  assert.equal(merged.name.label, defaultCardTemplate.name.label);
  assert.equal(merged.photo.x, defaultCardTemplate.photo.x);
});

test('normalize rejects invalid dimensions', () => {
  assert.throws(() => normalizeCardTemplate({ width: 100, height: 638 }));
});

test('normalize accepts background gradient tweak', () => {
  const out = normalizeCardTemplate(
    deepMerge(defaultCardTemplate, {
      background: { gradient: ['#000000', '#111111', '#222222'] },
    }),
  );
  assert.deepEqual(out.background.gradient, ['#000000', '#111111', '#222222']);
  cardTemplateSchema.parse(out);
});

test('normalize keeps duplex false when back is disabled', () => {
  const out = normalizeCardTemplate(
    deepMerge(defaultCardTemplate, {
      backSide: { enabled: false },
    }),
  );
  assert.equal(out.duplex, false);
  assert.equal(out.overlay, true);
});

test('normalize rejects invalid hex color', () => {
  assert.throws(() =>
    normalizeCardTemplate(
      deepMerge(defaultCardTemplate, {
        rank: { color: 'red' },
      }),
    ),
  );
});

test('normalize merges null backSide from legacy rows onto disabled default', () => {
  const out = normalizeCardTemplate({ ...defaultCardTemplate, backSide: null });
  assert.equal(out.backSide.enabled, false);
  assert.equal(out.duplex, false);
});
