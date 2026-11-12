"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { api, Badge, Button, Card, cx, ErrorNote, Field, inputCls, Note, PageHeader, useData } from "@/components/ui";
import { fmtDate } from "@/lib/labels";

interface Signal { source: string; sourceUrl: string; fetchedAt: string; publishedAt: string | null; metricLabel: string | null; metricValue: number | null; context: { title: string; url: string; source: string }[] }
interface Cand { id: string; title: string; score: number; growth: string; risk: string | null; signals: Signal[]; components: { name: string; value: number; weight: number; evidence: string; reason: string }[] }
interface Data { candidates: Cand[]; fetchedAt: string; sources: { name: string; ok: boolean; note: string }[]; disclaimer: string; geo: string }
const EVIDENCE: Record<string, [string, "good" | "warn" | "neutral"]> = { measured: ["Messwert", "good"], estimated: ["Schätzung", "warn"], qualitative: ["Einschätzung", "neutral"] };

export default function Trends() {
  const router = useRouter();
  const [nonce, setNonce] = useState(0);
  const { data, error, reload } = useData<Data>(`/api/trends${nonce ? `?refresh=${nonce}` : ""}`);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState({ platform: "TikTok", title: "", note: "", url: "" });
  const make = async (c: Cand) => {
    setBusy(c.id); setErr(null);
    try { const { id } = await api<{ id: string }>("/api/projects", { mode: "custom", brief: { topic: c.title, notes: `Aus dem Trend Radar (Score ${c.score}, ${c.signals.map((s) => s.source).join(", ")})` } }); router.push(`/projects/${id}`); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(null); }
  };
  const addManual = async () => { setErr(null); try { await api("/api/trends", manual); setManual({ ...manual, title: "", note: "", url: "" }); await reload(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  return (
    <>
      <PageHeader title="Trend Radar" subtitle="Aktuelle Signale aus öffentlich zugänglichen Quellen, mit Herkunft, Zeitstempel und nachvollziehbarer Bewertung."
        action={<Button onClick={() => setNonce(Date.now())}><RefreshCw className="size-4" aria-hidden />Aktualisieren</Button>} />
      {(error || err) && <div className="mb-4"><ErrorNote>{error || err}</ErrorNote></div>}
      {!data && !error && <Card className="p-8 text-center text-sm text-stone-500">Quellen werden abgefragt …</Card>}
      {data && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-stone-600">
            <span>Erhoben: {fmtDate(data.fetchedAt)} · Markt {data.geo}</span>
            {data.sources.map((s) => <Badge key={s.name} tone={s.ok ? "good" : "neutral"}>{s.ok ? "✓" : "–"} {s.name}: {s.note}</Badge>)}
          </div>
          <div className="mb-4"><Note>{data.disclaimer} TikTok und Instagram bieten keine offene Trend-Schnittstelle; Beobachtungen von dort kannst du unten manuell erfassen.</Note></div>
          <div className="space-y-3">
            {data.candidates.length === 0 && <Card className="p-8 text-center text-sm text-stone-500">Keine Signale verfügbar. Prüfe den Quellenstatus oben.</Card>}
            {data.candidates.slice(0, 30).map((c) => (
              <Card key={c.id} className="p-4 sm:p-5">
                <div className="flex items-start gap-4">
                  <div className={cx("grid size-12 shrink-0 place-items-center rounded-xl text-base font-semibold tabular-nums", c.risk ? "bg-stone-100 text-stone-500" : c.score >= 60 ? "bg-accent-soft text-violet-800" : "bg-stone-100 text-stone-700")} title="Interner Trend-Score (0–100)">{c.score}</div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{c.title}</h2>
                    <p className="mt-0.5 text-xs text-stone-500">{[...new Set(c.signals.map((s) => s.source))].join(" · ")}{c.signals[0].metricValue != null && ` · ${c.signals[0].metricLabel}: ${c.signals[0].metricValue.toLocaleString("de-DE")}`}{c.signals[0].publishedAt && ` · ${fmtDate(c.signals[0].publishedAt)}`}</p>
                    <p className="mt-0.5 text-xs text-stone-500">Entwicklung: {c.growth}</p>
                    {c.risk && <p className="mt-1 text-xs font-medium text-amber-800">{c.risk}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" busy={busy === c.id} disabled={!!c.risk} onClick={() => make(c)}>Video daraus erstellen</Button>
                  <Button size="sm" variant="ghost" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>Bewertung und Quellen<ChevronDown className={cx("size-4 transition", open === c.id && "rotate-180")} aria-hidden /></Button>
                </div>
                {open === c.id && (
                  <div className="mt-3 space-y-3 border-t border-stone-100 pt-3 text-sm">
                    <ul className="space-y-1.5">{c.components.map((k) => (
                      <li key={k.name} className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="w-36 font-medium">{k.name}</span><span className="w-20 tabular-nums text-stone-600">{k.value} × {Math.round(k.weight * 100)} %</span><Badge tone={EVIDENCE[k.evidence][1]}>{EVIDENCE[k.evidence][0]}</Badge><span className="text-xs text-stone-500">{k.reason}</span></li>
                    ))}</ul>
                    <ul className="space-y-1 text-xs text-stone-600">{c.signals.map((s, i) => (
                      <li key={i}><a href={s.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">{s.source}</a> – abgerufen {fmtDate(s.fetchedAt)}{s.context.map((x, j) => <span key={j} className="block pl-3 text-stone-500">↳ {x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="hover:underline">{x.title}</a> : x.title}{x.source && ` (${x.source})`}</span>)}</li>
                    ))}</ul>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <Card className="mt-8 p-5">
            <h2 className="text-base font-semibold">Eigene Beobachtung erfassen</h2>
            <p className="mt-1 text-sm text-stone-600">Für Plattformen ohne offene Schnittstelle. Einträge erscheinen als Quelle „Manuell“ und fließen 14 Tage in die Bewertung ein.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr]">
              <Field label="Plattform"><select className={inputCls} value={manual.platform} onChange={(e) => setManual({ ...manual, platform: e.target.value })}><option>TikTok</option><option>Instagram</option><option>Sonstige</option></select></Field>
              <Field label="Trend oder Thema"><input className={inputCls} value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} placeholder="z. B. Sound, Format oder Thema" /></Field>
              <Field label="Link (optional)"><input className={inputCls} value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} /></Field>
              <Field label="Notiz (optional)"><input className={inputCls} value={manual.note} onChange={(e) => setManual({ ...manual, note: e.target.value })} /></Field>
            </div>
            <Button className="mt-4" disabled={manual.title.trim().length < 2} onClick={addManual}>Beobachtung speichern</Button>
          </Card>
        </>
      )}
    </>
  );
}
