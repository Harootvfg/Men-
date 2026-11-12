import { NextResponse } from "next/server";
import { z } from "zod";
import { handler } from "@/lib/api";
import { researchTrends, SCORE_DISCLAIMER } from "@/lib/agents/market";
import { getDb } from "@/lib/db";
import { getPrefs } from "@/lib/settings";

export const dynamic = "force-dynamic";
type G = typeof globalThis & { __vasTrendCache?: { at: number; geo: string; data: Awaited<ReturnType<typeof researchTrends>> } };
const g = globalThis as G;

export const GET = handler(async (req: Request) => {
  const prefs = await getPrefs();
  const url = new URL(req.url);
  const geo = (url.searchParams.get("geo") || prefs.geo).toUpperCase().slice(0, 2);
  const c = g.__vasTrendCache;
  if (!c || c.geo !== geo || url.searchParams.get("refresh") || Date.now() - c.at > 10 * 60_000) g.__vasTrendCache = { at: Date.now(), geo, data: await researchTrends(geo, prefs.language) };
  return NextResponse.json({ ...g.__vasTrendCache!.data, geo, disclaimer: SCORE_DISCLAIMER });
});

const Manual = z.object({ platform: z.enum(["TikTok", "Instagram", "Sonstige"]), title: z.string().trim().min(2).max(200), note: z.string().max(500).optional(), url: z.string().max(500).optional() });
export const POST = handler(async (req: Request) => {
  const m = Manual.parse(await req.json());
  await (await getDb()).query("INSERT INTO manual_trends(platform, title, note, url) VALUES ($1,$2,$3,$4)", [m.platform, m.title, m.note || null, m.url || null]);
  g.__vasTrendCache = undefined;
  return NextResponse.json({ ok: true });
});
