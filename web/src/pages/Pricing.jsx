import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusCircle, AlertCircle, Edit3, Trash2, Search } from 'lucide-react';
import { api, params } from '../api';
import { useApp } from '../main';
import { can } from '../rbac';
import {
  Button,
  Card,
  Tag,
  Modal,
  FormGrid,
  Table,
  Loading,
  ErrorBox,
  Pager,
  useDebounced,
} from '../components/ui';

const pricefields = ['Cat', 'Jop', 'RDar', 'RElnada'].map((k) => ({
  key: k,
  label: {
    Cat: 'الفئة',
    Jop: 'الوظيفة',
    RDar: 'تجديد الدار',
    RElnada: 'بدل فاقد',
  }[k],
}));

export default function Pricing() {
  const { notify, user } = useApp();
  const canFees = can(user.role, 'fees');
  const qc = useQueryClient();
  const [tab, setTab] = useState('prices');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editLegacy, setEditLegacy] = useState(null);
  const [v, setV] = useState({});
  const debounced = useDebounced(search, 320);

  const legacy = useQuery({
    queryKey: ['legacy-prices', debounced, page, pageSize],
    queryFn: () => api('/legacy/prices' + params({ search: debounced, page, pageSize })),
  });
  const services = useQuery({ queryKey: ['services'], queryFn: () => api('/services') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings') });
  const [lostDefault, setLostDefault] = useState('50');
  const lostSetting = (settings.data || []).find((s) => s.setting_key === 'lost_card_fee_default');
  useEffect(() => {
    if (lostSetting?.setting_value != null) setLostDefault(String(lostSetting.setting_value));
  }, [lostSetting?.setting_value]);
  const saveLostDefault = useMutation({
    mutationFn: (value) => api('/settings/lost_card_fee_default', { method: 'PATCH', body: { value } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      notify('تم حفظ رسوم بدل فاقد الافتراضية');
    },
    onError: (e) => notify(e?.message || 'تعذر الحفظ'),
  });

  const save = useMutation({
    mutationFn: ({ route, method, body }) => api(route, { method, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['legacy-prices'] });
      setEditLegacy(null);
      notify('تم تحديث قائمة الأسعار');
    },
  });

  const remove = useMutation({
    mutationFn: (id) => api('/legacy/prices/' + id, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['legacy-prices'] });
      notify('تم حذف السعر نهائياً');
    },
    onError: (e) => notify(e?.message || 'تعذر حذف السعر'),
  });

  function openNewPriceRow() {
    setEditLegacy({});
    setV({ Cat: '', Jop: '', RDar: '', RElnada: '' });
  }

  function confirmDelete(row) {
    const label =
      [row.IdPrice, row.Cat, row.Jop, row.RDar].filter(Boolean).join(' / ') || '#' + row.id;
    if (
      !confirm(
        'حذف نهائي لسعر «' +
          label +
          '»؟ سيتم حذف الصف من قائمة الأسعار نهائياً ولا يمكن التراجع.',
      )
    ) {
      return;
    }
    remove.mutate(row.id);
  }

  return (
    <>
      <div className="section-head">
        <div>
          <div className="eyebrow">سجل أسعار مؤرخ غير قابل لإعادة كتابة التاريخ</div>
          <h1>الأسعار والفئات</h1>
          <p>أسعار التجديد الجديدة تُحفظ حسب تاريخ السريان؛ وتظل الأسعار القديمة منفصلة كما هي.</p>
        </div>
        {canFees && (
          <Button onClick={openNewPriceRow}>
            <PlusCircle size={16} /> إضافة سعر
          </Button>
        )}
      </div>

      <Card className="mb-4 !border-[#fae8bc] bg-[#fffcf5]">
        <div className="text-sm text-[#98753e] flex gap-2 items-start leading-relaxed font-bold">
          <AlertCircle size={18} className="shrink-0" />
          الأسعار التاريخية لم تتم تسويتها تلقائياً من 2023. لا يتم تفعيل تجديد مدفوع إلا بعد إنشاء
          السعر الحالي المعتمد، وبدون تغيير الفواتير السابقة.
        </div>
      </Card>

      <div className="flex gap-2 mb-5 flex-wrap">
        <button
          type="button"
          className={'small-action ' + (tab === 'prices' ? '!bg-blue !text-white' : '')}
          onClick={() => setTab('prices')}
        >
          قائمة الأسعار (PriceList)
        </button>
        <button
          type="button"
          className={'small-action ' + (tab === 'codes' ? '!bg-blue !text-white' : '')}
          onClick={() => setTab('codes')}
        >
          الأكواد والخدمات
        </button>
      </div>

      {tab === 'prices' && (
        <Card className="pricing-desk">
          <p className="text-sm text-[#456] mb-4 leading-6 font-bold">
            الفئات والأسعار من هنا — تجديد العضوية يعتمد على «تجديد الدار» (RDar) ورسوم «بدل فاقد»
            (RElnada) بحسب الفئة والوظيفة. كود السعر يُولَّد تلقائياً.
          </p>
          {canFees && (
            <div className="mb-5 rounded-2xl border border-[#dbe5f5] bg-white p-4 flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <label className="text-xs font-black text-[#456] block mb-1">
                  رسوم بدل فاقد الافتراضية (ج.م)
                </label>
                <input
                  className="field"
                  type="number"
                  min="0"
                  step="0.01"
                  value={lostDefault}
                  onChange={(e) => setLostDefault(e.target.value)}
                />
                <p className="text-[11px] muted mt-1 leading-5">
                  تُستخدم عندما لا يوجد سعر RElnada للفئة/الوظيفة في القائمة (الافتراضي 50 ج.م).
                </p>
              </div>
              <Button
                loading={saveLostDefault.isPending}
                onClick={() => saveLostDefault.mutate(lostDefault)}
              >
                حفظ الافتراضي
              </Button>
            </div>
          )}
          <div className="relative mb-5">
            <Search size={18} className="absolute top-3.5 right-4 muted" />
            <input
              className="field !pr-11 text-base"
              placeholder="بحث بالفئة أو الوظيفة أو كود السعر أو تجديد الدار..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <ErrorBox error={legacy.error} />
          {legacy.isLoading ? (
            <Loading />
          ) : (
            <>
              <Table
                heads={['كود السعر', 'الفئة', 'الوظيفة', 'تجديد الدار', 'بدل فاقد', 'إجراءات']}
                rows={legacy.data?.items || []}
                render={(x) => (
                  <>
                    <td className="text-base font-extrabold text-[#1f4fbf]">{x.IdPrice || '—'}</td>
                    <td className="text-base font-bold">{x.Cat}</td>
                    <td className="text-base font-bold">{x.Jop}</td>
                    <td className="text-base font-bold">{x.RDar}</td>
                    <td className="text-base font-bold">{x.RElnada ?? '—'}</td>
                    <td>
                      {canFees ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditLegacy(x);
                              setV({
                                Cat: x.Cat ?? '',
                                Jop: x.Jop ?? '',
                                RDar: x.RDar ?? '',
                                RElnada: x.RElnada ?? '',
                              });
                            }}
                          >
                            <Edit3 size={14} />
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={remove.isPending}
                            onClick={() => confirmDelete(x)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </>
                )}
              />
              <Pager
                data={legacy.data}
                setPage={setPage}
                pageSize={pageSize}
                setPageSize={setPageSize}
              />
            </>
          )}
        </Card>
      )}

      {tab === 'codes' && (
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {services.data?.map((x) => (
            <Card key={x.code}>
              <div className="stat-value text-blue">{x.code}</div>
              <div className="font-black text-sm mt-1">{x.label}</div>
              <Tag tone={x.active ? 'green' : 'red'} className="mt-3">
                {x.active ? 'مفعل' : 'موقوف'}
              </Tag>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={editLegacy !== null}
        onClose={() => setEditLegacy(null)}
        title={editLegacy?.id ? 'تعديل الفئة والأسعار' : 'إضافة فئة وأسعار'}
      >
        <div className="pricing-desk">
          {editLegacy?.id && editLegacy?.IdPrice != null && editLegacy?.IdPrice !== '' && (
            <p className="text-sm mb-3 text-[#456] font-bold">
              كود السعر: <span className="text-base text-[#1f4fbf]">{editLegacy.IdPrice}</span>
              <span className="muted font-semibold"> (للقراءة فقط)</span>
            </p>
          )}
          <ErrorBox error={save.error} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const body = Object.fromEntries(pricefields.map((f) => [f.key, v[f.key] ?? null]));
              save.mutate({
                route: editLegacy?.id ? '/legacy/prices/' + editLegacy.id : '/legacy/prices',
                method: editLegacy?.id ? 'PATCH' : 'POST',
                body,
              });
            }}
          >
            <FormGrid schema={pricefields} values={v} onChange={setV} />
            <Button className="w-full mt-4 text-base" loading={save.isPending}>
              حفظ
            </Button>
          </form>
        </div>
      </Modal>
    </>
  );
}
