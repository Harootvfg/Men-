"use client";
import { Card, ErrorNote, PageHeader, useData } from "@/components/ui";
import { ProjectGrid, type ProjectSummary } from "@/components/ProjectList";
import { isActive } from "@/lib/labels";

export default function Videos() {
  const { data, error } = useData<{ projects: ProjectSummary[] }>("/api/projects", (d) => (d?.projects.some((p) => isActive(p.status)) ? 3000 : null));
  return (
    <>
      <PageHeader title="Meine Videos" subtitle="Alle Produktionen mit Qualitätsstatus und Download." />
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && data.projects.length === 0 ? <Card className="p-8 text-center text-sm text-stone-500">Noch keine Videos vorhanden.</Card> : <ProjectGrid projects={data?.projects || []} />}
    </>
  );
}
