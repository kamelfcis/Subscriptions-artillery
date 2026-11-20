import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {pool,one} from './db.js';
import {AppError,wrap} from './core.js';
import {login,logout,changePassword,requireAuth,requireCsrf} from './auth.js';
import legacy from './legacy.js';
import renewals from './renewals.js';
import ops from './ops.js';
if(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32||process.env.JWT_SECRET.includes('CHANGE_ME'))throw new Error('Configure a strong JWT_SECRET (32+ chars) in server/.env');
const app=express();app.disable('x-powered-by');
app.use((req,res,next)=>{const incoming=String(req.get('x-correlation-id')||'').replace(/[^\w.-]/g,'').slice(0,80);const id=incoming||crypto.randomUUID();req.correlationId=id;res.setHeader('X-Correlation-Id',id);next();});
app.use(helmet({contentSecurityPolicy:false}));app.use(compression());app.use(cookieParser());app.use(express.json({limit:'256kb'}));
const limiter=rateLimit({windowMs:60000,limit:200,standardHeaders:'draft-7',legacyHeaders:false});app.use('/api',limiter);
app.get('/api/health',(req,res)=>res.json({alive:true}));
app.get('/api/ready',wrap(async(req,res)=>{const db=await one("SELECT COUNT(*) total FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') AND name IN ('Client','SubClient','AppUsers','AppRenewals','AppPayments','AppAudit')");res.status(db.total===6?200:503).json({ready:db.total===6});}));
app.post('/api/auth/login',rateLimit({windowMs:60000,limit:8,standardHeaders:'draft-7',legacyHeaders:false}),login);
app.use('/api',requireAuth,requireCsrf);
app.post('/api/auth/logout',logout);
app.get('/api/auth/me',(req,res)=>res.json({user:req.user}));
app.post('/api/auth/change-password',changePassword);
app.use('/api',legacy,renewals,ops);
app.use('/api',(req,res)=>res.status(404).json({error:'NOT_FOUND'}));
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../web/dist');
if(process.env.SERVE_WEB!=='false'){
 app.use(express.static(base,{index:false,maxAge:'1h',immutable:false}));
 app.get('*',(req,res)=>res.sendFile(path.join(base,'index.html'),e=>{if(e&&!res.headersSent)res.status(404).send('Build frontend: npm run build in web');}));
}
app.use((err,req,res,next)=>{
 const status=err instanceof z.ZodError?400:err.status||(err.code==='LIMIT_FILE_SIZE'?413:500);
 if(status>=500)console.error('API failure',req.correlationId||'-',req.method,req.path,err.code||err.name||'ERROR',err.originalError?.message||err.message);
 const reply={error:err instanceof z.ZodError?'VALIDATION_ERROR':err instanceof AppError?err.code:status===413?'UPLOAD_TOO_LARGE':status>=500?'INTERNAL_ERROR':'BAD_REQUEST',message:err instanceof z.ZodError?'بيانات الطلب غير صحيحة':status>=500?'حدث خطأ داخلي، راجع سجل السيرفر':err.message};
 if(err instanceof z.ZodError)reply.issues=err.issues;
 if(err instanceof AppError&&err.details)reply.details=err.details;
 if(req.correlationId)reply.correlationId=req.correlationId;
 res.status(status).json(reply);
});
const port=Number(process.env.PORT||5050),host=process.env.HOST||'127.0.0.1';
export {app};
// Fail fast if SQL is unavailable: do not claim the service is ready with a broken DB.
if(process.env.NODE_APP_LISTEN!=='false'){
 try{await pool();const ok=await one("SELECT COUNT(*) total FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') AND name IN ('Client','SubClient','AppUsers','AppRenewals','AppPayments','AppAudit')");if(ok.total!==6)throw new Error('Database migration incomplete: run DB verification and additive migration on a staging copy first');const server=app.listen(port,host,()=>console.log(`Subscriptions Enterprise listening on http://${host}:${port}`));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
 }catch(e){console.error('Unable to connect to SQL Server:',e.message);process.exitCode=1;}
}
