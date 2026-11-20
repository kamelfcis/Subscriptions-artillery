const PREFIX = '01|02|03|04';

function foldDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/**
 * Canonical display: category then serial, left-to-right (`01-100`).
 * Keep in sync with web/src/membership-id.js.
 */
export function formatMembershipId(value) {
  const original = value == null ? '' : String(value);
  const trimmed = foldDigits(original.trim());
  const m = trimmed.match(new RegExp('^(' + PREFIX + ')-(\\d+)$'));
  if (!m) return original;
  return m[1] + '-' + m[2];
}

/**
 * Normalize search input to the stored key `01-100`.
 * Accepts canonical form or legacy reversed `100-01`.
 * Keep in sync with web/src/membership-id.js.
 */
export function parseMembershipId(value) {
  const original = value == null ? '' : String(value);
  const trimmed = foldDigits(original.trim());
  if (new RegExp('^(?:' + PREFIX + ')-\\d+$').test(trimmed)) return trimmed;
  const shown = trimmed.match(new RegExp('^(\\d+)-(' + PREFIX + ')$'));
  if (shown) return shown[2] + '-' + shown[1];
  return original;
}