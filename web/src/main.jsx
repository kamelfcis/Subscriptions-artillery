import React,{useEffect,useState,useRef,createContext,useContext} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,Link,NavLink,useLocation} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {LayoutDashboard,UsersRound,CreditCard,Wallet,ShieldAlert,Tags,FileBarChart2,Settings2,LogOut,Menu,X,ShieldCheck,Search,Activity,UserCog,KeyRound,ChevronDown} from 'lucide-react';
import {api} from './api';
import {Card,useToast,Modal,FormInput,ErrorBox,Button} from './components/ui';
import Dashboard from './pages/Dashboard';
import Members,{MemberDetail} from './pages/Members';
import Renewals from './pages/Renewals';
import Finance from './pages/Finance';
import Blocked from './pages/Blocked';
import Pricing from './pages/Pricing';
import Reports from './pages/Reports';
import Admin from './pages/Admin';
import CardDesign from './pages/CardDesign';
import Login from './pages/Login';
import {nav,visibleNav,can} from './rbac';
import './style.css';

const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:15000,refetchOnWindowFocus:false,retry:1}}});
const Context=createContext(null);
export const useApp=()=>useContext(Context);

const icons={ '/':LayoutDashboard,'/members':UsersRound,'/renewals':CreditCard,'/finance':Wallet,'/blocked':ShieldAlert,'/pricing':Tags,'/reports':FileBarChart2,'/admin':Settings2};
const roleLabel={admin:'مدير النظام',supervisor:'مشرف',cashier:'خزينة',clerk:'موظف',auditor:'مراجع'};

function Gate({perm,children}){
  const {user}=useApp();
  if(!can(user.role,perm))return <Card>ليست لديك صلاحية لفتح هذه الصفحة.</Card>;
  return children;
}

function ChangePasswordModal({open,onClose,notify}){
  const [current,setCurrent]=useState('');
  const [next,setNext]=useState('');
  const [confirm,setConfirm]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  useEffect(()=>{if(open){setCurrent('');setNext('');setConfirm('');setError(null);}},[open]);
  async function save(e){
    e.preventDefault();
    setBusy(true);setError(null);
    try{
      await api('/auth/change-password',{method:'POST',body:{current_password:current,new_password:next,confirm_password:confirm}});
      notify('تم تغيير كلمة المرور بنجاح');
      onClose();
    }catch(err){setError(err);}
    finally{setBusy(false);}
  }
  return <Modal open={open} onClose={onClose} title="تغيير كلمة المرور">
    <form onSubmit={save} className="space-y-4">
      <p className="text-xs muted leading-5">أدخل كلمة المرور الحالية ثم الكلمة الجديدة (8 أحرف على الأقل) وتأكيدها.</p>
      <ErrorBox error={error}/>
      <FormInput label="كلمة المرور الحالية" type="password" value={current} onChange={setCurrent} required autoComplete="current-password"/>
      <FormInput label="كلمة المرور الجديدة" type="password" value={next} onChange={setNext} required autoComplete="new-password"/>
      <FormInput label="تأكيد كلمة المرور الجديدة" type="password" value={confirm} onChange={setConfirm} required autoComplete="new-password"/>
      <Button className="w-full" loading={busy} disabled={current.length<1||next.length<8||confirm.length<8}>حفظ كلمة المرور</Button>
    </form>
  </Modal>;
}

function UserMenu({user,onLogout,onChangePassword}){
  const [open,setOpen]=useState(false);
  const root=useRef(null);
  useEffect(()=>{
    function onDoc(e){if(root.current&&!root.current.contains(e.target))setOpen(false);}
    function onKey(e){if(e.key==='Escape')setOpen(false);}
    document.addEventListener('mousedown',onDoc);
    document.addEventListener('keydown',onKey);
    return ()=>{document.removeEventListener('mousedown',onDoc);document.removeEventListener('keydown',onKey);};
  },[]);
  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        className={'flex items-center gap-2.5 rounded-2xl border px-2.5 py-1.5 transition-colors '+(open?'bg-[#eaf1fe] border-[#c7d8f5]':'bg-white border-[#e2e8f2] hover:bg-[#f5f8ff]')}
        onClick={()=>setOpen(v=>!v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#3b81fa] to-[#1f58bd] text-white grid place-content-center text-xs font-black uppercase">
          {(user.username||'?').slice(0,2)}
        </div>
        <div className="hidden sm:block text-right min-w-0">
          <div className="text-[12px] font-black text-[#1c314f] truncate max-w-[140px]">{user.username}</div>
          <div className="text-[10px] font-bold text-[#7d90ad]">{roleLabel[user.role]||user.role}</div>
        </div>
        <ChevronDown size={16} className={'text-[#7d90ad] transition-transform '+(open?'rotate-180':'')}/>
      </button>
      {open&&(
        <div role="menu" className="absolute left-0 mt-2 w-56 rounded-2xl border border-[#e2e8f2] bg-white shadow-[0_16px_40px_rgba(18,40,80,.12)] overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-[#eef2f8] bg-[#f8faff]">
            <div className="text-xs font-black text-[#1c314f] truncate">{user.username}</div>
            <div className="text-[10px] font-bold text-[#7d90ad] mt-0.5">{roleLabel[user.role]||user.role}</div>
          </div>
          <button type="button" role="menuitem" className="w-full flex items-center gap-2.5 px-4 py-3 text-xs font-extrabold text-[#395171] hover:bg-[#f5f8ff] text-right" onClick={()=>{setOpen(false);onChangePassword();}}>
            <KeyRound size={16}/> تغيير كلمة المرور
          </button>
          <button type="button" role="menuitem" className="w-full flex items-center gap-2.5 px-4 py-3 text-xs font-extrabold text-[#c8474b] hover:bg-[#fff5f5] text-right border-t border-[#eef2f8]" onClick={()=>{setOpen(false);onLogout();}}>
            <LogOut size={16}/> تسجيل الخروج
          </button>
        </div>
      )}
    </div>
  );
}

function Shell({user,onLogout,notify}){
  const [mobile,setMobile]=useState(false);
  const [pwdOpen,setPwdOpen]=useState(false);
  const loc=useLocation();
  useEffect(()=>setMobile(false),[loc.pathname]);
  const items=visibleNav(user.role);
  const current=items.find(x=>x.url===loc.pathname)||items.find(x=>loc.pathname.startsWith(x.url)&&x.url!=='/')||nav.find(x=>x.url===loc.pathname)||items[0];

  return <Context.Provider value={{user,notify}}>
    <div className="min-h-screen flex">
      <aside className={'no-print z-40 fixed inset-y-0 right-0 w-[254px] bg-night flex flex-col transition-transform duration-200 lg:translate-x-0 lg:static lg:shrink-0 '+(mobile?'translate-x-0':'translate-x-full')}>
        <div className="px-6 py-7 border-b border-white/10 flex gap-3 items-center">
          <div className="bg-gradient-to-br from-[#3b81fa] to-[#1f58bd] p-2.5 rounded-xl text-white"><ShieldCheck size={27}/></div>
          <div>
            <div className="text-white font-black text-base leading-5">منظومة الاشتراكات</div>
            <div className="text-[#8299c0] text-[10px] mt-1">SUBSCRIPTIONS HUB</div>
          </div>
          <button className="lg:hidden text-white mr-auto" onClick={()=>setMobile(false)}><X size={20}/></button>
        </div>
        <div className="px-5 pt-7 pb-3 text-[11px] text-[#6f85ad] font-bold">القائمة الرئيسية</div>
        <nav className="px-3 space-y-1 flex-1 overflow-auto scrollbar-hide">
          {items.map(x=>{
            const Icon=icons[x.url];
            return <NavLink key={x.url} to={x.url} end={x.url==='/'} className={({isActive})=>'flex gap-3 items-center px-4 py-3.5 rounded-xl text-[12px] font-bold transition-all '+(isActive?'bg-[#2c3f64] text-white shadow-[inset_3px_0_0_#4a90ff]':'text-[#9daeca] hover:text-white hover:bg-white/5')}>
              <Icon size={18}/>{x.label}
            </NavLink>;
          })}
        </nav>
        <div className="m-4 mt-6 rounded-2xl bg-[#1b2a47] p-4 border border-white/5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#45669e] text-white flex items-center justify-center"><UserCog size={20}/></div>
            <div className="min-w-0">
              <div className="text-white font-bold text-xs truncate">{user.username}</div>
              <div className="text-[#8fa6c9] text-[10px] mt-1">{roleLabel[user.role]||user.role}</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="rounded-xl bg-white/5 hover:bg-white/10 text-[#c5d4ea] text-[10px] font-extrabold py-2 px-2 flex items-center justify-center gap-1" onClick={()=>setPwdOpen(true)}>
              <KeyRound size={13}/> كلمة المرور
            </button>
            <button type="button" className="rounded-xl bg-white/5 hover:bg-white/10 text-[#c5d4ea] text-[10px] font-extrabold py-2 px-2 flex items-center justify-center gap-1" onClick={onLogout}>
              <LogOut size={13}/> خروج
            </button>
          </div>
        </div>
      </aside>
      {mobile&&<div className="no-print fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={()=>setMobile(false)}/>}
      <div className="min-w-0 flex-1 flex flex-col">
        <header className="no-print sticky top-0 z-20 h-[77px] bg-white/90 backdrop-blur-xl border-b border-[#e9edf4] flex items-center justify-between px-5 sm:px-8 gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <button className="lg:hidden" onClick={()=>setMobile(true)} aria-label="القائمة"><Menu size={22}/></button>
            <div className="min-w-0">
              <div className="text-[11px] text-[#9babc0]">الصفحة الرئيسية /</div>
              <div className="text-[#243a5b] font-black text-sm truncate">{current.label}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="hidden md:flex items-center gap-2 rounded-full bg-[#f1f8f5] text-[#13815e] px-3 py-2 text-[11px] font-extrabold">
              <span className="w-2 h-2 rounded-full bg-[#23b07f]"/>نظام الاشتراكات
            </div>
            <Link to="/members" className="w-10 h-10 rounded-xl bg-[#f1f5fb] flex items-center justify-center text-[#6581b3]" title="بحث الأعضاء" aria-label="بحث الأعضاء">
              <Search size={18}/>
            </Link>
            <UserMenu user={user} onLogout={onLogout} onChangePassword={()=>setPwdOpen(true)}/>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-8 max-w-[1500px] w-full mx-auto">
          <Routes>
            <Route path="/" element={<Gate perm="read"><Dashboard/></Gate>}/>
            <Route path="/members" element={<Gate perm="read"><Members/></Gate>}/>
            <Route path="/members/:id" element={<Gate perm="read"><MemberDetail/></Gate>}/>
            <Route path="/renewals" element={<Gate perm="finance"><Renewals/></Gate>}/>
            <Route path="/finance" element={<Gate perm="finance"><Finance/></Gate>}/>
            <Route path="/blocked" element={<Gate perm="read"><Blocked/></Gate>}/>
            <Route path="/pricing" element={<Gate perm="fees"><Pricing/></Gate>}/>
            <Route path="/reports" element={<Gate perm="reports"><Reports/></Gate>}/>
            <Route path="/admin" element={<Gate perm="users"><Admin/></Gate>}/>
            <Route path="/admin/card-design" element={<Gate perm="users"><CardDesign/></Gate>}/>
            <Route path="*" element={<Card>الصفحة غير موجودة <Link to="/" className="text-blue">العودة للرئيسية</Link></Card>}/>
          </Routes>
        </main>
        <footer className="no-print px-8 py-4 border-t border-[#e8edf5] text-[11px] text-[#9ba8ba] flex justify-between">
          <span>منظومة إدارة العضويات • إصدار 1.0</span>
          <span>جميع العمليات المالية مؤرشفة</span>
        </footer>
      </div>
    </div>
    <ChangePasswordModal open={pwdOpen} onClose={()=>setPwdOpen(false)} notify={notify}/>
  </Context.Provider>;
}

function App(){
  const [user,setUser]=useState(null),[boot,setBoot]=useState(true);
  const {notify,node}=useToast();
  useEffect(()=>{
    api('/auth/me').then(x=>setUser(x.user)).catch(()=>setUser(null)).finally(()=>setBoot(false));
    const f=()=>setUser(null);
    window.addEventListener('auth-lost',f);
    return ()=>window.removeEventListener('auth-lost',f);
  },[]);
  async function logout(){
    try{await api('/auth/logout',{method:'POST'});}catch{}
    setUser(null);
    queryClient.clear();
  }
  return <QueryClientProvider client={queryClient}>
    {boot
      ? <div className="min-h-screen grid place-content-center text-center"><Activity size={36} className="mx-auto text-blue animate-pulse"/><p className="mt-4 text-sm">جاري تحميل المنظومة...</p></div>
      : user
        ? <Shell user={user} onLogout={logout} notify={notify}/>
        : <Login onLogin={setUser}/>}
    {node}
  </QueryClientProvider>;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
