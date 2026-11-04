import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from '../icons';

export function Field({ label, hint, children, inline }: { label: string; hint?: ReactNode; children: ReactNode; inline?: boolean }) {
  return (
    <label className={`field${inline ? ' inline' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Text input that writes on every keystroke (callers coalesce undo history). */
export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  className,
  autoFocus,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  return <input className={`input${mono ? ' mono' : ''} ${className || ''}`} value={value ?? ''} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />;
}

/** Input that commits on blur / Enter (for renames that cascade or must be validated). */
export function CommitInput({
  value,
  onCommit,
  placeholder,
  mono,
  className,
  validate,
  transform,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
  validate?: (v: string) => string | null;
  transform?: (v: string) => string;
}) {
  const [v, setV] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const next = transform ? transform(v) : v;
    if (next === value) {
      setV(value);
      return setErr(null);
    }
    const e = validate?.(next) ?? null;
    if (e) {
      setErr(e);
      return;
    }
    setErr(null);
    onCommit(next);
  };
  return (
    <span className="commit-input">
      <input
        className={`input${mono ? ' mono' : ''}${err ? ' invalid' : ''} ${className || ''}`}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setV(value);
            setErr(null);
          }
        }}
        title={err || undefined}
      />
      {err && <span className="input-error">{err}</span>}
    </span>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3, mono }: { value: string | undefined; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  return <textarea className={`input textarea${mono ? ' mono' : ''}`} rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function NumberInput({ value, onChange, step = 0.01, min, max, className }: { value: number | undefined | null; onChange: (v: number) => void; step?: number; min?: number; max?: number; className?: string }) {
  return (
    <input
      type="number"
      className={`input num ${className || ''}`}
      value={value ?? ''}
      step={step}
      min={min}
      max={max}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  className,
  mono,
}: {
  value: T | undefined | null;
  onChange: (v: T) => void;
  options: (T | { value: T; label: string; disabled?: boolean })[];
  placeholder?: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <select className={`input select${mono ? ' mono' : ''} ${className || ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
      {placeholder !== undefined && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return (
          <option key={opt.value} value={opt.value} disabled={(opt as any).disabled}>
            {opt.label}
          </option>
        );
      })}
    </select>
  );
}

export function Toggle({ checked, onChange, label, title }: { checked: boolean | undefined; onChange: (v: boolean) => void; label?: ReactNode; title?: string }) {
  return (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

export function Check({ checked, onChange, title }: { checked: boolean | undefined; onChange: (v: boolean) => void; title?: string }) {
  return <input type="checkbox" className="check" checked={!!checked} title={title} onChange={(e) => onChange(e.target.checked)} />;
}

export function Segmented<T extends string>({ value, onChange, options, size }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; size?: 'sm' }) {
  return (
    <div className={`segmented${size ? ' ' + size : ''}`}>
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorSwatches({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button key={c} type="button" className={`swatch${c.toLowerCase() === value?.toLowerCase() ? ' active' : ''}`} style={{ background: c }} onClick={() => onChange(c)} title={c} />
      ))}
      <label className="swatch custom" title="Custom color">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      </label>
    </div>
  );
}

export function Modal({ title, onClose, children, footer, width = 560 }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Menu({ trigger, children, align = 'left' }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <span onClick={() => setOpen(!open)}>{trigger(open)}</span>
      {open && <div className={`menu ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {actions && <span className="section-actions">{actions}</span>}
    </div>
  );
}

export function confirmAction(message: string) {
  return window.confirm(message);
}
