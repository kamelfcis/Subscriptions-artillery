import { describe, expect, it } from 'vitest';
import defaultTemplate from './card-template.json';
import {
  RELATION_LABEL,
  VIP_JOB_LABEL,
  cardLineYs,
  cardOverlayLines,
  cardPhotoSlots,
  cardVipFlags,
  isOfficerMember,
  membershipNumber,
  overlayTextMaxWidth,
  relationValue,
} from './card-vip.js';

const officer = {
  IdClient: '01-1300',
  Name: 'أحمد محمد علي',
  jop: 'عقيد',
  vip_job: 'مدير إدارة',
  Cat: 'عسكرى',
  is_vip: true,
};

const civilian = {
  IdClient: '04-1300',
  Name: 'رضوى مصطفى',
  jop: 'محاسب',
  vip_job: 'مدير إدارة',
  Cat: 'مدنى',
  is_vip: true,
};

const daughter = { id: 17, Name: 'ليلى أحمد', realation: 'كريمته', seq: 3, DepNo: 2 };

describe('card VIP flags', () => {
  it('keeps expiry and the preview header year for VIP members', () => {
    expect(cardVipFlags({ is_vip: true })).toEqual({ isVip: true, omitExpiry: false, omitPreviewYear: false });
    expect(cardVipFlags({ is_vip: 1 }, {})).toEqual({ isVip: true, omitExpiry: false, omitPreviewYear: false });
  });
  it('keeps expiry and the preview header year for non-VIP members', () => {
    expect(cardVipFlags({ is_vip: false })).toEqual({ isVip: false, omitExpiry: false, omitPreviewYear: false });
    expect(cardVipFlags({})).toEqual({ isVip: false, omitExpiry: false, omitPreviewYear: false });
  });
  it('lets an explicit options.isVip override the member flag without hiding expiry', () => {
    expect(cardVipFlags({ is_vip: false }, { isVip: true })).toEqual({
      isVip: true,
      omitExpiry: false,
      omitPreviewYear: false,
    });
  });
});

describe('printed membership number', () => {
  it('is always the primary IdClient, with no dependent suffix', () => {
    expect(membershipNumber(civilian)).toBe('04-1300');
    expect(membershipNumber(civilian, daughter)).toBe('04-1300');
    expect(membershipNumber(civilian, { id: 8, seq: 3, DepNo: 2, dep_no: 4 })).toBe('04-1300');
    expect(membershipNumber({ IdClient: ' 01-9 ' }, { id: 1 })).toBe('01-9');
  });
});

describe('card overlay lines', () => {
  it('prints rank then primary name, number, and expiry for officers', () => {
    expect(isOfficerMember(officer)).toBe(true);
    expect(isOfficerMember({ IdClient: '02-44', Name: 'معاش', jop: 'عميد' })).toBe(true);
    expect(isOfficerMember({ IdClient: '77', Name: 'قديم', jop: 'نقيب', Cat: 'ضابط' })).toBe(true);
    expect(isOfficerMember({ IdClient: '88', Name: 'قديم', jop: 'رائد', Cat: 'عسكرى' })).toBe(true);

    const lines = cardOverlayLines(officer, null, defaultTemplate, { expiryText: '31-12-2027' });
    expect(lines.map((line) => line.key)).toEqual(['role', 'name', 'number', 'expiry']);
    expect(lines.map((line) => line.label)).toEqual([
      defaultTemplate.rank.label,
      defaultTemplate.name.label,
      'رقم العضوية',
      'ينتهى فى',
    ]);
    expect(lines.map((line) => line.value)).toEqual(['عقيد', 'أحمد محمد علي', '01-1300', '31-12-2027']);
    expect(lines[0].styleKey).toBe('rank');
    expect(lines.map((line) => line.y)).toEqual([
      defaultTemplate.rank.y,
      defaultTemplate.name.y,
      defaultTemplate.number.y,
      defaultTemplate.expiry.y,
    ]);
    expect(lines.some((line) => line.key === 'relation')).toBe(false);
  });

  it('prints the job label and vip_job, falling back to jop, for civilians', () => {
    expect(isOfficerMember(civilian)).toBe(false);
    expect(isOfficerMember({ IdClient: '04-1', Cat: 'مدني' })).toBe(false);
    expect(isOfficerMember({ IdClient: '03-20', Name: 'أسرة', jop: 'أبناء', Cat: 'أبناء' })).toBe(false);

    const withJob = cardOverlayLines(civilian, null, defaultTemplate, { expiryText: '01-01-2028' });
    expect(withJob[0]).toMatchObject({ styleKey: 'job', label: VIP_JOB_LABEL, value: 'مدير إدارة', y: defaultTemplate.rank.y });
    expect(withJob.map((line) => line.value)).toEqual(['مدير إدارة', 'رضوى مصطفى', '04-1300', '01-01-2028']);
    expect(withJob.map((line) => line.key)).toEqual(['role', 'name', 'number', 'expiry']);

    const fallback = cardOverlayLines(
      { IdClient: '04-1300', Name: 'رضوى مصطفى', jop: 'محاسب', vip_job: '   ', Cat: 'مدنى' },
      null,
      defaultTemplate,
    );
    expect(fallback[0]).toMatchObject({ label: defaultTemplate.job.label, value: 'محاسب' });

    const children = cardOverlayLines({ IdClient: '03-20', Name: 'أسرة', jop: 'أبناء', Cat: 'أبناء' }, null, defaultTemplate);
    expect(children[0]).toMatchObject({ label: VIP_JOB_LABEL, value: 'أبناء' });
  });

  it('keeps the primary name and inserts the relation line on a dependent card', () => {
    const lines = cardOverlayLines(civilian, daughter, defaultTemplate, { expiryText: '15-06-2027' });
    expect(lines.map((line) => line.key)).toEqual(['role', 'name', 'relation', 'number', 'expiry']);
    expect(lines.map((line) => line.label)).toEqual([
      VIP_JOB_LABEL,
      defaultTemplate.name.label,
      RELATION_LABEL,
      'رقم العضوية',
      'ينتهى فى',
    ]);
    expect(lines.map((line) => line.value)).toEqual([
      'مدير إدارة',
      'رضوى مصطفى',
      'كريمته / ليلى أحمد',
      '04-1300',
      '15-06-2027',
    ]);
    expect(lines.map((line) => line.y)).toEqual([276, 324, 372, 420, 468]);
    expect(relationValue(daughter)).toBe('كريمته / ليلى أحمد');
  });

  it('prints rank and the primary name on an officer dependent card', () => {
    const lines = cardOverlayLines(officer, { id: 9, Name: 'الابن', realation: 'نجله' }, defaultTemplate);
    expect(lines[0]).toMatchObject({ label: defaultTemplate.rank.label, value: 'عقيد' });
    expect(lines[1].value).toBe('أحمد محمد علي');
    expect(lines[2]).toMatchObject({ key: 'relation', label: 'درجة القرابة', value: 'نجله / الابن' });
    expect(lines[3].value).toBe('01-1300');
    expect(lines.find((line) => line.key === 'expiry')).toMatchObject({ y: 468 });
  });

  it('still prints expiry for a VIP member instead of dropping the line', () => {
    const lines = cardOverlayLines(
      { IdClient: '04-1', Name: 'وزير سابق', jop: 'موظف', vip_job: 'وزير', is_vip: true, Cat: 'مدنى' },
      null,
      defaultTemplate,
      { expiryText: '31-12-2026' },
    );
    expect(lines.find((line) => line.key === 'expiry')).toMatchObject({ value: '31-12-2026', y: defaultTemplate.expiry.y });
    expect(lines.find((line) => line.key === 'number').y).toBe(defaultTemplate.number.y);
  });

  it('spaces five lines between the rank slot and the expiry slot', () => {
    expect(cardLineYs(defaultTemplate, 4)).toEqual([276, 340, 404, 468]);
    expect(cardLineYs(defaultTemplate, 5)).toEqual([276, 324, 372, 420, 468]);
  });
});

describe('card photos', () => {
  it('prints one photo for the primary member', () => {
    const slots = cardPhotoSlots(civilian, null, defaultTemplate);
    expect(slots).toEqual([
      {
        key: 'photo',
        box: defaultTemplate.photo,
        url: '/api/members/04-1300/photo',
        who: 'primary',
      },
    ]);
  });

  it('prints the dependent photo and a smaller primary photo to its right', () => {
    const slots = cardPhotoSlots(civilian, daughter, defaultTemplate);
    expect(slots.map((slot) => slot.who)).toEqual(['dependent', 'primary']);
    expect(slots[0]).toMatchObject({
      key: 'photo',
      box: defaultTemplate.photo,
      url: '/api/dependents/17/photo',
    });
    expect(slots[1]).toMatchObject({
      key: 'photoPrimary',
      box: defaultTemplate.photoPrimary,
      url: '/api/members/04-1300/photo',
    });
    const main = defaultTemplate.photo;
    const primary = defaultTemplate.photoPrimary;
    expect(primary.x).toBeGreaterThan(main.x + main.w);
    expect(primary.w).toBeLessThan(main.w);
    expect(primary.h).toBeLessThan(main.h);
    expect(primary.y + primary.h).toBe(main.y + main.h);

    const width = overlayTextMaxWidth(defaultTemplate, defaultTemplate.name, primary);
    const right = defaultTemplate.width - defaultTemplate.name.xFromRight;
    expect(width).toBeLessThan(defaultTemplate.name.maxWidth);
    expect(right - width).toBeGreaterThanOrEqual(primary.x + primary.w + 16);
    expect(overlayTextMaxWidth(defaultTemplate, defaultTemplate.name, null)).toBe(defaultTemplate.name.maxWidth);
  });
});
