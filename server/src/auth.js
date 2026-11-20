import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import {z} from 'zod';
import {one,rows,run,audit} from './db.js';
import {wrap,fail} from './core.js';
export const roles=['admin','supervisor','cashier','clerk','auditor'];
export const permissions={
 admin:['*'],supervisor:['read','write','finance','reports','block','fees','print','users','approve'],
 cashier:['read','finance','reports','print'],clerk:['read','write','print'],auditor:['read','reports']
};
export const permit=(...names)=>(req,res,next)=>{if(permissions[req.user?.role]?.includes('*')||names.some(x=>permissions[req.user?.role]?.includes(x)))return next();return res.status(403).json({error:'FORBIDDEN',message:'ليس لديك صلاحية لتنفيذ هذا الإجراء'});};
export const sessionOpts=()=>({httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:8*60*60*1000});
export const login=wrap(async(req,res)=>{
 const {username,password}=z.object({username:z.string().trim().min(1).max(80),password:z.string().min(1).max(200)}).parse(req.body);
 const u=await one('SELECT username,password_hash,role,enabled FROM dbo.AppUsers WHERE username=@username',{username});
 if(!u||!u.enabled||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:'INVALID_LOGIN',message:'بيانات الدخول غير صحيحة'});
 const token=jwt.sign({sub:u.username,role:u.role},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'8h'});
 const csrf=crypto.randomBytes(24).toString('hex');
 res.cookie('session',token,sessionOpts());res.cookie('csrf',csrf,{...sessionOpts(),httpOnly:false});
 await audit(u.username,'LOGIN','auth',u.username);
 res.json({user:{username:u.username,role:u.role},csrf});
});
export async function requireAuth(req,res,next){try{
 const raw=req.cookies?.session;if(!raw)return res.status(401).json({error:'UNAUTHORIZED'});
 const u=jwt.verify(raw,process.env.JWT_SECRET,{algorithms:['HS256']});
 // Always honor account deactivation/role changes even for a previously issued token.
 const current=await one('SELECT username,role,enabled FROM dbo.AppUsers WHERE username=@who',{who:u.sub});
 if(!current||!current.enabled||current.role!==u.role)return res.status(401).json({error:'SESSION_REVOKED'});
 req.user={username:current.username,role:current.role};next();
 }catch(e){if(e?.code==='ESOCKET'||e?.code==='ETIMEOUT')return next(e);return res.status(401).json({error:'UNAUTHORIZED'});}}

export function requireCsrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const h=req.get('X-CSRF-Token')||'';const c=req.cookies?.csrf||'';if(!c||!h||h.length!==c.length||!crypto.timingSafeEqual(Buffer.from(h),Buffer.from(c)))return res.status(403).json({error:'CSRF_REJECTED'});next();}
export const logout=wrap(async(req,res)=>{res.clearCookie('session',{path:'/'});res.clearCookie('csrf',{path:'/'});res.json({ok:true});});
export const changePassword=wrap(async(req,res)=>{
 const d=z.object({
  current_password:z.string().min(1).max(200),
  new_password:z.string().min(8).max(128),
  confirm_password:z.string().min(8).max(128),
 }).parse(req.body);
 if(d.new_password!==d.confirm_password)fail('PASSWORD_MISMATCH','كلمة المرور الجديدة وتأكيدها غير متطابقتين',409);
 if(d.new_password===d.current_password)fail('PASSWORD_UNCHANGED','اختر كلمة مرور جديدة مختلفة عن الحالية',409);
 const u=await one('SELECT username,password_hash,enabled FROM dbo.AppUsers WHERE username=@who',{who:req.user.username});
 if(!u||!u.enabled)fail('UNAUTHORIZED','الجلسة غير صالحة',401);
 if(!(await bcrypt.compare(d.current_password,u.password_hash)))fail('BAD_PASSWORD','كلمة المرور الحالية غير صحيحة',403);
 const hash=await bcrypt.hash(d.new_password,12);
 await run('UPDATE dbo.AppUsers SET password_hash=@hash WHERE username=@who',{hash,who:req.user.username});
 await audit(req.user.username,'PASSWORD_CHANGE','AppUsers',req.user.username,{});
 res.json({ok:true});
});
export const listUsers=wrap(async(req,res)=>res.json(await rows('SELECT username,role,enabled,created_at FROM dbo.AppUsers ORDER BY username')));
export const saveUser=wrap(async(req,res)=>{const d=z.object({username:z.string().regex(/^[a-zA-Z0-9._-]{3,64}$/),password:z.string().min(8).max(128),role:z.enum(roles)}).parse(req.body);const hash=await bcrypt.hash(d.password,12);await run('INSERT dbo.AppUsers(username,password_hash,role,enabled) VALUES(@username,@hash,@role,1)',{...d,hash});await audit(req.user.username,'USER_CREATE','AppUsers',d.username,{role:d.role});res.status(201).json({username:d.username});});
export const editUser=wrap(async(req,res)=>{const d=z.object({role:z.enum(roles).optional(),enabled:z.boolean().optional(),password:z.string().min(8).max(128).optional()}).parse(req.body);if(d.enabled===false&&req.params.username===req.user.username)fail('SELF_DISABLE','لا يمكن تعطيل حسابك بنفسك');if(d.role&&d.role!=='admin'&&req.params.username===req.user.username)fail('SELF_DEMOTE','لا يمكن خفض صلاحيات حسابك بنفسك');const list=[],p={username:req.params.username};if(d.role){list.push('role=@role');p.role=d.role;}if(d.enabled!==undefined){list.push('enabled=@enabled');p.enabled=d.enabled?1:0;}if(d.password){list.push('password_hash=@hash');p.hash=await bcrypt.hash(d.password,12);}if(!list.length)fail('EMPTY','لم يتم تحديد حقول');const r=await run(`UPDATE dbo.AppUsers SET ${list.join(',')} WHERE username=@username`,p);if(!r.rowsAffected[0])fail('NOT_FOUND','المستخدم غير موجود',404);await audit(req.user.username,'USER_UPDATE','AppUsers',req.params.username,{role:d.role,enabled:d.enabled});res.json({ok:true});});
