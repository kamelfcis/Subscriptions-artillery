import { describe, expect, it } from 'vitest';
import { formatMembershipId, parseMembershipId } from './membership-id';

describe('membership id display', () => {
  it('shows category-serial from left to right (01-100)', () => {
    expect(formatMembershipId('01-100')).toBe('01-100');
    expect(formatMembershipId('02-3829')).toBe('02-3829');
    expect(formatMembershipId('04-1300')).toBe('04-1300');
    expect(formatMembershipId('03-12')).toBe('03-12');
    expect(formatMembershipId(' 01-9 ')).toBe('01-9');
  });

  it('parses the displayed form back to the stored key and keeps a stored key', () => {
    expect(parseMembershipId('100-01')).toBe('01-100');
    expect(parseMembershipId('3829-02')).toBe('02-3829');
    expect(parseMembershipId('1300-04')).toBe('04-1300');
    expect(parseMembershipId('12-03')).toBe('03-12');
    expect(parseMembershipId('01-100')).toBe('01-100');
    expect(parseMembershipId('04-1288')).toBe('04-1288');
  });

  it('leaves values that are not prefix-serial unchanged', () => {
    expect(formatMembershipId('3659')).toBe('3659');
    expect(formatMembershipId('77')).toBe('77');
    expect(formatMembershipId('abc')).toBe('abc');
    expect(formatMembershipId('')).toBe('');
    expect(parseMembershipId('3659')).toBe('3659');
    expect(parseMembershipId('77')).toBe('77');
    expect(parseMembershipId('not-an-id')).toBe('not-an-id');
    expect(parseMembershipId('')).toBe('');
  });
});
