import React from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {UsersRound,UserCheck,Wallet,ShieldAlert,PlusCircle,ArrowUpLeft,Activity,FileWarning,Sparkles,CalendarClock,TrendingUp} from 'lucide-react';
import {api} from '../api';
import {Card,Tag,Loading,ErrorBox,fmtDate,amount,Button} from '../components/ui';
import {useApp} from '../main';
import {can} from '../rbac';
import MembershipId from '../components/MembershipId';

export default function Dashboard(){
  const {user}=useApp();
  const d=useQuery({queryKey:['dashboard'],queryFn:()=>api('/dashboard')});
  const recent=useQuery({queryKey:['recent-renewals'],queryFn:()=>api('/renewals?page=1&pageSize=6')});
  const expiry=useQuery({queryKey:['expiring'],queryFn:()=>api('/reports/expiring?page=1&pageSize=6&days=30')});

  const hour=new Date().getHours();
  const greet=hour<12?'صباح الخير':hour<18?'مساء الخير':'مساء الخير';

  const stats=[
    {label:'إجمالي العضويات',value:d.data?.members,icon:UsersRound,tone:'from-[#e8f1ff] to-[#f4f8ff]',ink:'text-[#2f66d0]',ring:'ring-[#c9dbff]'},
    {label:'الأفراد التابعون',value:d.data?.dependents,icon:UserCheck,tone:'from-[#e4f8f1] to-[#f3fcf8]',ink:'text-[#0c8f6a]',ring:'ring-[#b7e8d4]'},
    {label:'تجديدات نشطة جديدة',value:d.data?.new_active,icon:Activity,tone:'from-[#eaf4ff] to-[#f5f9ff]',ink:'text-[#2563b8]',ring:'ring-[#c5dbf7]'},
    {label:'المحظورون أمنياً',value:d.data?.blocked,icon:ShieldAlert,tone:'from-[#ffecec] to-[#fff7f7]',ink:'text-[#c8474b]',ring:'ring-[#f0c4c4]'},
  ];

  return <>
    <div className="section-head">
      <div>
        <div className="eyebrow">لوحة القيادة الرئيسية</div>
        <h1>{greet}، أهلاً بعودتك</h1>
        <p>ملخص واضح لحالة الاشتراكات والتحصيل والتنبيهات التشغيلية.</p>
      </div>
      {can(user.role,'write')&&<Link to="/members"><Button><PlusCircle size={17}/> إضافة عضو جديد</Button></Link>}
    </div>

    <ErrorBox error={d.error}/>

    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {stats.map(x=>(
        <Card key={x.label} className={`!p-5 bg-gradient-to-br ${x.tone} ring-1 ${x.ring} border-0`}>
          <div className="flex justify-between items-start mb-4">
            <div className={`w-12 h-12 rounded-2xl grid place-content-center bg-white/80 ${x.ink} shadow-sm`}><x.icon size={22}/></div>
            <span className="text-[10px] font-extrabold text-[#8a9ab0] tracking-wide">لحظي</span>
          </div>
          <div className={`stat-value ${x.ink}`}>{d.isLoading?'—':Number(x.value||0).toLocaleString('ar-EG')}</div>
          <div className="text-xs font-extrabold text-[#5f7394] mt-1.5">{x.label}</div>
        </Card>
      ))}
    </div>

    <div className="grid lg:grid-cols-3 gap-4 mt-5">
      <Card className="lg:col-span-2 !p-6 bg-gradient-to-br from-[#123056] via-[#1c4a92] to-[#2a6cbc] text-white overflow-hidden relative border-0 shadow-[0_18px_40px_#1a4a8a33]">
        <div className="absolute -left-16 -top-20 w-72 h-72 rounded-full border-[48px] border-white/[0.05]"/>
        <div className="absolute left-24 bottom-[-60px] w-40 h-40 rounded-full bg-[#5aa7ff22] blur-2xl"/>
        <div className="relative flex justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[#c8def8] text-xs font-extrabold bg-white/10 rounded-full px-3 py-1">
              <TrendingUp size={14}/> تحصيل الشهر الحالي
            </div>
            <div className="text-4xl sm:text-5xl mt-4 font-black tracking-tight">
              {amount(d.data?.new_payments_month)} <span className="text-base font-extrabold opacity-90">ج.م</span>
            </div>
            <p className="text-[#bed4f4] text-[11px] mt-3 leading-5 max-w-md">يشمل التحصيلات المسجّلة في النظام الجديد فقط — دون إيصالات النظام القديم أو التسويات المعلقة.</p>
          </div>
          <div className="w-16 h-16 bg-white/12 rounded-2xl grid place-content-center backdrop-blur-sm"><Wallet size={30}/></div>
        </div>
        <Link to="/finance" className="relative mt-8 inline-flex gap-2 text-sm text-white font-extrabold items-center hover:gap-3 transition-all">
          استعراض المعاملات <ArrowUpLeft size={16}/>
        </Link>
      </Card>

      <Card className="!p-6 bg-gradient-to-b from-[#fffaf3] to-white ring-1 ring-[#f0e0c8]">
        <div className="flex gap-3 items-center mb-5">
          <div className="w-12 h-12 bg-[#fff1dd] text-[#c4821a] rounded-2xl grid place-content-center"><FileWarning size={22}/></div>
          <div>
            <div className="text-[13px] font-black text-[#1e314f]">تنبيهات للمتابعة</div>
            <div className="text-[10px] font-bold text-[#9a8462] mt-0.5">أولوية تشغيلية</div>
          </div>
        </div>
        <div className="space-y-2.5">
          <Link to="/finance" className="flex justify-between items-center p-3.5 bg-[#fff6ea] rounded-2xl border border-[#f3e2c4] hover:bg-[#ffefd8] transition-colors">
            <span className="text-xs font-extrabold text-[#7a6035]">تجديدات بانتظار السداد</span>
            <b className="text-[#c4821a] text-sm">{d.data?.pending||0}</b>
          </Link>
          <Link to="/reports" className="flex justify-between items-center p-3.5 bg-[#eef5ff] rounded-2xl border border-[#d7e5fb] hover:bg-[#e6f0ff] transition-colors">
            <span className="text-xs font-extrabold text-[#3d5f94] flex items-center gap-1.5"><CalendarClock size={14}/> تنتهي خلال 30 يوماً</span>
            <b className="text-blue text-sm">{d.data?.legacy_expiring_30d||0}</b>
          </Link>
          <div className="p-3.5 bg-[#f5f7fb] rounded-2xl border border-[#e5eaf2] text-xs font-extrabold text-[#61748f] flex justify-between">
            <span>المبالغ المعلقة</span>
            <span>{amount(d.data?.outstanding)} ج.م</span>
          </div>
        </div>
      </Card>
    </div>

    <div className="grid xl:grid-cols-2 gap-5 mt-5">
      <Card className="!p-0 overflow-hidden">
        <div className="flex justify-between items-center px-5 py-4 border-b border-[#e8eef8] bg-gradient-to-l from-[#f7faff] to-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#eaf1fe] text-blue grid place-content-center"><Sparkles size={15}/></div>
            <h2 className="font-black text-sm text-[#162440]">آخر عمليات التجديد</h2>
          </div>
          <Link className="text-xs text-blue font-extrabold" to="/renewals">عرض الكل ←</Link>
        </div>
        <div className="px-5 pb-2">
          {recent.isLoading?<div className="py-4"><Loading rows={4}/></div>:<div className="divide-y divide-[#eef2f8]">
            {(recent.data?.items||[]).map(x=>(
              <div key={x.id} className="py-3.5 flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <div className="font-extrabold text-xs truncate text-[#1c314f]">{(x.dependent_name||x.client_name)||<MembershipId value={x.client_id}/>}</div>
                  <div className="text-[11px] muted mt-1">#{x.id} • {fmtDate(x.created_at)}</div>
                </div>
                <div className="text-left shrink-0">
                  <div className="font-black text-xs text-[#1c314f]">{amount(x.amount_due)} ج.م</div>
                  <div className="mt-1 flex justify-end"><Tag tone={x.status==='ACTIVE'?'green':'orange'}>{x.status==='ACTIVE'?'نشط':'معلق'}</Tag></div>
                </div>
              </div>
            ))}
            {!recent.data?.items?.length&&<p className="text-xs muted text-center p-10">لا توجد تجديدات حديثة</p>}
          </div>}
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="flex justify-between items-center px-5 py-4 border-b border-[#e8eef8] bg-gradient-to-l from-[#fff8f0] to-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#fff1dd] text-[#c4821a] grid place-content-center"><CalendarClock size={15}/></div>
            <h2 className="font-black text-sm text-[#162440]">اشتراكات على وشك الانتهاء</h2>
          </div>
          <Link className="text-xs text-blue font-extrabold" to="/reports">عرض التقرير ←</Link>
        </div>
        <div className="px-5 pb-2">
          {expiry.error?<ErrorBox error={expiry.error}/>:expiry.isLoading?<div className="py-4"><Loading rows={4}/></div>:<div className="divide-y divide-[#eef2f8]">
            {(expiry.data?.items||[]).map(x=>(
              <Link to={'/members/'+encodeURIComponent(x.IdClient)} key={x.IdClient} className="py-3.5 flex justify-between items-center gap-3 hover:bg-[#fafcff] -mx-2 px-2 rounded-xl transition-colors">
                <div>
                  <div className="text-xs font-extrabold text-[#1c314f]">{x.Name}</div>
                  <div className="text-[11px] muted mt-1">عضوية <MembershipId value={x.IdClient}/></div>
                </div>
                <Tag tone="orange">{fmtDate(x.ends)}</Tag>
              </Link>
            ))}
            {!expiry.data?.items?.length&&<p className="text-xs muted text-center p-10">لا توجد عضويات على وشك الانتهاء</p>}
          </div>}
        </div>
      </Card>
    </div>
  </>;
}
