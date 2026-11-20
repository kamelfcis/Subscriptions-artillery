import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CreditCard, Minus, Plus, RotateCcw, Save } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../main';
import { Button, Card, ErrorBox, FormInput, Loading } from '../components/ui';
import ColorField from '../components/ColorField';
import { renderCard } from '../components/CardPrinter';
import { getAt, getDefaultCardTemplate, mergeCardTemplate, setAt } from '../card-template-utils.js';

const sampleMember = {
  IdClient: '3659',
  Name: 'رضوى مصطفى قطرى',
  jop: 'ابناء',
  ends: '2026-12-31',
};

const FONT_PRESETS = [
  { value: 'bold 30px Arial, Tahoma, sans-serif', label: 'حقل 30' },
  { value: 'bold 28px Arial, Tahoma, sans-serif', label: 'حقل 28' },
  { value: 'bold 17px Arial, Tahoma, sans-serif', label: 'توقيع 17' },
  { value: 'bold 18px Arial, Tahoma, sans-serif', label: 'توقيع 18' },
  { value: 'bold 22px Cairo, Arial', label: 'نص 22' },
];

const frontFields = [
  {
    section: 'أبعاد البطاقة ومنطقة البياض (CR80)',
    items: [
      { path: ['width'], label: 'العرض (بكسل)', type: 'number', step: 1 },
      { path: ['height'], label: 'الارتفاع (بكسل)', type: 'number', step: 1 },
      { path: ['contentTop'], label: 'بداية المنطقة البيضاء (Y)', type: 'number', step: 1 },
    ],
  },
  {
    section: 'الصورة الشخصية (يسار)',
    items: [
      { path: ['photo', 'x'], label: 'X', type: 'number', step: 1 },
      { path: ['photo', 'y'], label: 'Y', type: 'number', step: 1 },
      { path: ['photo', 'w'], label: 'العرض', type: 'number', step: 1 },
      { path: ['photo', 'h'], label: 'الارتفاع', type: 'number', step: 1 },
    ],
  },
  {
    section: 'حقول البيانات (يمين — سطر واحد: تسمية: قيمة)',
    items: [
      { path: ['rank', 'label'], label: 'تسمية الرتبة (مع التفصيلة)', type: 'text' },
      { path: ['rank', 'xFromRight'], label: 'X الرتبة من اليمين', type: 'number', step: 1 },
      { path: ['rank', 'y'], label: 'Y الرتبة', type: 'number', step: 1 },
      { path: ['rank', 'font'], label: 'خط الرتبة', type: 'font' },
      { path: ['name', 'label'], label: 'تسمية الاسم (مع التفصيلة)', type: 'text' },
      { path: ['name', 'xFromRight'], label: 'X الاسم من اليمين', type: 'number', step: 1 },
      { path: ['name', 'y'], label: 'Y الاسم', type: 'number', step: 1 },
      { path: ['name', 'font'], label: 'خط الاسم', type: 'font' },
      { path: ['job', 'label'], label: 'تسمية الوظيفة (VIP)', type: 'text' },
      { path: ['job', 'xFromRight'], label: 'X الوظيفة من اليمين', type: 'number', step: 1 },
      { path: ['job', 'y'], label: 'Y الوظيفة (VIP — مكان الرقم)', type: 'number', step: 1 },
      { path: ['job', 'font'], label: 'خط الوظيفة', type: 'font' },
      { path: ['number', 'label'], label: 'تسمية رقم العضوية', type: 'text' },
      { path: ['number', 'xFromRight'], label: 'X الرقم من اليمين', type: 'number', step: 1 },
      { path: ['number', 'y'], label: 'Y الرقم', type: 'number', step: 1 },
      { path: ['number', 'font'], label: 'خط الرقم', type: 'font' },
      { path: ['expiry', 'label'], label: 'تسمية الانتهاء', type: 'text' },
      { path: ['expiry', 'xFromRight'], label: 'X الانتهاء من اليمين', type: 'number', step: 1 },
      { path: ['expiry', 'y'], label: 'Y الانتهاء', type: 'number', step: 1 },
      { path: ['expiry', 'font'], label: 'خط الانتهاء', type: 'font' },
    ],
  },
  {
    section: 'التوقيع تحت الصورة',
    items: [
      { path: ['signature', 'show'], label: 'إظهار التوقيع', type: 'checkbox' },
      { path: ['signature', 'x'], label: 'X (مركز النص)', type: 'number', step: 1 },
      { path: ['signature', 'y'], label: 'Y السطر الأول', type: 'number', step: 1 },
      { path: ['signature', 'lineHeight'], label: 'تباعد الأسطر', type: 'number', step: 1 },
      { path: ['signature', 'font'], label: 'الخط', type: 'font' },
      { path: ['signature', 'color'], label: 'اللون', type: 'color' },
      { path: ['signature', 'lines', 0], label: 'السطر 1', type: 'text' },
      { path: ['signature', 'lines', 1], label: 'السطر 2', type: 'text' },
    ],
  },
];

function NumberNudge({ label, value, step = 1, onChange }) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return (
    <div>
      <label className="block text-xs font-extrabold text-[#395171] mb-1.5">{label}</label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="h-10 w-10 rounded-xl border border-[#d8e2f0] bg-white text-[#395171] flex items-center justify-center"
          onClick={() => onChange(safe - step)}
          aria-label="نقص"
        >
          <Minus size={14} />
        </button>
        <input
          className="min-w-0 flex-1"
          type="number"
          value={Number.isFinite(n) ? n : ''}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
        <button
          type="button"
          className="h-10 w-10 rounded-xl border border-[#d8e2f0] bg-white text-[#395171] flex items-center justify-center"
          onClick={() => onChange(safe + step)}
          aria-label="زيادة"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function FieldRow({ field, draft, setDraft }) {
  const val = getAt(draft, field.path);
  const key = field.path.join('.');
  if (field.type === 'color') {
    return (
      <ColorField
        key={key}
        label={field.label}
        value={val ?? ''}
        onChange={(x) => setDraft((d) => setAt(d, field.path, x))}
      />
    );
  }
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 min-h-10 text-sm font-bold text-[#395171]">
        <input type="checkbox" checked={!!val} onChange={(e) => setDraft(setAt(draft, field.path, e.target.checked))} />
        {field.label}
      </label>
    );
  }
  if (field.type === 'font') {
    const opts = FONT_PRESETS.slice();
    if (val && !opts.some((x) => x.value === val)) opts.unshift({ value: val, label: `الحالي: ${val}` });
    return (
      <div className="space-y-2">
        <FormInput label={field.label} value={val ?? ''} onChange={(x) => setDraft(setAt(draft, field.path, x))} options={opts} />
        <input
          className="field text-[11px]"
          value={val ?? ''}
          onChange={(e) => setDraft(setAt(draft, field.path, e.target.value))}
          placeholder="أو اكتب قيمة الخط يدوياً"
        />
      </div>
    );
  }
  if (field.type === 'number') {
    return (
      <NumberNudge
        label={field.label}
        value={val}
        step={field.step || 1}
        onChange={(x) => setDraft((d) => setAt(d, field.path, x))}
      />
    );
  }
  return (
    <FormInput
      label={field.label}
      type="text"
      value={val ?? ''}
      onChange={(x) => setDraft(setAt(draft, field.path, x))}
    />
  );
}

function DesignSection({ sec, draft, setDraft }) {
  return (
    <Card>
      <h2 className="font-black text-sm mb-4">{sec.section}</h2>
      <div className="input-grid">
        {sec.items.map((f) => (
          <FieldRow key={f.path.join('.')} field={f} draft={draft} setDraft={setDraft} />
        ))}
      </div>
    </Card>
  );
}

export default function CardDesign() {
  const { user, notify } = useApp();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';
  const q = useQuery({ queryKey: ['card-template'], queryFn: () => api('/card-template'), enabled: isAdmin });
  const [draft, setDraft] = useState(getDefaultCardTemplate());
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (q.data?.template) setDraft(mergeCardTemplate(q.data.template));
  }, [q.data]);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      const c = document.createElement('canvas');
      (async () => {
        try {
          const live = mergeCardTemplate({
            ...draft,
            duplex: false,
            overlay: true,
            backSide: { ...(draft.backSide || {}), enabled: false },
          });
          const front = await renderCard(c, sampleMember, null, live, {
            previewChrome: true,
            expiryDate: sampleMember.ends,
          });
          if (!cancelled) setPreview(front);
        } catch {
          if (!cancelled) setPreview('');
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [draft]);

  if (!isAdmin) return <Card>تصميم الكارنيه متاح لمدير النظام فقط.</Card>;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...draft,
        duplex: false,
        overlay: true,
        backSide: { ...(draft.backSide || getDefaultCardTemplate().backSide), enabled: false },
      };
      await api('/card-template', { method: 'PUT', body: { template: payload } });
      notify('تم حفظ تصميم الكارنيه (وجه أمامي فقط — الظهر مطبوع مسبقاً)');
      qc.invalidateQueries({ queryKey: ['card-template'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="mb-4">
        <Link to="/admin" className="flex items-center gap-2 font-bold text-blue text-xs">
          <ArrowRight size={15} /> العودة لإعدادات النظام
        </Link>
      </p>
      <div className="section-head">
        <div>
          <div className="eyebrow">CR80 • طباعة على كرت مطبوع مسبقاً</div>
          <h1>تصميم كارنيه العضوية</h1>
          <p>
            الرأس والظهر مطبوعان على الكرت مسبقاً. اضبط مواضع الصورة والحقول والتوقيع داخل المنطقة البيضاء فقط — المعاينة تُظهر رأسًا تجريبيًا للمحاذاة ولا يُطبع.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setDraft(getDefaultCardTemplate())}>
            <RotateCcw size={15} /> استعادة الافتراضي
          </Button>
          <Button loading={busy} onClick={save}>
            <Save size={15} /> حفظ التصميم
          </Button>
        </div>
      </div>
      <ErrorBox error={error} />
      {q.data?.source === 'database' && (
        <p className="text-xs muted mb-4">
          آخر حفظ: {q.data.updated_by || '—'} • {q.data.updated_at ? new Date(q.data.updated_at).toLocaleString('ar-EG') : '—'}
        </p>
      )}
      <div className="grid xl:grid-cols-[1fr_420px] gap-5">
        {q.isLoading ? (
          <Loading />
        ) : (
          <>
            <div className="space-y-4">
              <Card className="bg-[#f7f9fc] border border-[#e7ebf3]">
                <p className="text-xs leading-6 text-[#4a5f7d]">
                  الوجه الخلفي (توت عنخ آمون + QR) مطبوع مسبقاً على المخزون ولا يُرسل للطابعة من النظام.
                </p>
              </Card>
              {frontFields.map((sec) => (
                <DesignSection key={sec.section} sec={sec} draft={draft} setDraft={setDraft} />
              ))}
            </div>
            <Card className="xl:sticky xl:top-24 h-fit">
              <h2 className="font-black text-sm mb-3 flex gap-2 items-center">
                <CreditCard size={18} className="text-blue" /> معاينة الوجه الأمامي
              </h2>
              {preview ? (
                <img src={preview} alt="معاينة الأمام" className="rounded-xl w-full shadow-lift" />
              ) : (
                <div className="shimmer aspect-[1.59] rounded-xl" />
              )}
              <p className="text-[11px] muted mt-3 leading-6">
                المعاينة ببيانات تجريبية. عند الطباعة الفعلية يُحذف رأس المعاينة التجريبي وتُطبع الحقول على البياض فقط.
              </p>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
