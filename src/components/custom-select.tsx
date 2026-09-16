"use client";
import { useState, useRef, useEffect } from "react";

type Option = { value: string; label: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

export function CustomSelect({ value, onChange, options, placeholder = "请选择", className = "", disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 text-xs bg-[#0b1220] border border-white/12 rounded-lg px-3 py-1.5 text-white hover:border-white/25 transition-colors focus:outline-none disabled:opacity-50"
      >
        <span className={`truncate ${selected ? "text-white" : "text-gray-500"}`}>
          {selected?.label || placeholder}
        </span>
        <svg className={`w-3 h-3 text-gray-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-[200] mt-1 rounded-xl border border-white/12 bg-[#0b1220] shadow-2xl overflow-hidden max-h-56 overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500">暂无选项</div>
          ) : (
            options.map(opt => (
              <button key={opt.value} type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                  opt.value === value
                    ? "bg-violet-600/25 text-violet-300"
                    : "text-gray-300 hover:bg-white/8 hover:text-white"
                }`}>
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
