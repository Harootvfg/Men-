"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { api, Badge, Button, Card, cx, ErrorNote, inputCls, Note, PageHeader } from "@/components/ui";
import { fmtUsd, PLATFORM_LABEL } from "@/lib/labels";

interface Q { id: string; field: string; question: string; options: { label: string; value: string }[]; allowFreeText: boolean }
interface QSet { analysis: string; detected: { field: string; value: string }[]; questions: Q[]; generatedBy: string; demand: { recentArticles: number; articles: { title: string; url: string; source: string }[] } | null }
interface Estimate { usd: number; lines: { label: string; usd: number }[]; note: string }
type Answer = { value: string; label: string; free?: boolean };

const EXAMPLES = ["Was würde passieren, wenn die Sonne plötzlich verschwinden würde?", "Ein emotionales Motivationsvideo über Disziplin", "Warum schlafen Katzen so viel? 30 Sekunden, lustig"];
const FIELD_LABEL: Record<string, string> = { tone: "Wirkung", audience: "Zielgruppe", style: "Stil", durationSec: "Länge", language: "Sprache", platform: "Plattform", angle: "Blickwinkel", other: "Weitere Angabe", voice: "Stimme" };

/** Turns detected values and answers into a production brief. "auto" leaves the decision to the agents. */
function toBrief(topic: string, qs: QSet, answers: Record<string, Answer>) {
  const brief: Record<string, unknown> = { topic };
  const set = (field: string, value: string) => {
    if (!value || value === "auto") return;
    if (field === "durationSec") { const n = Number(value); if (n >= 8 && n <= 120) brief.durationSec = n; }
    else if (field === "language") { if (value === "de" || value === "en") brief.language = value; }
    else if (field === "platform") { if (value in PLATFORM_LABEL) brief.platform = value; }
    else if (["tone", "audience", "style", "voice"].includes(field)) brief[field] = value;
  };
  for (const d of qs.detected) set(d.field, d.value);
  for (const q of qs.questions) if (answers[q.id]) set(q.field, answers[q.id].value);
  brief.answers = qs.questions.filter((q) => answers[q.id]).map((q) => ({ question: q.question, answer: answers[q.id].label }));
  return brief;
}

export default function Create() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [qs, setQs] = useState<QSet | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const step = !qs ? 1 : !estimate ? 2 : 3;

  const act = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const analyse = () => act(async () => { setQs(await api<QSet>("/api/questions", { topic })); setAnswers({}); });
  const summarise = () => act(async () => { setEstimate(await api<Estimate>("/api/estimate", toBrief(topic, qs!, answers))); });
  const startProduction = () => act(async () => { const { id } = await api<{ id: string }>("/api/projects", { mode: "custom", brief: toBrief(topic, qs!, answers) }); router.push(`/projects/${id}`); });
  const allAnswered = qs?.questions.every((q) => answers[q.id]?.value.trim());
  const brief = qs ? toBrief(topic, qs, answers) : null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Eigenes Video erstellen" subtitle="Drei kurze Schritte: Idee beschreiben, Rückfragen beantworten, Produktion starten." />
      <ol className="mb-6 flex items-center gap-2 text-xs font-medium text-stone-500" aria-label="Fortschritt">
        {["Idee", "Rückfragen", "Briefing"].map((l, i) => (
          <li key={l} className="flex items-center gap-2" aria-current={step === i + 1 ? "step" : undefined}>
            <span className={cx("grid size-6 place-items-center rounded-full", step > i + 1 ? "bg-emerald-100 text-emerald-800" : step === i + 1 ? "bg-accent text-white" : "bg-stone-200 text-stone-600")}>{step > i + 1 ? <Check className="size-3.5" aria-hidden /> : i + 1}</span>
            <span className={step === i + 1 ? "text-ink" : ""}>{l}</span>{i < 2 && <span className="mx-1 h-px w-6 bg-stone-300" aria-hidden />}
          </li>
        ))}
      </ol>
      {err && <div className="mb-4"><ErrorNote>{err}</ErrorNote></div>}

      {step === 1 && (
        <Card className="rise p-5 sm:p-7">
          <label htmlFor="topic" className="text-sm font-medium">Worum soll es in deinem Video gehen?</label>
          <textarea id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={4} maxLength={600} placeholder="Beschreibe deine Idee in ein, zwei Sätzen …" className={cx(inputCls, "mt-2 resize-none")} />
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setTopic(ex)} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-left text-xs text-stone-600 transition hover:border-accent hover:text-accent">{ex}</button>)}
          </div>
          <Button variant="primary" className="mt-5 w-full" busy={busy} disabled={topic.trim().length < 3} onClick={analyse}>Thema analysieren</Button>
        </Card>
      )}

      {step === 2 && qs && (
        <div className="space-y-4">
          <Card className="rise p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-stone-700"><span className="font-medium text-ink">„{topic}“</span></p>
              <Badge tone={qs.generatedBy === "regelbasiert" ? "warn" : "accent"}>{qs.generatedBy === "regelbasiert" ? "Regelbasiert" : "KI-Analyse"}</Badge>
            </div>
            <p className="mt-2 text-sm text-stone-600">{qs.analysis}</p>
            {qs.demand && <p className="mt-2 text-xs text-stone-500">Nachfrage-Check (Google News, 30 Tage): {qs.demand.recentArticles === 0 ? "keine aktuellen Artikel gefunden" : `${qs.demand.recentArticles}${qs.demand.recentArticles >= 100 ? "+" : ""} Artikel`}. Das ist ein Messwert zur Berichterstattung, kein Nachweis eines Social-Media-Trends.</p>}
          </Card>
          {qs.questions.map((q, i) => (
            <Card key={q.id} className="rise p-5">
              <fieldset>
                <legend className="text-sm font-semibold"><span className="mr-2 text-stone-400">{i + 1}/{qs.questions.length}</span>{q.question}</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {q.options.map((o) => {
                    const on = answers[q.id] && !answers[q.id].free && answers[q.id].value === o.value;
                    return <button key={o.value + o.label} type="button" aria-pressed={!!on} onClick={() => setAnswers({ ...answers, [q.id]: { value: o.value, label: o.label } })} className={cx("min-h-11 rounded-xl border px-3.5 py-2 text-left text-sm transition", on ? "border-accent bg-accent-soft font-medium text-violet-900" : "border-stone-200 hover:border-stone-300 hover:bg-stone-50", o.value === "auto" && !on && "text-stone-500")}>{o.value === "auto" ? "✨ " : ""}{o.label}</button>;
                  })}
                </div>
                {q.allowFreeText && <input aria-label={`Eigene Antwort: ${q.question}`} placeholder="Oder eigene Antwort eingeben …" className={cx(inputCls, "mt-2")} value={answers[q.id]?.free ? answers[q.id].value : ""} onChange={(e) => setAnswers({ ...answers, [q.id]: { value: e.target.value, label: e.target.value, free: true } })} />}
              </fieldset>
            </Card>
          ))}
          <div className="flex gap-3">
            <Button onClick={() => setQs(null)}><ArrowLeft className="size-4" aria-hidden />Zurück</Button>
            <Button variant="primary" className="flex-1" busy={busy} disabled={!allAnswered} onClick={summarise}>{allAnswered ? "Briefing ansehen" : "Bitte alle Fragen beantworten"}</Button>
          </div>
        </div>
      )}

      {step === 3 && qs && estimate && brief && (
        <Card className="rise p-5 sm:p-7">
          <h2 className="text-base font-semibold">Produktionsbriefing</h2>
          <dl className="mt-4 divide-y divide-stone-100 text-sm">
            <div className="flex gap-4 py-2.5"><dt className="w-28 shrink-0 text-stone-500">Thema</dt><dd>{topic}</dd></div>
            {qs.detected.map((d) => <div key={d.field} className="flex gap-4 py-2.5"><dt className="w-28 shrink-0 text-stone-500">{FIELD_LABEL[d.field] || d.field}</dt><dd>{d.field === "durationSec" ? `${d.value} Sekunden` : PLATFORM_LABEL[d.value] || d.value} <span className="text-xs text-stone-400">(aus deiner Eingabe)</span></dd></div>)}
            {qs.questions.map((q) => <div key={q.id} className="flex gap-4 py-2.5"><dt className="w-28 shrink-0 text-stone-500">{FIELD_LABEL[q.field] || q.field}</dt><dd>{answers[q.id]?.label}</dd></div>)}
          </dl>
          <div className="mt-5 rounded-xl bg-stone-50 p-4">
            <div className="flex items-baseline justify-between"><span className="text-sm font-medium">Geschätzte Produktionskosten</span><span className="text-lg font-semibold tabular-nums">{fmtUsd(estimate.usd)}</span></div>
            <ul className="mt-2 space-y-1 text-xs text-stone-600">{estimate.lines.map((l) => <li key={l.label} className="flex justify-between gap-3"><span>{l.label}</span><span className="tabular-nums">{fmtUsd(l.usd)}</span></li>)}</ul>
            <p className="mt-2 text-xs text-stone-500">{estimate.note}</p>
          </div>
          {estimate.usd === 0 && <div className="mt-3"><Note tone="warn">Dieses Video entsteht im Basis-Modus (prozedurale Hintergründe, synthetische Stimme). Für generative Videoclips und natürliche Stimmen hinterlege Anbieter-Schlüssel in den Einstellungen und gib kostenpflichtige Generierung frei.</Note></div>}
          <div className="mt-5 flex gap-3">
            <Button onClick={() => setEstimate(null)}><ArrowLeft className="size-4" aria-hidden />Zurück</Button>
            <Button variant="primary" className="flex-1" busy={busy} onClick={startProduction}>Produktion starten</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
