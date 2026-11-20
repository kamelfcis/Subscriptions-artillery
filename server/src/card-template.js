import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {one,run} from './db.js';

const defaultPath=path.join(path.dirname(fileURLToPath(import.meta.url)),'../../web/src/card-template.json');
export const defaultCardTemplate=JSON.parse(fs.readFileSync(defaultPath,'utf8'));

const hexColor=z.string().regex(/^#[0-9A-Fa-f]{6}$/,'invalid hex color');

const textBlock=z.object({
 show:z.boolean().optional(),
 text:z.string().max(200).optional(),
 xFromRight:z.number().int().min(0).max(2000).optional(),
 y:z.number().int().min(0).max(2000).optional(),
 font:z.string().max(120).optional(),
 color:hexColor.optional(),
 maxWidth:z.number().int().min(50).max(2000).optional(),
 maxChars:z.number().int().min(5).max(200).optional(),
}).partial();

const labelValue=z.object({
 show:z.boolean().optional(),
 label:z.string().max(120).optional(),
 xFromRight:z.number().int().min(0).max(2000).optional(),
 y:z.number().int().min(0).max(2000).optional(),
 labelY:z.number().int().min(0).max(2000).optional(),
 valueY:z.number().int().min(0).max(2000).optional(),
 font:z.string().max(120).optional(),
 labelFont:z.string().max(120).optional(),
 valueFont:z.string().max(120).optional(),
 color:hexColor.optional(),
 labelColor:hexColor.optional(),
 valueColor:hexColor.optional(),
 maxWidth:z.number().int().min(50).max(2000).optional(),
 maxChars:z.number().int().min(5).max(200).optional(),
}).partial();

const signatureBlock=z.object({
 show:z.boolean().optional(),
 lines:z.array(z.string().max(200)).max(6).optional(),
 x:z.number().int().min(0).max(2000).optional(),
 y:z.number().int().min(0).max(2000).optional(),
 font:z.string().max(120).optional(),
 color:hexColor.optional(),
 lineHeight:z.number().int().min(10).max(80).optional(),
 align:z.enum(['center','right','left']).optional(),
}).partial();

const backgroundBlock=z.object({
 gradient:z.array(hexColor).min(2).max(6).optional(),
 imageUrl:z.union([z.string().max(2000),z.literal(''),z.null()]).optional(),
 dividerY:z.number().int().min(0).max(2000).optional(),
}).partial();

const box=z.object({
 x:z.number().int().min(0).max(2000).optional(),
 y:z.number().int().min(0).max(2000).optional(),
 w:z.number().int().min(0).max(2000).optional(),
 h:z.number().int().min(0).max(2000).optional(),
 radius:z.number().int().min(0).max(200).optional(),
 size:z.number().int().min(20).max(500).optional(),
 inner:z.object({
  x:z.number().int().min(0).max(2000).optional(),
  y:z.number().int().min(0).max(2000).optional(),
  w:z.number().int().min(0).max(2000).optional(),
  h:z.number().int().min(0).max(2000).optional(),
  radius:z.number().int().min(0).max(200).optional(),
 }).partial().optional(),
}).partial();

const logoBox=box.extend({
 show:z.boolean().optional(),
 imageUrl:z.union([z.string().max(2000),z.literal(''),z.null()]).optional(),
}).partial();

const backSideSchema=z.object({
 enabled:z.boolean().optional(),
 background:backgroundBlock.optional(),
 title:textBlock.optional(),
 logo:logoBox.optional(),
 fields:z.object({
  name:textBlock.optional(),
  number:labelValue.optional(),
  rfid:labelValue.optional(),
  rank:labelValue.optional(),
 }).partial().optional(),
 lines:z.array(z.object({
  text:z.string().max(500).optional(),
  xFromRight:z.number().int().min(0).max(2000).optional(),
  y:z.number().int().min(0).max(2000).optional(),
  font:z.string().max(120).optional(),
  color:hexColor.optional(),
  maxWidth:z.number().int().min(50).max(2000).optional(),
 }).partial()).max(8).optional(),
 qr:z.object({
  showQr:z.boolean().optional(),
  x:z.number().int().min(0).max(2000).optional(),
  y:z.number().int().min(0).max(2000).optional(),
  size:z.number().int().min(20).max(500).optional(),
 }).partial().optional(),
}).partial();

export const cardTemplateSchema=z.object({
 width:z.number().int().min(400).max(2400),
 height:z.number().int().min(250).max(1600),
 duplex:z.boolean().optional(),
 overlay:z.boolean().optional(),
 contentTop:z.number().int().min(0).max(800).optional(),
 backSide:z.union([backSideSchema,z.null()]).optional(),
 background:backgroundBlock.optional(),
 title:textBlock.optional(),
 subtitle:textBlock.optional(),
 name:labelValue.optional(),
 job:labelValue.optional(),
 number:labelValue.optional(),
 rank:labelValue.optional(),
 expiry:labelValue.optional(),
 signature:signatureBlock.optional(),
 footer:textBlock.optional(),
 photo:box.optional(),
 qr:box.extend({show:z.boolean().optional()}).partial().optional(),
 logo:logoBox.optional(),
}).strict();

export function deepMerge(base,patch){
 if(patch===null||typeof patch!=='object'||Array.isArray(patch))return patch??base;
 const out={...base};
 for(const key of Object.keys(patch)){
  if(patch[key]===undefined)continue;
  const b=base?.[key];
  if(b&&typeof b==='object'&&!Array.isArray(b)&&typeof patch[key]==='object'&&!Array.isArray(patch[key]))
   out[key]=deepMerge(b,patch[key]);
  else out[key]=patch[key];
 }
 return out;
}

export function normalizeCardTemplate(raw){
 const patch={...(raw||{})};
 if(patch.backSide===null)delete patch.backSide;
 const merged=deepMerge(defaultCardTemplate,patch);
 const parsed=cardTemplateSchema.parse(merged);
 parsed.duplex=Boolean(parsed.backSide?.enabled);
 if(parsed.overlay==null)parsed.overlay=true;
 return parsed;
}

export async function loadCardTemplate(){
 let row;
 try{row=await one('SELECT template_json,updated_by,updated_at FROM dbo.AppCardTemplate WHERE id=1');}
 catch(e){if(e?.originalError?.number===208||/AppCardTemplate/i.test(e?.originalError?.message||e?.message||''))
  return {template:defaultCardTemplate,source:'default',updated_at:null,updated_by:null};
 throw e;}
 if(!row?.template_json){
  return {template:defaultCardTemplate,source:'default',updated_at:null,updated_by:null};
 }
 let parsed;
 try{parsed=JSON.parse(row.template_json);}catch{parsed={};}
 return {
  template:normalizeCardTemplate(parsed),
  source:'database',
  updated_at:row.updated_at,
  updated_by:row.updated_by,
 };
}

export async function saveCardTemplate(template,username){
 const normalized=normalizeCardTemplate(template);
 const json=JSON.stringify(normalized);
 const exists=await one('SELECT id FROM dbo.AppCardTemplate WHERE id=1');
 if(exists)
  await run('UPDATE dbo.AppCardTemplate SET template_json=@json,updated_by=@by,updated_at=SYSUTCDATETIME() WHERE id=1',{json,by:username});
 else
  await run('INSERT dbo.AppCardTemplate(id,template_json,updated_by) VALUES(1,@json,@by)',{json,by:username});
 return normalized;
}
