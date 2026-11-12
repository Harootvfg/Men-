"use client";
import { useState } from "react";
import { api, Button, Card, ErrorNote, Field, inputCls, Note, PageHeader, useData } from "@/components/ui";
import type { ProjectSummary } from "@/components/ProjectList";
import { PLATFORM_LABEL } from "@/lib/labels";

interface Row { id: number; project_id: string; title: string; platform: string; published_at: string | null; views: number; likes: number; comments: number; shares: number; retention_pct: number | null; format: string | null }

export default function Analytics() {
  const { data, error, reload } = useData<{ rows: Row[] }>("/api/metrics");
  const { data: pd } = useData<{ projects: ProjectSummary[] }>("/api/projects");
  const videos = pd?.projects.filter((p) => p.hasVideo) || [];
  const [f, setF] = useState({ projectId: "", platform: "tiktok", publishedAt: "", views: "", likes: "", comments: "", shares: "", retentionPct: "" });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      await api("/api/metrics", { projectId: f.projectId || videos[0]?.id, platform: f.platform, publishedAt: f.publishedAt || undefined, views: Number(f.views || 0), likes: Number(f.likes || 0), comments: Number(f.comments || 0), shares: Number(f.shares || 0), retentionPct: f.retentionPct ? Number(f.retentionPct) : undefined });
      setF({ ...f, views: "", likes: "", comments: "", shares: "", retentionPct: "" }); await reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const rows = data?.rows || [];
  // Latest entry per video+platform counts; earlier ones are history.
  const latest = [...new Map([...rows].reverse().map((r) => [`${r.project_id}:${r.platform}`, r])).values()];
  const group = (key: (r: Row) => string) => [...latest.reduce((m, r) => { const k = key(r); const g = m.get(k) || { n: 0, views: 0, inter: 0 }; g.n++; g.views += r.views; g.inter += r.likes + r.comments + r.shares; return m.set(k, g); }, new Map<string, { n: number; views: number; inter: number }>())];
  const num = (k: keyof typeof f, label: string) => <Field label={label}><input inputMode="numeric" className={inputCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, "") })} /></Field>;
  return (
    <>
      <PageHeader title="Analytics" subtitle="Echte Kennzahlen deiner veröffentlichten Videos. Es werden keine Werte geschätzt oder erfunden." />
      {(error || err) && <div className="mb-4"><ErrorNote>{error || err}</ErrorNote></div>}
      <div className="mb-4"><Note>Eine automatische Anbindung von Plattformkonten ist noch nicht umgesetzt. Bis dahin trägst du Kennzahlen aus den Plattform-Statistiken hier ein. Auswertungen unten sind bei wenigen Videos nur Beobachtungen, keine belastbaren Erkenntnisse.</Note></div>
      {latest.length === 0 ? <Card className="p-8 text-center text-sm text-stone-500">Noch keine Kennzahlen erfasst.</Card> : (
        <div className="grid gap-4 md:grid-cols-2">
          {[["Plattformvergleich", group((r) => PLATFORM_LABEL[r.platform])], ["Nach Videoformat", group((r) => r.format || "ohne Angabe")]].map(([title, g]) => (
            <Card key={title as string} className="p-5"><h2 className="text-sm font-semibold">{title as string}</h2>
              <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs text-stone-500"><th className="pb-2 font-medium">Gruppe</th><th className="pb-2 font-medium">Videos</th><th className="pb-2 font-medium">Ø Aufrufe</th><th className="pb-2 font-medium">Interaktionsrate</th></tr></thead>
                <tbody>{(g as [string, { n: number; views: number; inter: number }][]).map(([k, v]) => <tr key={k} className="border-t border-stone-100"><td className="py-2">{k}</td><td className="tabular-nums">{v.n}</td><td className="tabular-nums">{Math.round(v.views / v.n).toLocaleString("de-DE")}</td><td className="tabular-nums">{v.views ? ((v.inter / v.views) * 100).toFixed(1) + " %" : "–"}</td></tr>)}</tbody></table>
              {latest.length < 10 && <p className="mt-3 text-xs text-stone-500">Nur {latest.length} Datenpunkt(e): Unterschiede können Zufall sein.</p>}
            </Card>
          ))}
          <Card className="overflow-x-auto p-5 md:col-span-2"><h2 className="text-sm font-semibold">Erfasste Kennzahlen</h2>
            <table className="mt-3 w-full min-w-[36rem] text-sm"><thead><tr className="text-left text-xs text-stone-500">{["Video", "Plattform", "Veröffentlicht", "Aufrufe", "Likes", "Kommentare", "Geteilt", "Bindung"].map((h) => <th key={h} className="pb-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>{latest.map((r) => <tr key={r.id} className="border-t border-stone-100"><td className="max-w-48 truncate py-2 pr-3">{r.title}</td><td>{PLATFORM_LABEL[r.platform]}</td><td>{r.published_at ? new Date(r.published_at).toLocaleDateString("de-DE") : "–"}</td><td className="tabular-nums">{r.views.toLocaleString("de-DE")}</td><td className="tabular-nums">{r.likes}</td><td className="tabular-nums">{r.comments}</td><td className="tabular-nums">{r.shares}</td><td className="tabular-nums">{r.retention_pct != null ? r.retention_pct + " %" : "–"}</td></tr>)}</tbody></table>
          </Card>
        </div>
      )}
      <Card className="mt-6 p-5">
        <h2 className="text-base font-semibold">Kennzahlen eintragen</h2>
        {videos.length === 0 ? <p className="mt-2 text-sm text-stone-500">Sobald du ein Video produziert hast, kannst du hier seine Kennzahlen erfassen.</p> : <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Video"><select className={inputCls} value={f.projectId || videos[0].id} onChange={(e) => setF({ ...f, projectId: e.target.value })}>{videos.map((v) => <option key={v.id} value={v.id}>{v.title.slice(0, 50)}</option>)}</select></Field>
            <Field label="Plattform"><select className={inputCls} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{Object.entries(PLATFORM_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Veröffentlicht am"><input type="date" className={inputCls} value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} /></Field>
            {num("views", "Aufrufe")}{num("likes", "Likes")}{num("comments", "Kommentare")}{num("shares", "Geteilt")}{num("retentionPct", "Zuschauerbindung in %")}
          </div>
          <Button variant="primary" className="mt-4" disabled={!f.views} onClick={save}>Speichern</Button>
        </>}
      </Card>
    </>
  );
}
