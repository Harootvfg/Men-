"use client";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl border border-stone-200/80 bg-white shadow-(--shadow-card)", className)}>{children}</div>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean; size?: "sm" | "md" };
export function Button({ variant = "secondary", busy, size = "md", className, children, disabled, ...rest }: BtnProps) {
  const v = { primary: "bg-accent text-white hover:brightness-110 shadow-sm", secondary: "bg-white text-ink border border-stone-200 hover:bg-stone-50", ghost: "text-stone-600 hover:bg-stone-100", danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50" }[variant];
  return (
    <button {...rest} disabled={disabled || busy} className={cx("inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50", size === "sm" ? "min-h-9 px-3 text-sm" : "min-h-11 px-4 text-sm", v, className)}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "accent"; children: ReactNode }) {
  const t = { neutral: "bg-stone-100 text-stone-700", good: "bg-emerald-50 text-emerald-800", warn: "bg-amber-50 text-amber-900", bad: "bg-red-50 text-red-800", accent: "bg-accent-soft text-violet-800" }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", t)}>{children}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-stone-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{children}</div>;
}
export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return <div className={cx("rounded-xl border px-4 py-3 text-sm", tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-stone-200 bg-stone-50 text-stone-700")}>{children}</div>;
}

export async function api<T = unknown>(url: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(url, body !== undefined ? { method: method || "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { method: method || "GET", cache: "no-store" });
  const json = await res.json().catch(() => ({ error: `Serverfehler (${res.status})` }));
  if (!res.ok) throw new Error(json.error || json.message || `Serverfehler (${res.status})`);
  return json as T;
}

/** Fetches a URL, optionally polling while `pollMs` returns a number. */
export function useData<T>(url: string | null, pollMs?: (d: T | null) => number | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef(pollMs);
  pollRef.current = pollMs;
  const load = useCallback(async () => {
    if (!url) return null;
    try { const d = await api<T>(url); setData(d); setError(null); return d; } catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
  }, [url]);
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await load();
      if (stop) return;
      const ms = pollRef.current?.(d);
      if (ms) timer = setTimeout(tick, ms);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [load]);
  return { data, error, reload: load };
}

export function CopyButton({ text, label = "Kopieren" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="ghost" onClick={async () => {
      try { await navigator.clipboard.writeText(text); } catch {
        const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
      }
      setDone(true); setTimeout(() => setDone(false), 1500);
    }}>{done ? "Kopiert ✓" : label}</Button>
  );
}

export const inputCls = "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-stone-400 focus:border-accent focus:ring-2 focus:ring-accent/20";
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}
