"use client";

// Form inputs with friendly inline errors, used by onboarding and "Add company".

import { inputCls, labelCls } from "@/components/preview/ui";

const errorCls = "border-red-400 focus:border-red-500 focus:ring-red-100";

export function TextInput({ label, value, onChange, error, hint, type = "text", placeholder, autoComplete, className = "" }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={labelCls}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        className={`${inputCls} ${error ? errorCls : ""}`}
      />
      <FieldError error={error} hint={hint} />
    </label>
  );
}

export function SelectInput({ label, value, onChange, options, error, hint }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  error?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} className={`${inputCls} ${error ? errorCls : ""}`}>
        {options.map((o) => <option key={o} value={o}>{o || "Choose…"}</option>)}
      </select>
      <FieldError error={error} hint={hint} />
    </label>
  );
}

export function FieldError({ error, hint }: { error?: string; hint?: string }) {
  if (error) return <span className="mt-1 block text-xs text-red-600" role="alert">{error}</span>;
  if (hint) return <span className="mt-1 block text-xs text-slate-500">{hint}</span>;
  return null;
}
