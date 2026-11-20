const fs = require('fs');
const p = 'web/src/pages/Members.jsx';
let s = fs.readFileSync(p, 'utf8');

const replacements = [
  // Attachment thumb instead of FileText icon
  [
    '<FileText size={22} className="text-blue"/>',
    '<AttachmentThumb file={f} onClick={()=>setFileView(f)}/>',
  ],
  // Hard-delete file button
  [
    `{canWrite&&<Button size="sm" variant="danger" onClick={async()=>{if(!confirm('أرشفة المرفق؟'))return;try{await api('/files/'+f.id,{method:'DELETE'});qc.invalidateQueries({queryKey:['files',id]})}catch(e){setError(e)}}}>أرشفة</Button>}`,
    `{canWrite&&<Button size="sm" variant="danger" onClick={async()=>{if(!confirm('حذف نهائي لهذا المرفق؟ لا يمكن التراجع عن هذا الإجراء.'))return;try{await api('/files/'+f.id,{method:'DELETE'});qc.invalidateQueries({queryKey:['files',id]});notify('تم الحذف النهائي للمرفق')}catch(e){setError(e)}}}>حذف نهائي</Button>}`,
  ],
  // Dependents tab: hard delete instead of archive/restore
  [
    `{canWrite&&<Button variant="danger" size="sm" onClick={()=>toggleArchive(x.archived?'/dependents/'+x.id+'/restore':'/dependents/'+x.id,!x.archived)}>{x.archived?'استعادة':'أرشفة'}</Button>}`,
    `{canWrite&&<Button variant="danger" size="sm" onClick={async()=>{if(!confirm('حذف نهائي للتابع «'+x.Name+'»؟ سيُحذف التابع وتجديداته وأهليته نهائياً ولا يمكن التراجع.'))return;try{await api('/dependents/'+x.id,{method:'DELETE'});refresh();notify('تم الحذف النهائي للتابع')}catch(e){setError(e)}}}>حذف نهائي</Button>}`,
  ],
  // Officer edit form callback
  [
    `onArchiveDep={x=>toggleArchive(x.archived?'/dependents/'+x.id+'/restore':'/dependents/'+x.id,!x.archived)}`,
    `onDeleteDep={async x=>{if(!confirm('حذف نهائي للتابع «'+x.Name+'»؟ سيُحذف التابع وتجديداته وأهليته نهائياً ولا يمكن التراجع.'))return;try{await api('/dependents/'+x.id,{method:'DELETE'});refresh();notify('تم الحذف النهائي للتابع')}catch(e){setError(e)}}}`,
  ],
];

for (const [from, to] of replacements) {
  if (!s.includes(from)) {
    console.error('MISSING:', from.slice(0, 80));
    process.exit(1);
  }
  s = s.replace(from, to);
}

fs.writeFileSync(p, s);
console.log('patched ok');
