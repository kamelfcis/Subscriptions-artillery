import React,{useEffect,useRef,useState} from 'react';
import {Printer,Download,FileText,Loader2} from 'lucide-react';
import {Modal,Button,ErrorBox} from './ui';

const BASE=import.meta.env.VITE_API_BASE||'/api';

export function isImage(mime){return !!mime&&mime.startsWith('image/');}
export function isPdf(mime){return mime==='application/pdf';}

/** Small list thumbnail: images show a 48×48 preview; PDF/other/fail → FileText. */
export function AttachmentThumb({file,onClick,className=''}){
  const [blobUrl,setBlobUrl]=useState(null);
  const [mime,setMime]=useState('');
  useEffect(()=>{
    if(!file?.id||file.archived){
      setBlobUrl(null);setMime('');
      return;
    }
    let alive=true;
    let objectUrl=null;
    const ctrl=new AbortController();
    (async()=>{
      try{
        const res=await fetch(`${BASE}/files/${file.id}/content`,{credentials:'same-origin',signal:ctrl.signal});
        if(!res.ok)throw new Error('load failed');
        const blob=await res.blob();
        if(!alive)return;
        objectUrl=URL.createObjectURL(blob);
        setMime(blob.type||res.headers.get('Content-Type')||'');
        setBlobUrl(objectUrl);
      }catch(e){
        if(e.name==='AbortError')return;
        if(alive){setBlobUrl(null);setMime('');}
      }
    })();
    return()=>{
      alive=false;
      ctrl.abort();
      if(objectUrl)URL.revokeObjectURL(objectUrl);
    };
  },[file?.id,file?.archived]);

  const showImg=blobUrl&&isImage(mime);
  return (
    <button
      type="button"
      className={`shrink-0 w-12 h-12 rounded-xl overflow-hidden grid place-content-center bg-[#eaf1fb] text-blue border-0 p-0 cursor-pointer ${className}`}
      onClick={onClick}
      title={file?.discip||'عرض المرفق'}
      aria-label={file?.discip||'عرض المرفق'}
    >
      {showImg
        ?<img src={blobUrl} alt="" className="w-full h-full object-cover"/>
        :<FileText size={22}/>}
    </button>
  );
}

export default function FilePreview({file,onClose}){
  const open=!!file;
  const [blobUrl,setBlobUrl]=useState(null);
  const [mime,setMime]=useState('');
  const [error,setError]=useState(null);
  const [loading,setLoading]=useState(false);
  const iframeRef=useRef(null);
  const printAreaRef=useRef(null);

  useEffect(()=>{
    if(!file?.id){
      setBlobUrl(null);setMime('');setError(null);setLoading(false);
      return;
    }
    let alive=true;
    let objectUrl=null;
    const ctrl=new AbortController();
    (async()=>{
      setLoading(true);setError(null);setBlobUrl(null);setMime('');
      try{
        const res=await fetch(`${BASE}/files/${file.id}/content`,{credentials:'same-origin',signal:ctrl.signal});
        if(!res.ok){
          let msg=`تعذر تحميل المرفق (${res.status})`;
          if(res.status===404)msg='الملف غير موجود';
          if(res.status===415)msg='نوع الملف غير مدعوم للمعاينة';
          throw new Error(msg);
        }
        const blob=await res.blob();
        if(!alive)return;
        objectUrl=URL.createObjectURL(blob);
        setMime(blob.type||res.headers.get('Content-Type')||'');
        setBlobUrl(objectUrl);
      }catch(e){
        if(e.name==='AbortError')return;
        if(alive)setError(e);
      }finally{
        if(alive)setLoading(false);
      }
    })();
    return()=>{
      alive=false;
      ctrl.abort();
      if(objectUrl)URL.revokeObjectURL(objectUrl);
    };
  },[file?.id]);

  const filename=file?.discip||`مرفق #${file?.id||''}`;
  const title=`عرض المرفق — ${filename}`;

  function handlePrint(){
    if(isPdf(mime)&&iframeRef.current?.contentWindow){
      try{
        iframeRef.current.contentWindow.focus();
        iframeRef.current.contentWindow.print();
        return;
      }catch{/* fall through */}
    }
    document.body.classList.add('printing-file-preview');
    const cleanup=()=>{
      document.body.classList.remove('printing-file-preview');
      window.removeEventListener('afterprint',cleanup);
    };
    window.addEventListener('afterprint',cleanup);
    window.print();
    // Fallback if afterprint never fires
    setTimeout(cleanup,1500);
  }

  function handleDownload(){
    if(!blobUrl)return;
    const a=document.createElement('a');
    a.href=blobUrl;
    const ext=isPdf(mime)?'pdf':isImage(mime)?(mime.split('/')[1]||'img'):'bin';
    a.download=`${filename}.${ext}`;
    a.click();
  }

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="file-preview" dir="rtl">
        <div className="file-preview-meta no-print text-[11px] muted mb-3 flex flex-wrap gap-2 items-center">
          <span className="font-extrabold text-ink">{filename}</span>
          {file?.document_type&&<span>• {file.document_type}</span>}
          {mime&&<span dir="ltr" className="font-mono">• {mime}</span>}
        </div>

        <ErrorBox error={error}/>

        <div ref={printAreaRef} className="file-preview-print-root rounded-2xl border border-[#e7ebf3] bg-[#f7f9fc] overflow-hidden min-h-[280px] grid place-items-center">
          {loading&&(
            <div className="flex flex-col items-center gap-2 text-[#6b7c94] py-16 no-print">
              <Loader2 size={28} className="animate-spin text-blue"/>
              <span className="text-xs font-bold">جاري تحميل المرفق…</span>
            </div>
          )}
          {!loading&&!error&&blobUrl&&isImage(mime)&&(
            <img src={blobUrl} alt={filename} className="file-preview-img max-h-[min(62vh,640px)] max-w-full object-contain p-3"/>
          )}
          {!loading&&!error&&blobUrl&&isPdf(mime)&&(
            <iframe
              ref={iframeRef}
              title={filename}
              src={blobUrl}
              className="file-preview-frame w-full h-[min(62vh,640px)] border-0 bg-white"
            />
          )}
          {!loading&&!error&&blobUrl&&!isImage(mime)&&!isPdf(mime)&&(
            <div className="text-center py-14 px-6 space-y-3">
              <FileText size={40} className="mx-auto text-blue"/>
              <p className="text-sm font-bold text-ink">لا يمكن معاينة هذا النوع داخل الصفحة</p>
              <p className="text-xs muted">يمكنك تنزيل الملف ثم فتحه من جهازك.</p>
              <Button variant="outline" size="sm" onClick={handleDownload} className="no-print">
                <Download size={14}/> تنزيل الملف
              </Button>
            </div>
          )}
        </div>

        <div className="file-preview-actions no-print mt-4 flex flex-wrap gap-2 justify-between items-center">
          <div className="flex flex-wrap gap-2">
            <Button onClick={handlePrint} disabled={loading||!!error||!blobUrl}>
              <Printer size={15}/> طباعة
            </Button>
            {blobUrl&&(
              <Button variant="outline" onClick={handleDownload} disabled={loading}>
                <Download size={15}/> تنزيل
              </Button>
            )}
          </div>
          <Button variant="soft" onClick={onClose}>إغلاق</Button>
        </div>
      </div>
    </Modal>
  );
}
