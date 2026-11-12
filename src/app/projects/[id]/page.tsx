"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Circle, Download, Loader2, XCircle } from "lucide-react";
import { api, Badge, Button, Card, CopyButton, cx, ErrorNote, inputCls, Note, PageHeader, useData } from "@/components/ui";
import { StatusBadge } from "@/components/ProjectList";
import { fmtDate, fmtDur, fmtUsd, isActive, PLATFORM_LABEL, STATUS_LABEL } from "@/lib/labels";
import type { Project } from "@/lib/schemas";

interface Step { name: string; label: string; status: string; note?: string; error?: string }
interface Data { project: Project; running: boolean; steps: Step[]; events: { id: number; ts: string; level: string; step: string; message: string }[]; cost: { total: number; lines: { provider: string; kind: string; usd: number }[] } }
const TABS = ["Video", "Szenen", "Strategie", "Qualität", "Veröffentlichen"] as const;
const BASIS: Record<string, string> = { llm_multimodal: "KI-Prüfung mit Einzelbildern", llm_text: "KI-Prüfung (Text)", heuristic: "Selbsteinschätzung, ungeprüft", technical: "Technische Messung" };

export default function Studio() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, reload } = useData<Data>(`/api/projects/${id}`, (d) => (!d || d.running || isActive(d.project.status) ? 1500 : null));
  const [tab, setTab] = useState<(typeof TABS)[number]>("Video");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Record<string, { voiceover: string; onScreenText: string; subtitle: string }>>({});
  const [repair, setRepair] = useState("");

  if (error && !data) return <><PageHeader title="Video Studio" /><ErrorNote>{error}</ErrorNote></>;
  if (!data) return <div className="grid place-items-center py-24 text-stone-400"><Loader2 className="size-6 animate-spin" aria-label="Lädt" /></div>;
  const { project: p, steps, cost } = data;
  const s = p.state as Project["state"] & { subtitleOverrides?: Record<string, string> };
  const active = data.running || isActive(p.status);
  const r = s.render;
  const v = r?.version;
  const action = async (body: Record<string, unknown>) => {
    setBusy(true); setMsg(null);
    try { const res = await api<{ message: string }>(`/api/projects/${id}/action`, body); setMsg({ ok: true, text: res.message }); setEdit({}); await reload(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  };
  const remove = async () => { if (!confirm("Dieses Projekt und alle zugehörigen Dateien löschen?")) return; try { await api(`/api/projects/${id}`, undefined, "DELETE"); router.push("/videos"); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); } };
  const file = (kind: string, q = "") => `/api/projects/${id}/file/${kind}?${q}${q ? "&" : ""}v=${v}`;

  return (
    <>
      <div className="mb-2 text-sm"><Link href="/videos" className="text-stone-500 hover:text-ink">← Meine Videos</Link></div>
      <PageHeader title={p.title} subtitle={`${p.mode === "autopilot" ? "Autopilot" : "Eigenes Thema"} · ${PLATFORM_LABEL[s.brief.platform]} · ${s.brief.aspect} · erstellt ${fmtDate(p.createdAt)}`}
        action={<div className="flex items-center gap-2"><StatusBadge p={{ status: p.status, verdict: s.qa?.verdict ?? null }} />{active ? <Button size="sm" variant="danger" busy={busy} onClick={() => action({ type: "cancel" })}>Abbrechen</Button> : <Button size="sm" variant="ghost" onClick={remove}>Löschen</Button>}</div>} />
      {s.capabilities?.labels.length ? <div className="mb-4 flex flex-wrap gap-2">{s.capabilities.labels.map((l) => <Badge key={l} tone="warn">{l}</Badge>)}</div> : null}
      {msg && <div className="mb-4">{msg.ok ? <Note>{msg.text}</Note> : <ErrorNote>{msg.text}</ErrorNote>}</div>}
      {p.status === "failed" && <div className="mb-4"><ErrorNote><p className="font-medium">Die Produktion wurde angehalten.</p><p className="mt-1">{s.error}</p><Button size="sm" className="mt-3" busy={busy} onClick={() => action({ type: "resume" })}>Ab dem fehlgeschlagenen Schritt fortsetzen</Button></ErrorNote></div>}
      {p.status === "cancelled" && <div className="mb-4"><Note tone="warn">Die Produktion wurde abgebrochen. Bereits fertige Schritte bleiben erhalten. <Button size="sm" className="ml-2" busy={busy} onClick={() => action({ type: "resume" })}>Fortsetzen</Button></Note></div>}

      <div className="grid gap-5 lg:grid-cols-[19rem_1fr]">
        <Card className="h-fit p-5">
          <h2 className="text-sm font-semibold">Produktionsfortschritt</h2>
          <p className="mt-0.5 text-xs text-stone-500" aria-live="polite">{STATUS_LABEL[p.status]}{s.revisions > 0 && ` · Überarbeitungsrunde ${s.revisions}/2`}</p>
          <ol className="mt-4 space-y-3">
            {steps.map((st) => (
              <li key={st.name} className="flex gap-3">
                <span className="mt-0.5 shrink-0">{st.status === "done" ? <CheckCircle2 className="size-5 text-emerald-600" aria-label="abgeschlossen" /> : st.status === "running" ? <Loader2 className="size-5 animate-spin text-accent" aria-label="läuft" /> : st.status === "failed" ? <XCircle className="size-5 text-red-600" aria-label="fehlgeschlagen" /> : <Circle className="size-5 text-stone-300" aria-label="ausstehend" />}</span>
                <div className="min-w-0"><p className={cx("text-sm", st.status === "running" ? "font-semibold" : st.status === "pending" ? "text-stone-400" : "font-medium")}>{st.label}</p>{(st.note || st.error) && <p className={cx("mt-0.5 text-xs break-words", st.error ? "text-red-700" : "text-stone-500")}>{st.error || st.note}</p>}</div>
              </li>
            ))}
            <li className="flex gap-3"><span className="mt-0.5">{p.status === "completed" ? <CheckCircle2 className="size-5 text-emerald-600" aria-hidden /> : <Circle className="size-5 text-stone-300" aria-hidden />}</span><p className={cx("text-sm", p.status === "completed" ? "font-medium" : "text-stone-400")}>Fertig zum Download</p></li>
          </ol>
          <div className="mt-5 border-t border-stone-100 pt-4 text-xs text-stone-600">
            <div className="flex justify-between"><span>Angefallene Kosten</span><span className="font-medium tabular-nums">{fmtUsd(cost.total)}</span></div>
            {s.estimate && <div className="mt-1 flex justify-between"><span>Schätzung Medien</span><span className="tabular-nums">{fmtUsd(s.estimate.usd)}</span></div>}
            {s.brief.allowPaid && s.brief.budgetUsd > 0 && <div className="mt-1 flex justify-between"><span>Budgetlimit</span><span className="tabular-nums">{fmtUsd(s.brief.budgetUsd)}</span></div>}
          </div>
          <details className="mt-4 text-xs"><summary className="cursor-pointer font-medium text-stone-600">Protokoll</summary><ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">{data.events.map((e) => <li key={e.id} className={e.level === "error" ? "text-red-700" : e.level === "warn" ? "text-amber-800" : "text-stone-500"}><span className="tabular-nums">{new Date(e.ts).toLocaleTimeString("de-DE")}</span> {e.message}</li>)}</ul></details>
        </Card>

        <div className="min-w-0">
          <div role="tablist" aria-label="Bereiche" className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1">
            {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("min-h-9 flex-1 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition", tab === t ? "bg-white shadow-sm" : "text-stone-600 hover:text-ink")}>{t}</button>)}
          </div>

          {tab === "Video" && (!r ? <Card className="grid place-items-center gap-3 p-12 text-center text-sm text-stone-500">{active ? <><Loader2 className="size-6 animate-spin text-accent" aria-hidden />Das Video wird produziert. Diese Seite aktualisiert sich automatisch.</> : "Noch kein Video vorhanden."}</Card> : (
            <div className="grid gap-5 md:grid-cols-[minmax(0,17rem)_1fr]">
              <video key={v} controls playsInline preload="metadata" poster={file("cover")} className={cx("w-full rounded-2xl bg-black shadow-(--shadow-card)", active && "opacity-60")} style={{ aspectRatio: `${r.width}/${r.height}` }}><source src={file("video")} type="video/mp4" /><track kind="captions" srcLang={s.brief.language} label="Untertitel" /></video>
              <div className="space-y-4">
                <Card className="p-5">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    {[["Auflösung", `${r.width} × ${r.height}`], ["Länge", fmtDur(r.durationSec)], ["Sprache", s.brief.language === "de" ? "Deutsch" : "Englisch"], ["Version", `${r.version}`], ["Dateigröße", `${(r.sizeBytes / 1e6).toFixed(1)} MB`], ["Kosten", fmtUsd(cost.total)]].map(([k, val]) => <div key={k}><dt className="text-xs text-stone-500">{k}</dt><dd className="font-medium tabular-nums">{val}</dd></div>)}
                  </dl>
                  {s.qa && <div className="mt-4 flex items-center gap-3 border-t border-stone-100 pt-4"><span className={cx("grid size-12 place-items-center rounded-xl text-base font-semibold", s.qa.verdict === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>{s.qa.score}</span><div className="text-sm"><p className="font-medium">{s.qa.verdict === "approved" ? "Freigegeben" : "Überarbeitung erforderlich"}</p><p className="text-xs text-stone-500">{s.qa.checks.filter((c) => c.passed).length}/{s.qa.checks.length} technische Prüfungen bestanden</p></div></div>}
                </Card>
                {!active && <Card className="p-5">
                  <a href={file("video", "download=1")} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"><Download className="size-4" aria-hidden />Video herunterladen (MP4)</a>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    {[["Untertitel (SRT)", file("srt", "download=1")], ["Cover (JPG)", file("cover", "download=1")], ["Komplettpaket (ZIP)", file("zip")]].map(([label, href]) => <a key={label} href={href} className="flex min-h-10 items-center justify-center rounded-xl border border-stone-200 px-3 text-center font-medium hover:bg-stone-50 last:col-span-2">{label}</a>)}
                  </div>
                  <p className="mt-3 text-xs text-stone-500">Die Datei ({s.brief.aspect}, H.264/AAC) erfüllt die Upload-Vorgaben von TikTok, Reels und Shorts gleichermaßen; plattformspezifisch sind die Texte unter „Veröffentlichen“. Identische Dateien werden nicht mehrfach gerendert.</p>
                  <Button className="mt-3 w-full" busy={busy} onClick={() => action({ type: "newVersion" })}>Neue Version erstellen</Button>
                </Card>}
              </div>
            </div>
          ))}

          {tab === "Szenen" && (!s.script ? <Card className="p-8 text-center text-sm text-stone-500">Das Drehbuch wird noch geschrieben.</Card> : (
            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Hook-Labor</h2><Badge tone={s.script.generatedBy === "regelbasiert" ? "warn" : "accent"}>Drehbuch v{s.script.version} · {s.script.generatedBy}</Badge></div>
                <p className="mt-1 text-xs text-stone-500">{s.script.hookReasoning}</p>
                <ul className="mt-3 space-y-2">{s.script.hooks.map((h, i) => {
                  const on = i === s.script!.chosenHookIndex;
                  return <li key={i} className={cx("rounded-xl border p-3 text-sm", on ? "border-accent bg-accent-soft" : "border-stone-200")}><p className="font-medium">{on && <Check className="mr-1 inline size-4 text-accent" aria-label="gewählt" />}{h.text}</p><p className="mt-1 text-xs text-stone-500">Neugier {h.scores.curiosity} · Klarheit {h.scores.clarity} · Relevanz {h.scores.relevance} · Emotion {h.scores.emotion} · Glaubwürdigkeit {h.scores.credibility}</p>{!on && !active && <Button size="sm" className="mt-2" busy={busy} onClick={() => action({ type: "selectHook", index: i })}>Diesen Hook verwenden</Button>}</li>;
                })}</ul>
              </Card>
              <Card className="p-5">
                <h2 className="text-sm font-semibold">Szene reparieren</h2>
                <p className="mt-1 text-xs text-stone-500">Beschreibe, was an einer Szene nicht passt. Nur die genannte Szene wird neu produziert.</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input aria-label="Reparaturanweisung" className={inputCls} value={repair} onChange={(e) => setRepair(e.target.value)} placeholder="z. B. Szene 3 sieht unrealistisch aus. Erstelle sie neu." /><Button disabled={active || repair.trim().length < 6} busy={busy} onClick={() => action({ type: "repair", instruction: repair }).then(() => setRepair(""))}>Anwenden</Button></div>
              </Card>
              {s.script.scenes.map((sc, i) => {
                const e = edit[sc.id];
                const sub = s.subtitleOverrides?.[sc.id] || sc.voiceover;
                return (
                  <Card key={sc.id} className="p-5">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">Szene {i + 1}</h3><Badge>{sc.role}</Badge><Badge>{s.assets?.[sc.id] ? `${s.assets[sc.id].audioSec.toFixed(1)} s (gemessen)` : `ca. ${sc.estSeconds} s`}</Badge><Badge>Übergang: {sc.transition}</Badge></div>
                    {!e ? (
                      <>
                        <p className="mt-3 text-sm"><span className="text-xs font-medium text-stone-500">Sprechertext</span><br />{sc.voiceover}</p>
                        <p className="mt-2 text-sm"><span className="text-xs font-medium text-stone-500">Bildschirmtext</span><br />{sc.onScreenText || "–"}</p>
                        {s.subtitleOverrides?.[sc.id] && <p className="mt-2 text-sm"><span className="text-xs font-medium text-stone-500">Untertitel (manuell)</span><br />{sub}</p>}
                        <p className="mt-2 text-xs text-stone-500">Bildidee: {sc.visual}</p>
                        {!active && <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => setEdit({ ...edit, [sc.id]: { voiceover: sc.voiceover, onScreenText: sc.onScreenText, subtitle: sub } })}>Bearbeiten</Button><Button size="sm" variant="ghost" busy={busy} onClick={() => action({ type: "regenerateScene", sceneId: sc.id })}>Bildmaterial neu erzeugen</Button></div>}
                      </>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <label className="block text-xs font-medium text-stone-500">Sprechertext<textarea rows={3} className={cx(inputCls, "mt-1 text-ink")} value={e.voiceover} onChange={(ev) => setEdit({ ...edit, [sc.id]: { ...e, voiceover: ev.target.value, subtitle: e.subtitle === e.voiceover ? ev.target.value : e.subtitle } })} /></label>
                        <label className="block text-xs font-medium text-stone-500">Bildschirmtext (max. 5 Wörter)<input className={cx(inputCls, "mt-1 text-ink")} value={e.onScreenText} onChange={(ev) => setEdit({ ...edit, [sc.id]: { ...e, onScreenText: ev.target.value } })} /></label>
                        <label className="block text-xs font-medium text-stone-500">Untertitel (falls abweichend vom Sprechertext)<textarea rows={2} className={cx(inputCls, "mt-1 text-ink")} value={e.subtitle} onChange={(ev) => setEdit({ ...edit, [sc.id]: { ...e, subtitle: ev.target.value } })} /></label>
                        <div className="flex gap-2"><Button size="sm" variant="primary" busy={busy} onClick={async () => {
                          const textChanged = e.voiceover.trim() !== sc.voiceover || e.onScreenText.trim() !== sc.onScreenText;
                          if (textChanged) await action({ type: "editScene", sceneId: sc.id, voiceover: e.voiceover, onScreenText: e.onScreenText });
                          else await action({ type: "setSubtitles", overrides: { ...(s.subtitleOverrides || {}), [sc.id]: e.subtitle } });
                        }}>Speichern und neu produzieren</Button><Button size="sm" variant="ghost" onClick={() => { const n = { ...edit }; delete n[sc.id]; setEdit(n); }}>Verwerfen</Button></div>
                      </div>
                    )}
                  </Card>
                );
              })}
              {!active && <Card className="p-5">
                <h2 className="text-sm font-semibold">Stimme und Untertitelstil</h2>
                <div className="mt-3 flex flex-wrap gap-2">{[["Professionell", "professionell"], ["Emotional, ruhig", "emotional"], ["Dramatisch", "dramatisch"], ["Energisch", "energisch"]].map(([l, val]) => <Button key={val} size="sm" busy={busy} variant={s.brief.tone.toLowerCase().includes(val.slice(0, 5)) ? "primary" : "secondary"} onClick={() => action({ type: "setVoice", tone: val })}>{l}</Button>)}</div>
                <div className="mt-3 flex flex-wrap gap-2">{[["Kräftig", "bold"], ["Dezent mit Hintergrund", "clean"], ["Wort für Wort", "karaoke"]].map(([l, val]) => <Button key={val} size="sm" busy={busy} variant={s.brief.subtitleStyle === val ? "primary" : "secondary"} onClick={() => action({ type: "setSubtitles", style: val })}>{l}</Button>)}</div>
                <p className="mt-2 text-xs text-stone-500">Aktiv: {s.capabilities?.tts}. Weitere Stimmen unter Einstellungen.</p>
              </Card>}
            </div>
          ))}

          {tab === "Strategie" && (!s.strategy ? <Card className="p-8 text-center text-sm text-stone-500">Die Strategie wird noch entwickelt.</Card> : (
            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">Market Intelligence</h2><Badge tone={s.strategy.generatedBy === "regelbasiert" ? "warn" : "accent"}>{s.strategy.generatedBy}</Badge><Badge tone={s.strategy.dataBasis === "current_trend_data" ? "good" : s.strategy.dataBasis === "partial_data" ? "neutral" : "warn"}>{{ current_trend_data: "Aktuelle Trenddaten", partial_data: "Teilweise Daten", no_current_data: "Keine aktuelle Datenbasis" }[s.strategy.dataBasis]}</Badge></div>
                <p className="mt-2 text-sm text-stone-600">{s.strategy.dataBasisNote}</p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{[["Thema", s.strategy.topic], ["Zielgruppe", s.strategy.audience], ["Markt / Sprache", s.strategy.marketLanguage], ["Primäres Interesse", s.strategy.primaryInterest], ["Hook-Strategie", s.strategy.hookStrategy], ["Visueller Stil", s.strategy.visualStyle], ["Emotionaler Auslöser", s.strategy.emotionalTrigger], ["Mehrwert", s.strategy.valueProposition]].map(([k, val]) => <div key={k}><dt className="text-xs text-stone-500">{k}</dt><dd>{val}</dd></div>)}</dl>
                {s.strategy.risks.length > 0 && <div className="mt-4"><p className="text-xs font-medium text-stone-500">Risiken und Unsicherheiten</p><ul className="mt-1 list-disc pl-5 text-sm text-stone-700">{s.strategy.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
              </Card>
              <Card className="p-5">
                <h2 className="text-sm font-semibold">Konzeptvergleich</h2><p className="mt-1 text-xs text-stone-500">{s.strategy.choiceReasoning}</p>
                <div className="mt-3 space-y-2">{s.strategy.concepts.map((c, i) => <div key={i} className={cx("rounded-xl border p-3 text-sm", i === s.strategy!.chosenConceptIndex ? "border-accent bg-accent-soft" : "border-stone-200")}><p className="font-medium">{i === s.strategy!.chosenConceptIndex && "✓ "}{c.title} <span className="font-normal text-stone-500">· {c.format}</span></p><p className="mt-0.5 text-stone-600">{c.angle}</p><p className="mt-1 text-xs text-stone-500">Zielgruppe {c.ratings.audienceFit} · Wachstum {c.ratings.growthPotential} · Originalität {c.ratings.originality} · Umsetzbarkeit {c.ratings.feasibility} · Bindung {c.ratings.retention} — {c.reasoning}</p></div>)}</div>
              </Card>
              {s.research && <Card className="p-5"><h2 className="text-sm font-semibold">Quellen der Recherche</h2><p className="mt-1 text-xs text-stone-500">Erhoben {fmtDate(s.research.fetchedAt)}</p><ul className="mt-2 space-y-1 text-sm">{s.research.sources.map((x) => <li key={x.name}>{x.ok ? "✓" : "–"} {x.name}: <span className="text-stone-500">{x.note}</span></li>)}</ul>{s.research.demand && s.research.demand.articles.length > 0 && <ul className="mt-3 space-y-1 text-xs text-stone-500">{s.research.demand.articles.map((a, i) => <li key={i}>↳ <a className="hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.title}</a></li>)}</ul>}</Card>}
            </div>
          ))}

          {tab === "Qualität" && (!s.qa ? <Card className="p-8 text-center text-sm text-stone-500">Die Qualitätsprüfung folgt nach dem Rendering.</Card> : (
            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex flex-wrap items-center gap-3"><span className={cx("grid size-14 place-items-center rounded-2xl text-xl font-semibold", s.qa.verdict === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>{s.qa.score}</span><div><p className="font-semibold">{s.qa.verdict === "approved" ? "Freigegeben" : "Überarbeitung erforderlich"}</p><p className="text-xs text-stone-500">Version {s.qa.version} · geprüft {fmtDate(s.qa.checkedAt)} · {BASIS[s.qa.reviewMode]}</p></div></div>
                <p className="mt-3 text-xs text-stone-500">{s.qa.disclaimer}</p>
                <ul className="mt-4 space-y-3">{s.qa.categories.map((c) => <li key={c.key}><div className="flex items-baseline justify-between gap-3 text-sm"><span className="font-medium">{c.label} <span className="font-normal text-stone-400">({Math.round(c.weight * 100)} %)</span></span><span className="tabular-nums">{c.score}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100"><div className={cx("h-full rounded-full", c.score >= 70 ? "bg-emerald-500" : c.score >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${c.score}%` }} /></div><p className="mt-1 text-xs text-stone-500"><Badge>{BASIS[c.basis]}</Badge> {c.reason}</p></li>)}</ul>
              </Card>
              <Card className="p-5"><h2 className="text-sm font-semibold">Technische Prüfungen an der fertigen Datei</h2><ul className="mt-3 space-y-2 text-sm">{s.qa.checks.map((c) => <li key={c.id} className="flex gap-2.5">{c.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="bestanden" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" aria-label="nicht bestanden" />}<span><span className="font-medium">{c.label}</span>{c.critical && !c.passed && <Badge tone="bad">kritisch</Badge>}<span className="block text-xs text-stone-500">{c.detail}</span></span></li>)}</ul></Card>
              {s.qa.issues.length > 0 && <Card className="p-5"><h2 className="text-sm font-semibold">Festgestellte Mängel und Aufträge</h2><ul className="mt-3 space-y-3 text-sm">{s.qa.issues.map((x, i) => <li key={i} className="flex gap-2.5"><AlertTriangle className={cx("mt-0.5 size-4 shrink-0", x.severity === "critical" ? "text-red-600" : x.severity === "major" ? "text-amber-600" : "text-stone-400")} aria-hidden /><span><span className="font-medium">{x.description}</span><span className="block text-xs text-stone-500">{{ critical: "Kritisch", major: "Wesentlich", minor: "Gering" }[x.severity]}{x.sceneId && ` · ${x.sceneId}`} · zuständig: {{ script: "Drehbuch-Agent", production: "Produktions-Agent", strategy: "Strategie-Agent" }[x.owner]} — {x.fix}</span></span></li>)}</ul></Card>}
              {s.script && s.script.factNotes.length > 0 && <Card className="p-5"><h2 className="text-sm font-semibold">Tatsachenbehauptungen im Drehbuch</h2><ul className="mt-3 space-y-2 text-sm">{s.script.factNotes.map((f, i) => <li key={i}><Badge tone={f.status === "needs_source" ? "warn" : "neutral"}>{{ verified_common_knowledge: "Allgemeinwissen", needs_source: "Quelle prüfen", fictional_or_hypothetical: "Hypothetisch" }[f.status]}</Badge> {f.claim}<span className="block text-xs break-words text-stone-500">{f.note}</span></li>)}</ul></Card>}
            </div>
          ))}

          {tab === "Veröffentlichen" && (!s.metadata ? <Card className="p-8 text-center text-sm text-stone-500">Die Veröffentlichungstexte entstehen nach der Qualitätsprüfung.</Card> : (
            <div className="space-y-4">
              <Note>Reichweite lässt sich durch gute Metadaten unterstützen, aber nicht garantieren. Es wird nichts automatisch veröffentlicht. {s.metadata.generatedBy === "regelbasiert" && "Diese Texte sind regelbasierte Entwürfe."}</Note>
              {(["tiktok", "reels", "shorts"] as const).map((k) => { const m = s.metadata![k]; return (
                <Card key={k} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{PLATFORM_LABEL[k]}</h2>{r && !active && <a href={file("video", `download=${k}`)} className="text-sm font-medium text-accent hover:underline">{PLATFORM_LABEL[k]}-Version herunterladen</a>}</div>
                  {[["Titel", m.title], ["Beschreibung", m.description], ["Hashtags", m.hashtags.join(" ")], ["Suchbegriffe", m.keywords.join(", ")]].map(([label, text]) => <div key={label} className="mt-3 flex items-start justify-between gap-3 border-t border-stone-100 pt-3"><div className="min-w-0"><p className="text-xs font-medium text-stone-500">{label}</p><p className="mt-0.5 text-sm break-words whitespace-pre-line">{text}</p></div><CopyButton text={text} /></div>)}
                </Card>
              ); })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
