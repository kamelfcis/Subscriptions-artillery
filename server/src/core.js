import {z} from 'zod';
export {moneyCents,centsMoney,ageYears,dependentKind,isVipInLawRelation} from './rules.js';
export class AppError extends Error{constructor(code,message,status=400,details=null){super(message);this.code=code;this.status=status;this.details=details;}}
export const fail=(code,message,status=400,details=null)=>{throw new AppError(code,message,status,details);};
export const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
export const text=z.string().trim().max(50);
export const short=z.string().trim().min(1).max(50);
export const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !Number.isNaN(+d)&&d.toISOString().slice(0,10)===v},'Invalid date');
export const money=z.coerce.number().finite().nonnegative().max(10000000).refine(n=>Number.isInteger(Math.round(n*100)) && Math.abs(n*100-Math.round(n*100))<0.00001,'Only 2 decimals');
export const PAGE_SIZES=[10,25,50,100];
export function paging(q){return {page:Math.max(1,Math.min(1000000,Math.floor(Number(q.page)||1))),size:Math.max(1,Math.min(100,Math.floor(Number(q.pageSize)||25)))};}
export function paginateParams(q){const {page,size}=paging(q);return {page,size,offset:(page-1)*size};}
export function asyncList(items,total,p){return {items,total:Number(total),page:p.page,pageSize:p.size};}
export function safeSort(value,allowed,def){return allowed.includes(value)?value:def;}
export function fileType(b){if(!b||b.length<4)return'application/octet-stream';if(b.subarray(0,3).equals(Buffer.from([255,216,255])))return'image/jpeg';if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image/png';if(b.subarray(0,4).toString('ascii')==='%PDF')return'application/pdf';if(b.subarray(0,2).toString('ascii')==='BM')return'image/bmp';if(b.subarray(0,4).toString('ascii')==='RIFF'&&b.subarray(8,12).toString('ascii')==='WEBP')return'image/webp';return'application/octet-stream';}
export const validFileKinds=new Set(['image/jpeg','image/png','image/bmp','image/webp','application/pdf']);
function plausibleBmp(b,at){if(at<0||at+26>b.length||b[at]!==0x42||b[at+1]!==0x4D)return false;const declared=b.readUInt32LE(at+2);const remain=b.length-at;return declared>=54&&declared<=remain+32;}
// Serve legacy bytes in place. If a known image is wrapped (OLE/Access prefix), slice from the signature. Never write the column back.
export function legacyImage(bytes){if(!bytes)return null;const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);if(!b.length)return null;const direct=fileType(b);if(validFileKinds.has(direct))return {bytes:b,mime:direct};const marks=[];const jpeg=b.indexOf(Buffer.from([255,216,255]));if(jpeg>=0)marks.push(jpeg);const png=b.indexOf(Buffer.from([137,80,78,71,13,10,26,10]));if(png>=0)marks.push(png);const pdf=b.indexOf(Buffer.from('%PDF'));if(pdf>=0)marks.push(pdf);let from=0;while(from<b.length){const at=b.indexOf('BM',from);if(at<0)break;if(plausibleBmp(b,at)){marks.push(at);break;}from=at+2;}if(!marks.length)return {bytes:b,mime:'application/octet-stream'};const start=Math.min(...marks);const slice=start===0?b:b.subarray(start);return {bytes:slice,mime:fileType(slice)};}
export function asImage(res,bytes){if(!bytes||!Buffer.byteLength(bytes))return res.status(404).json({error:'NOT_FOUND'});const parsed=legacyImage(bytes);if(!parsed||!validFileKinds.has(parsed.mime))return res.status(415).json({error:'UNKNOWN_FILE_FORMAT'});res.set({'Content-Type':parsed.mime,'Cache-Control':'private,no-store','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'});return res.end(parsed.bytes);}
export function assertBackupTarget(name,allowLive){const db=String(name||'');if(!/^[A-Za-z0-9_]{1,80}$/.test(db))fail('BACKUP_PATH','اسم قاعدة البيانات غير صالح');if(db.toLowerCase()==='subscriptions'&&String(allowLive)!=='true')fail('LIVE_BACKUP_REFUSED','النسخ عبر التطبيق مرفوض لقاعدة Subscriptions الحية إلا مع BACKUP_ALLOW_LIVE',409);return db;}
export function intId(x){const n=Number(x);if(!Number.isSafeInteger(n)||n<1)fail('INVALID_ID','Invalid identifier');return n;}
