import {rows} from './db.js';
import {blockDecision} from './rules.js';
export async function assessBlock(name,idcard,t=null){
 const card=String(idcard||'').trim();
 const person=String(name||'').trim();
 if(!card&&!person)return {deny:null,nameCollisions:[]};
 const hits=await rows(`SELECT Id,IdCard FROM dbo.Blocked WHERE (@card<>'' AND IdCard IS NOT NULL AND LTRIM(RTRIM(IdCard))<>'' AND LTRIM(RTRIM(IdCard))=@card) OR (@name<>'' AND Name=@name)`,{card,name:person},t);
 return blockDecision(card,hits);
}
