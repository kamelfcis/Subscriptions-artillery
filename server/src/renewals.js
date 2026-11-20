import {Router} from 'express';
import {z} from 'zod';
import {rows,one,run,audit,transactional} from './db.js';
import {wrap,fail,date,money,moneyCents,centsMoney,ageYears,dependentKind,paginateParams,asyncList,intId} from './core.js';
import {permit,permissions as rolePermissions} from './auth.js';
import {isDependentAgeEligible} from './rules.js';
import {requireActualRefund,shiftBalance} from './finance-controls.js';
import {assessBlock} from './blocklist.js';
import {legacyTierText,parseLegacyMoney,parsePriceListLostCardAmount,pickPriceListRenewalRow,pickPriceListLostCardRow,renewalPriceListCandidateQuery,lostCardPriceListCandidateQuery} from './fee-tiers.js';
import {activePrimaryRenewal,activeDependentRenewal} from './dependent-renewal.js';
import {formatMembershipId,parseMembershipId} from './membership-id.js';
const r=Router();
const today=()=>{const f=new Intl.DateTimeFormat('en-US',{timeZone:process.env.BUSINESS_TIME_ZONE||'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'});const a=Object.fromEntries(f.formatToParts(new Date()).map(x=>[x.type,x.value]));return a.year+'-'+a.month+'-'+a.day;};
const dayString=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const dayAfter=v=>{const d=new Date(dayString(v)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const compare=(a,b)=>dayString(a).localeCompare(dayString(b));
const quoteShape=z.object({client_id:z.string().min(1).max(50),dependent_id:z.coerce.number().int().positive().nullable().optional(),service_code:z.enum(['01','02','03','04']),purpose:z.enum(['RENEWAL','LOST_CARD']).default('RENEWAL'),term_to:date.optional(),confirm_same_identity:z.boolean().optional(),skip_age_check:z.boolean().optional()});
const renewalShape=quoteShape.extend({request_key:z.string().uuid(),amount_paid:money,method:z.enum(['CASH','CARD','TRANSFER']).optional(),payment_reference:z.string().max(80).optional(),shift_id:z.number().int().positive().optional(),note:z.string().max(300).optional()});
const paymentShape=z.object({request_key:z.string().uuid(),amount:money.refine(v=>v>0),method:z.enum(['CASH','CARD','TRANSFER']),reference:z.string().max(80).optional(),shift_id:z.number().int().positive()});
/** Legacy dbo.Blocked watchlist (names / national ids) — never migrated into Client; checked as-is. */
function denyBlocked(gate,who,confirmSame){
 if(gate.deny)fail('SECURITY_BLOCK','محظور أمنيًا — رقم الهوية لل'+who+' مطابق لقائمة المحظورين (مرجع '+gate.deny.Id+')',403);
 if(confirmSame&&gate.nameCollisions?.length)fail('SECURITY_BLOCK','محظور أمنيًا — تم تأكيد تطابق اسم ال'+who+' مع قائمة المحظورين (مرجع '+(gate.nameCollisions[0].blocked_id||gate.nameCollisions[0].id)+')',403);
 return gate.nameCollisions||[];
}
async function latestParent(clientId,t=null){const result=await one(`SELECT MAX(end_date) last_date FROM (
 SELECT MAX(todate) end_date FROM dbo.subscriptioninf WHERE clientid=@id AND (active IS NULL OR active NOT IN (N'لا',N'0'))
 UNION ALL SELECT MAX(term_to) end_date FROM dbo.AppRenewals WHERE client_id=@id AND status='ACTIVE' AND dependent_id IS NULL
 ) x`,{id:clientId},t);return result?.last_date?dayString(result.last_date):null;}
async function latestDependent(clientId,dependentId,t=null){const result=await one(`SELECT MAX(term_to) last_date FROM dbo.AppRenewals WHERE client_id=@client AND dependent_id=@dep AND status='ACTIVE'`,{client:clientId,dep:dependentId},t);return result?.last_date?dayString(result.last_date):null;}
async function setting(key,t=null){return (await one('SELECT setting_value value FROM dbo.AppSettings WHERE setting_key=@key',{key},t))?.value;}
async function resolveLostCardFee(client,t=null){
 const tierCat=String(client.Cat||'').trim()||null;
 const tierJop=String(client.jop||'').trim()||null;
 const {statement,params}=lostCardPriceListCandidateQuery(tierCat,tierJop);
 const list=await rows(statement,params,t);
 const priceListRow=pickPriceListLostCardRow(list,tierCat,tierJop);
 let amount=parsePriceListLostCardAmount(priceListRow);
 let lost_card_price_source='default';
 if(amount!==null){
  lost_card_price_source='row';
 }else{
  const fallback=(await setting('lost_card_fee_default',t))||(await setting('benefit_substitute_default',t));
  const parsed=parseLegacyMoney(fallback);
  amount=parsed===null?50:parsed;
 }
 const matched_cat=legacyTierText(priceListRow?.Cat)??tierCat;
 const matched_jop=legacyTierText(priceListRow?.Jop)??tierJop;
 return {amount,priceListRow,lost_card_price_source,matched_cat,matched_jop};
}
async function validateLostCardQuote(d,t=null){
 const client=await one(`SELECT c.IdClient,c.Name,c.IdCard,c.age,c.Cat,c.jop,c.alive,ISNULL(f.is_archived,0) archived,ISNULL(f.is_security_blocked,0) security_blocked,f.security_block_reason,ISNULL(f.is_vip,0) is_vip FROM dbo.Client c LEFT JOIN dbo.AppClientFlags f ON f.client_id=c.IdClient WHERE c.IdClient=@id`,{id:d.client_id},t);
 if(!client||client.archived)fail('CLIENT_UNAVAILABLE','العضو غير موجود أو مؤرشف',404);
 if(client.security_blocked)fail('SECURITY_BLOCK','محظور أمنيًا'+(client.security_block_reason?' — '+client.security_block_reason:''),403);
 const nameCollisions=denyBlocked(await assessBlock(client.Name,client.IdCard,t),'عضو',!!d.confirm_same_identity).map(x=>({...x,who:'MAIN'}));
 let dependent=null;
 if(d.dependent_id){
  dependent=await one(`SELECT s.id,s.IdClient,s.Name,s.IdCard,s.age,s.realation,ISNULL(f.is_archived,0) archived FROM dbo.SubClient s LEFT JOIN dbo.AppDependentFlags f ON f.dependent_id=s.id WHERE s.id=@dep AND s.IdClient=@id`,{dep:d.dependent_id,id:d.client_id},t);
  if(!dependent||dependent.archived)fail('DEPENDENT_UNAVAILABLE','التابع غير موجود أو مؤرشف',404);
  nameCollisions.push(...denyBlocked(await assessBlock(dependent.Name,dependent.IdCard,t),'تابع',!!d.confirm_same_identity).map(x=>({...x,who:'DEPENDENT'})));
 }
 const activeSub=d.dependent_id?await activeDependentRenewal(d.client_id,d.dependent_id,t):await activePrimaryRenewal(d.client_id,t);
 if(!activeSub)fail('NO_ACTIVE_SUBSCRIPTION','لا يوجد اشتراك ساري اليوم — بدل فاقد يتطلب تجديداً نشطاً يغطي تاريخ اليوم',409);
 const {amount,priceListRow,lost_card_price_source,matched_cat,matched_jop}=await resolveLostCardFee(client,t);
 const svc=d.service_code||activeSub.service_code||'01';
 return {client_id:d.client_id,dependent_id:d.dependent_id||null,service_code:svc,purpose:'LOST_CARD',transaction_kind:'LOST_CARD',term_from:dayString(activeSub.term_from),term_to:dayString(activeSub.term_to),amount_due:amount,fee_id:null,price_list_id:priceListRow?.id??null,exemption_id:null,fee_label:'بدل فاقد — '+amount+' ج.م',lost_card_price_source,matched_cat,matched_jop,is_vip:!!client.is_vip,customer_name:dependent?.Name||client.Name,parent_end:null,acting_guardian:false,name_collisions:nameCollisions};
}
async function validateQuote(d,t=null){
 if(d.purpose==='LOST_CARD')return validateLostCardQuote(d,t);
 if(!d.term_to)fail('TERM_REQUIRED','حدد تاريخ انتهاء الفترة الجديدة',409);
 const client=await one(`SELECT c.IdClient,c.Name,c.IdCard,c.age,c.Cat,c.jop,c.alive,ISNULL(f.is_archived,0) archived,ISNULL(f.is_security_blocked,0) security_blocked,f.security_block_reason,ISNULL(f.is_vip,0) is_vip FROM dbo.Client c LEFT JOIN dbo.AppClientFlags f ON f.client_id=c.IdClient WHERE c.IdClient=@id`,{id:d.client_id},t);
 if(!client||client.archived)fail('CLIENT_UNAVAILABLE','العضو غير موجود أو مؤرشف',404);
 // Dual security gate (both required): (1) member-level AppClientFlags.is_security_blocked — (2) legacy dbo.Blocked name/IdCard list unchanged, not linked to members.
 if(client.security_blocked)fail('SECURITY_BLOCK','محظور أمنيًا'+(client.security_block_reason?' — '+client.security_block_reason:''),403);
 const nameCollisions=denyBlocked(await assessBlock(client.Name,client.IdCard,t),'عضو',!!d.confirm_same_identity).map(x=>({...x,who:'MAIN'}));
 const service=await one('SELECT active FROM dbo.AppServices WHERE code=@code',{code:d.service_code},t);if(!service?.active)fail('SERVICE_DISABLED','الفئة غير مفعلة أو غير موجودة',409);
 // Service 03 is only for a primary whose class is أبناء (IdClient 03- / Cat أبناء). Their own renewal uses PriceList.RDar.
 // A dependent child or grandchild renews under the primary's service code and is not forced onto 03.
 if(!d.dependent_id&&d.service_code==='03'){
  const primaryAbna=/^03-/.test(String(client.IdClient||''))||/أبنا/.test(String(client.Cat||''));
  if(!primaryAbna)fail('WRONG_SERVICE','كود الأبناء 03 لا يُستخدم للعضو الأساسي إلا لفئة أبناء (03-)',409);
 }
 const deceased=/متوف|وفاة|متوفي|deceased|dead/i.test(client.alive||'');
 if(deceased&&!d.dependent_id)fail('DECEASED_MAIN','لا يتم تجديد بطاقة المتوفى؛ جدّد الزوجة أو الأبناء',409);
 const isVip=!!client.is_vip;
 let dependent=null,eligibility=null,kind=null;
 if(d.dependent_id){dependent=await one(`SELECT s.id,s.IdClient,s.Name,s.IdCard,s.age,s.realation,ISNULL(f.is_archived,0) archived FROM dbo.SubClient s LEFT JOIN dbo.AppDependentFlags f ON f.dependent_id=s.id WHERE s.id=@dep AND s.IdClient=@id`,{dep:d.dependent_id,id:d.client_id},t);if(!dependent||dependent.archived)fail('DEPENDENT_UNAVAILABLE','التابع غير موجود أو مؤرشف',404);
 nameCollisions.push(...denyBlocked(await assessBlock(dependent.Name,dependent.IdCard,t),'تابع',!!d.confirm_same_identity).map(x=>({...x,who:'DEPENDENT'})));
 if(!deceased){
  const parentEnd=await latestParent(d.client_id,t);if(!parentEnd||compare(parentEnd,today())<0)fail('PARENT_NOT_ACTIVE','يجب تجديد العضو الأساسي أولاً',409);
  if(compare(parentEnd,d.term_to)<0)fail('DEPENDENT_AFTER_PARENT','تاريخ انتهاء التابع لا يمكن أن يتجاوز انتهاء الأساسي',409);
 }
 eligibility=await one('SELECT * FROM dbo.AppEligibility WHERE dependent_id=@dep',{dep:d.dependent_id},t);
 kind=eligibility?.dependent_kind||dependentKind(dependent.realation);
 const skipKindGates=kind==='INLAW'||kind==='SPOUSE'||(!kind&&isVip);
 if(!kind&&!isVip)fail('DEPENDENT_KIND_REQUIRED','يجب تصنيف علاقة التابع واعتمادها أولاً',409);
 if(!skipKindGates&&['CHILD','GRANDCHILD'].includes(kind)){
 const limit=Number(await setting(kind==='CHILD'?'age_limit_children':'age_limit_grandchildren',t)||21);
 const assessed=isDependentAgeEligible(dependent.age,d.term_to,limit,eligibility?{...eligibility,proof_valid_until:eligibility.proof_valid_until?dayString(eligibility.proof_valid_until):null}:null);
 const skipAge=!!d.skip_age_check;
 if(skipAge&&!d._skipAgeAllowed)fail('FORBIDDEN','تخطي فحص السن يتطلب صلاحية اعتماد (مشرف)',403);
 if(!skipAge){
  if(assessed.reason==='DOB_REQUIRED')fail('DOB_REQUIRED','تاريخ الميلاد غير صالح أو يقع في المستقبل',409);
  if(!assessed.ok){fail('PROOF_REQUIRED','تم تجاوز السن المحدد ('+limit+') خلال مدة التجديد. يلزم إثبات علاجي عائلي معتمد وساري حتى نهاية المدة',409);}
  if(assessed.age>limit){const f=await one(`SELECT f.id FROM dbo.Files f LEFT JOIN dbo.AppFileFlags x ON x.file_id=f.id WHERE f.id=@id AND f.clientid=@client AND ISNULL(x.is_archived,0)=0`,{id:eligibility.proof_file_id,client:d.client_id},t);if(!f)fail('PROOF_MISSING','مستند الإثبات غير موجود أو مؤرشف',409);}
 }
 }
 }
 const last=d.dependent_id?await latestDependent(d.client_id,d.dependent_id,t):await latestParent(d.client_id,t);
 const start=last&&compare(last,today())>=0?dayAfter(last):today();
 if(compare(d.term_to,start)<0)fail('INVALID_TERM','تاريخ نهاية الاشتراك يجب أن يكون بعد بداية المدة '+start);
 const exemption=await one(`SELECT TOP 1 id,type,reason FROM dbo.AppExemptions WHERE client_id=@client AND active=1 AND ( (dependent_id=@dep) OR (dependent_id IS NULL AND @dep IS NULL)) AND valid_from<=@start AND (valid_until IS NULL OR valid_until>=@end) ORDER BY id DESC`,{client:d.client_id,dep:d.dependent_id||null,start,end:d.term_to},t);
 let fee=null;
 let priceListRow=null;
 let amountDue=0;
 const spouseFree=kind==='SPOUSE';
 const childFixed=!isVip&&(kind==='CHILD'||kind==='GRANDCHILD')&&!exemption;
 if(isVip){
  amountDue=0;
 }else if(childFixed){
  amountDue=50;
 }else if(spouseFree){
  amountDue=0;
 }else if(!exemption){
  // Renewal amounts = pricing-module PriceList.RDar (تجديد الدار), matched on Cat + Jop (not AppFeeSchedule / staging bridges).
  const tierCat=String(client.Cat||'').trim()||null;
  const tierJop=String(client.jop||'').trim()||null;
  const {statement,params}=renewalPriceListCandidateQuery(tierCat,tierJop);
  const list=await rows(statement,params,t);
  priceListRow=pickPriceListRenewalRow(list,d.service_code,tierCat,tierJop);
  const parsed=parseLegacyMoney(priceListRow?.RDar);
  if(!priceListRow||parsed===null)fail('FEE_NOT_CONFIGURED','لا يوجد سعر تجديد دار معتمد في قائمة الأسعار لهذه الفئة والخدمة.',409);
  amountDue=parsed;
  fee={id:priceListRow.id,label:'تجديد الدار',amount:amountDue,Cat:priceListRow.Cat,Jop:priceListRow.Jop};
 }
 const feeLabel=isVip?'VIP — بدون رسوم':childFixed?'تجديد أبناء — 50 ج.م':spouseFree?'زوجة — بدون رسوم':exemption?'إعفاء معتمد: '+exemption.type:fee.Cat?('تجديد الدار — '+fee.Cat+(fee.Jop?' / '+fee.Jop:'')):'تجديد الدار';
 return {client_id:d.client_id,dependent_id:d.dependent_id||null,service_code:d.service_code,purpose:'RENEWAL',transaction_kind:'RENEWAL',term_from:start,term_to:d.term_to,amount_due:(isVip||exemption||spouseFree)?0:amountDue,fee_id:null,price_list_id:(isVip||childFixed)?null:(priceListRow?.id??null),exemption_id:exemption?.id||null,fee_label:feeLabel,is_vip:isVip,customer_name:dependent?.Name||client.Name,parent_end:dependent?await latestParent(d.client_id,t):null,acting_guardian:false,name_collisions:nameCollisions};
}
async function assertOpenShift(shift,user,t){if(!shift)fail('SHIFT_REQUIRED','افتح وردية قبل تسجيل المبلغ');const s=await one('SELECT id,opened_by,closed_at FROM dbo.AppShifts WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift',{shift},t);if(!s||s.closed_at)fail('SHIFT_CLOSED','الوردية مغلقة');if(s.opened_by!==user)fail('SHIFT_OWNER','الوردية تخص مستخدماً آخر',403);}
async function activate(id,t){const item=await one('SELECT * FROM dbo.AppRenewals WHERE id=@id',{id},t);if(!item||item.status!=='PENDING')fail('RENEWAL_STATE','حالة التجديد غير صحيحة',409);if(moneyCents(item.amount_due)!==moneyCents(item.paid_amount))fail('OUTSTANDING','هناك مبلغ مستحق',409);
 let legacy=null;
 // The meanings of historical [count]/MCount/active fields were not provided.
 // By default, keep new financial/expiry records in AppRenewals and preserve old dbo.subscriptioninf.
 // Legacy write-back is opt-in ONLY after historical mapping is approved and configured.
 if(process.env.LEGACY_MIRROR_ENABLED==='true'&&item.dependent_id===null&&String(item.transaction_kind||'RENEWAL')==='RENEWAL'){
   const count=process.env.LEGACY_MIRROR_COUNT,mcount=process.env.LEGACY_MIRROR_MCOUNT,active=process.env.LEGACY_MIRROR_ACTIVE;
   if(!count||!mcount||!active)fail('LEGACY_MAPPING_UNVERIFIED','لا يمكن تحديث تاريخ الاشتراك القديم قبل اعتماد دلالات الحقول Count وMCount وactive',409);
   const result=await run(`INSERT dbo.subscriptioninf(clientid,todate,CreateOn,admin,Discription,[count],MCount,active,cat) OUTPUT INSERTED.id VALUES(@client,@term,GETDATE(),@user,@descr,@count,@mcount,@active,@cat)`,{client:item.client_id,term:dayString(item.term_to),user:item.created_by,descr:'Enterprise #'+id,count,mcount,active,cat:item.service_code},t);legacy=result.recordset[0].id;
 }
 await run('UPDATE dbo.AppRenewals SET status=\'ACTIVE\',activated_at=SYSUTCDATETIME(),legacy_subscription_id=@legacy WHERE id=@id',{id,legacy},t);
}
function conflictRows(d,termFrom,termTo){return ['SELECT TOP 1 id,status FROM dbo.AppRenewals WITH(UPDLOCK,HOLDLOCK) WHERE client_id=@client AND ISNULL(dependent_id,-1)=@dep AND status IN (\'PENDING\',\'ACTIVE\') AND term_from<=@end AND term_to>=@start',{client:d.client_id,dep:d.dependent_id||-1,start:termFrom,end:termTo}];}
// Every operation key is idempotent and the per-member SQL application lock guards double clicks and concurrent workers.
function allowSkipAge(user){const p=rolePermissions[user?.role]||[];return p.includes('*')||p.includes('approve');}
r.post('/renewals/quote',permit('finance'),wrap(async(req,res)=>{
 const d=quoteShape.parse(req.body);
 if(d.skip_age_check&&!allowSkipAge(req.user))fail('FORBIDDEN','تخطي فحص السن للمشرف فقط',403);
 d._skipAgeAllowed=!!(d.skip_age_check&&allowSkipAge(req.user));
 res.json(await validateQuote(d));
}));
function duplicateKey(e){const n=e?.number||e?.originalError?.number||e?.originalError?.info?.number;return n===2627||n===2601;}
r.post('/renewals',permit('finance'),wrap(async(req,res)=>{
 const d=renewalShape.parse(req.body);
 if(d.skip_age_check&&!allowSkipAge(req.user))fail('FORBIDDEN','تخطي فحص السن للمشرف فقط',403);
 d._skipAgeAllowed=!!(d.skip_age_check&&allowSkipAge(req.user));
 let out;try{out=await transactional(async t=>{
 const existing=await one('SELECT id,status FROM dbo.AppRenewals WITH(UPDLOCK,HOLDLOCK) WHERE request_key=@key',{key:d.request_key},t);if(existing)return {...existing,idempotent:true};
 const lock=await one(`DECLARE @result int; EXEC @result=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; SELECT @result AS status`,{resource:'subscription:'+d.client_id},t);
 if(lock.status<0)fail('LOCK_TIMEOUT','تعذر حجز عملية التجديد، أعد المحاولة',409);
 const q=await validateQuote(d,t);
 if(moneyCents(d.amount_paid)>moneyCents(q.amount_due))fail('OVERPAYMENT','المبلغ المدفوع أكبر من المبلغ المستحق');
 if(d.purpose!=='LOST_CARD'){const [statement,params]=conflictRows(d,q.term_from,q.term_to);const overlap=await one(statement,params,t);if(overlap)fail('DUPLICATE_RENEWAL','يوجد تجديد قائم بالفعل لهذه الفترة (رقم '+overlap.id+')',409);}
 const txKind=q.transaction_kind||d.purpose||'RENEWAL';
 if(moneyCents(d.amount_paid)>0){if(!d.method)fail('PAYMENT_METHOD_REQUIRED','حدد طريقة الدفع');await assertOpenShift(d.shift_id,req.user.username,t);}
 const result=await run(`INSERT dbo.AppRenewals(request_key,client_id,dependent_id,service_code,term_from,term_to,amount_due,paid_amount,fee_id,exemption_id,status,shift_id,note,created_by,transaction_kind) OUTPUT INSERTED.id VALUES(@key,@client,@dep,@code,@start,@end,@amount,@paid,@fee,@exemption,'PENDING',@shift,@note,@actor,@txKind)`,{key:d.request_key,client:d.client_id,dep:d.dependent_id||null,code:q.service_code,start:q.term_from,end:q.term_to,amount:centsMoney(moneyCents(q.amount_due)),paid:centsMoney(moneyCents(d.amount_paid)),fee:q.fee_id,exemption:q.exemption_id,shift:d.shift_id||null,note:d.note||null,actor:req.user.username,txKind},t);
 const id=result.recordset[0].id;
 if(moneyCents(d.amount_paid)>0){await run(`INSERT dbo.AppPayments(request_key,renewal_id,shift_id,amount,method,reference,collected_by) VALUES(@key,@id,@shift,@amount,@method,@reference,@user)`,{key:d.request_key,id,shift:d.shift_id,amount:centsMoney(moneyCents(d.amount_paid)),method:d.method,reference:d.payment_reference||null,user:req.user.username},t);}
 if(moneyCents(d.amount_paid)===moneyCents(q.amount_due))await activate(id,t);
 await audit(req.user.username,txKind==='LOST_CARD'?'LOST_CARD':'RENEWAL','AppRenewals',id,{amount:q.amount_due,paid:d.amount_paid,exemption:q.exemption_id,transaction_kind:txKind},t);
 return {id,status:moneyCents(d.amount_paid)===moneyCents(q.amount_due)?'ACTIVE':'PENDING',idempotent:false,name_collisions:q.name_collisions};
 });}catch(e){if(!duplicateKey(e))throw e;const existing=await one('SELECT id,status FROM dbo.AppRenewals WHERE request_key=@key',{key:d.request_key});if(!existing)throw e;out={...existing,idempotent:true};}
 res.status(out.idempotent?200:201).json(out);
}));
r.get('/renewals',permit('read'),wrap(async(req,res)=>{const p=paginateParams(req.query),search=String(req.query.search||'').trim().slice(0,50),idSearch=String(parseMembershipId(String(req.query.search||'').trim())).slice(0,50),status=['ACTIVE','PENDING','VOID'].includes(req.query.status)?req.query.status:'';const par={search,idSearch,status,offset:p.offset,size:p.size};const where=`(@search='' OR r.client_id LIKE @search+'%' OR r.client_id LIKE @idSearch+'%' OR c.Name LIKE @search+'%') AND (@status='' OR r.status=@status)`;const base='FROM dbo.AppRenewals r JOIN dbo.Client c ON c.IdClient=r.client_id';const items=await rows(`SELECT r.*,c.Name client_name,s.Name dependent_name FROM dbo.AppRenewals r JOIN dbo.Client c ON c.IdClient=r.client_id LEFT JOIN dbo.SubClient s ON s.id=r.dependent_id WHERE ${where} ORDER BY r.id DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`,par);const total=(await one(`SELECT COUNT_BIG(*) total ${base} WHERE ${where}`,par)).total;res.json(asyncList(items,total,p));}));
r.get('/renewals/:id',permit('read'),wrap(async(req,res)=>{const id=intId(req.params.id);const item=await one('SELECT * FROM dbo.AppRenewals WHERE id=@id',{id});if(!item)fail('NOT_FOUND','التجديد غير موجود',404);res.json({...item,payments:await rows('SELECT id,amount,method,reference,collected_by,created_at FROM dbo.AppPayments WHERE renewal_id=@id ORDER BY id',{id}),reversals:await rows('SELECT id,amount,reason,reversed_by,created_at FROM dbo.AppReversals WHERE renewal_id=@id',{id})});}));
r.post('/renewals/:id/payments',permit('finance'),wrap(async(req,res)=>{const id=intId(req.params.id),d=paymentShape.parse(req.body);
 const result=await transactional(async t=>{const existing=await one('SELECT id FROM dbo.AppPayments WHERE request_key=@key',{key:d.request_key},t);if(existing)return{payment_id:existing.id,idempotent:true};
 const item=await one('SELECT * FROM dbo.AppRenewals WITH(UPDLOCK,HOLDLOCK) WHERE id=@id',{id},t);if(!item)fail('NOT_FOUND','التجديد غير موجود',404);if(item.status!=='PENDING')fail('ALREADY_FINISHED','التجديد مكتمل أو ملغى',409);
 await assertOpenShift(d.shift_id,req.user.username,t);const remaining=moneyCents(item.amount_due)-moneyCents(item.paid_amount);if(moneyCents(d.amount)>remaining)fail('OVERPAYMENT','المبلغ أكبر من المتبقي '+centsMoney(remaining));
 const p=await run('INSERT dbo.AppPayments(request_key,renewal_id,shift_id,amount,method,reference,collected_by) OUTPUT INSERTED.id VALUES(@key,@id,@shift,@amount,@method,@reference,@who)',{key:d.request_key,id,shift:d.shift_id,amount:centsMoney(moneyCents(d.amount)),method:d.method,reference:d.reference||null,who:req.user.username},t);
 const paid=centsMoney(moneyCents(item.paid_amount)+moneyCents(d.amount));await run('UPDATE dbo.AppRenewals SET paid_amount=@paid WHERE id=@id',{id,paid},t);if(moneyCents(paid)===moneyCents(item.amount_due))await activate(id,t);
 await audit(req.user.username,'PAYMENT','AppPayments',p.recordset[0].id,{renewal:id,amount:d.amount},t);return{payment_id:p.recordset[0].id,status:moneyCents(paid)===moneyCents(item.amount_due)?'ACTIVE':'PENDING',idempotent:false};
 });res.status(result.idempotent?200:201).json(result);
}));
r.post('/renewals/:id/void',permit('approve'),wrap(async(req,res)=>{
 const id=intId(req.params.id);
 const d=z.object({reason:z.string().trim().min(10).max(300),refund_confirmed:z.boolean().optional(),refund_method:z.enum(['CASH','CARD','TRANSFER']).optional(),refund_reference:z.string().trim().max(80).optional(),shift_id:z.number().int().positive().optional()}).parse(req.body);
 await transactional(async t=>{
  const item=await one('SELECT * FROM dbo.AppRenewals WITH(UPDLOCK,HOLDLOCK) WHERE id=@id',{id},t);
  if(!item)fail('NOT_FOUND','التجديد غير موجود',404);
  if(item.status==='VOID')fail('ALREADY_VOID','هذا السجل ملغى بالفعل',409);
  if(item.status==='ACTIVE')fail('ACTIVE_VOID_REQUIRES_REVIEW','لا يمكن إلغاء اشتراك نشط تلقائياً. يلزم تسوية مالية وإدارية معتمدة',409);
  const paid=moneyCents(item.paid_amount);
  if(paid>0){
   try{requireActualRefund({paid:item.paid_amount,confirmed:d.refund_confirmed,method:d.refund_method,reference:d.refund_reference,shiftId:d.shift_id});}
   catch{fail('REFUND_EVIDENCE_REQUIRED','يجب تسجيل صرف الاسترداد فعلياً وتحديد وردية مفتوحة وطريقة الصرف ومرجع إيصال موثق',409);}
   await assertOpenShift(d.shift_id,req.user.username,t);
   await run('INSERT dbo.AppReversals(renewal_id,amount,reason,reversed_by,shift_id,refund_method,reference) VALUES(@id,@amount,@reason,@who,@shift,@method,@reference)',{id,amount:item.paid_amount,reason:d.reason,who:req.user.username,shift:d.shift_id,method:d.refund_method,reference:d.refund_reference},t);
  }
  await run("UPDATE dbo.AppRenewals SET status='VOID' WHERE id=@id",{id},t);
  await audit(req.user.username,'VOID','AppRenewals',id,{reason:d.reason,refunded:item.paid_amount,refund_reference:d.refund_reference||null},t);
 });res.json({ok:true});
}));
function htmlEscape(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
r.get('/renewals/:id/receipt',permit('read'),wrap(async(req,res)=>{
 const id=intId(req.params.id);
 const item=await one(`SELECT r.id,r.client_id,r.dependent_id,r.service_code,r.term_from,r.term_to,r.amount_due,r.paid_amount,r.status,r.transaction_kind,r.created_by,r.created_at,c.Name client_name FROM dbo.AppRenewals r JOIN dbo.Client c ON c.IdClient=r.client_id WHERE r.id=@id`,{id});
 if(!item)fail('NOT_FOUND','التجديد غير موجود',404);
 const payments=await rows('SELECT id,amount,method,reference,collected_by,created_at FROM dbo.AppPayments WHERE renewal_id=@id ORDER BY id',{id});
 const adjustments=await rows('SELECT id,old_due,new_due,reason,adjusted_by,created_at FROM dbo.AppRenewalAdjustments WHERE renewal_id=@id ORDER BY id',{id});
 const lines=payments.map(p=>({kind:'PAYMENT',id:p.id,amount:Number(p.amount),method:p.method,reference:p.reference||'',actor:p.collected_by,at:p.created_at}));
 if(String(req.query.format||'')==='json')return res.json({renewal_id:id,client_id:item.client_id,amount_due:Number(item.amount_due),paid_amount:Number(item.paid_amount),status:item.status,lines,adjustments});
 const rowsHtml=lines.map(p=>`<tr><td>${htmlEscape(p.id)}</td><td>${htmlEscape(p.method)}</td><td>${htmlEscape(p.reference)}</td><td>${htmlEscape(p.actor)}</td><td>${htmlEscape(Number(p.amount).toFixed(2))}</td></tr>`).join('')||'<tr><td colspan="5">لا توجد دفعات</td></tr>';
 const kind=String(item.transaction_kind||'RENEWAL');
 const title=kind==='LOST_CARD'?'إيصال بدل فاقد (كارنيه)':'إيصال تجديد الدار';
 const subtitle=kind==='LOST_CARD'?'إيصال رسوم استبدال كارنيه مفقود — دون تمديد مدة الاشتراك.':'إيصال رسمي لعملية التجديد والتحصيل.';
 const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>إيصال ${id}</title><style>body{font-family:Tahoma,sans-serif;margin:24px;color:#1c2b44}table{width:100%;border-collapse:collapse}td,th{border:1px solid #d5deea;padding:6px;font-size:13px}h1{font-size:20px}.muted{color:#667} @media print{.no-print{display:none}}</style></head><body><button class="no-print" onclick="print()">طباعة</button><h1>${title}</h1><p class="muted">${subtitle}</p><p>العملية #${htmlEscape(item.id)} • العضوية <bdi dir="ltr">${htmlEscape(formatMembershipId(item.client_id))}</bdi> • ${htmlEscape(item.client_name)}</p><p>الفئة ${htmlEscape(item.service_code)} • من ${htmlEscape(dayString(item.term_from))} إلى ${htmlEscape(dayString(item.term_to))} • الحالة ${htmlEscape(item.status)}</p><p>المستحق ${htmlEscape(Number(item.amount_due).toFixed(2))} • المحصل ${htmlEscape(Number(item.paid_amount).toFixed(2))} • المتبقي ${htmlEscape((Number(item.amount_due)-Number(item.paid_amount)).toFixed(2))}</p><table><thead><tr><th>الدفعة</th><th>الطريقة</th><th>المرجع</th><th>المحصل</th><th>المبلغ</th></tr></thead><tbody>${rowsHtml}</tbody></table>${adjustments.length?`<h2>تسويات المستحق</h2><ul>${adjustments.map(a=>`<li>${htmlEscape(a.old_due)} → ${htmlEscape(a.new_due)} • ${htmlEscape(a.reason)} • ${htmlEscape(a.adjusted_by)}</li>`).join('')}</ul>`:''}</body></html>`;
 res.set('Content-Type','text/html; charset=utf-8');res.send(html);
}));
r.post('/renewals/:id/adjust',permit('approve'),wrap(async(req,res)=>{
 const id=intId(req.params.id),d=z.object({new_due:money,reason:z.string().trim().min(8).max(300)}).parse(req.body);
 const out=await transactional(async t=>{
  const item=await one('SELECT * FROM dbo.AppRenewals WITH(UPDLOCK,HOLDLOCK) WHERE id=@id',{id},t);
  if(!item)fail('NOT_FOUND','التجديد غير موجود',404);
  if(item.status==='VOID')fail('ALREADY_VOID','هذا السجل ملغى',409);
  if(item.status!=='PENDING')fail('ADJUST_PENDING_ONLY','تسوية المستحق متاحة للطلبات المعلقة فقط',409);
  if(moneyCents(d.new_due)<moneyCents(item.paid_amount))fail('OVERPAYMENT','المستحق الجديد أقل من المبلغ المحصل');
  const next=centsMoney(moneyCents(d.new_due));
  await run('INSERT dbo.AppRenewalAdjustments(renewal_id,old_due,new_due,reason,adjusted_by) VALUES(@id,@old,@new,@reason,@who)',{id,old:item.amount_due,new:next,reason:d.reason,who:req.user.username},t);
  await run('UPDATE dbo.AppRenewals SET amount_due=@due WHERE id=@id',{id,due:next},t);
  if(moneyCents(next)===moneyCents(item.paid_amount))await activate(id,t);
  await audit(req.user.username,'ADJUST_DUE','AppRenewals',id,{old_due:item.amount_due,new_due:next},t);
  const remaining=centsMoney(moneyCents(next)-moneyCents(item.paid_amount));
  return {old_due:Number(item.amount_due),new_due:Number(next),remaining:Number(remaining)};
 });
 res.json(out);
}));
r.get('/shifts',permit('finance'),wrap(async(req,res)=>res.json(await rows('SELECT TOP 150 id,opened_by,opened_at,closed_at,closed_by,opening_float,closing_note FROM dbo.AppShifts ORDER BY id DESC'))));
r.post('/shifts',permit('finance'),wrap(async(req,res)=>{const d=z.object({opening_float:money.default(0)}).parse(req.body);const id=await transactional(async t=>{const prev=await one(`SELECT id FROM dbo.AppShifts WITH(UPDLOCK,HOLDLOCK) WHERE opened_by=@who AND closed_at IS NULL`,{who:req.user.username},t);if(prev)fail('SHIFT_ALREADY_OPEN','لديك وردية مفتوحة رقم '+prev.id,409);const result=await run('INSERT dbo.AppShifts(opened_by,opening_float) OUTPUT INSERTED.id VALUES(@who,@cash)',{who:req.user.username,cash:centsMoney(moneyCents(d.opening_float))},t);const id=result.recordset[0].id;await audit(req.user.username,'OPEN_SHIFT','AppShifts',id,{},t);return id;});res.status(201).json({id});}));
r.get('/shifts/:id/summary',permit('finance'),wrap(async(req,res)=>{
 const id=intId(req.params.id);
 const sh=await one('SELECT id,opened_by,opened_at,closed_at,opening_float,closing_counted,closing_expected FROM dbo.AppShifts WHERE id=@id',{id});
 if(!sh)fail('NOT_FOUND','الوردية غير موجودة',404);
 if(sh.opened_by!==req.user.username&&!['admin','supervisor','auditor'].includes(req.user.role))fail('FORBIDDEN','وردية خاصة بموظف آخر',403);
 const [payments,refunds]=await Promise.all([
  rows('SELECT amount,method FROM dbo.AppPayments WHERE shift_id=@id',{id}),
  rows('SELECT amount,refund_method FROM dbo.AppReversals WHERE shift_id=@id',{id})
 ]);
 const expected=shiftBalance(sh.opening_float,payments,refunds);
 res.json({...sh,expected_cash:Number(expected),payments_total:Number(centsMoney(payments.reduce((v,p)=>v+moneyCents(p.amount),0))),refunds_total:Number(centsMoney(refunds.reduce((v,p)=>v+moneyCents(p.amount),0))),payments_count:payments.length,refunds_count:refunds.length});
}));
r.post('/shifts/:id/close',permit('finance'),wrap(async(req,res)=>{
 const id=intId(req.params.id),d=z.object({closing_note:z.string().trim().max(300).optional(),closing_counted:money}).parse(req.body);
 const outcome=await transactional(async t=>{
  const sh=await one('SELECT opened_by,closed_at,opening_float FROM dbo.AppShifts WITH(UPDLOCK,HOLDLOCK) WHERE id=@id',{id},t);
  if(!sh||sh.closed_at)fail('SHIFT_UNAVAILABLE','الوردية مغلقة أو غير موجودة',409);
  if(sh.opened_by!==req.user.username&&!['admin','supervisor'].includes(req.user.role))fail('SHIFT_OWNER','الوردية تخص موظفاً آخر',403);
  const payments=await rows('SELECT amount,method FROM dbo.AppPayments WHERE shift_id=@id',{id},t);
  const refunds=await rows('SELECT amount,refund_method FROM dbo.AppReversals WHERE shift_id=@id',{id},t);
  const expected=shiftBalance(sh.opening_float,payments,refunds);
  const difference=centsMoney(moneyCents(d.closing_counted)-moneyCents(expected));
  if(moneyCents(d.closing_counted)!==moneyCents(expected)&&(!d.closing_note||d.closing_note.length<12))fail('SHIFT_VARIANCE_NOTE','يوجد فرق بالخزينة؛ يلزم كتابة سبب تفصيلي لا يقل عن 12 حرفاً',409);
  await run('UPDATE dbo.AppShifts SET closed_by=@who,closed_at=SYSUTCDATETIME(),closing_note=@note,closing_expected=@expected,closing_counted=@counted WHERE id=@id',{who:req.user.username,note:d.closing_note||'',expected,counted:centsMoney(moneyCents(d.closing_counted)),id},t);
  await audit(req.user.username,'CLOSE_SHIFT','AppShifts',id,{expected,counted:d.closing_counted,difference},t);
  return{expected_cash:Number(expected),counted_cash:d.closing_counted,difference:Number(difference)};
 });res.json({ok:true,...outcome});
}));
export default r;
