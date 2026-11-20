import React, { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { Button, ErrorBox } from './ui';

/**
 * Upload a card brand image (logo / background) to the server and bind the returned URL.
 * kind: logo | background | back-background | back-logo
 */
export default function CardImageField({ label, hint, kind, value, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const out = await api('/card-assets', { method: 'POST', form: fd });
      onChange(out.url);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await api('/card-assets/' + encodeURIComponent(kind), { method: 'DELETE' }).catch(() => {});
      onChange(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-extrabold text-[#395171]">{label}</div>
      {hint && <p className="text-[11px] muted leading-6">{hint}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-20 h-20 rounded-xl border border-[#d8e2f0] bg-[#f7f9fc] overflow-hidden flex items-center justify-center">
          {value ? (
            <img src={value} alt="" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-[10px] muted text-center px-1">لا توجد صورة</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp"
            className="max-w-[220px] text-xs"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <Button variant="outline" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
            <ImagePlus size={14} /> رفع صورة
          </Button>
          {value && (
            <Button variant="danger" size="sm" disabled={busy} onClick={clear}>
              <Trash2 size={14} /> إزالة
            </Button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
