// Finance controls shared between REST handlers and executable offline tests.
import {moneyCents,centsMoney} from './rules.js';
export function shiftBalance(openingFloat,payments,refunds){
  const opening=moneyCents(openingFloat);
  const received=payments.filter(p=>p.method==='CASH').reduce((sum,p)=>sum+moneyCents(p.amount),0);
  const returned=refunds.filter(p=>p.refund_method==='CASH').reduce((sum,p)=>sum+moneyCents(p.amount),0);
  return centsMoney(opening+received-returned);
}
export function requireActualRefund({paid,confirmed,method,reference,shiftId}){
  if(moneyCents(paid)===0)return {required:false};
  if(!confirmed||!['CASH','CARD','TRANSFER'].includes(method)||!reference||reference.trim().length<5||!Number.isSafeInteger(shiftId)||shiftId<=0){
    throw new Error('Refund requires explicit approval, method, transaction reference and open shift');
  }
  return {required:true};
}
