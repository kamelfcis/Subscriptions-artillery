import test from 'node:test';
import assert from 'node:assert/strict';
import { dependentListDate, mapDependentRenewalFields } from '../src/dependent-renewal.js';

test('dependent list date prefers active term, else last renewal, else birth', () => {
  assert.equal(dependentListDate('2027-06-01', '2025-12-31', '1990-01-01'), '2027-06-01');
  assert.equal(dependentListDate(null, '2025-12-31', '1990-01-01'), '2025-12-31');
  assert.equal(dependentListDate(null, null, '1990-01-01'), '1990-01-01');
  assert.equal(dependentListDate(null, null, null), null);
});

test('can_print only when ACTIVE renewal covers today', () => {
  const renewed = mapDependentRenewalFields({
    id: 1,
    age: '2000-01-01',
    latest_renewal_term_to: new Date('2027-12-31'),
    active_term_to: new Date('2027-12-31'),
  });
  assert.equal(renewed.renewal_active, true);
  assert.equal(renewed.can_print, true);

  const stale = mapDependentRenewalFields({
    id: 2,
    age: '2010-05-05',
    latest_renewal_term_to: '2022-02-10',
    active_term_to: null,
  });
  assert.equal(stale.renewal_active, false);
  assert.equal(stale.can_print, false);
  assert.equal(stale.display_date, '2022-02-10');
});