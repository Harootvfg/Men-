"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PenLine, Sparkles, Wallet } from "lucide-react";
import { api, Button, Card, ErrorNote, PageHeader, useData } from "@/components/ui";
import { ProjectGrid, type ProjectSummary } from "@/components/ProjectList";
import { fmtUsd, isActive } from "@/lib/labels";

interface Data { projects: ProjectSummary[]; spend30d: number; prefs: { maxCostUsd: number; allowPaid: boolean } }

export default function Dashboard() {
  const router = useRouter();
  const { data, error } = useData<Data>("/api/projects", (d) => (d?.projects.some((p) => isActive(p.status)) ? 3000 : null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autopilot = async () => {
    setBusy(true); setErr(null);
    try { const { id } = await api<{ id: string }>("/api/projects", { mode: "autopilot", brief: {} }); router.push(`/projects/${id}`); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  const running = data?.projects.filter((p) => isActive(p.status)) || [];
  const done = data?.projects.filter((p) => p.status === "completed") || [];
  const recent = data?.projects.filter((p) => !isActive(p.status)).slice(0, 8) || [];
  return (
    <>
      <PageHeader title="Was möchtest du produzieren?" subtitle="Spezialisierte Agenten übernehmen Recherche, Drehbuch, Produktion und Qualitätsprüfung – bis zur fertigen MP4." />
      {(err || error) && <div className="mb-4"><ErrorNote>{err || error}</ErrorNote></div>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rise relative overflow-hidden p-6 sm:p-7">
          <div className="absolute -top-16 -right-16 size-48 rounded-full bg-accent/10 blur-2xl" aria-hidden />
          <span className="grid size-11 place-items-center rounded-xl bg-accent text-white"><Sparkles className="size-5" aria-hidden /></span>
          <h2 className="mt-4 text-lg font-semibold">Autopilot</h2>
          <p className="mt-1 text-sm text-stone-600">Die KI recherchiert aktuelle Trends, wählt das stärkste Konzept und produziert das Video ohne weitere Eingaben.</p>
          <Button variant="primary" className="mt-5 w-full sm:w-auto" busy={busy} onClick={autopilot}>✨ Virales Video automatisch erstellen</Button>
        </Card>
        <Card className="rise p-6 sm:p-7">
          <span className="grid size-11 place-items-center rounded-xl bg-stone-900 text-white"><PenLine className="size-5" aria-hidden /></span>
          <h2 className="mt-4 text-lg font-semibold">Eigenes Thema</h2>
          <p className="mt-1 text-sm text-stone-600">Beschreibe deine Idee. Die KI stellt ein paar gezielte Rückfragen und produziert danach dein Video.</p>
          <Link href="/create" className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-stone-200 bg-white px-4 text-sm font-medium transition hover:bg-stone-50 sm:w-auto">✍️ Eigenes Video erstellen</Link>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        {[["Laufende Produktionen", String(running.length)], ["Abgeschlossene Videos", String(done.length)], ["API-Kosten (30 Tage)", fmtUsd(data?.spend30d || 0)]].map(([label, value], i) => (
          <Card key={label} className="p-4 sm:p-5">
            <p className="flex items-center gap-1.5 text-xs text-stone-500">{i === 2 && <Wallet className="size-3.5" aria-hidden />}{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{data ? value : "–"}</p>
            {i === 2 && data && <p className="mt-0.5 text-xs text-stone-500">{data.prefs.allowPaid ? (data.prefs.maxCostUsd > 0 ? `Limit ${fmtUsd(data.prefs.maxCostUsd)} pro Video` : "kein Limit gesetzt") : "nur kostenlose Anbieter aktiv"}</p>}
          </Card>
        ))}
      </div>

      {running.length > 0 && (<section className="mt-8"><h2 className="mb-3 text-base font-semibold">Derzeit in Produktion</h2><ProjectGrid projects={running} /></section>)}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Letzte Projekte</h2>{recent.length > 0 && <Link href="/videos" className="text-sm font-medium text-accent hover:underline">Alle ansehen</Link>}</div>
        {data && recent.length === 0 ? <Card className="p-8 text-center text-sm text-stone-500">Noch keine Videos. Starte oben deine erste Produktion.</Card> : <ProjectGrid projects={recent} />}
      </section>
    </>
  );
}
