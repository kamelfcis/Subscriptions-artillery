import {Router} from 'express';
import multer from 'multer';
import {z} from 'zod';
import {rows,one,run,audit,transactional,sql} from './db.js';
import {wrap,fail,text,date,paginateParams,asyncList,intId,fileType,validFileKinds,asImage,isVipInLawRelation} from './core.js';
import {permit,permissions as rolePermissions} from './auth.js';
import {priceListImportRows} from './fee-tiers.js';
import {parseMembershipId} from './membership-id.js';
import {mapDependentRenewalFields} from './dependent-renewal.js';
const router=Router();
const field=(n=50)=>z.string().trim().max(n).nullable().optional();
const memberFields={Name:field(),IdCard:field(),Phone:field(),Address:field(),jop:field(),discription:field(),note:field(),State:field(),Cat:field(),age:date.nullable().optional(),Rfid:field(),alive:field()};
/** Primary membership class → IdClient prefix. Bidirectional 01↔02 renumber on خدمة↔معاش/متوفى. */
const MEMBERSHIP_CLASS={
 '01':{prefix:'01',catLabel:'عسكرى',stateLabel:'خدمة'},
 '02':{prefix:'02',catLabel:'عسكرى',stateLabel:'معاش'},
 '03':{prefix:'03',catLabel:'أبناء',stateLabel:'أبناء'},
 '04':{prefix:'04',catLabel:'مدنى',stateLabel:'مدنى'},
};
function resolveMembershipClass(raw){
 const s=String(raw??'').trim();
 if(MEMBERSHIP_CLASS[s])return s;
 if(/^(عسكر|ضابط|خدم)/i.test(s))return '01';
 if(/معاش|متقاعد|وفاة|متوف/.test(s))return '02';
 if(/أبنا|ابن/.test(s))return '03';
 if(/مدن/.test(s))return '04';
 return null;
}
const vipBool=z.union([z.boolean(),z.literal(0),z.literal(1)]).optional();
const memberCreate=z.object({
 membership_class:z.enum(['01','02','03','04']).optional(),
 Name:z.string().trim().min(2).max(50),
 IdCard:field(),
 Phone:field(),
 Address:field(100),
 age:date.nullable().optional(),
 jop:field(),
 alive:field(),
 note:field(),
 discription:field(),
 Rfid:field(),
 // Client-supplied IdClient/id are ignored — server allocates a fixed lifetime number.
 IdClient:z.string().trim().min(1).max(50).optional(),
 id:z.coerce.number().int().min(0).optional(),
 Cat:field(),
 State:field(),
 is_vip:vipBool,
 vip:vipBool,
 vip_job:field(),
});
const memberUpdate=z.object({...memberFields,is_vip:vipBool,vip:vipBool,vip_job:field()}).partial();
function takeVipFlag(data){
 const raw=data.is_vip??data.vip;
 delete data.is_vip;
 delete data.vip;
 if(raw===undefined)return undefined;
 return raw===true||raw===1;
}
function takeVipJob(data){
 if(!Object.prototype.hasOwnProperty.call(data,'vip_job'))return undefined;
 const raw=data.vip_job;
 delete data.vip_job;
 if(raw==null||String(raw).trim()==='')return null;
 return String(raw).trim().slice(0,50);
}
async function upsertVipFields(clientId,{isVip,vipJob},who,t){
 const existing=await one(`SELECT ISNULL(is_vip,0) is_vip, vip_job FROM dbo.AppClientFlags WITH(UPDLOCK,HOLDLOCK) WHERE client_id=@id`,{id:clientId},t);
 const nextVip=isVip===undefined?!!existing?.is_vip:!!isVip;
 const nextJob=vipJob===undefined?(existing?.vip_job??null):vipJob;
 const bit=nextVip?1:0;
 await run(`IF EXISTS(SELECT 1 FROM dbo.AppClientFlags WITH(UPDLOCK,HOLDLOCK) WHERE client_id=@id)
  UPDATE dbo.AppClientFlags SET is_vip=@vip,vip_job=@job,updated_at=SYSUTCDATETIME() WHERE client_id=@id
 ELSE INSERT dbo.AppClientFlags(client_id,is_archived,is_vip,vip_job) VALUES(@id,0,@vip,@job)`,{id:clientId,vip:bit,job:nextJob},t);
 if(isVip!==undefined){
  const prev=!!existing?.is_vip;
  if(prev!==nextVip)await audit(who,nextVip?'VIP_ON':'VIP_OFF','Client',clientId,{is_vip:nextVip},t);
 }
}
async function assertVipRelationAllowed(clientId,relation,t){
 if(!isVipInLawRelation(relation))return;
 const flags=await one(`SELECT ISNULL(f.is_vip,0) is_vip FROM dbo.Client c LEFT JOIN dbo.AppClientFlags f ON f.client_id=c.IdClient WHERE c.IdClient=@id`,{id:clientId},t);
 if(!flags)fail('NOT_FOUND','العضوية غير موجودة',404);
 if(!flags.is_vip)fail('VIP_RELATION_REQUIRED','صلة زوج الابنة / زوجة الابن متاحة لأعضاء VIP فقط',409);
}
const OFFICER_RANKS=['ملازم','ملازم أول','نقيب','رائد','مقدم','عقيد','عميد','لواء','فريق'];
function normalizeAlive(v){
 if(v==null||v==='')return null;
 const s=String(v).trim();
 if(/متوف/.test(s))return 'متوفى';
 if(/^(نعم|حي|قيد\s*الحياة)$/i.test(s))return 'نعم';
 return s.slice(0,50);
}
function normalizeState(v){
 if(v==null||v==='')return null;
 const s=String(v).trim();
 if(/معاش|متقاعد/.test(s))return 'معاش';
 if(/خدم/.test(s))return 'خدمة';
 return s.slice(0,50);
}
function assertOfficerMemberPayload(data,{cls,requireRank=false}={}){
 const military=cls==='01'||cls==='02'||/عسكر|ضابط/.test(String(data.Cat||''));
 if(!military)return;
 if(!String(data.IdCard??'').trim())fail('IDCARD_REQUIRED','تحقيق الشخصية العسكرية مطلوب للعضوية العسكرية',400);
 if(data.State!=null&&data.State!==''){
  const st=normalizeState(data.State);
  if(st!=='خدمة'&&st!=='معاش')fail('BAD_STATE','حالة الخدمة يجب أن تكون خدمة أو معاش',400);
  data.State=st;
 }
 if(data.alive!=null&&data.alive!==''){
  const al=normalizeAlive(data.alive);
  if(al!=='نعم'&&al!=='متوفى')fail('BAD_ALIVE','حالة الحياة يجب أن تكون نعم أو متوفى',400);
  data.alive=al;
 }
 if(requireRank||(data.jop!=null&&String(data.jop).trim()!=='')){
  const raw=String(data.jop||'').trim();
  if(!raw)fail('RANK_REQUIRED','الرتبة مطلوبة للضابط',400);
  const base=raw.replace(/\s*-?\s*اح\s*$/i,'').trim();
  if(base&&!OFFICER_RANKS.some(r=>base===r||base.startsWith(r))){
   // Allow free-text ranks already in DB (legacy typos) but reject empty after strip.
  }
 }
}
async function allocateMembershipIds(prefix,t){
 const nextNum=await one(`SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(IdClient, CHARINDEX('-', IdClient)+1, 50))), 0) + 1 AS n
  FROM dbo.Client WITH (UPDLOCK, HOLDLOCK)
  WHERE IdClient LIKE @pat AND CHARINDEX('-', IdClient) > 0`,{pat:prefix+'-%'},t);
 const nextInternal=await one(`SELECT ISNULL(MAX(id), 0) + 1 AS n FROM dbo.Client WITH (UPDLOCK, HOLDLOCK)`,{},t);
 return {IdClient:prefix+'-'+nextNum.n,id:Number(nextInternal.n)};
}
/** Read-only advisory next IdClient (same MAX+1 as allocate; no locks / no insert). */
async function previewNextMembershipId(prefix){
 const nextNum=await one(`SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(IdClient, CHARINDEX('-', IdClient)+1, 50))), 0) + 1 AS n
  FROM dbo.Client
  WHERE IdClient LIKE @pat AND CHARINDEX('-', IdClient) > 0`,{pat:prefix+'-%'});
 return {IdClient:prefix+'-'+nextNum.n};
}
const dependentFields={Name:field(),IdCard:field(),Phone:field(),Address:field(),realation:field(),discription:field(),note:field(),State:field(),Cat:field(),age:date.nullable().optional(),Rfid:field()};
const dependentCreate=z.object({...dependentFields,Name:z.string().trim().min(2).max(50)});
const dependentUpdate=z.object(dependentFields).partial();
/** IdPrice kept in DB for legacy keys / fee matching; not edited from Pricing UI. */
const priceFields={Cat:field(),Jop:field(),RDar:field(),RElnada:field()};
const priceSchema=z.object(priceFields);
const blockedSchema=z.object({Name:z.string().trim().min(2).max(50),IdCard:field(),JOP:field(),reason:z.string().trim().min(3).max(50),timeoff:date.nullable().optional(),State:field(),Phone:field(),Address:field(100),cat:field()});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
const actor=req=>req.user.username;
function patchSql(table,key,value,data,allowed){const entries=Object.entries(data).filter(([k])=>allowed.includes(k));if(!entries.length)fail('EMPTY_UPDATE','لا توجد بيانات للتعديل');const params={key:value};entries.forEach(([k,v],i)=>params['v'+i]=v);return {statement:`UPDATE dbo.[${table}] SET ${entries.map(([k],i)=>`[${k}]=@v${i}`).join(',')} WHERE [${key}]=@key`,params};}
function expectRows(r){if(!r.rowsAffected?.[0])fail('NOT_FOUND','السجل غير موجود',404);}
async function flag(table,key,id,archived,who,entity){await transactional(async t=>{await run(`IF EXISTS(SELECT 1 FROM dbo.[${table}] WITH(UPDLOCK,HOLDLOCK) WHERE [${key}]=@key) UPDATE dbo.[${table}] SET is_archived=@archived,updated_at=SYSUTCDATETIME() WHERE [${key}]=@key ELSE INSERT dbo.[${table}]([${key}],is_archived) VALUES(@key,@archived)`,{key:id,archived:archived?1:0},t);await audit(who,archived?'ARCHIVE':'RESTORE',entity,id,{},t);});}
function fileCheck(req){if(!req.file)fail('FILE_REQUIRED','اختار الملف');const actual=fileType(req.file.buffer);if(!validFileKinds.has(actual))fail('BAD_FILE','نوع الملف غير مدعوم',415);return actual;}

router.get('/members',permit('read'),wrap(async(req,res)=>{
 const p=paginateParams(req.query),search=String(req.query.search||'').trim().slice(0,80),idSearch=String(parseMembershipId(String(req.query.search||'').trim())).slice(0,80),active=req.query.archived==='true'?1:0;
 const cat=String(req.query.cat||'').trim().slice(0,50),jop=String(req.query.jop||'').trim().slice(0,50),state=String(req.query.state||req.query.State||'').trim().slice(0,50);
 const expiryDays=Math.min(3650,Math.max(0,Math.floor(Number(req.query.expiryDays)||0)));
 const securityRaw=String(req.query.securityBlocked??req.query.security_blocked??'').trim().toLowerCase();
 const securityBlocked=securityRaw==='true'||securityRaw==='1'?1:securityRaw==='false'||securityRaw==='0'?0:-1;
 const param={search,idSearch,archived:active,offset:p.offset,size:p.size,cat,jop,state,expiryDays,securityBlocked};
 const where=`ISNULL(f.is_archived,0)=@archived AND (@securityBlocked<0 OR ISNULL(f.is_security_blocked,0)=@securityBlocked) AND (@search='' OR c.IdClient LIKE @search+'%' OR c.IdClient LIKE @idSearch+'%' OR c.Name LIKE '%'+@search+'%' OR c.IdCard=@search OR c.Phone=@search OR c.Rfid=@search) AND (@cat='' OR c.Cat=@cat) AND (@jop='' OR c.jop LIKE '%'+@jop+'%') AND (@state='' OR c.State=@state) AND (@expiryDays=0 OR EXISTS (SELECT 1 FROM (SELECT MAX(ends) ends FROM (SELECT todate ends FROM dbo.subscriptioninf WHERE clientid=c.IdClient UNION ALL SELECT r.term_to FROM dbo.AppRenewals r WHERE r.client_id=c.IdClient AND r.status='ACTIVE' AND r.dependent_id IS NULL) v) latest WHERE latest.ends>=CAST(GETDATE() AS date) AND latest.ends<=DATEADD(day,@expiryDays,CAST(GETDATE() AS date))))`;
 const base='FROM dbo.Client c LEFT JOIN dbo.AppClientFlags f ON f.client_id=c.IdClient';
 const items=await rows(`SELECT c.IdClient,c.id,c.Name,c.IdCard,c.Phone,c.Address,c.jop,c.State,c.Cat,c.CreateOn,c.age,c.alive,CASE WHEN c.PicPath IS NULL THEN 0 ELSE 1 END hasPhoto,ISNULL(f.is_security_blocked,0) security_blocked,ISNULL(f.is_vip,0) is_vip,f.vip_job FROM dbo.Client c LEFT JOIN dbo.AppClientFlags f ON f.client_id=c.IdClient WHERE ${where} ORDER BY c.IdClient OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`,param);
 const total=(await one(`SELECT COUNT_BIG(*) total ${base} WHERE ${where}`,param)).total;res.json(asyncList(items,total,p));
}));
router.get('/members/next-id',permit('write'),wrap(async(req,res)=>{
 const cls=resolveMembershipClass(req.query.membership_class);
 if(!cls)fail('BAD_CLASS','فئة العضوية يجب أن تكون 01 أو 02 أو 03 أو 04',400);
 const meta=MEMBERSHIP_CLASS[cls];
 const preview=await previewNextMembershipId(meta.prefix);
 res.json({membership_class:cls,prefix:meta.prefix,IdClient:preview.IdClient});
}));
router.get('/members/:id',permit('read'),wrap(async(req,res)=>{const data=await one(`SELECT c.IdClient,c.id,c.Name,c.IdCard,c.Phone,c.Address,c.jop,c.CreateOn,c.discription,c.note,c.State,c.Admin,c.Cat,c.age,c.Rfid,c.alive,ISNULL(f.is_archived,0) archived,ISNULL(f.is_security_blocked,0) security_blocked,f.security_block_reason,f.security_blocked_at,f.security_blocked_by,ISNULL(f.is_vip,0) is_vip,f.vip_job,CASE WHEN c.PicPath IS NULL THEN 0 ELSE 1 END hasPhoto FROM dbo.Client c LEFT JOIN dbo.AppClientFlags f ON f.client_id=c.IdClient WHERE c.IdClient=@id`,{id:req.params.id});if(!data)fail('NOT_FOUND','العضوية غير موجودة',404);res.json(data); }));
router.post('/members',permit('write'),wrap(async(req,res)=>{
 const data=memberCreate.parse(req.body);
 const vipFlag=takeVipFlag(data);
 const vipJob=takeVipJob(data);
 const cls=resolveMembershipClass(data.membership_class??data.Cat) || '01';
 const meta=MEMBERSHIP_CLASS[cls];
 const rawCat=data.Cat==null?'':String(data.Cat).trim();
 // Keep explicit pricing cats (e.g. test suites); map 01/02/03/04 codes to legacy Arabic labels.
 const catLabel=(!rawCat||MEMBERSHIP_CLASS[rawCat])?meta.catLabel:rawCat;
 if(cls==='01'||cls==='02'){
  data.State=normalizeState(data.State)||meta.stateLabel;
  data.alive=normalizeAlive(data.alive)??'نعم';
  assertOfficerMemberPayload({...data,Cat:catLabel},{cls,requireRank:!!String(data.jop||'').trim()});
  if(!String(data.IdCard??'').trim())fail('IDCARD_REQUIRED','تحقيق الشخصية العسكرية مطلوب للعضوية العسكرية',400);
 }
 const IdClient=await transactional(async t=>{
  const alloc=await allocateMembershipIds(meta.prefix,t);
  const row={
   IdClient:alloc.IdClient,
   id:alloc.id,
   Name:data.Name,
   IdCard:data.IdCard??null,
   Phone:data.Phone??null,
   Address:data.Address??null,
   age:data.age??null,
   jop:data.jop??null,
   alive:data.alive??null,
   note:data.note??null,
   discription:data.discription??null,
   Rfid:data.Rfid??null,
   Cat:catLabel,
   State:data.State||meta.stateLabel,
   Admin:actor(req),
  };
  const keys=Object.keys(row);
  const r=await run(`INSERT dbo.Client (${[...keys,'CreateOn'].map(x=>'['+x+']').join(',')}) VALUES (${[...keys.map(k=>'@'+k),'GETDATE()'].join(',')})`,row,t);
  expectRows(r);
  await audit(actor(req),'CREATE','Client',alloc.IdClient,{membership_class:cls,prefix:meta.prefix},t);
  if(vipFlag||vipJob!==undefined)await upsertVipFields(alloc.IdClient,{isVip:!!vipFlag,vipJob},actor(req),t);
  return alloc.IdClient;
 });
 res.status(201).json({IdClient,membership_class:cls});
}));
async function renumberClientId(oldId,newId,t){
 // Legacy FKs (SubClient, Files, subscriptioninf) are ON UPDATE CASCADE — change Client PK first.
 // Updating child rows before Client fails with FK/EREQUEST because the new IdClient does not exist yet.
 expectRows(await run('UPDATE dbo.Client SET IdClient=@n WHERE IdClient=@o',{n:newId,o:oldId},t));
 // App* tables reference client_id by string without cascade — retarget after the PK move.
 await run('UPDATE dbo.AppClientFlags SET client_id=@n WHERE client_id=@o',{n:newId,o:oldId},t);
 await run('UPDATE dbo.AppRenewals SET client_id=@n WHERE client_id=@o',{n:newId,o:oldId},t);
 await run('UPDATE dbo.AppCardJobs SET client_id=@n WHERE client_id=@o',{n:newId,o:oldId},t);
 await run('UPDATE dbo.AppExemptions SET client_id=@n WHERE client_id=@o',{n:newId,o:oldId},t);
 await run('UPDATE dbo.AppFamilyGuardian SET client_id=@n WHERE client_id=@o',{n:newId,o:oldId},t);
}
function isDeceasedAlive(v){return /متوف|وفاة|متوفي|deceased|dead/i.test(String(v||''));}
router.patch('/members/:id',permit('write'),wrap(async(req,res)=>{
 const data=memberUpdate.parse(req.body);
 const vipFlag=takeVipFlag(data);
 const vipJob=takeVipJob(data);
 const existing=await one('SELECT IdClient,Cat,jop,State,alive,IdCard FROM dbo.Client WHERE IdClient=@id',{id:req.params.id});
 if(!existing)fail('NOT_FOUND','العضوية غير موجودة',404);
 const cls=/^(01|02)-/.test(String(existing.IdClient))?existing.IdClient.slice(0,2):resolveMembershipClass(existing.Cat);
 if(cls==='01'||cls==='02'||/عسكر|ضابط/.test(String(existing.Cat||''))){
  if(data.State!==undefined)data.State=normalizeState(data.State);
  if(data.alive!==undefined)data.alive=normalizeAlive(data.alive);
  if(data.alive!==undefined&&isDeceasedAlive(data.alive)){
   data.alive='متوفى';
   data.State='معاش';
  }
  assertOfficerMemberPayload({...existing,...data},{cls,requireRank:data.jop!==undefined});
  if(data.IdCard!==undefined&&!String(data.IdCard??'').trim())fail('IDCARD_REQUIRED','تحقيق الشخصية العسكرية مطلوب للعضوية العسكرية',400);
  if(data.Name!==undefined&&String(data.Name||'').trim().length<2)fail('NAME_REQUIRED','الاسم مطلوب (حرفان على الأقل)',400);
 }
 const merged={...existing,...data};
 // Deceased members stay on معاش/02- even if the PATCH tries to set خدمة.
 const deceased=isDeceasedAlive(merged.alive);
 if(deceased&&(cls==='01'||cls==='02'||/عسكر|ضابط/.test(String(existing.Cat||'')))){
  data.State='معاش';
  merged.State='معاش';
 }
 const toPension=String(merged.State||'')==='معاش'||deceased;
 // Reverse only when back on خدمة and not deceased (living pensioner stays 02-).
 const toService=String(merged.State||'')==='خدمة'&&!deceased;
 // Root cause of missing reverse: needsRenumber historically only covered 01→02.
 const needsRenumberTo02=String(existing.IdClient).startsWith('01-')&&toPension;
 const needsRenumberTo01=String(existing.IdClient).startsWith('02-')&&toService;
 const needsRenumber=needsRenumberTo02||needsRenumberTo01;
 const finalId=await transactional(async t=>{
  let id=req.params.id;
  if(needsRenumber){
   const prefix=needsRenumberTo02?'02':'01';
   const alloc=await allocateMembershipIds(prefix,t);
   await renumberClientId(id,alloc.IdClient,t);
   await audit(actor(req),'RENUMBER','Client',alloc.IdClient,{
    old_IdClient:id,
    new_IdClient:alloc.IdClient,
    reason:needsRenumberTo02?'pension_or_deceased':'return_to_service',
   },t);
   id=alloc.IdClient;
  }
  const keys=Object.keys(data);
  if(keys.length){
   const {statement,params}=patchSql('Client','IdClient',id,data,Object.keys(memberFields));
   expectRows(await run(statement,params,t));
   await audit(actor(req),'UPDATE','Client',id,{fields:keys,renumbered:needsRenumber},t);
  }else if(vipFlag===undefined&&vipJob===undefined&&!needsRenumber)fail('EMPTY_UPDATE','لا توجد بيانات للتعديل');
  if(vipFlag!==undefined||vipJob!==undefined)await upsertVipFields(id,{isVip:vipFlag,vipJob},actor(req),t);
  return id;
 });
 res.json({ok:true,IdClient:finalId});
}));
router.delete('/members/:id',permit('write'),wrap(async(req,res)=>{if(!await one('SELECT IdClient FROM dbo.Client WHERE IdClient=@id',{id:req.params.id}))fail('NOT_FOUND','العضوية غير موجودة',404);await flag('AppClientFlags','client_id',req.params.id,true,actor(req),'Client');res.json({archived:true});}));
router.post('/members/:id/restore',permit('write'),wrap(async(req,res)=>{await flag('AppClientFlags','client_id',req.params.id,false,actor(req),'Client');res.json({archived:false});}));
function normalizeConfirmId(s){
 return String(s??'').trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x0660)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x06F0));
}
/** Permanent purge — soft archive remains DELETE /members/:id. Requires typing the membership id. */
router.post('/members/:id/hard-delete',permit('approve'),wrap(async(req,res)=>{
 const id=req.params.id;
 const d=z.object({reason:z.string().trim().min(10).max(300),confirm_id:z.string().trim().min(1).max(50)}).parse(req.body);
 if(normalizeConfirmId(d.confirm_id)!==normalizeConfirmId(id))fail('CONFIRM_MISMATCH','اكتب رقم العضوية للتأكيد حرفياً',409);
 await transactional(async t=>{
  if(!await one('SELECT IdClient FROM dbo.Client WITH(UPDLOCK,HOLDLOCK) WHERE IdClient=@id',{id},t))fail('NOT_FOUND','العضوية غير موجودة',404);
  await run(`DELETE p FROM dbo.AppPayments p JOIN dbo.AppRenewals r ON r.id=p.renewal_id WHERE r.client_id=@id`,{id},t);
  await run(`DELETE v FROM dbo.AppReversals v JOIN dbo.AppRenewals r ON r.id=v.renewal_id WHERE r.client_id=@id`,{id},t);
  await run(`DELETE a FROM dbo.AppRenewalAdjustments a JOIN dbo.AppRenewals r ON r.id=a.renewal_id WHERE r.client_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppRenewals WHERE client_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppCardJobs WHERE client_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppExemptions WHERE client_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppFamilyGuardian WHERE client_id=@id`,{id},t);
  await run(`DELETE e FROM dbo.AppEligibility e JOIN dbo.SubClient s ON s.id=e.dependent_id WHERE s.IdClient=@id`,{id},t);
  await run(`DELETE l FROM dbo.AppFileLinks l JOIN dbo.Files f ON f.id=l.file_id WHERE f.clientid=@id`,{id},t);
  await run(`DELETE g FROM dbo.AppFileFlags g JOIN dbo.Files f ON f.id=g.file_id WHERE f.clientid=@id`,{id},t);
  await run(`DELETE FROM dbo.Files WHERE clientid=@id`,{id},t);
  await run(`DELETE g FROM dbo.AppDependentFlags g JOIN dbo.SubClient s ON s.id=g.dependent_id WHERE s.IdClient=@id`,{id},t);
  await run(`DELETE FROM dbo.SubClient WHERE IdClient=@id`,{id},t);
  await run(`DELETE FROM dbo.subscriptioninf WHERE clientid=@id`,{id},t);
  await run(`DELETE FROM dbo.AppClientFlags WHERE client_id=@id`,{id},t);
  expectRows(await run(`DELETE FROM dbo.Client WHERE IdClient=@id`,{id},t));
  await audit(actor(req),'HARD_DELETE','Client',id,{reason:d.reason},t);
 });
 res.json({ok:true,deleted:true});
}));
router.post('/members/:id/security-block',permit('block'),wrap(async(req,res)=>{
 const id=req.params.id;
 const {reason}=z.object({reason:z.string().trim().min(5).max(300)}).parse(req.body);
 await transactional(async t=>{
  if(!await one('SELECT IdClient FROM dbo.Client WHERE IdClient=@id',{id},t))fail('NOT_FOUND','العضوية غير موجودة',404);
  await run(`IF EXISTS(SELECT 1 FROM dbo.AppClientFlags WITH(UPDLOCK,HOLDLOCK) WHERE client_id=@id)
    UPDATE dbo.AppClientFlags SET is_security_blocked=1,security_block_reason=@reason,security_blocked_at=SYSUTCDATETIME(),security_blocked_by=@who,updated_at=SYSUTCDATETIME() WHERE client_id=@id
   ELSE INSERT dbo.AppClientFlags(client_id,is_archived,is_security_blocked,security_block_reason,security_blocked_at,security_blocked_by)
    VALUES(@id,0,1,@reason,SYSUTCDATETIME(),@who)`,{id,reason,who:actor(req)},t);
  await audit(actor(req),'MEMBER_SECURITY_BLOCK','Client',id,{reason},t);
 });
 res.json({ok:true,security_blocked:true});
}));
router.post('/members/:id/security-unblock',permit('block'),wrap(async(req,res)=>{
 const id=req.params.id;
 const {reason}=z.object({reason:z.string().trim().min(5).max(300)}).parse(req.body);
 await transactional(async t=>{
  const row=await one(`SELECT ISNULL(f.is_security_blocked,0) security_blocked FROM dbo.Client c LEFT JOIN dbo.AppClientFlags f ON f.client_id=c.IdClient WHERE c.IdClient=@id`,{id},t);
  if(!row)fail('NOT_FOUND','العضوية غير موجودة',404);
  if(!row.security_blocked)fail('NOT_BLOCKED','العضو غير محظور أمنيًا على مستوى العضوية',409);
  await run(`UPDATE dbo.AppClientFlags SET is_security_blocked=0,security_block_reason=NULL,security_blocked_at=NULL,security_blocked_by=NULL,updated_at=SYSUTCDATETIME() WHERE client_id=@id`,{id},t);
  await audit(actor(req),'MEMBER_SECURITY_UNBLOCK','Client',id,{reason},t);
 });
 res.json({ok:true,security_blocked:false});
}));
router.get('/members/:id/photo',permit('read'),wrap(async(req,res)=>{const r=await one('SELECT PicPath image FROM dbo.Client WHERE IdClient=@id',{id:req.params.id});return asImage(res,r?.image);}));
router.put('/members/:id/photo',permit('write'),upload.single('file'),wrap(async(req,res)=>{const type=fileCheck(req);if(!type.startsWith('image/'))fail('IMAGE_ONLY','صورة فقط');await transactional(async t=>{expectRows(await run('UPDATE dbo.Client SET PicPath=CONVERT(image,@file) WHERE IdClient=@id',{file:req.file.buffer,id:req.params.id},t));await audit(actor(req),'PHOTO','Client',req.params.id,{size:req.file.size},t);});res.json({ok:true});}));
router.delete('/members/:id/photo',permit('write'),wrap(async(req,res)=>{await transactional(async t=>{expectRows(await run('UPDATE dbo.Client SET PicPath=NULL WHERE IdClient=@id',{id:req.params.id},t));await audit(actor(req),'PHOTO_DELETE','Client',req.params.id,{},t);});res.json({ok:true});}));

router.get('/members/:id/dependents',permit('read'),wrap(async(req,res)=>{
 const list=await rows(`SELECT d.id,d.IdClient,d.Name,d.IdCard,d.Phone,d.Address,d.realation,d.CreateOn,d.State,d.Cat,d.age,d.Rfid,CASE WHEN d.PicPath IS NULL THEN 0 ELSE 1 END hasPhoto,ISNULL(f.is_archived,0) archived,e.dependent_kind,e.proof_type,e.proof_valid_until,e.verified_at,ren.latest_renewal_term_to,ren.active_term_to FROM dbo.SubClient d LEFT JOIN dbo.AppDependentFlags f ON f.dependent_id=d.id LEFT JOIN dbo.AppEligibility e ON e.dependent_id=d.id OUTER APPLY (SELECT MAX(CASE WHEN r.status='ACTIVE' THEN r.term_to END) latest_renewal_term_to,MAX(CASE WHEN r.status='ACTIVE' AND r.term_from<=CAST(GETDATE() AS date) AND r.term_to>=CAST(GETDATE() AS date) THEN r.term_to END) active_term_to FROM dbo.AppRenewals r WHERE r.client_id=d.IdClient AND r.dependent_id=d.id) ren WHERE d.IdClient=@id ORDER BY d.id`,{id:req.params.id});
 res.json(list.map(mapDependentRenewalFields));
}));
router.post('/members/:id/dependents',permit('write'),wrap(async(req,res)=>{const data=dependentCreate.parse(req.body),p={...data,IdClient:req.params.id,Admin:actor(req)},keys=Object.keys(p);const id=await transactional(async t=>{await assertVipRelationAllowed(req.params.id,data.realation,t);const r=await run(`INSERT dbo.SubClient(${[...keys,'CreateOn'].map(k=>'['+k+']').join(',')}) OUTPUT INSERTED.id VALUES(${[...keys.map(k=>'@'+k),'GETDATE()'].join(',')})`,p,t);const n=r.recordset[0].id;await audit(actor(req),'CREATE','SubClient',n,{parent:req.params.id},t);return n;});res.status(201).json({id});}));
router.get('/dependents/:id',permit('read'),wrap(async(req,res)=>{const d=await one('SELECT id,IdClient,Name,IdCard,Phone,Address,realation,CreateOn,discription,note,State,Cat,age,Rfid FROM dbo.SubClient WHERE id=@id',{id:intId(req.params.id)});if(!d)fail('NOT_FOUND','التابع غير موجود',404);res.json(d);}));
router.patch('/dependents/:id',permit('write'),wrap(async(req,res)=>{const d=dependentUpdate.parse(req.body),id=intId(req.params.id),{statement,params}=patchSql('SubClient','id',id,d,Object.keys(dependentFields));await transactional(async t=>{const existing=await one('SELECT id,IdClient FROM dbo.SubClient WITH(UPDLOCK,HOLDLOCK) WHERE id=@id',{id},t);if(!existing)fail('NOT_FOUND','التابع غير موجود',404);if(d.realation!==undefined)await assertVipRelationAllowed(existing.IdClient,d.realation,t);expectRows(await run(statement,params,t));await audit(actor(req),'UPDATE','SubClient',id,{fields:Object.keys(d)},t);});res.json({ok:true});}));
router.delete('/dependents/:id',permit('write'),wrap(async(req,res)=>{
 const id=intId(req.params.id);
 await transactional(async t=>{
  if(!await one('SELECT id FROM dbo.SubClient WITH(UPDLOCK,HOLDLOCK) WHERE id=@id',{id},t))fail('NOT_FOUND','التابع غير موجود',404);
  await run(`DELETE p FROM dbo.AppPayments p JOIN dbo.AppRenewals r ON r.id=p.renewal_id WHERE r.dependent_id=@id`,{id},t);
  await run(`DELETE v FROM dbo.AppReversals v JOIN dbo.AppRenewals r ON r.id=v.renewal_id WHERE r.dependent_id=@id`,{id},t);
  await run(`DELETE a FROM dbo.AppRenewalAdjustments a JOIN dbo.AppRenewals r ON r.id=a.renewal_id WHERE r.dependent_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppRenewals WHERE dependent_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppCardJobs WHERE dependent_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppExemptions WHERE dependent_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppEligibility WHERE dependent_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppDependentFlags WHERE dependent_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppFamilyGuardian WHERE dependent_id=@id`,{id},t);
  await run(`UPDATE dbo.AppFileLinks SET dependent_id=NULL WHERE dependent_id=@id`,{id},t);
  expectRows(await run(`DELETE FROM dbo.SubClient WHERE id=@id`,{id},t));
  await audit(actor(req),'HARD_DELETE','SubClient',id,{},t);
 });
 res.json({ok:true,deleted:true});
}));
router.post('/dependents/:id/restore',permit('write'),wrap(async(req,res)=>{await flag('AppDependentFlags','dependent_id',intId(req.params.id),false,actor(req),'SubClient');res.json({archived:false});}));
router.get('/dependents/:id/photo',permit('read'),wrap(async(req,res)=>{const r=await one('SELECT PicPath image FROM dbo.SubClient WHERE id=@id',{id:intId(req.params.id)});return asImage(res,r?.image);}));
router.put('/dependents/:id/photo',permit('write'),upload.single('file'),wrap(async(req,res)=>{const type=fileCheck(req);if(!type.startsWith('image/'))fail('IMAGE_ONLY','صورة فقط');await transactional(async t=>{expectRows(await run('UPDATE dbo.SubClient SET PicPath=CONVERT(image,@file) WHERE id=@id',{file:req.file.buffer,id:intId(req.params.id)},t));await audit(actor(req),'PHOTO','SubClient',req.params.id,{},t);});res.json({ok:true});}));
router.delete('/dependents/:id/photo',permit('write'),wrap(async(req,res)=>{await transactional(async t=>{expectRows(await run('UPDATE dbo.SubClient SET PicPath=NULL WHERE id=@id',{id:intId(req.params.id)},t));await audit(actor(req),'PHOTO_DELETE','SubClient',req.params.id,{},t);});res.json({ok:true});}));

router.get('/members/:id/files',permit('read'),wrap(async(req,res)=>res.json(await rows(`SELECT f.id,f.clientid,f.discip,f.createon,f.admin,l.dependent_id,l.document_type,ISNULL(g.is_archived,0) archived FROM dbo.Files f LEFT JOIN dbo.AppFileFlags g ON g.file_id=f.id LEFT JOIN dbo.AppFileLinks l ON l.file_id=f.id WHERE f.clientid=@id ORDER BY f.createon DESC,f.id DESC`,{id:req.params.id}))));
router.post('/members/:id/files',permit('write'),upload.single('file'),wrap(async(req,res)=>{fileCheck(req);const d=z.object({discip:field(),document_type:z.string().max(40).default('OTHER'),dependent_id:z.coerce.number().int().positive().nullable().optional()}).parse(req.body);const id=await transactional(async t=>{if(d.dependent_id){const own=await one('SELECT id FROM dbo.SubClient WHERE id=@dep AND IdClient=@id',{dep:d.dependent_id,id:req.params.id},t);if(!own)fail('BAD_DEPENDENT','التابع لا يتبع هذه العضوية');}const r=await run('INSERT dbo.Files(clientid,filename,discip,createon,admin) OUTPUT INSERTED.id VALUES(@client,CONVERT(image,@file),@discip,GETDATE(),@admin)',{client:req.params.id,file:req.file.buffer,discip:d.discip||'',admin:actor(req)},t);const id=r.recordset[0].id;await run('INSERT dbo.AppFileLinks(file_id,dependent_id,document_type) VALUES(@id,@dep,@type)',{id,dep:d.dependent_id||null,type:d.document_type},t);await audit(actor(req),'UPLOAD','Files',id,{type:d.document_type,size:req.file.size},t);return id;});res.status(201).json({id});}));
router.get('/files/:id/content',permit('read'),wrap(async(req,res)=>{const r=await one(`SELECT f.filename image FROM dbo.Files f LEFT JOIN dbo.AppFileFlags a ON a.file_id=f.id WHERE f.id=@id AND ISNULL(a.is_archived,0)=0`,{id:intId(req.params.id)});return asImage(res,r?.image);}));
router.put('/files/:id/content',permit('write'),upload.single('file'),wrap(async(req,res)=>{fileCheck(req);const id=intId(req.params.id);await transactional(async t=>{expectRows(await run('UPDATE dbo.Files SET filename=CONVERT(image,@file) WHERE id=@id',{file:req.file.buffer,id},t));await audit(actor(req),'FILE_REPLACE','Files',id,{size:req.file.size},t);});res.json({ok:true});}));
router.patch('/files/:id',permit('write'),wrap(async(req,res)=>{const d=z.object({discip:field(),document_type:z.string().max(40).optional(),dependent_id:z.number().int().positive().nullable().optional()}).parse(req.body),id=intId(req.params.id);await transactional(async t=>{if(d.discip!==undefined)expectRows(await run('UPDATE dbo.Files SET discip=@discip WHERE id=@id',{id,discip:d.discip},t));if(d.document_type!==undefined||d.dependent_id!==undefined){const old=await one('SELECT document_type,dependent_id FROM dbo.AppFileLinks WHERE file_id=@id',{id},t);const values={id,type:d.document_type??old?.document_type??'OTHER',dep:d.dependent_id===undefined?old?.dependent_id||null:d.dependent_id};const r=await run('UPDATE dbo.AppFileLinks SET document_type=@type,dependent_id=@dep WHERE file_id=@id',values,t);if(!r.rowsAffected[0])await run('INSERT dbo.AppFileLinks(file_id,document_type,dependent_id) VALUES(@id,@type,@dep)',values,t);}await audit(actor(req),'UPDATE','Files',id,{fields:Object.keys(d)},t);});res.json({ok:true});}));
router.delete('/files/:id',permit('write'),wrap(async(req,res)=>{
 const id=intId(req.params.id);
 await transactional(async t=>{
  if(!await one('SELECT id FROM dbo.Files WITH(UPDLOCK,HOLDLOCK) WHERE id=@id',{id},t))fail('NOT_FOUND','المرفق غير موجود',404);
  const linked=await one('SELECT dependent_id FROM dbo.AppEligibility WHERE proof_file_id=@id',{id},t);
  if(linked)fail('DOCUMENT_IN_USE','المستند مستخدم كإثبات أهلية، قم بإلغاء الاعتماد أولاً');
  await run(`DELETE FROM dbo.AppFileLinks WHERE file_id=@id`,{id},t);
  await run(`DELETE FROM dbo.AppFileFlags WHERE file_id=@id`,{id},t);
  expectRows(await run(`DELETE FROM dbo.Files WHERE id=@id`,{id},t));
  await audit(actor(req),'HARD_DELETE','Files',id,{},t);
 });
 res.json({ok:true,deleted:true});
}));
router.post('/files/:id/restore',permit('write'),wrap(async(req,res)=>{await flag('AppFileFlags','file_id',intId(req.params.id),false,actor(req),'Files');res.json({archived:false});}));

router.get('/members/:id/legacy-subscriptions',permit('read'),wrap(async(req,res)=>res.json(await rows('SELECT id,clientid,todate,CreateOn,admin,Discription,[count],MCount,active,cat FROM dbo.subscriptioninf WHERE clientid=@id ORDER BY todate DESC,id DESC',{id:req.params.id}))));

// Combined non-destructive membership history: legacy rows and modern AppRenewals.
router.get('/members/:id/subscriptions',permit('read'),wrap(async(req,res)=>{
 const id=req.params.id;
 const [legacy,modern]=await Promise.all([
  rows('SELECT id,clientid,todate,CreateOn,admin,Discription,cat FROM dbo.subscriptioninf WHERE clientid=@id ORDER BY todate DESC,id DESC',{id}),
  rows('SELECT id,client_id,dependent_id,service_code,term_from,term_to,created_at,created_by,status,amount_due,paid_amount FROM dbo.AppRenewals WHERE client_id=@id ORDER BY term_to DESC,id DESC',{id})
 ]);
 const modernLinks=new Set(modern.map(x=>'Enterprise #'+String(x.id)));
 const items=[...modern.map(x=>({source:'MODERN',id:x.id,dependent_id:x.dependent_id,from:x.term_from,ends:x.term_to,created:x.created_at,service:x.service_code,status:x.status,actor:x.created_by,amount_due:x.amount_due,paid_amount:x.paid_amount})),...legacy.filter(x=>!modernLinks.has(x.Discription)).map(x=>({source:'LEGACY',id:x.id,dependent_id:null,ends:x.todate,created:x.CreateOn,service:x.cat,status:'HISTORICAL',actor:x.admin,amount_due:null,paid_amount:null}))];
 items.sort((a,b)=>String(b.ends||'').localeCompare(String(a.ends||'')));
 res.json(items);
}));


// Legacy administrators are a lookup. Do not expose or reuse insecure legacy tbluser passwords.
router.get('/legacy/admins',permit('read'),wrap(async(req,res)=>res.json(await rows('SELECT id,name FROM dbo.admin ORDER BY name,id'))));
router.post('/legacy/admins',permit('users'),wrap(async(req,res)=>{
 const {name}=z.object({name:z.string().trim().min(2).max(150)}).parse(req.body);
 const id=await transactional(async t=>{const r=await run('INSERT dbo.admin(name) OUTPUT INSERTED.id VALUES(@name)',{name},t);const id=r.recordset[0].id;await audit(actor(req),'CREATE','admin',id,{name},t);return id;});res.status(201).json({id});
}));
router.patch('/legacy/admins/:id',permit('users'),wrap(async(req,res)=>{
 const id=intId(req.params.id),{name}=z.object({name:z.string().trim().min(2).max(150)}).parse(req.body);
 await transactional(async t=>{expectRows(await run('UPDATE dbo.admin SET name=@name WHERE id=@id',{id,name},t));await audit(actor(req),'UPDATE','admin',id,{name},t);});res.json({ok:true});
}));
router.delete('/legacy/admins/:id',permit('users'),wrap(async(req,res)=>{
 const id=intId(req.params.id);
 await transactional(async t=>{const x=await one('SELECT name FROM dbo.admin WITH(UPDLOCK,HOLDLOCK) WHERE id=@id',{id},t);if(!x)fail('NOT_FOUND','المسؤول غير موجود',404);
  const usage=await one(`SELECT (SELECT COUNT(*) FROM dbo.Client WHERE Admin=@name)+(SELECT COUNT(*) FROM dbo.SubClient WHERE Admin=@name)+(SELECT COUNT(*) FROM dbo.Files WHERE admin=@name)+(SELECT COUNT(*) FROM dbo.bill WHERE admin=@name) total`,{name:x.name},t);
  if(usage.total>0)fail('ADMIN_REFERENCED','المسؤول مستخدم في سجلات تاريخية، لا يجوز حذفه. يمكن تعديل الاسم',409);
  expectRows(await run('DELETE dbo.admin WHERE id=@id',{id},t));await audit(actor(req),'DELETE','admin',id,{name:x.name},t);
 });res.json({ok:true});
}));
/** PriceList (دار فقط) is the editable master; renewals quote RDar directly from this table. */
router.get('/legacy/prices',permit('read'),wrap(async(req,res)=>{
 const p=paginateParams(req.query),search=String(req.query.search||'').trim().slice(0,80),par={search,offset:p.offset,size:p.size};
 const where=`(@search='' OR Cat LIKE '%'+@search+'%' OR Jop LIKE '%'+@search+'%' OR IdPrice LIKE '%'+@search+'%' OR CONVERT(nvarchar(50),RDar) LIKE '%'+@search+'%' OR CONVERT(nvarchar(50),RElnada) LIKE '%'+@search+'%')`;
 const items=await rows(`SELECT id,Cat,Jop,IdPrice,RDar,RElnada FROM dbo.PriceList WHERE ${where} ORDER BY id OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`,par);
 const total=(await one(`SELECT COUNT_BIG(*) total FROM dbo.PriceList WHERE ${where}`,par)).total;
 res.json(asyncList(items,total,p));
}));
router.post('/legacy/prices',permit('fees'),wrap(async(req,res)=>{
 const d=priceSchema.parse(req.body);
 const id=await transactional(async t=>{
  const next=await one(`SELECT CONVERT(nvarchar(50), ISNULL(MAX(TRY_CAST(LTRIM(RTRIM(IdPrice)) AS bigint)), 0) + 1) AS nextId FROM dbo.PriceList WITH(UPDLOCK,HOLDLOCK)`,{},t);
  const IdPrice=String(next.nextId);
  const r=await run(`INSERT dbo.PriceList(Cat,Jop,IdPrice,FDar,RDar,FElnada,RElnada) OUTPUT INSERTED.id, INSERTED.Cat, INSERTED.Jop, INSERTED.IdPrice, INSERTED.RDar, INSERTED.RElnada
   VALUES(@Cat,@Jop,@IdPrice,NULL,@RDar,NULL,@RElnada)`,{...d,IdPrice,RElnada:d.RElnada??null},t);
  const row=r.recordset[0];
  await audit(actor(req),'CREATE','PriceList',row.id,{IdPrice},t);
  return row.id;
 });
 res.status(201).json({id});
}));
router.patch('/legacy/prices/:id',permit('fees'),wrap(async(req,res)=>{
 const id=intId(req.params.id);
 const d=priceSchema.parse(req.body);
 const {statement,params}=patchSql('PriceList','id',id,d,Object.keys(priceFields));
 await transactional(async t=>{
  expectRows(await run(statement,params,t));
  await audit(actor(req),'UPDATE','PriceList',id,{fields:Object.keys(d)},t);
 });
 res.json({ok:true});
}));
/** Hard delete — permanently removes the PriceList row (no soft archive). */
router.delete('/legacy/prices/:id',permit('fees'),wrap(async(req,res)=>{
 const id=intId(req.params.id);
 await transactional(async t=>{
  expectRows(await run('DELETE dbo.PriceList WHERE id=@id',{id},t));
  await audit(actor(req),'DELETE','PriceList',id,{},t);
 });
 res.json({ok:true});
}));
router.get('/blocked',permit('read'),wrap(async(req,res)=>{const p=paginateParams(req.query),search=String(req.query.search||'').slice(0,80),par={search,offset:p.offset,size:p.size};const where=`(@search='' OR Name LIKE '%'+@search+'%' OR IdCard=@search OR Phone=@search)`;const items=await rows(`SELECT Id,Name,IdCard,JOP,reason,timeoff,State,Phone,Address,cat FROM dbo.Blocked WHERE ${where} ORDER BY Id DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`,par);const total=(await one(`SELECT COUNT_BIG(*) total FROM dbo.Blocked WHERE ${where}`,par)).total;res.json(asyncList(items,total,p));}));
router.post('/blocked',permit('block'),wrap(async(req,res)=>{const d=blockedSchema.extend({confirm_identity:z.boolean().optional()}).parse(req.body);const id=await transactional(async t=>{
 const card=String(d.IdCard||'').trim();
 const same=await one(`SELECT TOP 1 Id FROM dbo.Blocked WITH(UPDLOCK,HOLDLOCK) WHERE Name=@Name AND ISNULL(LTRIM(RTRIM(IdCard)),'')=@card`,{Name:d.Name,card},t);
 if(same)fail('ALREADY_BLOCKED','يوجد حظر لنفس الاسم ونفس رقم الهوية');
 if(card){const byCard=await one(`SELECT TOP 1 Id FROM dbo.Blocked WITH(UPDLOCK,HOLDLOCK) WHERE IdCard IS NOT NULL AND LTRIM(RTRIM(IdCard))=@card`,{card},t);if(byCard)fail('ALREADY_BLOCKED','يوجد حظر بنفس رقم الهوية');}
 const byName=await one(`SELECT TOP 1 Id FROM dbo.Blocked WITH(UPDLOCK,HOLDLOCK) WHERE Name=@Name AND ISNULL(LTRIM(RTRIM(IdCard)),'')<>@card`,{Name:d.Name,card},t);
 if(byName&&!d.confirm_identity)fail('NAME_COLLISION','الاسم يطابق سجلاً في قائمة الحظر دون تطابق رقم الهوية. أعد الطلب مع confirm_identity لإنشاء الحظر.',409,{warning:{code:'NAME_COLLISION',blocked_id:byName.Id}});
 const collisions=await one(`SELECT COUNT_BIG(*) n FROM (SELECT IdClient id FROM dbo.Client WHERE Name=@Name AND ISNULL(LTRIM(RTRIM(IdCard)),'')<>@card UNION ALL SELECT CONVERT(nvarchar(50),id) FROM dbo.SubClient WHERE Name=@Name AND ISNULL(LTRIM(RTRIM(IdCard)),'')<>@card) x`,{Name:d.Name,card},t);
 if(Number(collisions?.n||0)>0&&!d.confirm_identity)fail('NAME_COLLISION','الاسم يطابق عضوية أخرى برقم هوية مختلف. أكد أن الحظر يخص هذا الشخص.',409,{warning:{code:'NAME_COLLISION',collisions:Number(collisions.n)}});
 const m=await one('SELECT ISNULL(MAX(Id),999)+1 AS nextId FROM dbo.Blocked WITH(TABLOCKX,HOLDLOCK)',{},t);
 await run(`INSERT dbo.Blocked(Id,Name,IdCard,JOP,reason,timeoff,State,Phone,Address,cat) VALUES(@id,@Name,@IdCard,@JOP,@reason,@timeoff,@State,@Phone,@Address,@cat)`,{id:m.nextId,Name:d.Name,IdCard:card||null,JOP:d.JOP??null,reason:d.reason,timeoff:d.timeoff??null,State:d.State??null,Phone:d.Phone??null,Address:d.Address??null,cat:d.cat??null},t);
 await audit(actor(req),'BLOCK','Blocked',m.nextId,{reason:d.reason,confirm_identity:!!d.confirm_identity},t);return m.nextId;});res.status(201).json({Id:id});}));
router.patch('/blocked/:id',permit('block'),wrap(async(req,res)=>{const d=blockedSchema.partial().parse(req.body),{statement,params}=patchSql('Blocked','Id',intId(req.params.id),d,Object.keys(blockedSchema.shape));await transactional(async t=>{expectRows(await run(statement,params,t));await audit(actor(req),'BLOCK_UPDATE','Blocked',req.params.id,{fields:Object.keys(d)},t);});res.json({ok:true});}));
router.delete('/blocked/:id',permit('block'),wrap(async(req,res)=>{const id=intId(req.params.id),{reason}=z.object({reason:z.string().trim().min(8).max(300)}).parse(req.body);await transactional(async t=>{const old=await one('SELECT * FROM dbo.Blocked WITH(UPDLOCK,HOLDLOCK) WHERE Id=@id',{id},t);if(!old)fail('NOT_FOUND','الحظر غير موجود',404);await run('INSERT dbo.AppBlockedHistory(blocked_id,snapshot,unblocked_by,reason) VALUES(@id,@snapshot,@user,@reason)',{id,snapshot:JSON.stringify(old),user:actor(req),reason},t);await run('DELETE dbo.Blocked WHERE Id=@id',{id},t);await audit(actor(req),'UNBLOCK','Blocked',id,{reason},t);});res.json({ok:true});}));
router.get('/services',permit('read'),wrap(async(req,res)=>res.json(await rows('SELECT code,label,active FROM dbo.AppServices ORDER BY code'))));
router.patch('/services/:code',permit('fees'),wrap(async(req,res)=>{const d=z.object({label:z.string().trim().min(1).max(100).optional(),active:z.boolean().optional()}).parse(req.body);const {statement,params}=patchSql('AppServices','code',req.params.code,d,['label','active']);expectRows(await run(statement,params));await audit(actor(req),'UPDATE','AppServices',req.params.code,d);res.json({ok:true});}));
router.get('/fees',permit('read'),wrap(async(req,res)=>res.json(await rows('SELECT f.*,s.label service_name FROM dbo.AppFeeSchedule f JOIN dbo.AppServices s ON s.code=f.service_code ORDER BY valid_from DESC,id DESC'))));
router.post('/fees',permit('fees'),wrap(async(req,res)=>{const d=z.object({service_code:z.enum(['01','02','03','04']),target_type:z.enum(['MAIN','DEPENDENT']),price_kind:z.enum(['RENEWAL']).default('RENEWAL'),tier_cat:z.string().trim().max(50).nullable().optional(),tier_jop:z.string().trim().max(50).nullable().optional(),label:z.string().min(1).max(100),amount:z.number().nonnegative().max(10000000),valid_from:date,valid_until:date.nullable().optional()}).parse(req.body);const par={...d,tier_cat:d.tier_cat??null,tier_jop:d.tier_jop??null,valid_until:d.valid_until||null};const id=await transactional(async t=>{
 const overlap=await one(`SELECT TOP 1 id FROM dbo.AppFeeSchedule WITH(UPDLOCK,HOLDLOCK) WHERE service_code=@service_code AND target_type=@target_type AND price_kind=@price_kind AND ISNULL(tier_cat,'')=ISNULL(@tier_cat,'') AND ISNULL(tier_jop,'')=ISNULL(@tier_jop,'') AND is_active=1 AND valid_from<=ISNULL(@valid_until,'99991231') AND (valid_until IS NULL OR valid_until>=@valid_from)`,par,t);
 if(overlap)fail('OVERLAPPING_FEE','يوجد سعر فعال لنفس الفئة يتداخل مع هذه الفترة. أوقف السعر السابق أو حدّد تاريخ انتهاء.',409);
 const r=await run(`INSERT dbo.AppFeeSchedule(service_code,target_type,tier_cat,tier_jop,price_kind,label,amount,valid_from,valid_until,created_by) OUTPUT INSERTED.id VALUES(@service_code,@target_type,@tier_cat,@tier_jop,@price_kind,@label,@amount,@valid_from,@valid_until,@user)`,{...par,user:actor(req)},t);await audit(actor(req),'FEE_CREATE','AppFeeSchedule',r.recordset[0].id,{amount:d.amount,tier_cat:par.tier_cat,tier_jop:par.tier_jop,price_kind:par.price_kind},t);return r.recordset[0].id;});res.status(201).json({id});}));
router.post('/fees/sync-legacy',permit('fees'),wrap(async(req,res)=>{
 const created=await transactional(async t=>{
  await run(`UPDATE dbo.AppFeeSchedule SET is_active=0, valid_until=CASE WHEN valid_until IS NULL THEN CAST(GETDATE() AS date) ELSE valid_until END
    WHERE is_active=1 AND (
      label LIKE N'%STAGING%' OR label LIKE N'%NOT OFFICIAL%' OR label LIKE N'%ندو%' OR label LIKE N'%الندى%'
      OR created_by IN ('staging-seed','test-suite')
    )`,{},t);
  const list=await rows('SELECT id,Cat,Jop,IdPrice,RDar FROM dbo.PriceList ORDER BY id',{},t);
  let n=0;
  for(const p of list){n+=priceListImportRows(p).length;}
  await audit(actor(req),'FEE_SYNC_LEGACY','AppFeeSchedule',0,{feeRows:n,priceListRows:list.length});
  return n;
 });
 res.json({ok:true,imported:created});
}));
router.patch('/fees/:id',permit('fees'),wrap(async(req,res)=>{const id=intId(req.params.id),d=z.object({is_active:z.boolean().optional(),valid_until:date.nullable().optional()}).parse(req.body);const {statement,params}=patchSql('AppFeeSchedule','id',id,d,['is_active','valid_until']);await transactional(async t=>{expectRows(await run(statement,params,t));await audit(actor(req),'FEE_UPDATE','AppFeeSchedule',id,d,t);});res.json({ok:true});}));
router.get('/settings',permit('read'),wrap(async(req,res)=>res.json(await rows("SELECT setting_key,setting_value FROM dbo.AppSettings WHERE setting_key IN ('age_limit_children','age_limit_grandchildren','lost_card_fee_default') ORDER BY setting_key"))));
router.patch('/settings/:key',wrap(async(req,res)=>{
 const key=req.params.key;
 const feeKeys=['lost_card_fee_default'];
 const approveKeys=['age_limit_children','age_limit_grandchildren'];
 const {value}=z.object({value:z.string().min(1).max(300)}).parse(req.body);
 if(feeKeys.includes(key)){
  if(!rolePermissions[req.user.role]?.includes('*')&&!rolePermissions[req.user.role]?.includes('fees')&&!rolePermissions[req.user.role]?.includes('approve'))fail('FORBIDDEN','صلاحية الأسعار مطلوبة',403);
  if(key==='lost_card_fee_default'&&(!/^\d+(\.\d{1,2})?$/.test(value)||+value<0||+value>100000))fail('BAD_SETTING','قيمة بدل فاقد الافتراضية غير صحيحة');
 }else if(approveKeys.includes(key)){
  if(!rolePermissions[req.user.role]?.includes('*')&&!rolePermissions[req.user.role]?.includes('approve'))fail('FORBIDDEN','صلاحية اعتماد مطلوبة',403);
  if(key.startsWith('age_limit_')&&(!/^\d{1,2}$/.test(value)||+value<1||+value>30))fail('BAD_SETTING','قيمة السن غير صحيحة');
 }else fail('UNKNOWN_SETTING','لا يمكن تعديل هذه القيمة');
 await run('UPDATE dbo.AppSettings SET setting_value=@value WHERE setting_key=@key',{value,key});
 if(!(await one('SELECT setting_key FROM dbo.AppSettings WHERE setting_key=@key',{key})))await run('INSERT dbo.AppSettings(setting_key,setting_value) VALUES(@key,@value)',{value,key});
 await audit(actor(req),'SETTING','AppSettings',key,{value});
 res.json({ok:true});
}));
router.put('/dependents/:id/eligibility',permit('approve'),wrap(async(req,res)=>{
 const id=intId(req.params.id),d=z.object({dependent_kind:z.enum(['CHILD','GRANDCHILD','SPOUSE','OTHER']),proof_type:z.string().max(50).nullable().optional(),proof_file_id:z.number().int().positive().nullable().optional(),proof_valid_until:date.nullable().optional(),review_note:z.string().max(300).nullable().optional()}).parse(req.body);
 await transactional(async t=>{const dep=await one('SELECT IdClient FROM dbo.SubClient WHERE id=@id',{id},t);if(!dep)fail('NOT_FOUND','التابع غير موجود');if(d.proof_file_id){const proof=await one(`SELECT f.id FROM dbo.Files f LEFT JOIN dbo.AppFileFlags a ON a.file_id=f.id WHERE f.id=@file AND f.clientid=@client AND ISNULL(a.is_archived,0)=0`,{file:d.proof_file_id,client:dep.IdClient},t);if(!proof)fail('BAD_PROOF','ملف الإثبات غير موجود في العضوية');}
 const par={id,kind:d.dependent_kind,type:d.proof_type||null,file:d.proof_file_id||null,until:d.proof_valid_until||null,user:actor(req),note:d.review_note||null};
 await run(`UPDATE dbo.AppEligibility SET dependent_kind=@kind,proof_type=@type,proof_file_id=@file,proof_valid_until=@until,verified_by=CASE WHEN @file IS NULL THEN NULL ELSE @user END,verified_at=CASE WHEN @file IS NULL THEN NULL ELSE SYSUTCDATETIME() END,review_note=@note WHERE dependent_id=@id; IF @@ROWCOUNT=0 INSERT dbo.AppEligibility(dependent_id,dependent_kind,proof_type,proof_file_id,proof_valid_until,verified_by,verified_at,review_note) VALUES(@id,@kind,@type,@file,@until,CASE WHEN @file IS NULL THEN NULL ELSE @user END,CASE WHEN @file IS NULL THEN NULL ELSE SYSUTCDATETIME() END,@note)`,par,t);
 await audit(actor(req),'ELIGIBILITY','AppEligibility',id,{kind:d.dependent_kind,proof:d.proof_file_id},t);
 });res.json({ok:true});
}));
router.get('/members/:id/exemptions',permit('read'),wrap(async(req,res)=>res.json(await rows('SELECT * FROM dbo.AppExemptions WHERE client_id=@id ORDER BY id DESC',{id:req.params.id}))));
router.post('/members/:id/exemptions',permit('approve'),wrap(async(req,res)=>{const d=z.object({dependent_id:z.number().int().positive().nullable().optional(),type:z.enum(['VIP','DONATION','OTHER']),reason:z.string().trim().min(5).max(200),valid_from:date,valid_until:date.nullable().optional()}).parse(req.body);const id=await transactional(async t=>{if(d.dependent_id&&!await one('SELECT id FROM dbo.SubClient WHERE id=@dep AND IdClient=@id',{dep:d.dependent_id,id:req.params.id},t))fail('WRONG_DEPENDENT','التابع لا يتبع العضوية');const r=await run('INSERT dbo.AppExemptions(client_id,dependent_id,type,reason,valid_from,valid_until,approved_by) OUTPUT INSERTED.id VALUES(@client,@dependent_id,@type,@reason,@valid_from,@valid_until,@who)',{client:req.params.id,...d,dependent_id:d.dependent_id||null,valid_until:d.valid_until||null,who:actor(req)},t);await audit(actor(req),'EXEMPTION_ADD','AppExemptions',r.recordset[0].id,{type:d.type},t);return r.recordset[0].id;});res.status(201).json({id});}));
router.patch('/exemptions/:id',permit('approve'),wrap(async(req,res)=>{const id=intId(req.params.id),d=z.object({active:z.boolean()}).parse(req.body);expectRows(await run('UPDATE dbo.AppExemptions SET active=@active WHERE id=@id',{active:d.active?1:0,id}));await audit(actor(req),'EXEMPTION_STATUS','AppExemptions',id,d);res.json({ok:true});}));

export default router;
