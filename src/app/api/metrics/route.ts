import { NextResponse } from "next/server";
import { z } from "zod";
import { handler } from "@/lib/api";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = handler(async () => {
  const rows = await (await getDb()).query(`SELECT m.id, m.project_id, p.title, m.platform, m.published_at, m.recorded_at, m.views, m.likes, m.comments, m.shares, m.retention_pct,
    p.state->'strategy'->'concepts'->((p.state->'strategy'->>'chosenConceptIndex')::int)->>'format' AS format
    FROM metrics m JOIN projects p ON p.id = m.project_id ORDER BY m.recorded_at DESC LIMIT 500`);
  return NextResponse.json({ rows });
});
const M = z.object({ projectId: z.string(), platform: z.enum(["tiktok", "reels", "shorts"]), publishedAt: z.string().optional(), views: z.number().int().min(0), likes: z.number().int().min(0).default(0), comments: z.number().int().min(0).default(0), shares: z.number().int().min(0).default(0), retentionPct: z.number().min(0).max(100).optional() });
export const POST = handler(async (req: Request) => {
  const m = M.parse(await req.json());
  await (await getDb()).query("INSERT INTO metrics(project_id, platform, published_at, views, likes, comments, shares, retention_pct) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [m.projectId, m.platform, m.publishedAt || null, m.views, m.likes, m.comments, m.shares, m.retentionPct ?? null]);
  return NextResponse.json({ ok: true });
});
