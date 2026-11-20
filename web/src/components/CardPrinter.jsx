import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Printer, RefreshCcw } from 'lucide-react';
import { Modal, Button, FormInput, ErrorBox } from './ui';
import { api } from '../api';
import { useApp } from '../main';
import defaultTemplate from '../card-template.json';
import { mergeCardTemplate, getDefaultCardTemplate } from '../card-template-utils.js';
import { PDF_PRINTER, choosePrinter } from '../print-choice.js';
import { cardOverlayLines, cardPhotoSlots, overlayTextMaxWidth } from '../card-vip.js';

// LAN print host: set VITE_PRINT_AGENT_URL=http://<server-ip>:5678 in web/.env.local
const agent = (import.meta.env.VITE_PRINT_AGENT_URL || 'http://127.0.0.1:5678').replace(/\/$/, '');
const PRINT_KEY_STORAGE = 'subscriptions_print_agent_key';

function initialPrintAgentKey() {
  try {
    const saved = sessionStorage.getItem(PRINT_KEY_STORAGE);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return String(import.meta.env.VITE_PRINT_AGENT_KEY || '').trim();
}

const img = async (source) =>
  new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = source;
  });

const makeQr = async (text) =>
  img(
    await QRCode.toDataURL(text, {
      width: 140,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#183b69', light: '#ffffffff' },
    }),
  );

async function loadPhoto(url) {
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) return null;
    const blob = await r.blob();
    const object = URL.createObjectURL(blob);
    try {
      return await img(object);
    } finally {
      URL.revokeObjectURL(object);
    }
  } catch {
    return null;
  }
}

async function loadBgImage(url) {
  if (!url) return null;
  try {
    return await img(url);
  } catch {
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) return null;
      const blob = await r.blob();
      const object = URL.createObjectURL(blob);
      try {
        return await img(object);
      } finally {
        URL.revokeObjectURL(object);
      }
    } catch {
      return null;
    }
  }
}

/** DD-MM-YYYY to match printed sample cards. */
export function formatCardDate(value) {
  if (!value) return '—';
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10) || '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function businessTodayIso() {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: typeof import.meta !== 'undefined' && import.meta.env?.VITE_BUSINESS_TIME_ZONE
      ? import.meta.env.VITE_BUSINESS_TIME_ZONE
      : 'Africa/Cairo',
  });
  return f.format(new Date());
}

function renewalCoversToday(row, today) {
  if (row?.status && row.status !== 'ACTIVE') return false;
  const end = String(row?.ends || row?.term_to || '').slice(0, 10);
  const start = String(row?.from || row?.term_from || '').slice(0, 10);
  return !!end && end >= today && (!start || start <= today);
}

export async function resolveCardExpiry(member, dependent) {
  if (member?.card_expires || member?.ends || member?.term_to) {
    return member.card_expires || member.ends || member.term_to;
  }
  if (dependent?.active_term_to) return dependent.active_term_to;
  const today = businessTodayIso();
  try {
    const items = await api('/members/' + encodeURIComponent(member.IdClient) + '/subscriptions');
    const list = Array.isArray(items) ? items : [];
    const matched = list.filter((x) =>
      dependent ? Number(x.dependent_id) === Number(dependent.id) : x.dependent_id == null,
    );
    const pool = matched.length ? matched : list;
    const covering = pool.filter((x) => renewalCoversToday(x, today));
    const ranked = (covering.length ? covering : pool).slice().sort((a, b) => String(b.ends || '').localeCompare(String(a.ends || '')));
    return ranked[0]?.ends || null;
  } catch {
    return null;
  }
}

export async function paintBackground(ctx, w, h, layout, { previewChrome = false } = {}) {
  const overlay = layout.overlay !== false;
  if (overlay) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    if (previewChrome) {
      const top = Number(layout.contentTop) || 178;
      const orangeH = Math.round(top * 0.42);
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#f0a12a');
      g.addColorStop(1, '#f6d56a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, orangeH);
      ctx.fillStyle = '#111111';
      ctx.fillRect(0, orangeH, w, top - orangeH);
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 28px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.direction = 'ltr';
      ctx.fillText('ARTILLERY HOUSE', 28, Math.round(orangeH * 0.68));
      // Header year is pre-printed stock. Draw it only in the preview chrome, never in the white overlay.
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 42px Arial, sans-serif';
      ctx.fillText('2026', 28, orangeH + Math.round((top - orangeH) * 0.72));
    }
    return;
  }
  const bg = layout.background || {};
  const bgImg = bg.imageUrl ? await loadBgImage(bg.imageUrl) : null;
  if (bgImg) ctx.drawImage(bgImg, 0, 0, w, h);
  const colors = bg.gradient?.length ? bg.gradient : ['#12386c', '#1262a2', '#06a0a4'];
  const g = ctx.createLinearGradient(0, 0, w, h);
  colors.forEach((c, i) => g.addColorStop(colors.length === 1 ? 0 : i / (colors.length - 1), c));
  ctx.fillStyle = g;
  if (bgImg) {
    ctx.globalAlpha = 0.72;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  } else ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  ctx.beginPath();
  ctx.arc(930, 0, 330, 0, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(85, 650, 230, 0, 7);
  ctx.fill();
  const divY = bg.dividerY ?? 136;
  ctx.strokeStyle = '#ffffff40';
  ctx.beginPath();
  ctx.moveTo(50, divY);
  ctx.lineTo(w - 48, divY);
  ctx.stroke();
}

export async function paintLogo(ctx, logo) {
  if (!logo || logo.show === false) return;
  const url = String(logo.imageUrl || '').trim();
  const w = Number(logo.w) || 0;
  const h = Number(logo.h) || 0;
  if (!url || w <= 0 || h <= 0) return;
  const image = await loadBgImage(url);
  if (!image) return;
  ctx.drawImage(image, Number(logo.x) || 0, Number(logo.y) || 0, w, h);
}

function paintInlineField(ctx, w, block, value, { isolateValue = false } = {}) {
  if (!block || block.show === false) return;
  const label = block.label || '';
  const raw = value || '—';
  const shown = isolateValue ? `\u2066${raw}\u2069` : raw;
  const text = label ? `${label}: ${shown}` : shown;
  const x = w - (block.xFromRight ?? 52);
  ctx.font = block.font || block.valueFont || 'bold 30px Arial, Tahoma, sans-serif';
  ctx.fillStyle = block.color || block.valueColor || '#000000';
  ctx.textAlign = 'right';
  ctx.direction = 'rtl';
  ctx.fillText(text, x, block.y ?? block.valueY ?? 0, block.maxWidth || 640);
}

function paintSignature(ctx, signature) {
  if (!signature || signature.show === false) return;
  const lines = signature.lines || [];
  if (!lines.length) return;
  ctx.font = signature.font || 'bold 17px Arial, Tahoma, sans-serif';
  ctx.fillStyle = signature.color || '#000000';
  ctx.textAlign = signature.align === 'center' ? 'center' : 'right';
  ctx.direction = 'rtl';
  const x = Number(signature.x) || 0;
  const y0 = Number(signature.y) || 0;
  const lh = Number(signature.lineHeight) || 26;
  lines.forEach((line, i) => {
    if (!line) return;
    ctx.fillText(String(line), x, y0 + i * lh);
  });
}

async function paintPhotoBox(ctx, photoBox, url) {
  if (!photoBox) return;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(photoBox.x, photoBox.y, photoBox.w, photoBox.h, photoBox.radius || 0);
  ctx.fill();
  const photo = url ? await loadPhoto(url) : null;
  const inner = photoBox.inner || photoBox;
  if (photo) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(inner.x, inner.y, inner.w, inner.h, inner.radius || 0);
    ctx.clip();
    const scale = Math.max(inner.w / photo.width, inner.h / photo.height);
    ctx.drawImage(
      photo,
      inner.x + (inner.w - photo.width * scale) / 2,
      inner.y + (inner.h - photo.height * scale) / 2,
      photo.width * scale,
      photo.height * scale,
    );
    ctx.restore();
  } else {
    ctx.fillStyle = '#f0f2f5';
    ctx.fillRect(inner.x + 1, inner.y + 1, inner.w - 2, inner.h - 2);
    ctx.fillStyle = '#9aa8bc';
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.font = `${inner.w < 160 ? 14 : 22}px Cairo, Arial`;
    ctx.fillText('بدون صورة', inner.x + inner.w / 2, inner.y + inner.h / 2);
  }
}

async function paintCardPhotos(ctx, member, dependent, layout) {
  for (const slot of cardPhotoSlots(member, dependent, layout)) {
    await paintPhotoBox(ctx, slot.box, slot.url);
  }
}

/**
 * Front face only — overlay for the pre-printed white body (header/back are stock).
 * options.previewChrome draws a faint pre-print header mock for on-screen alignment.
 * options.expiryDate overrides subscription lookup.
 */
export async function renderCard(canvas, member, dependent, layoutIn, options = {}) {
  const layout = layoutIn || defaultTemplate;
  const ctx = canvas.getContext('2d');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const w = layout.width;
  const h = layout.height;
  const overlay = layout.overlay !== false;
  const previewChrome = !!options.previewChrome;
  await paintBackground(ctx, w, h, layout, { previewChrome });

  if (!overlay) {
    await paintLogo(ctx, layout.logo);
    if (layout.title?.show !== false && layout.title?.text) {
      ctx.fillStyle = layout.title.color;
      ctx.textAlign = 'right';
      ctx.direction = 'rtl';
      ctx.font = layout.title.font;
      ctx.fillText(layout.title.text, w - layout.title.xFromRight, layout.title.y);
    }
    if (layout.subtitle?.show !== false && layout.subtitle?.text) {
      ctx.font = layout.subtitle.font;
      ctx.fillStyle = layout.subtitle.color;
      ctx.fillText(layout.subtitle.text, w - layout.subtitle.xFromRight, layout.subtitle.y);
    }
  }

  const expiry =
    options.expiryDate !== undefined
      ? options.expiryDate
      : await resolveCardExpiry(member, dependent);
  const lines = cardOverlayLines(member, dependent, layout, { expiryText: formatCardDate(expiry) });
  const roleLine = lines.find((line) => line.key === 'role');
  const nameLine = lines.find((line) => line.key === 'name');
  const numberLine = lines.find((line) => line.key === 'number');
  const relationLine = lines.find((line) => line.key === 'relation');
  const maxChars = layout.name?.maxChars || 40;
  const rawName = nameLine?.value || '';
  const displayName = rawName.length > maxChars ? rawName.slice(0, maxChars) + '…' : rawName;
  const extraPhoto = dependent ? layout.photoPrimary : null;

  if (overlay) {
    for (const line of lines) {
      const style = layout[line.styleKey] || layout.name || {};
      const value = line.key === 'name' ? displayName : line.value;
      paintInlineField(
        ctx,
        w,
        { ...style, label: line.label, y: line.y, maxWidth: overlayTextMaxWidth(layout, style, extraPhoto) },
        value,
        { isolateValue: line.key === 'number' },
      );
    }
    await paintCardPhotos(ctx, member, dependent, layout);
    paintSignature(ctx, layout.signature);
  } else {
    ctx.fillStyle = layout.name.color;
    ctx.font = layout.name.font;
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.fillText(displayName, w - layout.name.xFromRight, layout.name.y, layout.name.maxWidth);
    ctx.font = layout.number.labelFont;
    ctx.fillStyle = layout.number.labelColor || '#e6f2fa';
    ctx.fillText(numberLine?.label || layout.number.label, w - layout.number.xFromRight, layout.number.labelY);
    ctx.font = layout.number.valueFont;
    ctx.fillStyle = layout.number.valueColor || '#fff';
    ctx.direction = 'ltr';
    ctx.fillText('\u2066' + (numberLine?.value || '') + '\u2069', w - layout.number.xFromRight, layout.number.valueY);
    ctx.direction = 'rtl';
    ctx.font = layout.rank.labelFont;
    ctx.fillStyle = layout.rank.labelColor || '#e6f2fa';
    ctx.fillText(roleLine?.label || layout.rank.label, w - layout.rank.xFromRight, layout.rank.labelY);
    ctx.font = layout.rank.valueFont;
    ctx.fillStyle = layout.rank.valueColor || '#fff';
    ctx.fillText(roleLine?.value || '—', w - layout.rank.xFromRight, layout.rank.valueY);
    if (layout.footer?.show !== false) {
      ctx.font = layout.footer.font;
      ctx.fillStyle = layout.footer.color;
      ctx.fillText(
        relationLine ? 'عضوية تابعة • ' + relationLine.value : 'عضوية أساسية',
        w - layout.footer.xFromRight,
        layout.footer.y,
      );
    }
    await paintCardPhotos(ctx, member, dependent, layout);
    if (layout.qr?.show !== false) {
      try {
        const qr = await makeQr('SUBSCRIPTIONS|' + member.IdClient + '|' + (dependent?.id || 'MAIN'));
        ctx.drawImage(qr, layout.qr.x, layout.qr.y, layout.qr.size, layout.qr.size);
      } catch {}
    }
  }

  ctx.textAlign = 'right';
  ctx.direction = 'ltr';
  return canvas.toDataURL('image/png');
}

function paintLabelValue(ctx, w, block, value) {
  if (!block || block.show === false) return;
  const x = w - (block.xFromRight ?? 55);
  if (block.label) {
    ctx.font = block.labelFont || '22px Cairo, Arial';
    ctx.fillStyle = block.labelColor || '#d7eefc';
    ctx.fillText(block.label, x, block.labelY ?? 0);
  }
  ctx.font = block.valueFont || 'bold 28px Cairo, Arial';
  ctx.fillStyle = block.valueColor || '#ffffff';
  ctx.fillText(value || '—', x, block.valueY ?? 0);
}

/** Name/number on back are opt-in; RFID/rank show unless show === false. */
function backFieldVisible(block, { optIn = false } = {}) {
  if (!block) return false;
  if (optIn) return block.show === true;
  return block.show !== false;
}

/** Back face is pre-printed on stock — kept only for legacy design tools; returns '' when disabled. */
export async function renderCardBack(canvas, member, dependent, layoutIn) {
  const layout = layoutIn || defaultTemplate;
  const back = layout.backSide || getDefaultCardTemplate().backSide;
  if (back?.enabled === false || layout.duplex === false) {
    canvas.width = layout.width || 1012;
    canvas.height = layout.height || 638;
    return '';
  }
  const ctx = canvas.getContext('2d');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const w = layout.width;
  const h = layout.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  await paintBackground(ctx, w, h, { background: back.background || {}, overlay: false });
  await paintLogo(ctx, back.logo);
  ctx.textAlign = 'right';
  ctx.direction = 'rtl';
  if (back.title?.text) {
    ctx.fillStyle = back.title.color || '#ffffff';
    ctx.font = back.title.font || 'bold 28px Cairo, Arial';
    ctx.fillText(back.title.text, w - (back.title.xFromRight ?? 55), back.title.y ?? 55);
  }
  for (const line of back.lines || []) {
    if (!line?.text) continue;
    ctx.font = line.font || '22px Cairo, Arial';
    ctx.fillStyle = line.color || '#dbf3ff';
    ctx.fillText(line.text, w - (line.xFromRight ?? 55), line.y ?? 0, line.maxWidth);
  }
  const fields = back.fields || {};
  const backLines = cardOverlayLines(member, dependent, layout);
  const nameCfg = fields.name;
  if (backFieldVisible(nameCfg, { optIn: true })) {
    const name = backLines.find((line) => line.key === 'name')?.value || '';
    const maxChars = nameCfg.maxChars || 40;
    const display = name.length > maxChars ? name.slice(0, maxChars) + '…' : name;
    if (display) {
      ctx.font = nameCfg.font || 'bold 34px Cairo, Arial';
      ctx.fillStyle = nameCfg.color || '#ffffff';
      ctx.fillText(display, w - (nameCfg.xFromRight ?? 55), nameCfg.y ?? 140, nameCfg.maxWidth || 900);
    }
  }
  const printedNumber = backLines.find((line) => line.key === 'number')?.value || '';
  paintLabelValue(
    ctx,
    w,
    backFieldVisible(fields.number, { optIn: true }) ? fields.number : null,
    printedNumber ? '\u2066' + printedNumber + '\u2069' : '',
  );
  const rfid = String(dependent?.Rfid || member.Rfid || '').trim();
  paintLabelValue(ctx, w, backFieldVisible(fields.rfid) ? fields.rfid : null, rfid || 'غير مسجل');
  paintLabelValue(
    ctx,
    w,
    backFieldVisible(fields.rank) ? fields.rank : null,
    backLines.find((line) => line.key === 'role')?.value || 'عضوية',
  );
  const qrSpec = back.qr || {};
  if (qrSpec.showQr !== false) {
    try {
      const qr = await makeQr('SUBSCRIPTIONS|' + member.IdClient + '|' + (dependent?.id || 'MAIN') + '|' + (rfid || ''));
      const qx = qrSpec.x ?? layout.qr?.x ?? 58;
      const qy = qrSpec.y ?? layout.qr?.y ?? 510;
      const qs = qrSpec.size ?? layout.qr?.size ?? 100;
      ctx.drawImage(qr, qx, qy, qs, qs);
    } catch {}
  }
  return canvas.toDataURL('image/png');
}

export async function fetchCardTemplate() {
  try {
    const x = await api('/card-template');
    return mergeCardTemplate(x.template);
  } catch {
    return getDefaultCardTemplate();
  }
}

/** Always print the fixed pre-printed-stock overlay (front only). */
function printLayoutFrom(tpl) {
  const base = getDefaultCardTemplate();
  const merged = mergeCardTemplate({
    ...base,
    ...(tpl || {}),
    duplex: false,
    overlay: true,
    backSide: { ...(base.backSide || {}), ...(tpl?.backSide || {}), enabled: false },
  });
  // Lock geometry to the stock overlay defaults so stale DB templates cannot reprint the old dual face.
  return {
    ...merged,
    ...base,
    duplex: false,
    overlay: true,
    backSide: { ...base.backSide, enabled: false },
    signature: { ...(merged.signature || base.signature), y: base.signature.y },
  };
}

export default function CardPrinter({ open, onClose, id, member, dependent, defaultReprintReason = '' }) {
  const { notify } = useApp();
  const [image, setImage] = useState('');
  const [layout, setLayout] = useState(defaultTemplate);
  const [key, setKey] = useState(initialPrintAgentKey);
  const [printers, setPrinters] = useState([]);
  const [printer, setPrinter] = useState(PDF_PRINTER);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      if (key) sessionStorage.setItem(PRINT_KEY_STORAGE, key);
    } catch {
      /* ignore */
    }
  }, [key]);

  useEffect(() => {
    if (!open || !member) return;
    let cancelled = false;
    setImage('');
    setError(null);
    setReason(defaultReprintReason || '');
    (async () => {
      const tpl = await fetchCardTemplate();
      const ready = printLayoutFrom(tpl);
      if (cancelled) return;
      setLayout(ready);
      const c = document.createElement('canvas');
      try {
        const expiryDate = await resolveCardExpiry(member, dependent);
        const x = await renderCard(c, member, dependent, ready, { previewChrome: true, expiryDate });
        if (!cancelled) setImage(x);
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, member, dependent, defaultReprintReason]);

  if (!open || !member) return null;

  async function requestAgent(url, data) {
    const res = await fetch(agent + url, {
      method: data ? 'POST' : 'GET',
      headers: { 'X-Print-Key': key, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(data ? 110000 : 15000),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || out.message || 'فشل الاتصال ببرنامج الطباعة المحلي');
    return out;
  }

  async function loadPrinters() {
    setError(null);
    try {
      const x = await requestAgent('/printers');
      const list = x.printers || [];
      setPrinters(list);
      setPrinter(choosePrinter(list));
    } catch (e) {
      setError(e);
    }
  }

  async function sendPrint() {
    setError(null);
    setBusy(true);
    let job = null;
    try {
      if (!image) throw new Error('تعذر توليد صورة الكارنيه');
      // Re-render without preview chrome so the physical header is not double-printed.
      const c = document.createElement('canvas');
      const expiryDate = await resolveCardExpiry(member, dependent);
      const printPng = await renderCard(c, member, dependent, layout, { previewChrome: false, expiryDate });
      job = await api('/card-jobs', {
        method: 'POST',
        body: { client_id: id, dependent_id: dependent?.id || null, printer, reprint_reason: reason || undefined },
      });
      const payload = {
        printer,
        imageBase64: printPng.split(',')[1],
        duplex: false,
      };
      const out = await requestAgent('/print', payload);
      if (out.status !== 'SPOOLED') throw new Error(out.error || 'لم تُرسل المهمة إلى الطابور');
      await api('/card-jobs/' + job.id, { method: 'PATCH', body: { status: 'SPOOLED' } });
      notify('أُرسل الوجه الأمامي (منطقة البياض فقط) إلى طابور الطباعة.');
    } catch (e) {
      setError(e);
      if (job)
        await api('/card-jobs/' + job.id, {
          method: 'PATCH',
          body: { status: 'ERROR', error_message: String(e.message).slice(0, 390) },
        }).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  function downloadPng() {
    const a = document.createElement('a');
    a.download = 'card-' + id + '-front.png';
    a.href = image;
    a.click();
  }

  return (
    <Modal open onClose={onClose} title="معاينة وطباعة الكارنيه" wide>
      <div className="space-y-5">
        <div>
          <div className="eyebrow mb-2">CR80 • الوجه الأمامي (طباعة على منطقة البياض فقط)</div>
          {image ? (
            <img src={image} className="rounded-xl w-full max-w-xl mx-auto shadow-lift" alt="معاينة الأمام" />
          ) : (
            <div className="shimmer aspect-[1.59] rounded-xl max-w-xl mx-auto" />
          )}
        </div>
        <p className="text-xs muted leading-6">
          الكرت مطبوع مسبقاً (رأس ARTILLERY HOUSE / 2026 من الأمام، والظهر بالكامل). الطابعة تطبع فقط الصورة والحقول والتوقيع في المنطقة البيضاء السفلية بدقة {layout.width}×{layout.height}. لا تُرسل أي صفحة خلفية.
        </p>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="flex gap-2 flex-wrap content-start">
            <Button variant="outline" disabled={!image} onClick={downloadPng}>
              حفظ صورة المعاينة
            </Button>
          </div>
          <div>
            <h3 className="font-black text-sm mb-4">برنامج الطباعة المحلي</h3>
            <div className="space-y-3">
              <FormInput
                label="مفتاح برنامج الطابعة (لجلسة الموظف فقط)"
                type="password"
                value={key}
                onChange={setKey}
                placeholder="PRINT_AGENT_KEY"
              />
              <Button variant="soft" onClick={loadPrinters} disabled={!key}>
                <RefreshCcw size={15} /> استعلام الطابعات المتصلة
              </Button>
              <FormInput
                label="اسم الطابعة"
                value={printer}
                onChange={setPrinter}
                options={(printers.length ? printers : [PDF_PRINTER]).map((x) => ({ value: x, label: x }))}
              />
              <FormInput label="سبب إعادة الطباعة (مطلوب إذا سبق إصدار كارنيه)" value={reason} onChange={setReason} />
              <ErrorBox error={error} />
              <Button className="w-full" disabled={!image || !key} loading={busy} onClick={sendPrint}>
                <Printer size={17} /> طباعة الوجه الأمامي
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
