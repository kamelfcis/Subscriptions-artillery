import React,{useState,useEffect} from 'react';import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';import{Link,useNavigate,useParams}from'react-router-dom';import * as Tabs from '@radix-ui/react-tabs';import{PlusCircle,Search,Eye,ImagePlus,FileUp,Trash2,UsersRound,ArrowRight,Printer,UserRound,ShieldAlert,FileText,Ban,RotateCcw,CreditCard,Edit3,CheckCircle,Archive,Smile,Pencil,X}from'lucide-react';import {api,params} from '../api';import {Button,Card,Tag,Modal,FormGrid,FormInput,ErrorBox,Pager,Table,Loading,Empty,fmtDate,iso,useDebounced}from'../components/ui';import {useApp}from'../main';import CardPrinter from '../components/CardPrinter';
import FilePreview,{AttachmentThumb} from '../components/FilePreview';
import {can} from '../rbac';
import MembershipId from '../components/MembershipId';
import {formatMembershipId,parseMembershipId} from '../membership-id';
function birthFromNationalId(id){
  const s=String(id||'').replace(/\D/g,'');
  if(s.length<7)return null;
  const century={2:1900,3:2000}[s[0]];
  if(!century)return null;
  const y=century+Number(s.slice(1,3)),m=Number(s.slice(3,5)),d=Number(s.slice(5,7));
  if(m<1||m>12||d<1||d>31)return null;
  const dt=new Date(Date.UTC(y,m-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)return null;
  return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}
const RANK_OPTIONS=['ملازم','ملازم أول','نقيب','رائد','مقدم','عقيد','عميد','لواء','فريق'];
const memberFields=[
  {key:'Name',label:'الاسم',required:true,span:2},
  {key:'IdCard',label:'رقم الهوية'},
  {key:'Phone',label:'رقم موبايل'},
  {key:'age',label:'تاريخ ميلاد',type:'date'},
  {key:'jop',label:'الرتبة'},
  {key:'State',label:'حالة الخدمة'},
  {key:'alive',label:'حالة الحياة'},
  {key:'Address',label:'عنوان',type:'textarea',span:2},
  {key:'note',label:'ملاحظات',type:'textarea',span:2},
];
const DEP_RELATIONS_BASE=[{value:'حرمه',label:'حرمه / زوجة'},{value:'نجله',label:'نجله / ابن'},{value:'كريمته',label:'كريمته / ابنة'},{value:'الوالد',label:'الوالد'},{value:'الوالدة',label:'الوالدة'},{value:'أخرى',label:'أخرى'}];
const DEP_RELATIONS_VIP=[{value:'زوج الابنة',label:'زوج الابنة'},{value:'زوجة الابن',label:'زوجة الابن'}];
function depRelationOptions(isVip,current){
  const opts=[...DEP_RELATIONS_BASE];
  if(isVip) opts.push(...DEP_RELATIONS_VIP);
  else if(current&&DEP_RELATIONS_VIP.some(x=>x.value===current)&&!opts.some(x=>x.value===current)) opts.push(DEP_RELATIONS_VIP.find(x=>x.value===current));
  return opts;
}
function depFieldsFor(isVip=false,currentRelation){
  return [
    {key:'Name',label:'الاسم',required:true,span:2},
    {key:'realation',label:'صلة القرابة',options:depRelationOptions(isVip,currentRelation)},
    {key:'IdCard',label:'الرقم القومي'},
    {key:'age',label:'تاريخ ميلاد',type:'date'},
    {key:'Phone',label:'رقم موبايل'},
    {key:'Address',label:'عنوان',type:'textarea',span:2},
  ];
}
const depFields=depFieldsFor(false);
const memberClean=d=>Object.fromEntries(Object.entries(d).filter(([key])=>memberFields.some(f=>f.key===key)).map(([k,v])=>[k,k==='age'?iso(v):v??'']));
const depClean=d=>Object.fromEntries(Object.entries(d).filter(([key])=>depFields.some(f=>f.key===key)).map(([k,v])=>[k,k==='age'?iso(v):v??'']));
function parseOfficerJob(jop){
  const raw=String(jop||'').trim();
  const ark=/(-?\s*اح|أركان|اركان)/i.test(raw);
  const rank=RANK_OPTIONS.find(r=>raw.startsWith(r))||raw.replace(/\s*-?\s*اح\s*$/i,'').trim();
  return {rank:rank||'',arkan:ark};
}
function composeOfficerJob(rank,arkan){const r=String(rank||'').trim();if(!r)return arkan?'-اح':null;return arkan?(r.endsWith('-اح')||r.endsWith('اح')?r:r+'-اح'):r.replace(/\s*-?\s*اح\s*$/i,'').trim();}
function isMilitaryMember(idClient,cat,membershipClass){
  if(/^(01|02)-/.test(String(idClient||'')))return true;
  if(membershipClass==='01'||membershipClass==='02')return true;
  return /عسكر|ضابط/.test(String(cat||''));
}
function validateOfficerForm(v,{create=false,military=true}={}){
  const errs=[];
  if(!String(v.Name||'').trim()||String(v.Name).trim().length<2)errs.push('الاسم مطلوب (حرفان على الأقل)');
  if(military&&!String(v.IdCard||'').trim())errs.push('تحقيق الشخصية العسكرية مطلوب');
  if(!military&&!String(v.IdCard||'').trim())errs.push('الرقم القومي مطلوب');
  if(military&&!String(v.rank||'').trim())errs.push('اختر الرتبة من الشبكة');
  if(military&&!['خدمة','معاش'].includes(v.State))errs.push('اختر حالة الخدمة (خدمة / معاش)');
  if(military&&!['نعم','متوفى'].includes(v.alive))errs.push('اختر حالة الحياة (قيد الحياة / متوفى)');
  if(create&&!['01','02','03','04'].includes(v.membership_class))errs.push('اختر فئة العضوية');
  if(v.Phone&&String(v.Phone).replace(/\D/g,'').length>0&&String(v.Phone).replace(/\D/g,'').length<8)errs.push('رقم الموبايل غير مكتمل');
  return errs;
}
function SegPair({label,value,onChange,options,toneMap={}}){
  return <div className="legacy-seg-wrap">
    {label&&<span className="legacy-label">{label}</span>}
    <div className="legacy-seg-row">
      {options.map(opt=>{
        const on=value===opt.value;
        const tone=toneMap[opt.value]||opt.tone||'';
        return <button key={opt.value} type="button" className={'legacy-seg-btn'+(on?' is-on':'')+(on&&tone?' is-'+tone:'')} aria-pressed={on} onClick={()=>onChange(opt.value)}>{opt.label}</button>;
      })}
    </div>
  </div>;
}
function RankGrid({value,onChange}){
  return <div>
    <span className="legacy-label">الرتبة *</span>
    <div className="legacy-rank-grid" role="group" aria-label="الرتبة">
      {RANK_OPTIONS.map(r=><button key={r} type="button" className={'legacy-rank-btn'+(value===r?' is-on':'')} aria-pressed={value===r} onClick={()=>onChange(r)}>{r}</button>)}
    </div>
  </div>;
}
function DeskHead({title,onClose}){
  return <div className="legacy-desk-head">
    <span>{title}</span>
    {onClose&&<button type="button" className="rounded-full p-1.5 hover:bg-white/15 text-white" aria-label="إغلاق" onClick={onClose}><X size={18}/></button>}
  </div>;
}
function DeskErrors({errors}){
  if(!errors?.length)return null;
  return <div className="legacy-errors" role="alert"><div>تحقق من الحقول قبل الحفظ:</div><ul>{errors.map(e=><li key={e}>{e}</li>)}</ul></div>;
}
function ChangeForm({initial={},fields,onSave,isBusy,edit=false}){const [values,setValues]=useState(initial);useEffect(()=>setValues(initial),[initial]);const s=fields.filter(x=>!edit||!['id','IdClient'].includes(x.key));function update(updater){setValues(prev=>{const next=typeof updater==='function'?updater(prev):updater;if(next.IdCard!==prev.IdCard&&s.some(f=>f.key==='age')){const born=birthFromNationalId(next.IdCard);if(born)return{...next,age:born};}return next;});}function submit(e){e.preventDefault();const fd=new FormData(e.currentTarget);const payload=Object.fromEntries(s.map(x=>{let v=fd.has(x.key)?fd.get(x.key):(values[x.key]??null);if(v===''||v==null)v=null;else if(x.type==='number')v=Number(v);return[x.key,v];}));if(payload.IdCard&&(!payload.age||payload.age==='')){const born=birthFromNationalId(payload.IdCard);if(born)payload.age=born;}if(payload.age==='')payload.age=null;onSave(payload);}return <form onSubmit={submit} className="space-y-1"><FormGrid schema={s} values={values} onChange={update}/><Button loading={isBusy} type="submit" className="mt-6 w-full" size="lg"><CheckCircle size={17}/> حفظ البيانات</Button></form>}
function AddMemberForm({onSave,isBusy,onClose}){
  const [v,setV]=useState({membership_class:'01',Name:'',IdCard:'',Phone:'',age:'',Address:'',alive:'نعم',State:'خدمة',rank:'',arkan:false,is_vip:false,vip_job:''});
  const [errors,setErrors]=useState([]);
  const military=v.membership_class==='01'||v.membership_class==='02';
  const debouncedClass=useDebounced(v.membership_class,200);
  const nextId=useQuery({
    queryKey:['members-next-id',debouncedClass],
    queryFn:()=>api('/members/next-id'+params({membership_class:debouncedClass})),
    enabled:['01','02','03','04'].includes(debouncedClass),
    staleTime:0,
    refetchOnWindowFocus:false,
  });
  function setField(key,val){setV(prev=>{const next={...prev,[key]:val};if(key==='membership_class'){next.State=val==='02'?'معاش':val==='01'?'خدمة':val==='03'?'أبناء':val==='04'?'مدنى':prev.State;if(val==='01'&&prev.alive==='متوفى'){next.State='معاش';next.membership_class='02';}if(val==='03'||val==='04'){next.rank='';next.arkan=false;}const bornCivilian=(val==='03'||val==='04')?birthFromNationalId(next.IdCard):null;if(bornCivilian)next.age=bornCivilian;}if(key==='State'&&military){if(val==='خدمة'&&next.alive==='متوفى'){next.State='معاش';next.membership_class='02';}else next.membership_class=val==='معاش'?'02':'01';}if(key==='alive'&&val==='متوفى'&&military){next.State='معاش';next.membership_class='02';}if(key==='IdCard'&&(next.membership_class==='03'||next.membership_class==='04')){const born=birthFromNationalId(val);if(born)next.age=born;}return next;});}
  function submit(e){e.preventDefault();const errs=validateOfficerForm(v,{create:true,military});setErrors(errs);if(errs.length)return;const payload={membership_class:v.membership_class,Name:v.Name.trim(),IdCard:v.IdCard.trim()||null,Phone:v.Phone.trim()||null,age:v.age||null,Address:v.Address.trim()||null,is_vip:!!v.is_vip,vip_job:(v.vip_job||'').trim()||null};if(military){payload.State=v.State;payload.alive=v.alive;payload.jop=composeOfficerJob(v.rank,v.arkan);}onSave(payload);}
  return <div className="legacy-desk">
    <DeskHead title="عضوية جديدة — بيانات الاشتراك" onClose={onClose}/>
    <form onSubmit={submit} className="legacy-desk-body" noValidate>
      <div className="legacy-panel space-y-3">
        <div className="legacy-panel-title">تسجيل عضوية</div>
        <DeskErrors errors={errors}/>
        <div>
          <span className="legacy-label">فئة العضوية *</span>
          <div className="legacy-class-grid">
            {[{value:'01',label:'خدمة (01)'},{value:'02',label:'معاش (02)'},{value:'03',label:'أبناء (03)'},{value:'04',label:'مدنيين (04)'}].map(opt=>(
              <button key={opt.value} type="button" className={'legacy-seg-btn'+(v.membership_class===opt.value?' is-on is-navy':'')} aria-pressed={v.membership_class===opt.value} onClick={()=>setField('membership_class',opt.value)}>{opt.label}</button>
            ))}
          </div>
          <div className="legacy-id-preview" aria-live="polite">
            <span className="legacy-label">رقم العضوية</span>
            <div className="legacy-id-value" dir="ltr">{nextId.isFetching&&!nextId.data?'…':(nextId.data?.IdClient?<MembershipId value={nextId.data.IdClient}/>:'—')}</div>
            <p className="legacy-hint">معاينة تقريبية — الرقم النهائي يُثبت عند الحفظ ويُعرض من الشمال لليمين (مثل 01-100). الترقيم ثنائي الاتجاه: خدمة/حي تنتهي بـ 01، ومعاش أو متوفى بـ 02 (والعودة لخدمة مع قيد الحياة تعيد اللاحقة إلى 01). فئة أبناء لاحقتها 03.</p>
          </div>
        </div>
        <div className="legacy-fields">
          <label className="span-2"><span className="legacy-label">الاسم *</span><input className="field" value={v.Name} onChange={e=>setField('Name',e.target.value)} required/></label>
          <label className="span-2"><span className="legacy-label">{military?'تحقيق الشخصية العسكرية *':'الرقم القومي *'}</span><input className="field" value={v.IdCard} onChange={e=>setField('IdCard',e.target.value)} placeholder={military?'رقم تحقيق الشخصية':'14 رقماً — يُحسب الميلاد تلقائياً'} required/></label>
          <label><span className="legacy-label">رقم موبايل</span><input className="field" value={v.Phone} onChange={e=>setField('Phone',e.target.value)} dir="ltr"/></label>
          <label><span className="legacy-label">تاريخ ميلاد</span><input className="field" type="date" value={v.age} onChange={e=>setField('age',e.target.value)}/></label>
          <label className="span-2"><span className="legacy-label">عنوان</span><textarea className="field min-h-20" value={v.Address} onChange={e=>setField('Address',e.target.value)}/></label>
        </div>
        {military&&<>
          <div className="grid md:grid-cols-2 gap-3">
            <SegPair label="قيد الحياة" value={v.alive} onChange={x=>setField('alive',x)} options={[{value:'نعم',label:'نعم — حي'},{value:'متوفى',label:'متوفى'}]} toneMap={{نعم:'green',متوفى:'rose'}}/>
            <SegPair label="حالة الخدمة" value={v.State} onChange={x=>setField('State',x)} options={[{value:'خدمة',label:'خدمة'},{value:'معاش',label:'معاش'}]} toneMap={{خدمة:'navy',معاش:'orange'}}/>
          </div>
          <RankGrid value={v.rank} onChange={x=>setField('rank',x)}/>
          <div className="grid md:grid-cols-2 gap-3">
            <SegPair label="أركان حرب" value={v.arkan?'1':'0'} onChange={x=>setField('arkan',x==='1')} options={[{value:'1',label:'نعم'},{value:'0',label:'لا'}]} toneMap={{'1':'navy','0':'orange'}}/>
            <div className="legacy-hint self-end">أركان حرب تُحفظ ضمن حقل الرتبة (`عقيد-اح`).</div>
          </div>
        </>}
        <div className="grid md:grid-cols-2 gap-3">
          <SegPair label="VIP" value={v.is_vip?'1':'0'} onChange={x=>setField('is_vip',x==='1')} options={[{value:'1',label:'نعم'},{value:'0',label:'لا'}]} toneMap={{'1':'navy','0':'orange'}}/>
          <p className="legacy-hint self-end">VIP: تجديد الأسرة بدون رسوم، كارنيه بدون تاريخ انتهاء، وصلات زوج الابنة / زوجة الابن.</p>
        </div>
        {v.is_vip&&<label className="block"><span className="legacy-label">الوظيفة</span><input className="field" value={v.vip_job||''} onChange={e=>setField('vip_job',e.target.value)} maxLength={50} placeholder="الوظيفة المدنية / الرسمية"/></label>}
        <div className="legacy-save-bar">
          <button type="submit" className="legacy-save" disabled={isBusy}>{isBusy?'جاري الحفظ…':<>حفظ الاشتراك</>}</button>
        </div>
      </div>
    </form>
  </div>;
}
function OfficerEditForm({initial={},onSave,isBusy,idClient,member,dependents=[],subscriptions=[],onClose,onEditDep,onEligDep,onDeleteDep,onPrintDep,onRenew,onFiles}){
  const parsed=parseOfficerJob(initial.jop);
  const military=isMilitaryMember(idClient,member?.Cat||initial.Cat);
  const [v,setV]=useState({Name:initial.Name||'',IdCard:initial.IdCard||'',Phone:initial.Phone||'',age:iso(initial.age)||'',Address:initial.Address||'',alive:/متوف/.test(initial.alive||'')?'متوفى':'نعم',State:/معاش|متقاعد/.test(initial.State||'')?'معاش':'خدمة',rank:parsed.rank,arkan:parsed.arkan,note:initial.note||'',is_vip:!!member?.is_vip,vip_job:member?.vip_job||''});
  const [errors,setErrors]=useState([]);
  useEffect(()=>{const p=parseOfficerJob(initial.jop);setV({Name:initial.Name||'',IdCard:initial.IdCard||'',Phone:initial.Phone||'',age:iso(initial.age)||'',Address:initial.Address||'',alive:/متوف/.test(initial.alive||'')?'متوفى':'نعم',State:/معاش|متقاعد/.test(initial.State||'')?'معاش':'خدمة',rank:p.rank,arkan:p.arkan,note:initial.note||'',is_vip:!!member?.is_vip,vip_job:member?.vip_job||''});setErrors([]);},[initial,member]);
  const kidsMember=(dependents||[]).some(x=>/ابن|ابنة|نجله|كريمته|ولد/.test(x.realation||'')&&!x.archived);
  const lastSub=(subscriptions||[])[0];
  const lastDate=lastSub?.created||lastSub?.from||null;
  const expiry=lastSub?.ends||null;
  function setField(key,val){setV(prev=>{const next={...prev,[key]:val};if(key==='alive'&&val==='متوفى')next.State='معاش';if(key==='State'&&val==='خدمة'&&(next.alive==='متوفى'||/متوف/.test(prev.alive||'')))next.State='معاش';if(key==='IdCard'&&!military){const born=birthFromNationalId(val);if(born)next.age=born;}return next;});}
  function submit(e){e.preventDefault();const errs=validateOfficerForm({...v,membership_class:military?'01':'04'},{military});setErrors(errs);if(errs.length)return;onSave({Name:v.Name.trim(),IdCard:v.IdCard.trim()||null,Phone:v.Phone.trim()||null,age:v.age||null,Address:v.Address.trim()||null,alive:v.alive||null,State:military?v.State:v.State||null,jop:military?composeOfficerJob(v.rank,v.arkan):(initial.jop||null),note:v.note.trim()||null,is_vip:!!v.is_vip,vip_job:(v.vip_job||'').trim()||null});}
  const photoUrl=member?.hasPhoto?('/api/members/'+encodeURIComponent(idClient)+'/photo'):null;
  return <div className="legacy-desk">
    <DeskHead title="بيانات الاشتراك — تعديل بيانات" onClose={onClose}/>
    <form onSubmit={submit} className="legacy-desk-body" noValidate>
      <div className={'legacy-desk-grid'+(military?' is-edit':'')}>
        {/* RTL grid: first col = right summary, center form, left dependents */}
        <aside className="legacy-panel legacy-summary">
          <div className="legacy-summary-photo">{photoUrl?<img src={photoUrl} alt=""/>:<UserRound size={48}/>}</div>
          <div className="legacy-kv"><span>رقم العضوية</span><b><MembershipId value={idClient}/></b></div>
          <div className="legacy-kv"><span>الرتبة</span><b>{composeOfficerJob(v.rank,v.arkan)||member?.jop||'—'}</b></div>
          <div className="legacy-kv"><span>الاسم</span><b>{v.Name||'—'}</b></div>
          <div className="legacy-kv"><span>الميلاد</span><b>{fmtDate(v.age)}</b></div>
          <div className="legacy-kv"><span>آخر اشتراك</span><b>{fmtDate(lastDate)}</b></div>
          <div className="legacy-kv"><span>الانتهاء</span><b>{fmtDate(expiry)}</b></div>
          <div className="legacy-kv"><span>الحالة</span><b>{v.State} · {v.alive==='متوفى'?'متوفى':'حي'}</b></div>
        </aside>
        <div className="legacy-panel space-y-3">
          <div className="legacy-panel-title">تعديل بيانات</div>
          <DeskErrors errors={errors}/>
          <div className="flex flex-wrap gap-4 items-start">
            <div className="legacy-form-photo shrink-0">{photoUrl?<img src={photoUrl} alt=""/>:<UserRound size={42}/>}</div>
            <div className="legacy-fields flex-1 min-w-[220px]">
              <label className="span-2"><span className="legacy-label">الاسم *</span><input className="field" value={v.Name} onChange={e=>setField('Name',e.target.value)}/></label>
              <label className="span-2"><span className="legacy-label">{military?'تحقيق الشخصية العسكرية *':'الرقم القومي *'}</span><input className="field" value={v.IdCard} onChange={e=>setField('IdCard',e.target.value)}/></label>
              <label><span className="legacy-label">رقم موبايل</span><input className="field" value={v.Phone} onChange={e=>setField('Phone',e.target.value)} dir="ltr"/></label>
              <label><span className="legacy-label">تاريخ ميلاد</span><input className="field" type="date" value={v.age} onChange={e=>setField('age',e.target.value)}/></label>
            </div>
          </div>
          {military&&<>
            <div className="grid md:grid-cols-2 gap-3">
              <SegPair label="قيد الحياة" value={v.alive} onChange={x=>setField('alive',x)} options={[{value:'نعم',label:'نعم — حي'},{value:'متوفى',label:'متوفى'}]} toneMap={{نعم:'green',متوفى:'rose'}}/>
              <SegPair label="حالة الخدمة" value={v.State} onChange={x=>setField('State',x)} options={[{value:'خدمة',label:'خدمة'},{value:'معاش',label:'معاش'}]} toneMap={{خدمة:'navy',معاش:'orange'}}/>
            </div>
            <RankGrid value={v.rank} onChange={x=>setField('rank',x)}/>
            <div className="grid md:grid-cols-2 gap-3">
              <SegPair label="أركان حرب" value={v.arkan?'1':'0'} onChange={x=>setField('arkan',x==='1')} options={[{value:'1',label:'نعم'},{value:'0',label:'لا'}]} toneMap={{'1':'navy','0':'orange'}}/>
              <div className="legacy-seg-wrap" aria-readonly="true">
                <span className="legacy-label">عضوية أبناء؟</span>
                <div className="legacy-seg-row pointer-events-none">
                  <button type="button" tabIndex={-1} className={'legacy-seg-btn'+(kidsMember?' is-on is-navy':'')}>نعم</button>
                  <button type="button" tabIndex={-1} className={'legacy-seg-btn'+(!kidsMember?' is-on is-orange':'')}>لا</button>
                </div>
              </div>
            </div>
            <p className="legacy-hint">عضوية الأبناء تُدار عبر التابعين. تجديد الابن أو الحفيد بنفس فئة العضو الأساسي وبمبلغ 50 ج.م، وكود 03 للعضو الأساسي من فئة أبناء فقط. رقم العضوية: <b><MembershipId value={idClient}/></b> — معاش/وفاة لاحقتها 02، والعودة لخدمة مع قيد الحياة تعيد اللاحقة إلى 01 (المتوفى يبقى معاش).</p>
          </>}
          <div className="grid md:grid-cols-2 gap-3">
            <SegPair label="VIP" value={v.is_vip?'1':'0'} onChange={x=>setField('is_vip',x==='1')} options={[{value:'1',label:'نعم'},{value:'0',label:'لا'}]} toneMap={{'1':'navy','0':'orange'}}/>
            <p className="legacy-hint self-end">VIP: تجديد الأسرة بدون رسوم، كارنيه بدون تاريخ انتهاء، وصلات زوج الابنة / زوجة الابن.</p>
          </div>
          {v.is_vip&&<label className="block"><span className="legacy-label">الوظيفة</span><input className="field" value={v.vip_job||''} onChange={e=>setField('vip_job',e.target.value)} maxLength={50} placeholder="الوظيفة المدنية / الرسمية"/></label>}
          <label className="block"><span className="legacy-label">عنوان</span><textarea className="field min-h-16" value={v.Address} onChange={e=>setField('Address',e.target.value)}/></label>
          <label className="block"><span className="legacy-label">ملاحظات</span><textarea className="field min-h-16" value={v.note} onChange={e=>setField('note',e.target.value)}/></label>
          <div className="legacy-save-bar">
            <button type="submit" className="legacy-save" disabled={isBusy}>{isBusy?'جاري الحفظ…':'حفظ الاشتراك'}</button>
            <div className="legacy-toolbar">
              {onRenew&&<button type="button" className="legacy-tool" onClick={onRenew}><RotateCcw size={15}/> تجديد الاشتراك</button>}
              <button type="button" className="legacy-tool" disabled><Pencil size={15}/> تعديل بيانات</button>
              {onFiles&&<button type="button" className="legacy-tool" onClick={onFiles}><FileUp size={15}/> إضافة مرفقات</button>}
            </div>
          </div>
        </div>
        {military&&<aside className="legacy-panel">
          <div className="legacy-panel-title">التابعون</div>
          <div className="legacy-deps">
            {(dependents||[]).filter(x=>!x.archived).map(x=>(
              <div key={x.id} className="legacy-dep-card">
                <div className="legacy-dep-photo">{x.hasPhoto?<img src={'/api/dependents/'+x.id+'/photo'} alt=""/>:<UserRound size={22}/>}</div>
                <div className="legacy-dep-meta"><div className="name">{x.Name}</div><div className="rel">{x.realation||'—'}</div></div>
                <div className="legacy-dep-actions">
                  {onEligDep&&<button type="button" className="legacy-icon-btn is-warn" title="الأهلية" onClick={()=>onEligDep(x)}><Smile size={14}/></button>}
                  {onEditDep&&<button type="button" className="legacy-icon-btn" title="تعديل" onClick={()=>onEditDep(x)}><Pencil size={14}/></button>}
                  {onDeleteDep&&<button type="button" className="legacy-icon-btn is-danger" title="حذف نهائي" onClick={()=>onDeleteDep(x)}><Trash2 size={14}/></button>}
                  {onPrintDep&&(x.can_print?<button type="button" className="legacy-icon-btn" title="طباعة" onClick={()=>onPrintDep(x)}><Printer size={14}/></button>:<button type="button" className="legacy-icon-btn" disabled title="يتطلب تجديد التابع أولاً"><Printer size={14}/></button>)}
                </div>
              </div>
            ))}
            {!dependents?.filter(x=>!x.archived).length&&<div className="legacy-hint">لا يوجد تابعون بعد — أضفهم من تبويب التابعين.</div>}
          </div>
        </aside>}
      </div>
    </form>
  </div>;
}
export default function Members(){
  const {notify,user}=useApp(),qc=useQueryClient(),nav=useNavigate();
  const [search,setSearch]=useState(''),debounced=useDebounced(search,320);
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(25),[open,setOpen]=useState(false);
  const [archived,setArchived]=useState(false);
  const [blockedFilter,setBlockedFilter]=useState('');
  const [cat,setCat]=useState(''),[jop,setJop]=useState(''),[state,setState]=useState(''),[expiryDays,setExpiry]=useState('');
  const q=useQuery({
    queryKey:['members',debounced,page,archived,pageSize,cat,jop,state,expiryDays,blockedFilter],
    queryFn:()=>api('/members'+params({search:debounced,page,pageSize,archived,cat,jop,state,expiryDays,securityBlocked:blockedFilter||undefined}))
  });
  const m=useMutation({mutationFn:b=>api('/members',{method:'POST',body:b}),onSuccess:x=>{qc.invalidateQueries({queryKey:['members']});setOpen(false);notify('تم تسجيل العضوية');nav('/members/'+encodeURIComponent(x.IdClient));}});
  const canApprove=can(user.role,'approve');
  const [purge,setPurge]=useState(null);
  function chip(active,onClick,label,tone=''){
    return <button type="button" className={'filter-chip '+tone+(active?' is-active':'')} onClick={onClick} aria-pressed={active}>{label}</button>;
  }
  return <>
    <div className="section-head">
      <div>
        <div className="eyebrow">سجلات الأعضاء</div>
        <h1>إدارة العضويات</h1>
        <p>بحث بالاسم أو رقم العضوية أو الرقم القومي أو بطاقة RFID.</p>
      </div>
      {can(user.role,'write')&&<Button onClick={()=>setOpen(true)}><PlusCircle size={17}/> إضافة عضو</Button>}
    </div>

    <Card className="overflow-hidden !p-0">
      <div className="px-5 pt-5 pb-4 border-b border-[#e8eef8] bg-gradient-to-l from-[#f7faff] to-white">
        <div className="relative">
          <Search size={18} className="absolute right-4 top-3.5 text-[#7f93b3]"/>
          <input className="field !pr-11 !bg-white !border-[#d5e0f2] !min-h-12" placeholder="الاسم، رقم العضوية، الهاتف، الرقم القومي، RFID..." value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/>
        </div>
      </div>

      <div className="p-5 filter-shell !rounded-none !border-0 !border-b !border-[#e8eef8]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-black text-[#5b6f8c] mb-2">حالة السجل</div>
            <div className="status-seg">
              {chip(!archived,()=>{setArchived(false);setPage(1)},'المسجلون','is-mint')}
              {chip(archived,()=>{setArchived(true);setPage(1)},'المؤرشفون','is-slate')}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-black text-[#5b6f8c] mb-2">الحظر الأمني</div>
            <div className="status-seg">
              {chip(blockedFilter==='',()=>{setBlockedFilter('');setPage(1)},'الكل')}
              {chip(blockedFilter==='true',()=>{setBlockedFilter('true');setPage(1)},'محظورون أمنيًا','is-rose')}
              {chip(blockedFilter==='false',()=>{setBlockedFilter('false');setPage(1)},'غير محظورين','is-mint')}
            </div>
          </div>
          <div className="text-xs font-extrabold text-[#5d7394] bg-white border border-[#e1e8f4] rounded-xl px-3 py-2">{q.data?.total||0} سجل</div>
        </div>

        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 pt-1">
          <label className="block min-w-0">
            <span className="form-label">التصنيف</span>
            <select className="field" value={cat} onChange={e=>{setCat(e.target.value);setPage(1)}} aria-label="التصنيف">
              <option value="">كل التصنيفات</option>
              <option value="عسكرى">عسكرى</option>
              <option value="مدنى">مدنى</option>
              <option value="دار">دار</option>
            </select>
          </label>
          <label className="block min-w-0">
            <span className="form-label">الرتبة / الوظيفة</span>
            <input className="field" placeholder="مثال: رائد، عقيد..." value={jop} onChange={e=>{setJop(e.target.value);setPage(1)}}/>
          </label>
          <label className="block min-w-0">
            <span className="form-label">الحالة</span>
            <input className="field" placeholder="حالة العضو" value={state} onChange={e=>{setState(e.target.value);setPage(1)}}/>
          </label>
          <label className="block min-w-0">
            <span className="form-label">نافذة الانتهاء</span>
            <select aria-label="نافذة الانتهاء" className="field" value={expiryDays} onChange={e=>{setExpiry(e.target.value);setPage(1)}}>
              <option value="">كل تواريخ الانتهاء</option>
              <option value="30">ينتهي خلال 30 يوم</option>
              <option value="90">ينتهي خلال 90 يوم</option>
              <option value="365">ينتهي خلال سنة</option>
            </select>
          </label>
        </div>
      </div>

      <div className="p-5">
        <ErrorBox error={q.error}/>
        {q.isLoading?<Loading rows={7}/>:<>
          <Table heads={['رقم العضوية','الاسم','الرتبة / الوظيفة','التصنيف','الهاتف','تاريخ الميلاد','الإجراء']} rows={q.data?.items||[]} onClick={x=>nav('/members/'+encodeURIComponent(x.IdClient))} render={x=><>
            <td className={'font-black text-blue '+(x.security_blocked?'member-row-blocked':'')}><MembershipId value={x.IdClient}/></td>
            <td className={x.security_blocked?'member-row-blocked':''}>
              <div className="flex gap-2.5 items-center">
                <div className={'w-10 h-10 rounded-full overflow-hidden ring-2 ring-white shadow-sm grid place-content-center shrink-0 '+(x.security_blocked?'bg-[#ffecec] text-[#c8474b] ring-[#ffd4d4]':'bg-[#eaf1fd] text-blue ring-[#dce8ff]')}>
                  {x.hasPhoto
                    ? <img src={'/api/members/'+encodeURIComponent(x.IdClient)+'/photo'} alt="" className="w-full h-full object-cover" loading="lazy"/>
                    : <UserRound size={18}/>}
                </div>
                <div className="min-w-0">
                  <span className="font-bold">{x.Name}</span>
                  {!!x.security_blocked&&<div className="mt-1"><Tag tone="red">محظور أمنيًا</Tag></div>}
                </div>
              </div>
            </td>
            <td className={x.security_blocked?'member-row-blocked':''}>{x.jop||'—'}</td>
            <td className={x.security_blocked?'member-row-blocked':''}><Tag>{x.Cat||'غير محدد'}</Tag></td>
            <td className={x.security_blocked?'member-row-blocked':''} dir="ltr">{x.Phone||'—'}</td>
            <td className={x.security_blocked?'member-row-blocked':''}>{fmtDate(x.age)}</td>
            <td className={x.security_blocked?'member-row-blocked':''} onClick={e=>e.stopPropagation()}>
              <div className="flex items-center gap-1.5">
                <button type="button" className="p-2 rounded-lg hover:bg-[#eaf1fe] text-blue" title="عرض" onClick={()=>nav('/members/'+encodeURIComponent(x.IdClient))}><Eye size={16}/></button>
                {canApprove&&<button type="button" className="p-2 rounded-lg hover:bg-[#ffecec] text-[#c8474b]" title="حذف نهائي" onClick={()=>setPurge(x)}><Trash2 size={16}/></button>}
              </div>
            </td>
          </>}/>
          <Pager data={q.data} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}/>
        </>}
      </div>
    </Card>

    <Modal open={open} onClose={()=>setOpen(false)} title="عضوية جديدة" desk>
      {m.error&&<div className="px-3 pt-3"><ErrorBox error={m.error}/></div>}
      <AddMemberForm onSave={b=>m.mutate(b)} isBusy={m.isPending} onClose={()=>setOpen(false)}/>
    </Modal>
    <HardDeleteModal member={purge} close={()=>setPurge(null)} onDone={()=>{setPurge(null);qc.invalidateQueries({queryKey:['members']});notify('تم الحذف النهائي للعضوية');}}/>
  </>;
}

function Tab({id,children}){return <Tabs.Trigger value={id} className="whitespace-nowrap px-4 py-3 rounded-xl data-[state=active]:text-blue data-[state=active]:bg-[#edf3ff] text-[#8490a4] text-xs font-extrabold">{children}</Tabs.Trigger>}
function PhotoUploader({url,onUpload,deleteUrl,hasPhoto,refresh}){const [file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null);async function upload(){if(!file)return;setBusy(true);setError(null);try{const fd=new FormData();fd.append('file',file);await api(url,{method:'PUT',form:fd});setFile(null);refresh();}catch(e){setError(e)}finally{setBusy(false)}}return <div className="flex flex-wrap gap-3 items-center"><input className="max-w-[230px]" type="file" accept="image/*" onChange={e=>setFile(e.target.files?.[0]||null)}/><Button variant="outline" size="sm" onClick={upload} disabled={!file} loading={busy}><ImagePlus size={14}/> رفع صورة</Button>{hasPhoto&&<Button variant="danger" size="sm" onClick={async()=>{if(!confirm('مسح الصورة من قاعدة البيانات؟'))return;await api(deleteUrl,{method:'DELETE'});refresh()}}><Trash2 size={14}/> حذف الصورة</Button>}<ErrorBox error={error}/></div>}
export function MemberDetail(){const {id}=useParams(),{notify,user}=useApp(),qc=useQueryClient(),nav=useNavigate();const [edit,setEdit]=useState(false),[depModal,setDepModal]=useState(null),[eligModal,setEligModal]=useState(null),[fileEdit,setFileEdit]=useState(null),[fileView,setFileView]=useState(null),[exModal,setExModal]=useState(false),[print,setPrint]=useState(null),[secModal,setSecModal]=useState(null),[hardDel,setHardDel]=useState(false),[error,setError]=useState(null),[tab,setTab]=useState('info');const key=encodeURIComponent(id);const info=useQuery({queryKey:['member',id],queryFn:()=>api('/members/'+key)});const deps=useQuery({queryKey:['deps',id],queryFn:()=>api('/members/'+key+'/dependents')});const files=useQuery({queryKey:['files',id],queryFn:()=>api('/members/'+key+'/files')});const legacy=useQuery({queryKey:['legacy-sub',id],queryFn:()=>api('/members/'+key+'/subscriptions')});const exem=useQuery({queryKey:['exemptions',id],queryFn:()=>api('/members/'+key+'/exemptions')});const pays=useQuery({queryKey:['member-pay',id],queryFn:()=>api('/reports/payments'+params({client:id,page:1,pageSize:25,from:'2000-01-01',to:new Date().toISOString().slice(0,10)}))});const audits=useQuery({queryKey:['member-audit',id],queryFn:()=>api('/reports/audit'+params({page:1,pageSize:25,entity_id:id}))});const save=useMutation({mutationFn:b=>api('/members/'+key,{method:'PATCH',body:b}),onSuccess:(x)=>{qc.invalidateQueries({queryKey:['member',id]});setEdit(false);notify(x?.IdClient&&x.IdClient!==id?'تم الحفظ وتحويل الرقم إلى '+formatMembershipId(x.IdClient):'تم حفظ البيانات');if(x?.IdClient&&x.IdClient!==id){nav('/members/'+encodeURIComponent(x.IdClient),{replace:true});}else{qc.invalidateQueries({queryKey:['member',id]});}}});const saveDep=useMutation({mutationFn:({body,dep})=>dep?api('/dependents/'+dep,{method:'PATCH',body}):api('/members/'+key+'/dependents',{method:'POST',body}),onSuccess:()=>{qc.invalidateQueries({queryKey:['deps',id]});setDepModal(null);notify('تم حفظ بيانات التابع');}});
 const refresh=()=>{qc.invalidateQueries({queryKey:['member',id]});qc.invalidateQueries({queryKey:['deps',id]})};const data=info.data;const canWrite=can(user.role,'write'),canReports=can(user.role,'reports'),canApprove=can(user.role,'approve'),canBlock=can(user.role,'block');if(info.isLoading)return <Loading/>;if(info.error)return <ErrorBox error={info.error}/>;
 async function toggleArchive(path,archived){if(!confirm(archived?'تأكيد الأرشفة؟ السجل سيبقى محفوظاً.':'استعادة هذا السجل؟'))return;try{await api(path,{method:archived?'DELETE':'POST'});refresh();notify('تم تحديث حالة الأرشفة')}catch(e){setError(e)}}
 const spouse=(deps.data||[]).find(x=>/حرمه|زوج|أرمل|ارمل/.test(x.realation||'')&&!x.archived);
 return <><div className="mb-5"><Link to="/members" className="flex items-center gap-2 font-bold text-blue text-xs"><ArrowRight size={15}/> العودة للعضويات</Link></div><div className="section-head"><div><h1>{data.Name}</h1><p>ملف العضو • <MembershipId value={data.IdClient} className="font-bold"/> • {data.jop||'الرتبة غير محددة'}{spouse?<> • المستفيد: <b>{spouse.Name}</b> ({spouse.realation})</>:null}</p></div><div className="flex gap-2 flex-wrap">{can(user.role,'finance')&&<Link to={'/renewals?client='+encodeURIComponent(id)}><Button><CreditCard size={15}/> تجديد</Button></Link>}{canWrite&&<Button variant="outline" onClick={()=>setEdit(true)}><Edit3 size={15}/> تعديل</Button>}{canWrite&&<Button variant="soft" onClick={()=>setTab('files')}><FileUp size={15}/> مرفقات</Button>}{can(user.role,'print')&&<Button variant="soft" onClick={()=>setPrint({dependent_id:null,name:data.Name,id:data.IdClient})}><Printer size={15}/> طباعة الكارنيه</Button>}{canBlock&&<Button variant={data.security_blocked?'success':'danger'} onClick={()=>setSecModal(data.security_blocked?'unblock':'block')}><ShieldAlert size={15}/> {data.security_blocked?'رفع الحظر الأمني':'حظر أمني'}</Button>}{canWrite&&<Button variant={data.archived?'success':'danger'} onClick={()=>toggleArchive(data.archived?'/members/'+key+'/restore':'/members/'+key,!data.archived)}>{data.archived?<RotateCcw size={15}/>:<Archive size={15}/>} {data.archived?'استعادة':'أرشفة'}</Button>}{canApprove&&<Button variant="danger" onClick={()=>setHardDel(true)}><Trash2 size={15}/> حذف نهائي</Button>}</div></div><ErrorBox error={error}/><div className="grid lg:grid-cols-[280px_1fr] gap-5"><Card className="flex flex-col gap-5"><div className="w-36 h-36 rounded-3xl bg-[#eaf1fb] mx-auto overflow-hidden grid place-content-center text-blue">{data.hasPhoto?<img className="w-full h-full object-cover" src={'/api/members/'+key+'/photo'} alt="صورة العضو"/>:<UserRound size={70}/>}</div><div className="text-center"><h2 className="font-black text-[17px]">{data.Name}</h2><div className="flex gap-2 justify-center flex-wrap"><Tag tone={data.archived?'red':'green'}>{data.archived?'مؤرشف':'مسجل'}</Tag>{!!data.security_blocked&&<Tag tone="red">محظور أمنيًا</Tag>}{!!data.is_vip&&<Tag tone="blue">VIP</Tag>}</div></div><div className="text-[11px] border-t pt-4 space-y-3"><div className="flex justify-between"><span className="muted">رقم العضوية</span><b><MembershipId value={data.IdClient}/></b></div><div className="flex justify-between"><span className="muted">الرتبة</span><b>{data.jop||'—'}</b></div><div className="flex justify-between"><span className="muted">تاريخ الميلاد</span><b>{fmtDate(data.age)}</b></div><div className="flex justify-between"><span className="muted">التصنيف</span><b>{data.Cat||'—'}</b></div><div className="flex justify-between"><span className="muted">الحالة</span><b>{data.alive||'—'}</b></div>{!!data.security_blocked&&<div className="text-red-700 bg-red-50 rounded-xl p-2"><div className="font-black">محظور أمنيًا</div><div className="mt-1">{data.security_block_reason||'—'}</div></div>}</div>{canWrite&&<PhotoUploader url={'/members/'+key+'/photo'} deleteUrl={'/members/'+key+'/photo'} hasPhoto={data.hasPhoto} refresh={refresh}/>}{can(user.role,'finance')&&<Link to={'/renewals?client='+encodeURIComponent(id)}><Button className="w-full"><CreditCard size={16}/> تجديد العضوية</Button></Link>}</Card><Card className="min-w-0"><Tabs.Root value={tab} onValueChange={setTab} dir="rtl"><Tabs.List className="flex gap-2 overflow-x-auto scrollbar-hide border-b pb-3 mb-5"><Tab id="info">البيانات</Tab><Tab id="dependents">التابعون ({deps.data?.length||0})</Tab><Tab id="files">المرفقات</Tab><Tab id="history">سجل الاشتراكات</Tab>{canReports&&<Tab id="payments">الدفعات</Tab>}{canReports&&<Tab id="audit">سجل المراجعة</Tab>}<Tab id="exemptions">الإعفاءات</Tab></Tabs.List><Tabs.Content value="info"><div className="input-grid">{memberFields.filter(x=>!['IdClient','id'].includes(x.key)).map(f=><div key={f.key} className="p-3 bg-[#f8fafd] rounded-xl"><div className="text-[11px] muted mb-1">{f.label}</div><div className="font-bold text-xs break-words">{f.type==='date'?fmtDate(data[f.key]):data[f.key]||'—'}</div></div>)}</div></Tabs.Content><Tabs.Content value="dependents"><div className="flex justify-between items-center mb-4"><h3 className="font-black text-sm">التابعون وأفراد الأسرة</h3>{canWrite&&<Button size="sm" onClick={()=>setDepModal({})}><PlusCircle size={15}/> إضافة تابع</Button>}</div>{deps.isLoading?<Loading/>:<div className="space-y-3">{deps.data?.map(x=><div key={x.id} className="border border-[#e9edf5] p-3 rounded-2xl flex flex-wrap items-center gap-3"><div className="w-14 h-14 overflow-hidden bg-[#eaf1fb] rounded-2xl grid place-content-center">{x.hasPhoto?<img className="w-full h-full object-cover" src={'/api/dependents/'+x.id+'/photo'}/>:<UserRound size={26} className="text-blue"/>}</div><div className="flex-1 min-w-[150px]"><div className="font-extrabold text-xs">{x.Name}</div><div className="text-[11px] muted mt-1">{x.realation||'علاقة غير محددة'} • {x.display_date?fmtDate(x.display_date):'—'}</div><div className="mt-1">{x.archived?<Tag tone="red">مؤرشف</Tag>:x.verified_at?<Tag tone="green">أهلية معتمدة</Tag>:<Tag tone="orange">أهلية غير معتمدة</Tag>}</div></div><div className="flex flex-wrap gap-1">{canWrite&&<Button variant="outline" size="sm" onClick={()=>setDepModal(x)}>تعديل</Button>}{canWrite&&<Button variant="soft" size="sm" onClick={()=>setEligModal(x)}>الأهلية</Button>}{can(user.role,'print')&&(x.can_print?<Button variant="outline" size="sm" onClick={()=>setPrint({dependent_id:x.id,name:x.Name,id:x.id})} title="طباعة كارنيه التابع"><Printer size={15}/></Button>:<span title="يتطلب تجديد التابع أولاً" className="inline-flex"><Button variant="outline" size="sm" disabled aria-label="يتطلب تجديد التابع أولاً"><Printer size={15}/></Button></span>)}{canWrite&&<Button variant="danger" size="sm" onClick={async()=>{if(!confirm('حذف نهائي للتابع «'+x.Name+'»؟ سيُحذف التابع وتجديداته وأهليته نهائياً ولا يمكن التراجع.'))return;try{await api('/dependents/'+x.id,{method:'DELETE'});refresh();notify('تم الحذف النهائي للتابع')}catch(e){setError(e)}}}>حذف نهائي</Button>}</div></div>)}{!deps.data?.length&&<Empty message="لم يتم إضافة تابعين بعد"/>}</div>}</Tabs.Content><Tabs.Content value="files"><div className="flex justify-between items-center mb-4"><h3 className="font-black text-sm">المستندات والمرفقات</h3>{canWrite&&<Button size="sm" onClick={()=>setFileEdit({})}><FileUp size={15}/> رفع من الماسح / ملف</Button>}</div><div className="space-y-2">{files.data?.map(f=><div key={f.id} className="flex items-center gap-3 flex-wrap border rounded-xl p-3"><AttachmentThumb file={f} onClick={()=>setFileView(f)}/><div className="flex-1 text-xs"><b>{f.discip||'مرفق'}</b><div className="muted mt-1">{f.document_type||'OTHER'} • {fmtDate(f.createon)} {f.archived&&' • مؤرشف'}</div></div><button type="button" className="small-action" onClick={()=>setFileView(f)}>عرض</button>{canWrite&&<label className="text-[11px] font-extrabold text-blue cursor-pointer">استبدال الملف<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/bmp,application/pdf" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{const fd=new FormData();fd.append('file',file);await api('/files/'+f.id+'/content',{method:'PUT',form:fd});qc.invalidateQueries({queryKey:['files',id]});notify('تم استبدال الملف')}catch(err){setError(err)}}}/></label>}{canWrite&&<Button size="sm" variant="outline" onClick={()=>setFileEdit(f)}>تعديل</Button>}{canWrite&&<Button size="sm" variant="danger" onClick={async()=>{if(!confirm('حذف نهائي لهذا المرفق؟ لا يمكن التراجع عن هذا الإجراء.'))return;try{await api('/files/'+f.id,{method:'DELETE'});qc.invalidateQueries({queryKey:['files',id]});notify('تم الحذف النهائي للمرفق')}catch(e){setError(e)}}}>حذف نهائي</Button>}</div>)}{!files.data?.length&&<Empty message="لا يوجد أي ملفات"/>}</div></Tabs.Content><Tabs.Content value="history">{legacy.isLoading?<Loading/>:<Table heads={['رقم','النوع','من','إلى','الفئة','الحالة','الموظف']} rows={legacy.data||[]} render={x=><><td>#{x.id}</td><td><Tag tone={x.source==='MODERN'?'green':'blue'}>{x.source==='MODERN'?'تجديد':'اشتراك'}</Tag></td><td>{fmtDate(x.created)}</td><td><Tag tone="orange">{fmtDate(x.ends)}</Tag></td><td>{x.service||'—'}</td><td>{x.status}</td><td>{x.actor||'—'}</td></>}/>}</Tabs.Content><Tabs.Content value="payments"><ErrorBox error={pays.error}/>{pays.isLoading?<Loading/>:<Table heads={['الدفعة','التجديد','المبلغ','الطريقة','المحصل','التاريخ']} rows={pays.data?.items||[]} render={x=><><td>#{x.id}</td><td>#{x.renewal_id}</td><td>{x.amount}</td><td>{x.method}</td><td>{x.collected_by}</td><td>{fmtDate(x.created_at)}</td></>}/>}</Tabs.Content><Tabs.Content value="audit"><ErrorBox error={audits.error}/>{audits.isLoading?<Loading/>:<Table heads={['الوقت','الموظف','الإجراء','الكيان']} rows={audits.data?.items||[]} render={x=><><td>{fmtDate(x.created_at)}</td><td>{x.actor}</td><td>{x.action}</td><td>{x.entity}</td></>}/>}</Tabs.Content><Tabs.Content value="exemptions"><div className="flex justify-between gap-3 items-center mb-4"><div className="text-xs muted">التصدقات والحالات الخاصة تُعتمد هنا. علم VIP التشغيلي يُضبط من بيانات العضو ويسري على الأسرة كلها.</div>{canApprove&&<Button size="sm" onClick={()=>setExModal(true)}>إضافة إعفاء</Button>}</div><div className="space-y-2">{exem.data?.map(x=><div key={x.id} className="border rounded-xl p-3 flex justify-between flex-wrap gap-3"><div className="text-xs"><b>{x.type} • {x.reason}</b><div className="muted mt-1">{fmtDate(x.valid_from)} — {fmtDate(x.valid_until)} • {x.approved_by}</div></div>{canApprove?<Button size="sm" variant={x.active?'danger':'success'} onClick={async()=>{await api('/exemptions/'+x.id,{method:'PATCH',body:{active:!x.active}});qc.invalidateQueries({queryKey:['exemptions',id]})}}>{x.active?'تعطيل':'تفعيل'}</Button>:<Tag tone={x.active?'green':'red'}>{x.active?'مفعّل':'معطّل'}</Tag>}</div>)}{!exem.data?.length&&<Empty message="لا توجد إعفاءات معتمدة"/>}</div></Tabs.Content></Tabs.Root></Card></div><Modal open={edit} onClose={()=>setEdit(false)} title="تعديل بيانات العضو" desk>{save.error&&<div className="px-3 pt-3"><ErrorBox error={save.error}/></div>}<OfficerEditForm idClient={data.IdClient} initial={memberClean(data)} member={data} dependents={deps.data||[]} subscriptions={legacy.data||[]} onSave={b=>save.mutate(b)} isBusy={save.isPending} onClose={()=>setEdit(false)} onEditDep={x=>setDepModal(x)} onEligDep={x=>setEligModal(x)} onDeleteDep={async x=>{if(!confirm('حذف نهائي للتابع «'+x.Name+'»؟ سيُحذف التابع وتجديداته وأهليته نهائياً ولا يمكن التراجع.'))return;try{await api('/dependents/'+x.id,{method:'DELETE'});refresh();notify('تم الحذف النهائي للتابع')}catch(e){setError(e)}}} onPrintDep={x=>setPrint({dependent_id:x.id,name:x.Name,id:x.id})} onRenew={()=>{setEdit(false);nav('/renewals?client='+encodeURIComponent(id));}} onFiles={()=>{setEdit(false);setTab('files');}}/></Modal><DependentModal data={depModal} close={()=>setDepModal(null)} save={saveDep} id={id} refresh={refresh} isVip={!!data.is_vip}/><EligibilityModal data={eligModal} close={()=>setEligModal(null)} id={id} files={files.data||[]} refresh={()=>qc.invalidateQueries({queryKey:['deps',id]})}/><FileModal data={fileEdit} close={()=>setFileEdit(null)} id={id} deps={deps.data||[]} refresh={()=>qc.invalidateQueries({queryKey:['files',id]})}/><FilePreview file={fileView} onClose={()=>setFileView(null)}/><ExemptionModal open={exModal} close={()=>setExModal(false)} id={id} deps={deps.data||[]} refresh={()=>qc.invalidateQueries({queryKey:['exemptions',id]})}/><SecurityBlockModal mode={secModal} close={()=>setSecModal(null)} id={id} refresh={()=>{qc.invalidateQueries({queryKey:['member',id]});qc.invalidateQueries({queryKey:['members']});}} notify={notify}/><HardDeleteModal member={hardDel?data:null} close={()=>setHardDel(false)} onDone={()=>{setHardDel(false);notify('تم الحذف النهائي للعضوية');nav('/members');}}/><CardPrinter open={!!print} onClose={()=>setPrint(null)} id={id} member={data} dependent={print?.dependent_id?deps.data?.find(x=>x.id===print.dependent_id):null}/></>}
function normalizeConfirmId(s){
  return String(s??'').trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x0660)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x06F0));
}
function HardDeleteModal({member,close,onDone}){
  const [reason,setReason]=useState(''),[confirmId,setConfirmId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  useEffect(()=>{setReason('');setConfirmId('');setError(null)},[member]);
  if(!member||typeof member!=='object')return null;
  const idOk=parseMembershipId(normalizeConfirmId(confirmId))===parseMembershipId(normalizeConfirmId(member.IdClient));
  const reasonLen=reason.trim().length;
  const reasonOk=reasonLen>=10;
  async function save(e){
    e.preventDefault();
    if(!idOk||!reasonOk)return;
    setBusy(true);setError(null);
    try{
      await api('/members/'+encodeURIComponent(member.IdClient)+'/hard-delete',{method:'POST',body:{reason,confirm_id:parseMembershipId(normalizeConfirmId(confirmId))}});
      onDone();
    }catch(err){setError(err)}finally{setBusy(false)}
  }
  return <Modal open onClose={close} title="حذف نهائي للعضوية">
    <form onSubmit={save} className="space-y-4">
      <p className="text-xs p-3 rounded-xl bg-red-50 text-red-800 leading-5">هذا حذف دائم وليس أرشفة. سيُحذف العضو والتابعون والمرفقات وسجلات التجديد المرتبطة في قاعدة البيانات الحالية.</p>
      <ErrorBox error={error}/>
      <div className="text-xs font-bold">العضوية: <MembershipId value={member.IdClient}/> — {member.Name}</div>
      <FormInput label="اكتب رقم العضوية للتأكيد" value={confirmId} onChange={setConfirmId} required dir="ltr" placeholder={formatMembershipId(member.IdClient)} autoComplete="off">
        {confirmId.trim()&&!idOk?<div className="mt-1 text-[11px] font-bold text-red-700">رقم العضوية غير مطابق</div>:null}
      </FormInput>
      <FormInput label="سبب الحذف النهائي" required type="textarea" value={reason} onChange={setReason}>
        <div className={'mt-1 text-[11px] font-bold '+(reasonOk?'text-[#5b6b82]':'text-red-700')}>10 أحرف على الأقل ({reasonLen}/10)</div>
      </FormInput>
      <Button type="submit" className="w-full" variant="danger" loading={busy} disabled={!idOk||!reasonOk}>تأكيد الحذف النهائي</Button>
    </form>
  </Modal>;
}
function SecurityBlockModal({mode,close,id,refresh,notify}){const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(null);if(!mode)return null;const blocking=mode==='block';async function save(e){e.preventDefault();setBusy(true);setError(null);try{await api('/members/'+encodeURIComponent(id)+'/security-'+(blocking?'block':'unblock'),{method:'POST',body:{reason}});notify(blocking?'تم تسجيل الحظر الأمني للعضوية':'تم رفع الحظر الأمني عن العضوية');refresh();close();setReason('')}catch(err){setError(err)}finally{setBusy(false)}}return <Modal open onClose={close} title={blocking?'حظر أمني للعضوية':'رفع الحظر الأمني'}><form onSubmit={save} className="space-y-4"><p className="text-xs p-3 rounded-xl bg-orange-50">قائمة المحظورين بالأسماء تبقى كما هي ولا تُربط بهذه العضوية. هذا الحظر خاص بسجل العضو فقط، وفحص الأهلية يرفض التجديد إذا وُجد أي من المصدرين.</p><ErrorBox error={error}/><FormInput label={blocking?'سبب الحظر الأمني':'سبب رفع الحظر'} required type="textarea" value={reason} onChange={setReason}/><Button className="w-full" variant={blocking?'danger':'success'} loading={busy} disabled={reason.trim().length<5}>{blocking?'تأكيد الحظر الأمني':'تأكيد رفع الحظر'}</Button></form></Modal>}
function DependentModal({data,close,save,id,refresh,isVip=false}){const [file,setFile]=useState(null),[error,setError]=useState(null);if(data===null)return null;async function submit(body){try{const x=await save.mutateAsync({body,dep:data.id});if(file){const fd=new FormData();fd.append('file',file);await api('/dependents/'+(data.id||x.id)+'/photo',{method:'PUT',form:fd});refresh()}close()}catch(e){setError(e)}}return <Modal open onClose={close} title={data.id?'تعديل بيانات التابع':'إضافة تابع'} wide><ErrorBox error={error||save.error}/><ChangeForm fields={depFieldsFor(isVip,data.realation)} edit initial={depClean(data)} onSave={submit} isBusy={save.isPending}/><div className="mt-4"><span className="form-label">الصورة الشخصية</span><input type="file" accept="image/*" onChange={e=>setFile(e.target.files?.[0])}/></div></Modal>}
function EligibilityModal({data,close,id,files,refresh}){const [v,setV]=useState({dependent_kind:data?.dependent_kind||'CHILD',proof_type:data?.proof_type||'بطاقة علاجية عائلية',proof_file_id:'',proof_valid_until:data?.proof_valid_until?iso(data.proof_valid_until):'',review_note:''}),[error,setError]=useState(null),[busy,setBusy]=useState(false);useEffect(()=>{if(data)setV({dependent_kind:data.dependent_kind||'CHILD',proof_type:data.proof_type||'بطاقة علاجية عائلية',proof_file_id:'',proof_valid_until:data.proof_valid_until?iso(data.proof_valid_until):'',review_note:''})},[data]);if(!data)return null;async function save(e){e.preventDefault();setBusy(true);setError(null);try{await api('/dependents/'+data.id+'/eligibility',{method:'PUT',body:{...v,proof_file_id:v.proof_file_id?Number(v.proof_file_id):null,proof_valid_until:v.proof_valid_until||null}});refresh();close()}catch(e){setError(e)}finally{setBusy(false)}}return <Modal open onClose={close} title={'اعتماد أهلية التابع: '+data.Name}><form onSubmit={save} className="space-y-4"><p className="text-xs bg-orange-50 p-3 rounded-xl">السن المسموح قابل للضبط وفق اللائحة المعتمدة. إذا تخطى التابع الحد يجب إرفاق إثبات حقيقي والتحقق منه.</p><ErrorBox error={error}/><FormInput label="نوع التابع" value={v.dependent_kind} onChange={x=>setV({...v,dependent_kind:x})} options={[{value:'CHILD',label:'ابن / ابنة'},{value:'GRANDCHILD',label:'حفيد / حفيدة'},{value:'SPOUSE',label:'زوج / زوجة'},{value:'OTHER',label:'أخرى'}]}/><FormInput label="نوع الإثبات" value={v.proof_type} onChange={x=>setV({...v,proof_type:x})}/><FormInput label="ملف الإثبات من المرفقات" value={v.proof_file_id} onChange={x=>setV({...v,proof_file_id:x})} options={[{label:'بدون إثبات — سيتم إلغاء الاعتماد',value:''},...files.filter(f=>!f.archived).map(f=>({label:'#'+f.id+' - '+(f.discip||'مرفق'),value:String(f.id)}))]}/><FormInput label="تاريخ صلاحية الإثبات" type="date" value={v.proof_valid_until} onChange={x=>setV({...v,proof_valid_until:x})}/><FormInput label="ملاحظة المراجع" value={v.review_note} onChange={x=>setV({...v,review_note:x})}/><Button className="w-full" loading={busy}>اعتماد الأهلية</Button></form></Modal>}
function FileModal({data,close,id,deps,refresh}){const [f,setF]=useState(null),[v,setV]=useState({discip:'',document_type:'OTHER',dependent_id:''}),[error,setError]=useState(null),[busy,setBusy]=useState(false);useEffect(()=>{if(data)setV({discip:data.discip||'',document_type:data.document_type||'OTHER',dependent_id:data.dependent_id?String(data.dependent_id):''})},[data]);if(data===null)return null;async function submit(e){e.preventDefault();setBusy(true);setError(null);try{if(data.id){await api('/files/'+data.id,{method:'PATCH',body:{...v,dependent_id:v.dependent_id?Number(v.dependent_id):null}})}else{if(!f)throw new Error('اختار المستند أولاً');const fd=new FormData();fd.append('file',f);fd.append('discip',v.discip);fd.append('document_type',v.document_type);if(v.dependent_id)fd.append('dependent_id',v.dependent_id);await api('/members/'+encodeURIComponent(id)+'/files',{method:'POST',form:fd})}refresh();close()}catch(e){setError(e)}finally{setBusy(false)}}return <Modal open onClose={close} title={data.id?'تعديل المستند':'رفع مستند جديد'}><form onSubmit={submit} className="space-y-4"><ErrorBox error={error}/>{!data.id&&<label className="block text-xs font-bold">رفع من الماسح / ملف<input className="mt-2" type="file" accept="image/jpeg,image/png,image/webp,image/bmp,application/pdf" onChange={e=>setF(e.target.files?.[0])}/></label>}<FormInput label="وصف المستند" value={v.discip} onChange={x=>setV({...v,discip:x})}/><FormInput label="نوع المستند" value={v.document_type} onChange={x=>setV({...v,document_type:x})} options={[{label:'عام',value:'OTHER'},{label:'هوية',value:'IDENTITY'},{label:'بطاقة علاجية',value:'MEDICAL_CARD'},{label:'إثبات قرابة',value:'FAMILY_PROOF'},{label:'مستند إعفاء',value:'EXEMPTION'}]}/><FormInput label="تابع مربوط بالمستند" value={v.dependent_id} onChange={x=>setV({...v,dependent_id:x})} options={[{label:'العضو الأساسي',value:''},...deps.map(x=>({label:x.Name,value:String(x.id)}))]}/><Button loading={busy} className="w-full" type="submit">حفظ المستند</Button></form></Modal>}
function ExemptionModal({open,close,id,deps,refresh}){const [v,setV]=useState({dependent_id:'',type:'DONATION',reason:'',valid_from:new Date().toISOString().slice(0,10),valid_until:''}),[busy,setBusy]=useState(false),[error,setError]=useState(null);if(!open)return null;async function save(e){e.preventDefault();setBusy(true);setError(null);try{await api('/members/'+encodeURIComponent(id)+'/exemptions',{method:'POST',body:{...v,dependent_id:v.dependent_id?Number(v.dependent_id):null,valid_until:v.valid_until||null}});refresh();close()}catch(e){setError(e)}finally{setBusy(false)}}return <Modal open onClose={close} title="اعتماد إعفاء من رسوم العضوية"><form onSubmit={save} className="space-y-4"><ErrorBox error={error}/><FormInput label="نوع الإعفاء" value={v.type} onChange={x=>setV({...v,type:x})} options={[{label:'VIP',value:'VIP'},{label:'تصدقات',value:'DONATION'},{label:'حالة خاصة',value:'OTHER'}]}/><FormInput label="العضو / التابع" value={v.dependent_id} onChange={x=>setV({...v,dependent_id:x})} options={[{label:'العضو الأساسي',value:''},...deps.map(x=>({label:x.Name,value:String(x.id)}))]}/><FormInput label="سبب الإعفاء المعتمد" required value={v.reason} onChange={x=>setV({...v,reason:x})}/><div className="input-grid"><FormInput label="من" type="date" value={v.valid_from} onChange={x=>setV({...v,valid_from:x})}/><FormInput label="حتى" type="date" value={v.valid_until} onChange={x=>setV({...v,valid_until:x})}/></div><Button loading={busy} className="w-full">حفظ الإعفاء</Button></form></Modal>}
