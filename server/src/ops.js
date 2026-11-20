import {Router} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import multer from 'multer';
import {z} from 'zod';
import {rows,one,run,audit,pool,bind,sql} from './db.js';
import {wrap,fail,date,intId,paginateParams,asyncList,assertBackupTarget,fileType,validFileKinds} from './core.js';
import {permit,listUsers,saveUser,editUser} from './auth.js';
import {assessBlock} from './blocklist.js';
import {loadCardTemplate,saveCardTemplate,deepMerge} from './card-template.js';
import {parseMembershipId} from './membership-id.js';
import {hasActiveDependentRenewal} from './dependent-renewal.js';
import * as XLSX from 'xlsx';
const r=Router();
const cardAssetDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/card-assets');
const cardAssetUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1}});
const cardAssetKinds=new Set(['logo','background','back-background','back-logo']);
const cardAssetNameRe=/^(logo|background|back-background|back-logo)\.(png|jpg|webp|bmp)$/i;
function ensureCardAssetDir(){fs.mkdirSync(cardAssetDir,{recursive:true});}
function cardAssetExt(mime){
 if(mime==='image/png')return'png';
 if(mime==='image/jpeg')return'jpg';
 if(mime==='image/webp')return'webp';
 if(mime==='image/bmp')return'bmp';
 return null;
}
const range=z.object({from:date,to:date}).refine(d=>d.from<=d.to,'End must be after start');
const dateRange=req=>range.parse({from:req.query.from||new Date(Date.now()-30*86400000).toISOString().slice(0,10),to:req.query.to||new Date().toISOString().slice(0,10)});
function csvCell(val){const s=String(val??'');const safe=/^[\s]*[=+@-]/.test(s)?"'"+s:s;return '"'+safe.replaceAll('"','""')+'"';}
function plainRows(items){return items.map(row=>{const out={};for(const [k,v] of Object.entries(row))out[k]=v instanceof Date?v.toISOString():v;return out;});}
function sendCsv(res,filename,items){if(!items.length){res.set('Content-Type','text/csv; charset=utf-8');res.send('\uFEFF');return;}const keys=Object.keys(items[0]);const content='\uFEFF'+keys.map(csvCell).join(',')+'\r\n'+items.map(x=>keys.map(k=>csvCell(x[k] instanceof Date?x[k].toISOString():x[k])).join(',')).join('\r\n');res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${filename}.csv"`});res.send(content);}
function sendXlsx(res,filename,items){const book=XLSX.utils.book_new();const sheet=XLSX.utils.json_to_sheet(plainRows(items));XLSX.utils.book_append_sheet(book,sheet,'Report');const buf=XLSX.write(book,{type:'buffer',bookType:'xlsx'});res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${filename}.xlsx"`});res.send(buf);}
function sendTable(res,filename,items,format){if(format==='xlsx')return sendXlsx(res,filename,items);return sendCsv(res,filename,items);}
function reportFilters(req){const d=dateRange(req);const method=['CASH','CARD','TRANSFER'].includes(req.query.method)?req.query.method:'';const service=['01','02','03','04'].includes(req.query.service_code)?req.query.service_code:'';const clientRaw=String(req.query.client||'').trim();return {...d,client:String(parseMembershipId(clientRaw)||clientRaw).slice(0,50),cashier:String(req.query.collected_by||'').slice(0,64),method,service};}
r.get('/dashboard',permit('read'),wrap(async(req,res)=>{const [members,dependents,blocked,renewals,outstanding,month,newPayments]=await Promise.all([
 one('SELECT COUNT_BIG(*) total FROM dbo.Client c LEFT JOIN dbo.AppClientFlags f ON f.client_id=c.IdClient WHERE ISNULL(f.is_archived,0)=0'),
 one('SELECT COUNT_BIG(*) total FROM dbo.SubClient s LEFT JOIN dbo.AppDependentFlags f ON f.dependent_id=s.id WHERE ISNULL(f.is_archived,0)=0'),
 one('SELECT COUNT_BIG(*) total FROM dbo.Blocked'),one("SELECT COUNT_BIG(*) total FROM dbo.AppRenewals WHERE status='ACTIVE'"),
 one("SELECT COUNT_BIG(*) total,ISNULL(SUM(amount_due-paid_amount),0) amount FROM dbo.AppRenewals WHERE status='PENDING'"),
 one('SELECT COUNT_BIG(*) total FROM dbo.subscriptioninf WHERE todate>=CAST(GETDATE() AS date) AND todate<DATEADD(day,31,CAST(GETDATE() AS date))'),
 one("SELECT ISNULL(SUM(amount),0) amount FROM dbo.AppPayments WHERE created_at>=DATEFROMPARTS(YEAR(SYSUTCDATETIME()),MONTH(SYSUTCDATETIME()),1)")
 ]);res.json({members:Number(members.total),dependents:Number(dependents.total),blocked:Number(blocked.total),new_active:Number(renewals.total),pending:Number(outstanding.total),outstanding:Number(outstanding.amount),legacy_expiring_30d:Number(month.total),new_payments_month:Number(newPayments.amount)});}));
r.get('/reports/revenue',permit('reports'),wrap(async(req,res)=>{const d=dateRange(req),param=d;const [payments,refunds,legacy,daily,categories,reviews]=await Promise.all([
 one('SELECT COUNT_BIG(*) count,ISNULL(SUM(amount),0) total FROM dbo.AppPayments WHERE created_at>=@from AND created_at<DATEADD(day,1,CAST(@to AS datetime2))',param),
 one('SELECT COUNT_BIG(*) count,ISNULL(SUM(amount),0) total FROM dbo.AppReversals WHERE created_at>=@from AND created_at<DATEADD(day,1,CAST(@to AS datetime2))',param),
 one('SELECT COUNT_BIG(*) count,ISNULL(SUM(CAST(money AS bigint)),0) total FROM dbo.bill WHERE createon>=@from AND createon<DATEADD(day,1,CAST(@to AS datetime2))',param),
 rows(`SELECT CAST(p.created_at AS date) day,p.method,COUNT_BIG(*) transactions,SUM(p.amount) total FROM dbo.AppPayments p WHERE p.created_at>=@from AND p.created_at<DATEADD(day,1,CAST(@to AS datetime2)) GROUP BY CAST(p.created_at AS date),p.method ORDER BY day DESC,p.method`,param),
 rows(`SELECT r.service_code,COUNT_BIG(*) renewals,SUM(r.amount_due) invoiced,SUM(r.paid_amount) received FROM dbo.AppRenewals r WHERE r.created_at>=@from AND r.created_at<DATEADD(day,1,CAST(@to AS datetime2)) AND r.status<>'VOID' GROUP BY r.service_code ORDER BY r.service_code`,param),
 one('SELECT COUNT_BIG(*) reviewed,ISNULL(SUM(actual_money-recorded_money),0) difference FROM dbo.AppLegacyBillReviews WHERE reviewed_at>=@from AND reviewed_at<DATEADD(day,1,CAST(@to AS datetime2))',param)
 ]);res.json({range:d,newLedger:{payments:Number(payments.total),refunds:Number(refunds.total),net:Number(payments.total)-Number(refunds.total),paymentCount:Number(payments.count)},legacyBills:{total:Number(legacy.total),count:Number(legacy.count),reconciliationRequired:true,reviewed:Number(reviews.reviewed),reviewedDifference:Number(reviews.difference)},daily,categories,notice:'البيانات المالية القديمة والجديدة معروضة منفصلة لتجنب مضاعفة العد. لا توجد تسوية تلقائية للأرصدة التاريخية.'});}));
r.get('/reports/expiring',permit('reports'),wrap(async(req,res)=>{const p=paginateParams(req.query),days=Math.min(365,Math.max(1,Number(req.query.days)||30));const param={days,offset:p.offset,size:p.size};const latest=`(SELECT clientid,MAX(ends) ends FROM (
 SELECT clientid,todate ends FROM dbo.subscriptioninf
 UNION ALL SELECT r.client_id,r.term_to FROM dbo.AppRenewals r WHERE r.status='ACTIVE'
 ) v GROUP BY clientid)`;const where=`x.ends BETWEEN CAST(GETDATE() AS date) AND DATEADD(day,@days,CAST(GETDATE() AS date))`;const items=await rows(`SELECT c.IdClient,c.Name,c.Phone,x.ends FROM ${latest} x JOIN dbo.Client c ON c.IdClient=x.clientid WHERE ${where} ORDER BY x.ends ASC,c.IdClient OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`,param);const count=(await one(`SELECT COUNT_BIG(*) total FROM ${latest} x WHERE ${where}`,param)).total;res.json(asyncList(items,count,p));}));
r.get('/reports/outstanding',permit('reports'),wrap(async(req,res)=>{const p=paginateParams(req.query);const items=await rows(`SELECT r.id,r.client_id,c.Name,r.dependent_id,r.amount_due,r.paid_amount,(r.amount_due-r.paid_amount) outstanding,r.term_to,r.created_at FROM dbo.AppRenewals r JOIN dbo.Client c ON c.IdClient=r.client_id WHERE r.status='PENDING' ORDER BY r.id DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`,{offset:p.offset,size:p.size});const count=(await one("SELECT COUNT_BIG(*) total FROM dbo.AppRenewals WHERE status='PENDING'")).total;res.json(asyncList(items,count,p));}));
r.get('/reports/legacy-bills',permit('reports'),wrap(async(req,res)=>{const p=paginateParams(req.query),search=String(req.query.search||'').trim().slice(0,50),idSearch=String(parseMembershipId(String(req.query.search||'').trim())).slice(0,50);const param={search,idSearch,offset:p.offset,size:p.size};const where=`(@search='' OR b.CId=@search OR b.CId=@idSearch OR b.admin LIKE @search+'%')`;const items=await rows(`SELECT b.id,b.shiftid,b.money,b.operate,b.createon,b.admin,b.CId FROM dbo.bill b WHERE ${where} ORDER BY b.createon DESC,b.id DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`,param);const count=(await one(`SELECT COUNT_BIG(*) total FROM dbo.bill b WHERE ${where}`,param)).total;res.json(asyncList(items,count,p));}));
r.get('/legacy-bill-reviews',permit('reports'),wrap(async(req,res)=>{const p=paginateParams(req.query);const items=await rows('SELECT id,bill_id,shift_id,recorded_money,actual_money,reason,reviewed_by,reviewed_at FROM dbo.AppLegacyBillReviews ORDER BY id DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY',{offset:p.offset,size:p.size});const count=(await one('SELECT COUNT_BIG(*) total FROM dbo.AppLegacyBillReviews')).total;res.json(asyncList(items,count,p));}));
r.post('/legacy-bills/:id/reconcile',permit('approve'),wrap(async(req,res)=>{const id=intId(req.params.id),d=z.object({shift_id:z.number().int().positive(),actual_money:z.number().nonnegative().max(10000000),reason:z.string().min(12).max(300)}).parse(req.body);await run('SET XACT_ABORT ON');
 const b=await one('SELECT money FROM dbo.bill WHERE id=@id AND shiftid=@shift',{id,shift:d.shift_id});if(!b)fail('NOT_FOUND','الإيصال التاريخي غير موجود',404);
 const out=await run('INSERT dbo.AppLegacyBillReviews(bill_id,shift_id,recorded_money,actual_money,reason,reviewed_by) OUTPUT INSERTED.id VALUES(@id,@shift,@recorded,@actual,@reason,@who)',{id,shift:d.shift_id,recorded:b.money,actual:d.actual_money,reason:d.reason,who:req.user.username});await audit(req.user.username,'LEGACY_BILL_REVIEW','AppLegacyBillReviews',out.recordset[0].id,{bill_id:id,shift_id:d.shift_id,recorded:b.money,actual:d.actual_money});res.status(201).json({id:out.recordset[0].id});}));
r.get('/reports/payments',permit('reports'),wrap(async(req,res)=>{const p=paginateParams(req.query),f=reportFilters(req),par={...f,size:p.size,offset:p.offset};const where=`p.created_at>=@from AND p.created_at<DATEADD(day,1,CAST(@to AS datetime2)) AND (@client='' OR r.client_id=@client) AND (@cashier='' OR p.collected_by=@cashier) AND (@method='' OR p.method=@method) AND (@service='' OR r.service_code=@service)`;const items=await rows(`SELECT p.id,p.renewal_id,r.client_id,r.service_code,p.amount,p.method,p.reference,p.collected_by,p.created_at,p.shift_id FROM dbo.AppPayments p JOIN dbo.AppRenewals r ON r.id=p.renewal_id WHERE ${where} ORDER BY p.id DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`,par);const count=(await one(`SELECT COUNT_BIG(*) total FROM dbo.AppPayments p JOIN dbo.AppRenewals r ON r.id=p.renewal_id WHERE ${where}`,par)).total;res.json(asyncList(items,count,p));}));
r.get('/reports/audit',permit('reports'),wrap(async(req,res)=>{const p=paginateParams(req.query),entityRaw=String(req.query.entity_id||'').trim(),entityId=String(parseMembershipId(entityRaw)||entityRaw).slice(0,80),par={offset:p.offset,size:p.size,entityId};const where=entityId?`WHERE entity_id=@entityId`:'';const items=await rows(`SELECT id,actor,action,entity,entity_id,details,created_at FROM dbo.AppAudit ${where} ORDER BY id DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`,par);const count=(await one(`SELECT COUNT_BIG(*) total FROM dbo.AppAudit ${where}`,par)).total;res.json(asyncList(items,count,p));}));
r.get('/reports/:kind/export',permit('reports'),wrap(async(req,res)=>{
 const kind=req.params.kind,format=req.query.format==='xlsx'?'xlsx':'csv';let records;const f=reportFilters(req);
 if(kind==='payments')records=await rows(`SELECT TOP 20000 p.id,p.renewal_id,r.client_id,r.service_code,p.amount,p.method,p.reference,p.collected_by,p.created_at,p.shift_id FROM dbo.AppPayments p JOIN dbo.AppRenewals r ON r.id=p.renewal_id WHERE p.created_at>=@from AND p.created_at<DATEADD(day,1,CAST(@to AS datetime2)) AND (@client='' OR r.client_id=@client) AND (@cashier='' OR p.collected_by=@cashier) AND (@method='' OR p.method=@method) AND (@service='' OR r.service_code=@service) ORDER BY p.id`,f);
 else if(kind==='revenue')records=await rows(`SELECT CAST(p.created_at AS date) day,p.method,r.service_code,p.collected_by,COUNT_BIG(*) transactions,SUM(p.amount) total FROM dbo.AppPayments p JOIN dbo.AppRenewals r ON r.id=p.renewal_id WHERE p.created_at>=@from AND p.created_at<DATEADD(day,1,CAST(@to AS datetime2)) AND (@cashier='' OR p.collected_by=@cashier) AND (@method='' OR p.method=@method) AND (@service='' OR r.service_code=@service) GROUP BY CAST(p.created_at AS date),p.method,r.service_code,p.collected_by ORDER BY day`,f);
 else if(kind==='outstanding')records=await rows(`SELECT TOP 20000 r.id,r.client_id,c.Name,r.service_code,r.amount_due,r.paid_amount,(r.amount_due-r.paid_amount) outstanding,r.term_to FROM dbo.AppRenewals r JOIN dbo.Client c ON c.IdClient=r.client_id WHERE r.status='PENDING' AND (@client='' OR r.client_id=@client) AND (@service='' OR r.service_code=@service) ORDER BY r.id`,f);
 else if(kind==='legacy-bills')records=await rows('SELECT TOP 20000 id,shiftid,money,operate,createon,admin,CId FROM dbo.bill WHERE createon>=@from AND createon<DATEADD(day,1,CAST(@to AS datetime2)) ORDER BY id,shiftid',f);
 else if(kind==='blocked')records=await rows('SELECT TOP 20000 Id,Name,IdCard,JOP,reason,timeoff,State,Phone,Address,cat FROM dbo.Blocked ORDER BY Id');
 else if(kind==='members')records=await rows('SELECT TOP 20000 IdClient,Name,IdCard,Phone,Address,jop,State,Cat,age,alive FROM dbo.Client ORDER BY IdClient');
 else fail('UNKNOWN_REPORT','التقرير غير موجود',404);
 await audit(req.user.username,'EXPORT','Report',kind,{from:f.from,to:f.to,count:records.length,format});sendTable(res,kind+'-'+f.from,records,format);
}));
r.get('/users',permit('users'),listUsers);r.post('/users',permit('users'),saveUser);r.patch('/users/:username',permit('users'),editUser);
r.get('/admin/health',permit('users'),wrap(async(req,res)=>{const r=await one('SELECT DB_NAME() name,GETDATE() date,@@SERVERNAME server');res.json({db:r,ok:true});}));
r.post('/admin/backup',permit('users'),wrap(async(req,res)=>{
 if(process.env.BACKUP_ENABLED!=='true')fail('BACKUP_DISABLED','النسخ الاحتياطي معطل حتى يتم تجهيز صلاحيات SQL Server ومسار التخزين',409);
 const directory=process.env.SQL_BACKUP_DIR;if(!directory||!path.win32.isAbsolute(directory))fail('BACKUP_PATH','يجب تحديد مسار مطلق على خادم قاعدة البيانات');
 const database=assertBackupTarget(process.env.SQL_DATABASE,process.env.BACKUP_ALLOW_LIVE);
 const name=database+'_COPYONLY_'+new Date().toISOString().replace(/[:.]/g,'-')+'.bak';const full=path.win32.join(directory,name);
 // The path is server-local; SQL Server's service identity, not Node, needs write permission.
 const backupReq=bind(new sql.Request(await pool()),{path:full});backupReq.timeout=0;await backupReq.query(`DECLARE @p nvarchar(1024)=@path; BACKUP DATABASE [${database}] TO DISK=@p WITH COPY_ONLY,INIT,CHECKSUM,STATS=10; RESTORE VERIFYONLY FROM DISK=@p WITH CHECKSUM`);
 await audit(req.user.username,'BACKUP','Database',name,{verified:true});res.json({ok:true,sqlServerPath:full,verified:true,note:'اختبار الاسترجاع الفعلي على سيرفر منفصل مطلوب بشكل دوري'});
}));
r.post('/card-jobs',permit('print'),wrap(async(req,res)=>{const d=z.object({client_id:z.string().max(50),dependent_id:z.number().int().positive().nullable().optional(),printer:z.string().max(150).optional(),reprint_reason:z.string().trim().max(300).optional(),confirm_same_identity:z.boolean().optional()}).parse(req.body);
 const client=await one(`SELECT c.IdClient,c.Name,c.IdCard,ISNULL(f.is_security_blocked,0) security_blocked FROM dbo.Client c LEFT JOIN dbo.AppClientFlags f ON f.client_id=c.IdClient WHERE c.IdClient=@id`,{id:d.client_id});if(!client)fail('NOT_FOUND','العضوية غير موجودة',404);
 if(client.security_blocked)fail('SECURITY_BLOCK','محظور أمنيًا — لا يمكن إصدار كارنيه',403);
 const gate=await assessBlock(client.Name,client.IdCard);if(gate.deny)fail('SECURITY_BLOCK','محظور أمنيًا — رقم الهوية مطابق لقائمة المحظورين، لا يمكن إصدار كارنيه',403);
 let nameCollisions=gate.nameCollisions.map(x=>({...x,who:'MAIN'}));
 if(d.dependent_id){const member=await one('SELECT id,Name,IdCard FROM dbo.SubClient WHERE id=@dep AND IdClient=@id',{dep:d.dependent_id,id:d.client_id});if(!member)fail('BAD_DEPENDENT','التابع غير موجود',404);if(!(await hasActiveDependentRenewal(d.client_id,d.dependent_id)))fail('DEPENDENT_NOT_RENEWED','يتطلب تجديد التابع أولاً — لا يمكن إصدار كارنيه لتابع غير مجدَّد',409);const depGate=await assessBlock(member.Name,member.IdCard);if(depGate.deny)fail('SECURITY_BLOCK','رقم هوية التابع مطابق لسجل حظر، لا يمكن إصدار كارنيه',403);nameCollisions=nameCollisions.concat(depGate.nameCollisions.map(x=>({...x,who:'DEPENDENT'})));}
 if(d.confirm_same_identity&&nameCollisions.length)fail('SECURITY_BLOCK','تم تأكيد أن الاسم هو نفس سجل الحظر، لا يمكن إصدار كارنيه (مرجع '+(nameCollisions[0].blocked_id||nameCollisions[0].id)+')',403);
 const prior=await one(`SELECT TOP 1 id FROM dbo.AppCardJobs WHERE client_id=@client AND ISNULL(dependent_id,-1)=ISNULL(@dep,-1) AND status IN ('PREPARED','SPOOLED') ORDER BY id DESC`,{client:d.client_id,dep:d.dependent_id||null});
 if(prior&&(!d.reprint_reason||d.reprint_reason.length<4))fail('REPRINT_REASON_REQUIRED','إعادة الطباعة تحتاج سببًا واضحًا',409);
 const id=(await run("INSERT dbo.AppCardJobs(client_id,dependent_id,printer,status,requested_by,reprint_reason) OUTPUT INSERTED.id VALUES(@client_id,@dependent_id,@printer,'PREPARED',@who,@reason)",{client_id:d.client_id,dependent_id:d.dependent_id||null,printer:d.printer||null,who:req.user.username,reason:d.reprint_reason||null})).recordset[0].id;await audit(req.user.username,'CARD_PREVIEW','AppCardJobs',id,{reprint:!!prior});res.status(201).json({id,status:'PREPARED',name_collisions:nameCollisions});}));
r.patch('/card-jobs/:id',permit('print'),wrap(async(req,res)=>{const id=intId(req.params.id),d=z.object({status:z.enum(['SPOOLED','ERROR']),error_message:z.string().max(400).optional()}).parse(req.body);const x=await one('SELECT id,status,requested_by FROM dbo.AppCardJobs WHERE id=@id',{id});if(!x)fail('NOT_FOUND','عملية الطباعة غير موجودة',404);if(x.requested_by!==req.user.username&&req.user.role!=='admin')fail('FORBIDDEN','عملية تخص موظف آخر',403);if(x.status!=='PREPARED')fail('INVALID_STATE','لا يمكن تغيير حالة عملية مكتملة',409);await run('UPDATE dbo.AppCardJobs SET status=@status,error_message=@message,updated_at=SYSUTCDATETIME() WHERE id=@id',{id,status:d.status,message:d.error_message||null});await audit(req.user.username,'CARD_STATUS','AppCardJobs',id,d);res.json({ok:true});}));
r.get('/card-jobs',permit('print'),wrap(async(req,res)=>res.json(await rows('SELECT TOP 100 * FROM dbo.AppCardJobs ORDER BY id DESC'))));
r.get('/card-template',permit('read'),wrap(async(req,res)=>res.json(await loadCardTemplate())));
r.put('/card-template',permit('users'),wrap(async(req,res)=>{
 if(req.user.role!=='admin')fail('FORBIDDEN','تصميم الكارنيه متاح لمدير النظام فقط',403);
 const patch=req.body?.template&&typeof req.body.template==='object'?req.body.template:req.body;
 const current=(await loadCardTemplate()).template;
 const saved=await saveCardTemplate(deepMerge(current,patch),req.user.username);
 await audit(req.user.username,'CARD_TEMPLATE','AppCardTemplate',1,{keys:Object.keys(patch)});
 res.json({ok:true,template:saved});
}));
r.post('/card-assets',permit('users'),cardAssetUpload.single('file'),wrap(async(req,res)=>{
 if(req.user.role!=='admin')fail('FORBIDDEN','رفع أصول الكارنيه متاح لمدير النظام فقط',403);
 const kind=String(req.body?.kind||'logo').trim();
 if(!cardAssetKinds.has(kind))fail('BAD_KIND','نوع أصل الكارنيه غير مدعوم');
 if(!req.file)fail('FILE_REQUIRED','اختار صورة الشعار أو الخلفية');
 const mime=fileType(req.file.buffer);
 if(!validFileKinds.has(mime)||!mime.startsWith('image/'))fail('IMAGE_ONLY','صورة فقط (PNG / JPG / WEBP / BMP)',415);
 const ext=cardAssetExt(mime);
 if(!ext)fail('IMAGE_ONLY','امتداد الصورة غير مدعوم',415);
 ensureCardAssetDir();
 for(const old of fs.readdirSync(cardAssetDir)){
  if(old.toLowerCase().startsWith(kind+'.'))fs.unlinkSync(path.join(cardAssetDir,old));
 }
 const name=`${kind}.${ext}`;
 fs.writeFileSync(path.join(cardAssetDir,name),req.file.buffer);
 const url=`/api/card-assets/${name}?v=${Date.now()}`;
 await audit(req.user.username,'CARD_ASSET','CardAsset',kind,{name,size:req.file.size,mime});
 res.status(201).json({ok:true,url,kind,name});
}));
r.get('/card-assets/:name',permit('read'),wrap(async(req,res)=>{
 const name=path.basename(String(req.params.name||''));
 if(!cardAssetNameRe.test(name))fail('BAD_NAME','اسم الملف غير صالح',400);
 const file=path.join(cardAssetDir,name);
 if(!fs.existsSync(file))fail('NOT_FOUND','أصل الكارنيه غير موجود',404);
 res.set({'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});
 res.sendFile(file);
}));
r.delete('/card-assets/:kind',permit('users'),wrap(async(req,res)=>{
 if(req.user.role!=='admin')fail('FORBIDDEN','حذف أصول الكارنيه متاح لمدير النظام فقط',403);
 const kind=String(req.params.kind||'').trim();
 if(!cardAssetKinds.has(kind))fail('BAD_KIND','نوع أصل الكارنيه غير مدعوم');
 ensureCardAssetDir();
 let removed=0;
 for(const old of fs.readdirSync(cardAssetDir)){
  if(old.toLowerCase().startsWith(kind+'.')){fs.unlinkSync(path.join(cardAssetDir,old));removed+=1;}
 }
 await audit(req.user.username,'CARD_ASSET_DELETE','CardAsset',kind,{removed});
 res.json({ok:true,removed});
}));
export default r;
