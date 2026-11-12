import { NextResponse } from "next/server";
import { z } from "zod";
import { handler } from "@/lib/api";
import { getPrefs } from "@/lib/settings";
import { listProjects, totalCost } from "@/lib/store";
import { createAndStart } from "@/lib/workflow/engine";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const projects = await listProjects();
  return NextResponse.json({
    projects: projects.map((p) => ({
      id: p.id, mode: p.mode, title: p.title, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt,
      platform: p.state.brief.platform, durationSec: p.state.render?.durationSec ?? null, hasVideo: !!p.state.render,
      coverVersion: p.state.render?.version ?? null, verdict: p.state.qa?.verdict ?? null, score: p.state.qa?.score ?? null, error: p.state.error ?? null,
    })),
    spend30d: await totalCost(30),
    prefs: await getPrefs(),
  });
});

const Body = z.object({ mode: z.enum(["autopilot", "custom"]), brief: z.record(z.string(), z.unknown()).default({}) });
export const POST = handler(async (req: Request) => {
  const { mode, brief } = Body.parse(await req.json());
  const prefs = await getPrefs();
  if (mode === "custom" && !String(brief.topic || "").trim()) return NextResponse.json({ error: "Bitte gib ein Thema ein." }, { status: 400 });
  const p = await createAndStart(mode, {
    language: prefs.language, geo: prefs.geo, durationSec: prefs.durationSec, platform: prefs.platform, profile: prefs.profile,
    budgetUsd: prefs.maxCostUsd, allowPaid: prefs.allowPaid, subtitleStyle: prefs.subtitleStyle, ...brief,
  });
  return NextResponse.json({ id: p.id });
});
