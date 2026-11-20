import { formatMembershipId } from './membership-id.js';

/** Same tatweel style as الرتبـــــــــة / الاســــــــــم on the stock overlay. */
export const VIP_JOB_LABEL = 'الوظيفـــــة';

/** Printed between the primary name and the membership number on a dependent card. */
export const RELATION_LABEL = 'درجة القرابة';

/**
 * Expiry is always printed in the white overlay.
 * The header year stays on the pre-printed stock and in preview chrome only — never omitted, never drawn into the white area.
 */
export function cardVipFlags(member, options = {}) {
  const isVip = !!(options.isVip ?? member?.is_vip);
  return { isVip, omitExpiry: false, omitPreviewYear: false };
}

/** Officer card: IdClient 01-/02-, or a military category (عسكر / ضابط). Everyone else uses the job line. */
export function isOfficerMember(member) {
  const id = String(member?.IdClient || '').trim();
  if (/^(01|02)-/.test(id)) return true;
  return /عسكر|ضابط/.test(String(member?.Cat ?? member?.cat ?? ''));
}

/** Printed membership number is always the primary IdClient (01-100, LTR). Dependents do not get an id suffix. */
export function membershipNumber(member, _dependent) {
  return formatMembershipId(String(member?.IdClient || '').trim());
}

export function relationValue(dependent) {
  const rel = String(dependent?.realation ?? dependent?.relation ?? '').trim();
  const name = String(dependent?.Name ?? '').trim();
  if (rel && name) return `${rel} / ${name}`;
  return rel || name;
}

function anchorY(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Four lines keep the stock slots. A dependent's fifth line is spaced evenly from rank Y to expiry Y. */
export function cardLineYs(layout = {}, count = 4) {
  const rankY = anchorY(layout.rank?.y, 276);
  const nameY = anchorY(layout.name?.y, 340);
  const numberY = anchorY(layout.number?.y, 404);
  const expiryY = anchorY(layout.expiry?.y, 468);
  if (count === 4) return [rankY, nameY, numberY, expiryY];
  const n = Math.max(1, count);
  if (n === 1) return [rankY];
  const end = expiryY > rankY ? expiryY : rankY + 64 * (n - 1);
  const step = (end - rankY) / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(rankY + step * i));
}

function roleLine(member, layout) {
  if (isOfficerMember(member)) {
    return {
      key: 'role',
      styleKey: 'rank',
      label: layout.rank?.label || 'الرتبـــــــــة',
      value: String(member?.jop || '').trim(),
    };
  }
  const job = String(member?.vip_job ?? '').trim() || String(member?.jop || '').trim();
  return {
    key: 'role',
    styleKey: 'job',
    label: layout.job?.label || VIP_JOB_LABEL,
    value: job,
  };
}

/**
 * White-overlay lines, top to bottom.
 * Primary: rank/job, primary name, membership number, expiry.
 * Dependent: the same, with درجة القرابة between the name and the number.
 * Line 2 is always the primary member name.
 */
export function cardOverlayLines(member, dependent, layout = {}, options = {}) {
  const lines = [
    roleLine(member, layout),
    {
      key: 'name',
      styleKey: 'name',
      label: layout.name?.label || 'الاســــــــــم',
      value: String(member?.Name || '').trim(),
    },
  ];
  if (dependent) {
    lines.push({
      key: 'relation',
      styleKey: 'relation',
      label: layout.relation?.label || RELATION_LABEL,
      value: relationValue(dependent),
    });
  }
  lines.push({
    key: 'number',
    styleKey: 'number',
    label: layout.number?.label || 'رقم العضوية',
    value: membershipNumber(member, dependent),
  });
  const expiryText = options.expiryText;
  lines.push({
    key: 'expiry',
    styleKey: 'expiry',
    label: layout.expiry?.label || 'ينتهى فى',
    value: expiryText == null ? '' : String(expiryText),
  });
  const ys = cardLineYs(layout, lines.length);
  return lines.map((line, i) => ({ ...line, y: ys[i] }));
}

/** Keep overlay text to the right of a second photo so the primary portrait is not covered. */
export function overlayTextMaxWidth(layout, block, photoBox) {
  const configured = Number(block?.maxWidth) || 640;
  if (!photoBox) return configured;
  const cardW = Number(layout?.width) || 1012;
  const right = cardW - (Number(block?.xFromRight) || 52);
  const photoRight = (Number(photoBox.x) || 0) + (Number(photoBox.w) || 0);
  const room = right - photoRight - 16;
  if (!(room > 0)) return configured;
  return Math.min(configured, room);
}

/**
 * Primary card: one photo in layout.photo.
 * Dependent card: dependent photo in that box, plus the primary photo in the smaller box to its right.
 */
export function cardPhotoSlots(member, dependent, layout = {}) {
  const primaryUrl = '/api/members/' + encodeURIComponent(member?.IdClient || '') + '/photo';
  const slots = [
    {
      key: 'photo',
      box: layout.photo || null,
      url: dependent ? '/api/dependents/' + dependent.id + '/photo' : primaryUrl,
      who: dependent ? 'dependent' : 'primary',
    },
  ];
  if (dependent && layout.photoPrimary) {
    slots.push({
      key: 'photoPrimary',
      box: layout.photoPrimary,
      url: primaryUrl,
      who: 'primary',
    });
  }
  return slots;
}
