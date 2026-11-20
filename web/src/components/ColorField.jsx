import React, { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HexColorPicker } from 'react-colorful';
import { ChevronDown } from 'lucide-react';

export const CARD_COLOR_PRESETS = ['#12386c', '#1262a2', '#06a0a4', '#ffffff', '#dbf3ff', '#e5f8f8', '#e6f2fa'];

export function isValidHex(value) {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
}

function normalizeHexInput(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const withHash = t.startsWith('#') ? t : `#${t}`;
  return isValidHex(withHash) ? withHash.toLowerCase() : null;
}

function ColorField({ label, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? '');
  const [pickerColor, setPickerColor] = useState(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const commitTimer = useRef(null);
  const pickerColorRef = useRef(null);
  const labelId = useId();

  const swatch = isValidHex(value) ? value : '#12386c';
  const activeColor = pickerColor ?? swatch;

  useEffect(() => {
    if (!open) setText(value ?? '');
  }, [value, open]);

  const flushCommit = useCallback(
    (next) => {
      const norm = normalizeHexInput(next);
      if (norm) onChange(norm);
    },
    [onChange],
  );

  const scheduleCommit = useCallback(
    (next) => {
      clearTimeout(commitTimer.current);
      commitTimer.current = setTimeout(() => flushCommit(next), 60);
    },
    [flushCommit],
  );

  useEffect(() => () => clearTimeout(commitTimer.current), []);

  const updatePanelPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(240, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPanelPos({ top: r.bottom + 8, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPos();
  }, [open, updatePanelPos]);

  useEffect(() => {
    if (!open) return;
    const onReflow = () => updatePanelPos();
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, updatePanelPos]);

  const closePicker = useCallback(() => {
    clearTimeout(commitTimer.current);
    const pending = pickerColorRef.current;
    if (pending && isValidHex(pending)) flushCommit(pending);
    pickerColorRef.current = null;
    setPickerColor(null);
    setOpen(false);
  }, [flushCommit]);

  useEffect(() => {
    if (!open) return;
    let attached = false;
    let onOutside;
    const arm = window.setTimeout(() => {
      onOutside = (e) => {
        const t = e.target;
        if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
        closePicker();
      };
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('touchstart', onOutside, true);
      attached = true;
    }, 0);
    return () => {
      clearTimeout(arm);
      if (attached && onOutside) {
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('touchstart', onOutside, true);
      }
    };
  }, [open, closePicker]);

  function handlePickerChange(next) {
    pickerColorRef.current = next;
    setPickerColor(next);
    setText(next);
    scheduleCommit(next);
  }

  function toggleOpen(e) {
    e.stopPropagation();
    if (disabled) return;
    if (open) closePicker();
    else {
      const initial = isValidHex(value) ? value : swatch;
      pickerColorRef.current = initial;
      setPickerColor(initial);
      setOpen(true);
    }
  }

  const panel =
    open &&
    createPortal(
      <div
        ref={panelRef}
        className="fixed z-[200] p-3 bg-white border border-[#e4eaf3] rounded-2xl shadow-lift"
        style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <HexColorPicker color={activeColor} onChange={handlePickerChange} style={{ width: '100%' }} />
        <input
          className="field mt-3 font-mono text-xs"
          dir="ltr"
          value={text}
          placeholder="#RRGGBB"
          onChange={(e) => {
            setText(e.target.value);
            const norm = normalizeHexInput(e.target.value);
            if (norm) {
              pickerColorRef.current = norm;
              setPickerColor(norm);
              scheduleCommit(norm);
            }
          }}
          onBlur={() => {
            const norm = normalizeHexInput(text);
            if (norm) {
              pickerColorRef.current = norm;
              setPickerColor(norm);
              flushCommit(norm);
              setText(norm);
            } else setText(value ?? '');
          }}
        />
        <div className="flex flex-wrap gap-2 mt-3">
          {CARD_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              className="w-7 h-7 rounded-lg border border-[#dde4f1]"
              style={{ background: c }}
              onClick={() => {
                pickerColorRef.current = c;
                setPickerColor(c);
                setText(c);
                flushCommit(c);
              }}
            />
          ))}
        </div>
      </div>,
      document.body,
    );

  return (
    <div className="block min-w-0" ref={rootRef}>
      <span className="form-label" id={labelId}>
        {label}
      </span>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-labelledby={labelId}
          className="field flex items-center gap-2 text-left w-full !pr-3"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={toggleOpen}
        >
          <span
            className="w-7 h-7 rounded-lg border border-[#dde4f1] shrink-0 shadow-inner"
            style={{ background: swatch }}
            aria-hidden
          />
          <span className="font-mono text-xs flex-1 truncate" dir="ltr">
            {isValidHex(value) ? value : '—'}
          </span>
          <ChevronDown size={16} className="text-[#8391a7] shrink-0" />
        </button>
      </div>
      {panel}
    </div>
  );
}

export default memo(ColorField);
