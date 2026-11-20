import {describe,expect,it} from 'vitest';
import {deepMerge,getDefaultCardTemplate,getAt,mergeCardTemplate,setAt} from './card-template-utils.js';

describe('card template merge',()=>{
 it('preserves defaults when patching title position',()=>{
  const base=getDefaultCardTemplate();
  const merged=deepMerge(base,{title:{y:99}});
  expect(merged.title.y).toBe(99);
  expect(merged.title.text).toBe(base.title.text);
  expect(merged.width).toBe(1012);
 });
 it('includes overlay defaults for pre-printed stock',()=>{
  const t=getDefaultCardTemplate();
  expect(t.overlay).toBe(true);
  expect(t.duplex).toBe(false);
  expect(t.backSide?.enabled).toBe(false);
  expect(t.expiry?.label).toBeTruthy();
  expect(t.job?.label).toBe('الوظيفـــــة');
  expect(t.job?.y).toBe(404);
  expect(t.relation?.label).toBe('درجة القرابة');
  expect(t.number?.y).toBe(404);
  expect(t.expiry?.y).toBe(468);
  expect(t.photoPrimary.x).toBeGreaterThan(t.photo.x + t.photo.w);
  expect(t.photoPrimary.w).toBeLessThan(t.photo.w);
  expect(t.photoPrimary.h).toBeLessThan(t.photo.h);
  expect(t.signature?.lines?.length).toBeGreaterThanOrEqual(2);
 });
 it('setAt updates front gradient stop without corrupting array',()=>{
  const base=getDefaultCardTemplate();
  const next=setAt(base,['background','gradient',0],'#aabbcc');
  expect(getAt(next,['background','gradient',0])).toBe('#aabbcc');
  expect(next.background.gradient[1]).toBe(base.background.gradient[1]);
  expect(Array.isArray(next.background.gradient)).toBe(true);
 });
 it('setAt updates signature line text',()=>{
  const base=getDefaultCardTemplate();
  const next=setAt(base,['signature','lines',0],'سطر اختبار');
  expect(getAt(next,['signature','lines',0])).toBe('سطر اختبار');
  expect(next.signature.lines[1]).toBe(base.signature.lines[1]);
 });
 it('setAt updates nested text colors',()=>{
  const base=getDefaultCardTemplate();
  const next=setAt(base,['rank','color'],'#000000');
  expect(next.rank.color).toBe('#000000');
 });
 it('keeps back face disabled after merge unless explicitly enabled',()=>{
  const merged=mergeCardTemplate({
   backSide:{
    enabled:false,
    title:{text:'تعليمات العضوية'},
   },
  });
  expect(merged.duplex).toBe(false);
  expect(merged.backSide.enabled).toBe(false);
  expect(merged.overlay).toBe(true);
 });
});
