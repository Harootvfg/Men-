"use client";
import Link from "next/link";
import { Download, Film } from "lucide-react";
import { Badge, Card } from "./ui";
import { fmtDate, fmtDur, isActive, PLATFORM_LABEL, STATUS_LABEL } from "@/lib/labels";

export interface ProjectSummary { id: string; mode: string; title: string; status: string; createdAt: string; platform: string; durationSec: number | null; hasVideo: boolean; coverVersion: number | null; verdict: string | null; score: number | null; error: string | null }

export function StatusBadge({ p }: { p: Pick<ProjectSummary, "status" | "verdict"> }) {
  if (p.status === "failed") return <Badge tone="bad">Fehlgeschlagen</Badge>;
  if (p.status === "cancelled") return <Badge>Abgebrochen</Badge>;
  if (isActive(p.status)) return <Badge tone="accent"><span className="size-1.5 rounded-full bg-accent pulse-ring" />{STATUS_LABEL[p.status]}</Badge>;
  return p.verdict === "approved" ? <Badge tone="good">Freigegeben</Badge> : <Badge tone="warn">Überarbeitung erforderlich</Badge>;
}

export function ProjectGrid({ projects }: { projects: ProjectSummary[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {projects.map((p) => (
        <Card key={p.id} className="rise group overflow-hidden transition hover:-translate-y-0.5">
          <Link href={`/projects/${p.id}`} className="block">
            <div className="relative aspect-[9/12] bg-stone-100">
              {p.hasVideo ? <img src={`/api/projects/${p.id}/file/cover?v=${p.coverVersion}`} alt="" className="size-full object-cover" loading="lazy" /> : <div className="grid size-full place-items-center text-stone-300"><Film className="size-10" aria-hidden /></div>}
              {p.durationSec != null && <span className="absolute right-2 bottom-2 rounded-md bg-black/65 px-1.5 py-0.5 text-xs font-medium text-white">{fmtDur(p.durationSec)}</span>}
            </div>
            <div className="p-3.5">
              <p className="line-clamp-2 min-h-10 text-sm font-medium">{p.title}</p>
              <p className="mt-1 text-xs text-stone-500">{fmtDate(p.createdAt)} · {PLATFORM_LABEL[p.platform]}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5"><StatusBadge p={p} />{p.score != null && !isActive(p.status) && <Badge>{p.score}/100</Badge>}</div>
            </div>
          </Link>
          {p.hasVideo && !isActive(p.status) && (
            <a href={`/api/projects/${p.id}/file/video?download=1`} className="flex min-h-11 items-center justify-center gap-2 border-t border-stone-100 text-sm font-medium text-accent hover:bg-accent-soft"><Download className="size-4" aria-hidden />Herunterladen</a>
          )}
        </Card>
      ))}
    </div>
  );
}
