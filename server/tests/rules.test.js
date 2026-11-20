import test from 'node:test';import assert from 'node:assert/strict';
import{ageYears,dependentKind,moneyCents,centsMoney,isDependentAgeEligible,overlaps,blockDecision}from'../src/rules.js';
test('money cents never doubles due to binary rounding',()=>{assert.equal(moneyCents(600),60000);assert.equal(moneyCents(0.01),1);assert.equal(centsMoney(120001),'1200.01');assert.throws(()=>moneyCents(0.001));});
test('age boundary at term end',()=>{assert.equal(ageYears('2005-12-01',new Date('2026-11-30T12:00:00Z')),20);assert.equal(ageYears('2005-12-01',new Date('2026-12-01T12:00:00Z')),21);assert.equal(ageYears('2005-12-01',new Date('2027-12-01T12:00:00Z')),22);});
test('over-age child blocked unless proof verified through end date',()=>{const birth='2004-01-01';assert.equal(isDependentAgeEligible(birth,'2027-12-31',21,null).ok,false);assert.equal(isDependentAgeEligible(birth,'2027-12-31',21,{proof_file_id:17,verified_at:'2026-10-01',proof_type:'MEDICAL',proof_valid_until:'2027-01-01'}).ok,false);assert.equal(isDependentAgeEligible(birth,'2027-12-31',21,{proof_file_id:17,verified_at:'2026-10-01',proof_type:'MEDICAL',proof_valid_until:'2027-12-31'}).ok,true);});
test('dependent kinds and unknown classification',()=>{assert.equal(dependentKind('حفيد'), 'GRANDCHILD');assert.equal(dependentKind('ابن'), 'CHILD');assert.equal(dependentKind('زوجة'), 'SPOUSE');assert.equal(dependentKind('حرمه'), 'SPOUSE');assert.equal(dependentKind('حرم'), 'SPOUSE');assert.equal(dependentKind('نجله'), 'CHILD');assert.equal(dependentKind('كريمته'), 'CHILD');assert.equal(dependentKind('صديق'),null);assert.equal(dependentKind('زوج الابنة'),'INLAW');assert.equal(dependentKind('زوجة الابن'),'INLAW');assert.equal(dependentKind('زوجالابنة'),'INLAW');});
test('overlapping terms detected and touching terms overlap',()=>{assert.equal(overlaps('2026-11-01','2026-12-31','2026-12-31','2027-12-31'),true);assert.equal(overlaps('2026-01-01','2026-12-31','2027-01-01','2027-12-31'),false);});
import {shiftBalance,requireActualRefund} from '../src/finance-controls.js';
test('shift physical cash expected count handles payments and refunds exactly',()=>{
 assert.equal(shiftBalance(100,[{amount:600,method:'CASH'},{amount:400,method:'CARD'}],[{amount:90,refund_method:'CASH'}]),'610.00');
});
test('IdCard match denies and a shared name is only a collision warning',()=>{
 const exact=blockDecision('123',[{Id:1,IdCard:'123'}]);
 assert.equal(exact.deny.Id,1);
 assert.equal(exact.nameCollisions.length,0);
 const other=blockDecision('999',[{Id:2,IdCard:'123'}]);
 assert.equal(other.deny,null);
 assert.equal(other.nameCollisions[0].code,'NAME_COLLISION');
 assert.equal(other.nameCollisions[0].blocked_id,2);
 const blank=blockDecision('',[{Id:3,IdCard:''}]);
 assert.equal(blank.deny,null);
 assert.equal(blank.nameCollisions.length,1);
 const padded=blockDecision('123',[{Id:4,IdCard:' 123 '}]);
 assert.equal(padded.deny.Id,4);
});
test('refund cannot be silently marked complete without evidence and shift',()=>{
 assert.throws(()=>requireActualRefund({paid:100,confirmed:true}),/Refund requires/);
 assert.equal(requireActualRefund({paid:100,confirmed:true,method:'CASH',reference:'receipt 123',shiftId:4}).required,true);
 assert.equal(requireActualRefund({paid:0,confirmed:false}).required,false);
});
