import React,{useState,useEffect,useRef}from'react';
import{useQuery,useMutation,useQueryClient}from'@tanstack/react-query';
import{useSearchParams,Link}from'react-router-dom';
import{CreditCard,Search,CheckCircle2,Wallet,Sparkles,Printer,UserRound,BadgeCheck,Loader2,ArrowLeft,RotateCcw}from'lucide-react';
import{api,params}from'../api';
import{Button,Card,Tag,Modal,FormInput,ErrorBox,Pager,Table,Loading,fmtDate,amount,makeKey}from'../components/ui';
import{useApp}from'../main';
import{can}from'../rbac';
import CardPrinter from'../components/CardPrinter';
import MembershipId from'../components/MembershipId';
import{formatMembershipId,parseMembershipId}from'../membership-id';

const nextYearEnd=()=>String(new Date().getFullYear()+1)+'-12-31';
const SERVICE_CODES=['01','02','03','04'];
export function primaryServiceFromId(id){
  const m=String(id||'').match(/^(\d{2})-/);
  return m&&SERVICE_CODES.includes(m[1])?m[1]:'01';
}
export function isChildRelation(relation){
  const r=String(relation||'').replace(/\s+/g,'');
  if(/زوجالابنة|زوجةالابن/.test(r)) return false;
  return /ابن|إبن|ابنة|نجله|كريمته/.test(r);
}

const STEPS=[
  {id:1,label:'العضوية والأهلية',hint:'اختيار العضو وفحص السعر'},
  {id:2,label:'التحصيل والتسجيل',hint:'المبلغ وتأكيد التجديد'},
  {id:3,label:'طباعة الكارنيه',hint:'الوجه الأمامي والخلفي'},
];

function StatusChip({active,onClick,tone,children}){
  return <button type="button" className={'filter-chip '+(tone||'')+(active?' is-active':'')} onClick={onClick} aria-pressed={active}>{children}</button>;
}

function RenewalStepper({step}){
  const pct=Math.max(0,Math.min(100,((step-1)/(STEPS.length-1))*100));
  return (
    <div className="renewal-stepper mb-6">
      <div className="renewal-stepper-track" aria-hidden>
        <div className="renewal-stepper-fill" style={{width:pct+'%'}}/>
      </div>
      <ol className="grid grid-cols-3 gap-2 relative z-[1]">
        {STEPS.map(s=>{
          const done=step>s.id;
          const active=step===s.id;
          return (
            <li key={s.id} className={'renewal-step '+(done?'is-done':'')+(active?' is-active':'')}>
              <div className="renewal-step-badge">
                {done?<CheckCircle2 size={16}/>:active?<span className="renewal-step-pulse">{s.id}</span>:s.id}
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-black truncate">{s.label}</div>
                <div className="text-[10px] muted truncate mt-0.5 hidden sm:block">{s.hint}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Renewals(){
  const {notify,user}=useApp(),qc=useQueryClient();
  const [url]=useSearchParams();
  const attemptKey=useRef(null);
  const [step,setStep]=useState(1);
  const urlClient=parseMembershipId(url.get('client')||'');
  const [search,setSearch]=useState(urlClient?formatMembershipId(urlClient):'');
  const [client,setClient]=useState(urlClient);
  const [dependent,setDependent]=useState('');
  const [service,setService]=useState('01');
  const [end,setEnd]=useState(nextYearEnd());
  const [paid,setPaid]=useState('0');
  const [method,setMethod]=useState('CASH');
  const [reference,setRef]=useState('');
  const [quote,setQuote]=useState(null);
  const [skipAge,setSkipAge]=useState(false);
  const [error,setError]=useState(null);
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(25);
  const [filter,setFilter]=useState('');
  const [view,setView]=useState(null);
  const [printCtx,setPrintCtx]=useState(null);
  const [printOpen,setPrintOpen]=useState(false);
  const [cardLoading,setCardLoading]=useState(false);
  const [lastRenewalId,setLastRenewalId]=useState(null);
  const [purpose,setPurpose]=useState('RENEWAL');
  const isLost=purpose==='LOST_CARD';

  const members=useQuery({queryKey:['members-select',search],queryFn:()=>api('/members'+params({search,pageSize:10})),enabled:search.length>=2});
  const dependents=useQuery({queryKey:['dep-select',client],queryFn:()=>api('/members/'+encodeURIComponent(client)+'/dependents'),enabled:!!client});
  const shifts=useQuery({queryKey:['shifts'],queryFn:()=>api('/shifts')});
  const serviceList=useQuery({queryKey:['services'],queryFn:()=>api('/services'),staleTime:300000});
  const services=(serviceList.data||[{code:'01',label:'خدمة — الدار'},{code:'02',label:'معاش — الدار'},{code:'03',label:'أبناء — الدار'},{code:'04',label:'مدنيون — الدار'}]).filter(x=>x.active!==false).map(x=>({value:x.code,label:x.code+' • '+(x.label||x.code)}));
  const shift=shifts.data?.find(x=>x.opened_by===user.username&&!x.closed_at);
  const list=useQuery({queryKey:['renewals',page,filter,pageSize],queryFn:()=>api('/renewals'+params({page,pageSize,status:filter}))});
  const {isPending:quoting,mutateAsync:makeQuote}=useMutation({mutationFn:b=>api('/renewals/quote',{method:'POST',body:b})});
  const create=useMutation({
    mutationFn:b=>api('/renewals',{method:'POST',body:b}),
  });

  useEffect(()=>{setQuote(null);attemptKey.current=null;setStep(1);setLastRenewalId(null);},[client,dependent,service,end,purpose]);
  useEffect(()=>{
    if(!client) return;
    const prefix=primaryServiceFromId(client);
    setService(prefix);
    if(!dependent){setSkipAge(false);return;}
    const dep=(dependents.data||[]).find(x=>String(x.id)===String(dependent));
    if(!isChildRelation(dep?.realation)) setSkipAge(false);
  },[dependent,client,dependents.data]);

  const canApprove=can(user.role,'approve');
  const selectedDep=(dependents.data||[]).find(x=>String(x.id)===String(dependent));
  const childDep=!!dependent&&isChildRelation(selectedDep?.realation);
  const payload={client_id:client,dependent_id:dependent?Number(dependent):null,service_code:service,purpose,...(isLost?{}:{term_to:end}),...(skipAge&&canApprove&&childDep&&!isLost?{skip_age_check:true}:{})};
  const selectedName=members.data?.items?.find(x=>x.IdClient===client)?.Name;
  const canPrint=can(user.role,'print');

  async function preparePrintCard(clientId,dependentId){
    setCardLoading(true);
    setError(null);
    try{
      const member=await api('/members/'+encodeURIComponent(clientId));
      let dep=null;
      if(dependentId){
        const deps=await api('/members/'+encodeURIComponent(clientId)+'/dependents');
        dep=deps.find(x=>x.id===Number(dependentId))||null;
      }
      setPrintCtx({member,dependent:dep,id:clientId});
      setPrintOpen(true);
    }catch(e){setError(e);}
    finally{setCardLoading(false);}
  }

  async function quotation(){
    setError(null);
    try{
      const q=await makeQuote(payload);
      setQuote(q);
      setPaid(String(q.amount_due));
      attemptKey.current=null;
      setStep(2);
      notify('تم التحقق من الأهلية والسعر');
    }catch(e){setError(e);}
  }

  async function submit(e){
    e.preventDefault();
    setError(null);
    try{
      const x=await create.mutateAsync({
        ...payload,
        request_key:attemptKey.current||(attemptKey.current=makeKey()),
        amount_paid:Number(paid),
        method:Number(paid)>0?method:undefined,
        shift_id:Number(paid)>0?shift?.id:undefined,
        payment_reference:reference||undefined,
      });
      notify(x.idempotent?(isLost?'عملية بدل فاقد مسجلة مسبقاً':'عملية التجديد مسجلة مسبقاً'):(isLost?'تم تسجيل بدل فاقد #'+x.id:'تم إنشاء عملية التجديد #'+x.id));
      qc.invalidateQueries({queryKey:['renewals']});
      qc.invalidateQueries({queryKey:['dashboard']});
      setLastRenewalId(x.id);
      setView(x.id);
      setStep(3);
      if(canPrint) await preparePrintCard(client,dependent?Number(dependent):null);
    }catch(e){setError(e);}
  }

  function resetFlow(){
    setStep(1);
    setQuote(null);
    setPaid('0');
    setRef('');
    attemptKey.current=null;
    setLastRenewalId(null);
    setPrintCtx(null);
    setPrintOpen(false);
    setError(null);
  }

  return <>
    <div className="section-head">
      <div>
        <div className="eyebrow">مسار تجديد موحّد بثلاث خطوات</div>
        <h1>الاشتراكات والتجديدات</h1>
        <p>الأهلية → التحصيل → طباعة الكارنيه مباشرة من بيانات العضوية.</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" onClick={resetFlow}><RotateCcw size={15}/> تجديد جديد</Button>
        <Link to="/finance"><Button variant="outline"><Wallet size={16}/> فتح / متابعة وردية</Button></Link>
      </div>
    </div>

    <Card className="renewal-hero mb-5">
      <RenewalStepper step={step}/>
      <div className="grid xl:grid-cols-[1.05fr_.95fr] gap-6 items-start">
        <div className="space-y-4">
          {step===1&&(
            <div className="space-y-4 animate-in">
              <div className="flex gap-3 items-center">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#3b81fa] to-[#1f58bd] text-white grid place-content-center shadow-[0_10px_24px_#2b63cf33]"><UserRound size={20}/></div>
                <div>
                  <h2 className="text-sm font-black text-[#162440]">الخطوة 1 • اختيار العضوية</h2>
                  <div className="text-[11px] text-[#6d829f] mt-0.5">ابحث، حدّد صاحب التجديد، ثم افحص الأهلية والسعر</div>
                </div>
              </div>
              <FormInput label="نوع العملية" value={purpose} onChange={setPurpose} options={[{value:'RENEWAL',label:'تجديد اشتراك'},{value:'LOST_CARD',label:'بدل فاقد (ضياع كارنيه)'}]}/>
              {isLost&&<p className="text-[11px] font-bold text-[#7a5d24] bg-[#fff8e8] border border-[#f0dfb0] rounded-xl px-3 py-2 leading-5">لا يُمدَّد الاشتراك — رسوم استبدال كارنيه مفقود فقط، ثم الطباعة.</p>}
              <FormInput label="البحث عن العضوية" value={search} onChange={v=>{setSearch(v);if(v!==client)setClient('')}} placeholder="رقم العضوية أو الاسم"/>
              <div className="max-h-48 overflow-y-auto rounded-2xl border border-[#dbe5f5] bg-white/90 shadow-[inset_0_1px_0_#fff]">
                {members.isFetching&&search.length>=2&&<div className="px-3 py-4 text-xs muted flex items-center gap-2 justify-center"><Loader2 size={14} className="animate-spin"/> جاري البحث...</div>}
                {members.data?.items?.map(x=>
                  <button type="button" key={x.IdClient}
                    className={'w-full text-right px-3.5 py-2.5 border-b border-[#eef2f8] text-xs transition-colors '+(client===x.IdClient?'bg-[#eaf2ff] text-[#1f4fbf] font-black':'hover:bg-[#f7faff]')}
                    onClick={()=>{setClient(x.IdClient);setSearch(formatMembershipId(x.IdClient))}}>
                    <div className="font-bold">{x.Name}</div>
                    <div className="text-[10px] muted mt-0.5"><MembershipId value={x.IdClient}/>{!!x.security_blocked?' • محظور أمنيًا':''}</div>
                  </button>
                )}
                {search.length>=2&&!members.isLoading&&!(members.data?.items?.length)&&<div className="px-3 py-4 text-xs muted text-center">لا توجد نتائج</div>}
              </div>
              {client&&(
                <div className="rounded-2xl border border-[#cfe0ff] bg-gradient-to-l from-[#eef5ff] to-[#f7faff] px-3.5 py-3 text-[12px] text-[#2a55a8] flex items-start gap-2">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0"/>
                  <div>
                    <div className="font-black">العضوية المحددة</div>
                    <div className="mt-1">{selectedName||'—'} <span className="font-bold opacity-80">• <MembershipId value={client}/></span></div>
                  </div>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <FormInput label="صاحب التجديد" value={dependent} onChange={setDependent} options={[{value:'',label:'العضو الأساسي'},...(dependents.data||[]).filter(x=>!x.archived).map(x=>({value:String(x.id),label:x.Name+' • '+(x.realation||'تابع')}))]}/>
                {!isLost&&<FormInput label="فئة الخدمة المعتمدة" value={service} onChange={setService} options={services}/>}
              </div>
              {!isLost&&<FormInput label="تاريخ انتهاء الفترة الجديدة" type="date" value={end} onChange={setEnd}/>}
              {canApprove&&childDep&&!isLost?<label className="flex items-start gap-2 text-xs font-bold text-[#3d5474] mb-3 p-3 rounded-xl bg-[#fff8e8] border border-[#f0dfb0]"><input type="checkbox" className="mt-0.5" checked={skipAge} onChange={e=>setSkipAge(e.target.checked)}/><span>تخطي فحص السن (مشرف فقط) — عند نقص تواريخ الميلاد أو للتجديد الاستثنائي للأبناء</span></label>:null}
                <Button type="button" className="w-full !min-h-11" onClick={quotation} disabled={!client} loading={quoting}>
                <Search size={17}/> {isLost?'فحص الأهلية وسعر بدل فاقد':'فحص الأهلية والسعر والمتابعة'}
              </Button>
            </div>
          )}

          {step===2&&(
            <form onSubmit={submit} className="space-y-4 animate-in">
              <div className="flex gap-3 items-center">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#0d9a74] to-[#067a5c] text-white grid place-content-center shadow-[0_10px_24px_#0d9a7433]"><CreditCard size={20}/></div>
                <div>
                  <h2 className="text-sm font-black text-[#162440]">الخطوة 2 • التحصيل والتسجيل</h2>
                  <div className="text-[11px] text-[#6d829f] mt-0.5">أكد المبلغ ثم سجّل التجديد للانتقال للطباعة تلقائياً</div>
                </div>
              </div>
              {quote&&(
                <div className="quote-glow rounded-2xl p-4 space-y-2">
                  <div className="text-[#0a7f63] font-black text-xs flex items-center gap-2"><Sparkles size={16}/> {isLost?'مسموح ببدل فاقد':'مسموح بالتجديد'}</div>
                  <div className="text-sm font-bold text-[#163528]">{quote.customer_name}</div>
                  <div className="text-xs text-[#5f7a6d]">{isLost?'اشتراك ساري حتى':'من'} {fmtDate(quote.term_from)}{isLost?'':` إلى ${fmtDate(quote.term_to)}`}{isLost?` (ينتهي ${fmtDate(quote.term_to)})`:''}</div>
                  <div className="text-[11px] text-[#4d6b5c]">{quote.fee_label}</div>
                  {isLost&&quote?.lost_card_price_source&&(
                    <div className="text-[10px] text-[#6d829f] leading-snug">
                      {quote.lost_card_price_source==='row'
                        ?`سعر بدل فاقد من قائمة الأسعار${quote.matched_cat?` — ${quote.matched_cat}`:''}${quote.matched_jop?` / ${quote.matched_jop}`:''}. عدّل الرتبة من تبويب «بدل فاقد» في /pricing.`
                        :'سعر بدل فاقد من الإعداد الافتراضي (عمود بدل فاقد فارغ أو غير مضبوط في الأسعار). اضبط القيمة من /pricing → بدل فاقد.'}
                    </div>
                  )}
                  <div className="font-black text-[28px] leading-none text-[#078a68] pt-1">{Number(quote.amount_due)===0?'مجاني':<>{amount(quote.amount_due)} <span className="text-sm font-extrabold">ج.م</span></>}</div>
                </div>
              )}
              {Number(quote?.amount_due)===0?(
                <p className="text-xs font-bold text-[#0a7f63] bg-[#eefaf4] border border-[#cfe9dc] rounded-2xl px-3.5 py-3">تجديد مجاني — لا يلزم طريقة دفع ولا وردية.</p>
              ):(
              <>
              <div className="grid sm:grid-cols-2 gap-3">
                <FormInput label="المبلغ المدفوع فعلياً (ج.م)" type="number" min="0" step="0.01" value={paid} onChange={setPaid}/>
                <FormInput label="طريقة الدفع" value={method} onChange={setMethod} options={[{value:'CASH',label:'نقدي'},{value:'CARD',label:'بطاقة بنكية'},{value:'TRANSFER',label:'تحويل'}]}/>
              </div>
              <FormInput label="رقم مرجع الدفع (اختياري)" value={reference} onChange={setRef}/>
              </>
              )}
              <div className={'rounded-2xl px-3.5 py-3 text-xs font-bold '+(shift?'bg-[#eef7ff] text-[#2a5aa8] border border-[#d3e4ff]':'bg-[#fff6ea] text-[#936d39] border border-[#f0dfc0]')}>
                {shift?'الوردية المفتوحة: #'+shift.id:'لا توجد وردية مفتوحة. المدفوعات > 0 تتطلب فتح وردية من شاشة المالية.'}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button type="button" variant="outline" onClick={()=>setStep(1)}><ArrowLeft size={15}/> رجوع</Button>
                <Button type="submit" className="flex-1 !min-h-11" disabled={Number(paid)>0&&!shift} loading={create.isPending||cardLoading}>
                  <BadgeCheck size={17}/> {isLost?'تسجيل بدل فاقد والانتقال للطباعة':'تسجيل التجديد والانتقال للطباعة'}
                </Button>
              </div>
              <p className="text-[11px] muted leading-5">لو السداد أقل من المستحق، يسجل التجديد كـ«معلق» حتى استكمال التحصيل. بعد التسجيل تُفتح معاينة طباعة الكارنيه تلقائياً.</p>
            </form>
          )}

          {step===3&&(
            <div className="space-y-4 animate-in">
              <div className="flex gap-3 items-center">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#5b6cff] to-[#3140c8] text-white grid place-content-center shadow-[0_10px_24px_#3b4ad433]"><Printer size={20}/></div>
                <div>
                  <h2 className="text-sm font-black text-[#162440]">الخطوة 3 • طباعة الكارنيه</h2>
                  <div className="text-[11px] text-[#6d829f] mt-0.5">طباعة الوجه الأمامي فقط على الكرت المطبوع مسبقاً</div>
                </div>
              </div>
              <div className="rounded-2xl border border-[#d9e4fb] bg-gradient-to-br from-[#f7faff] to-[#eef3ff] p-4 space-y-3">
                <div className="flex items-center gap-2 text-[#1f4fbf] font-black text-xs">
                  <CheckCircle2 size={16}/> تم تسجيل العملية{lastRenewalId?' #'+lastRenewalId:''}
                </div>
                <p className="text-[12px] text-[#4a5f7d] leading-6">
                  الطباعة تستخدم تصميم الكارنيه (منطقة البياض فقط) من سجل العضوية المحدد في التجديد — دون مغادرة هذه الشاشة.
                </p>
                {cardLoading&&<div className="flex items-center gap-2 text-xs text-[#5b6cff]"><Loader2 size={15} className="animate-spin"/> تجهيز بيانات الكارنيه...</div>}
                <div className="flex gap-2 flex-wrap">
                  {canPrint&&(
                    <Button loading={cardLoading} onClick={()=>preparePrintCard(client,dependent?Number(dependent):null)} disabled={!client}>
                      <Printer size={16}/> {printOpen?'إعادة فتح معاينة الطباعة':'طباعة الكارنيه'}
                    </Button>
                  )}
                  {lastRenewalId&&<Button variant="outline" onClick={()=>setView(lastRenewalId)}>تفاصيل العملية</Button>}
                  <Button variant="soft" onClick={resetFlow}>بدء تجديد آخر</Button>
                </div>
              </div>
            </div>
          )}
          <ErrorBox error={error||create.error}/>
        </div>

        <div className="rounded-2xl border border-[#e2e8f2] bg-[#fbfcff] p-4 sm:p-5">
          <div className="text-[11px] font-black text-[#7d90ad] mb-3">ملخص المسار</div>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between gap-3"><span className="muted">العضوية</span><b dir="ltr">{client||'—'}</b></div>
            <div className="flex justify-between gap-3"><span className="muted">الاسم</span><b className="text-left">{quote?.customer_name||selectedName||'—'}</b></div>
            <div className="flex justify-between gap-3"><span className="muted">صاحب التجديد</span><b>{dependent?(dependents.data||[]).find(x=>String(x.id)===dependent)?.Name||dependent:'العضو الأساسي'}</b></div>
            <div className="flex justify-between gap-3"><span className="muted">نوع العملية</span><b>{isLost?'بدل فاقد':'تجديد'}</b></div>
            {!isLost&&<div className="flex justify-between gap-3"><span className="muted">الفئة</span><b>{service}</b></div>}
            <div className="flex justify-between gap-3"><span className="muted">{isLost?'انتهاء الاشتراك الحالي':'حتى'}</span><b>{fmtDate(isLost&&quote?quote.term_to:end)}</b></div>
            <div className="flex justify-between gap-3"><span className="muted">المستحق</span><b>{quote?Number(quote.amount_due)===0?'مجاني':amount(quote.amount_due)+' ج.م':'—'}</b></div>
            <div className="flex justify-between gap-3"><span className="muted">الخطوة الحالية</span><b>{STEPS.find(s=>s.id===step)?.label}</b></div>
          </div>
          {(quoting||create.isPending||cardLoading)&&(
            <div className="mt-4 flex items-center gap-2 text-[11px] font-bold text-[#3b81fa]">
              <Loader2 size={14} className="animate-spin"/> جاري معالجة الخطوة...
            </div>
          )}
        </div>
      </div>
    </Card>

    <Card className="panel-ledger min-w-0">
      <div className="flex flex-wrap justify-between gap-3 items-start mb-5">
        <div>
          <h2 className="font-black text-sm text-[#162440]">سجل التجديدات الحديثة</h2>
          <p className="muted text-[11px] mt-1">افتح أي سجل لطباعة الكارنيه أو متابعة السداد</p>
        </div>
        <div className="status-seg" role="group" aria-label="تصفية الحالة">
          {[
            {value:'',label:'الكل',tone:''},
            {value:'ACTIVE',label:'نشط',tone:'is-mint'},
            {value:'PENDING',label:'معلق',tone:'is-amber'},
            {value:'VOID',label:'ملغى',tone:'is-rose'},
          ].map(x=>(
            <StatusChip key={x.value||'all'} tone={x.tone} active={filter===x.value} onClick={()=>{setFilter(x.value);setPage(1)}}>{x.label}</StatusChip>
          ))}
        </div>
      </div>
      <ErrorBox error={list.error}/>
      {list.isLoading?<Loading/>:<>
        <Table heads={['رقم','النوع','العضو / التابع','المستحق','المدفوع','الحالة','التاريخ','كارنيه']} rows={list.data?.items||[]} onClick={x=>setView(x.id)} render={x=>{
          const kind=(x.transaction_kind||'RENEWAL')==='LOST_CARD'?'بدل فاقد':'تجديد';
          return <>
          <td className="font-black text-blue">#{x.id}</td>
          <td><Tag tone={kind==='بدل فاقد'?'orange':'blue'}>{kind}</Tag></td>
          <td><b>{x.dependent_name||x.client_name}</b><div className="text-[10px] muted"><MembershipId value={x.client_id}/></div></td>
          <td>{amount(x.amount_due)}</td>
          <td>{amount(x.paid_amount)}</td>
          <td><Tag tone={x.status==='ACTIVE'?'green':x.status==='PENDING'?'orange':'red'}>{x.status==='ACTIVE'?'نشط':x.status==='PENDING'?'معلق':'ملغى'}</Tag></td>
          <td>{fmtDate(x.created_at)}</td>
          <td onClick={e=>e.stopPropagation()}>
            {canPrint?<Button size="sm" variant="soft" onClick={()=>preparePrintCard(x.client_id,x.dependent_id)}><Printer size={14}/> طباعة</Button>:<span className="muted text-[10px]">—</span>}
          </td>
        </>;}}/>
        <Pager data={list.data} setPage={setPage} pageSize={pageSize} setPageSize={setPageSize}/>
      </>}
    </Card>

    <RenewalDetails
      id={view}
      close={()=>setView(null)}
      shifts={shifts.data||[]}
      onChange={()=>{qc.invalidateQueries({queryKey:['renewals']});qc.invalidateQueries({queryKey:['dashboard']})}}
      onPrintCard={(clientId,dependentId)=>preparePrintCard(clientId,dependentId)}
    />

    <CardPrinter
      open={printOpen&&!!printCtx?.member}
      onClose={()=>setPrintOpen(false)}
      id={printCtx?.id}
      member={printCtx?.member}
      dependent={printCtx?.dependent||null}
      defaultReprintReason={isLost||quote?.purpose==='LOST_CARD'?'بدل فاقد':''}
    />
  </>;
}

export function RenewalDetails({id,close,shifts=[],onChange=()=>{},onPrintCard}){
  const {user,notify}=useApp();
  const [paid,setPaid]=useState('');
  const [method,setMethod]=useState('CASH');
  const [reference,setReference]=useState('');
  const [error,setError]=useState(null);
  const [busy,setBusy]=useState(false);
  const [reason,setReason]=useState('');
  const [refundMethod,setRefundMethod]=useState('CASH');
  const [refundReference,setRefundReference]=useState('');
  const [newDue,setNewDue]=useState('');
  const [adjustReason,setAdjustReason]=useState('');
  const detail=useQuery({queryKey:['renewal',id],queryFn:()=>api('/renewals/'+id),enabled:!!id});
  const shift=shifts.find(x=>x.opened_by===user.username&&!x.closed_at);
  const canApprove=can(user.role,'approve');
  const x=detail.data;
  const rest=x?Math.max(0,Number(x.amount_due)-Number(x.paid_amount)):0;

  async function pay(e){e.preventDefault();setBusy(true);setError(null);try{await api('/renewals/'+id+'/payments',{method:'POST',body:{request_key:makeKey(),amount:Number(paid),method,reference,shift_id:shift?.id}});notify('تم تسجيل السداد');detail.refetch();onChange();setPaid('')}catch(e){setError(e)}finally{setBusy(false)}}
  async function openReceipt(){setError(null);try{const res=await fetch((import.meta.env.VITE_API_BASE||'/api')+'/renewals/'+id+'/receipt',{credentials:'same-origin'});if(!res.ok)throw new Error('تعذر فتح الإيصال');const html=await res.text();const w=window.open('','_blank');if(!w)throw new Error('المتصفح منع نافذة الإيصال');w.document.open();w.document.write(html);w.document.close();}catch(e){setError(e)}}
  async function adjustDue(){setBusy(true);setError(null);try{await api('/renewals/'+id+'/adjust',{method:'POST',body:{new_due:Number(newDue),reason:adjustReason}});notify('تم تسجيل التسوية');detail.refetch();onChange();setAdjustReason('')}catch(e){setError(e)}finally{setBusy(false)}}
  async function voidIt(){if(!confirm('إلغاء التجديد المعلق؟ لو فيه مبلغ مدفوع لازم تكون استرديته فعلياً قبل الإلغاء.'))return;setBusy(true);try{await api('/renewals/'+id+'/void',{method:'POST',body:{reason,refund_confirmed:Number(x.paid_amount)>0,refund_method:Number(x.paid_amount)>0?refundMethod:undefined,refund_reference:Number(x.paid_amount)>0?refundReference:undefined,shift_id:Number(x.paid_amount)>0?shift?.id:undefined}});notify('تم الإلغاء مع الاحتفاظ بالأثر المالي');detail.refetch();onChange()}catch(e){setError(e)}finally{setBusy(false)}}

  return <Modal open={!!id} onClose={close} title={'تفاصيل العملية #'+id}>
    <ErrorBox error={error||detail.error}/>
    {detail.isLoading?<Loading/>:x&&<div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-xs">{[['النوع',(x.transaction_kind||'RENEWAL')==='LOST_CARD'?'بدل فاقد':'تجديد'],['العضوية',<MembershipId value={x.client_id}/>],['الفئة',x.service_code],['من',fmtDate(x.term_from)],['حتى',fmtDate(x.term_to)],['المستحق',amount(x.amount_due)],['المدفوع',amount(x.paid_amount)]].map(([k,v])=><div key={k} className="bg-[#f6f8fc] p-3 rounded-xl"><span className="muted">{k}</span><div className="font-black mt-1">{v}</div></div>)}</div>
      <Tag tone={x.status==='ACTIVE'?'green':'orange'}>{x.status}</Tag>
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" onClick={openReceipt}>إيصال</Button>
        {can(user.role,'print')&&onPrintCard&&(
          <Button variant="soft" onClick={()=>onPrintCard(x.client_id,x.dependent_id)}>
            <Printer size={15}/> طباعة الكارنيه
          </Button>
        )}
      </div>
      {x.status==='PENDING'&&<>
        <div className="font-black text-sm">المتبقي: {amount(rest)} ج.م</div>
        <form className="space-y-3" onSubmit={pay}>
          <FormInput label="المبلغ المستلم" type="number" min="0.01" step="0.01" value={paid} onChange={setPaid}/>
          <FormInput label="طريقة الدفع" value={method} onChange={setMethod} options={[{label:'نقدي',value:'CASH'},{label:'بطاقة',value:'CARD'},{label:'تحويل',value:'TRANSFER'}]}/>
          <FormInput label="المرجع" value={reference} onChange={setReference}/>
          <Button className="w-full" disabled={!shift} loading={busy}>سداد المبلغ (وردية #{shift?.id||'غير مفتوحة'})</Button>
        </form>
        {canApprove&&x.status==='PENDING'&&<>
          <hr/>
          <FormInput label="المستحق الجديد بعد التسوية" type="number" min="0" step="0.01" value={newDue} onChange={setNewDue}/>
          <FormInput label="سبب التسوية" value={adjustReason} onChange={setAdjustReason}/>
          <Button variant="outline" className="w-full" disabled={adjustReason.length<8||newDue===''} loading={busy} onClick={adjustDue}>تسجيل تسوية المستحق</Button>
          <hr/>
          <FormInput label="سبب إلغاء تجديد معلق" value={reason} onChange={setReason} placeholder="سبب مفصل (10 حروف على الأقل)"/>
          {Number(x.paid_amount)>0&&<>
            <div className="text-xs text-red-700 bg-red-50 rounded-xl p-3">يجب صرف المبلغ فعلياً أولاً وتسجيل مرجع الاسترداد. لا يكفي الضغط على تأكيد.</div>
            <FormInput label="طريقة صرف الاسترداد" value={refundMethod} onChange={setRefundMethod} options={[{value:'CASH',label:'نقدي'},{value:'CARD',label:'بطاقة'},{value:'TRANSFER',label:'تحويل'}]}/>
            <FormInput label="مرجع إيصال الاسترداد الفعلي" value={refundReference} onChange={setRefundReference}/>
          </>}
          <Button variant="danger" className="w-full" disabled={reason.length<10||(Number(x.paid_amount)>0&&(!shift||refundReference.length<5))} loading={busy} onClick={voidIt}>إلغاء بعد استكمال إثبات الاسترداد</Button>
        </>}
      </>}
      <h3 className="font-black text-sm">الدفعات</h3>
      {x.payments?.map(p=><div key={p.id} className="p-3 border rounded-xl text-xs flex justify-between"><span>#{p.id} • {p.method} • {fmtDate(p.created_at)}</span><b>{amount(p.amount)} ج.م</b></div>)}
      {x.reversals?.length>0&&<div className="text-red-600 text-xs">سجل الاستردادات: {x.reversals.map(p=>amount(p.amount)).join('، ')}</div>}
    </div>}
  </Modal>;
}
