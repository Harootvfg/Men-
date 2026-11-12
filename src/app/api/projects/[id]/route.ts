import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { deleteProject, getProject, listEvents, projectCost } from "@/lib/store";
import { isRunning, STEP_LABEL } from "@/lib/workflow/engine";
import { STEPS } from "@/lib/schemas";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const p = await getProject(id);
  if (!p) return NextResponse.json({ error: "Projekt nicht gefunden." }, { status: 404 });
  // Strip server file paths from what the browser sees.
  const assets = Object.fromEntries(Object.entries(p.state.assets || {}).map(([k, a]) => [k, { audioSec: a.audioSec, visualProvider: a.visualProvider, ttsProvider: a.ttsProvider }]));
  return NextResponse.json({
    project: { ...p, state: { ...p.state, assets } }, running: isRunning(id), events: await listEvents(id), cost: await projectCost(id),
    steps: STEPS.map((s) => ({ name: s, label: STEP_LABEL[s], ...(p.state.steps[s] || { status: "pending" }) })),
  });
});

export const DELETE = handler(async (_req: Request, { params }: P) => {
  const { id } = await params;
  if (isRunning(id)) return NextResponse.json({ error: "Bitte zuerst die laufende Produktion abbrechen." }, { status: 409 });
  await deleteProject(id);
  return NextResponse.json({ ok: true });
});
