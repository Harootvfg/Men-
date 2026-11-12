import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { hasBinary } from "@/lib/exec";
import { getPrefs, secretStatus, setPrefs, setSecret, SECRET_NAMES, type SecretName } from "@/lib/settings";

export const dynamic = "force-dynamic";
const view = async () => ({ prefs: await getPrefs(), secrets: await secretStatus(), system: { ffmpeg: await hasBinary("ffmpeg"), espeak: await hasBinary("espeak-ng"), database: process.env.DATABASE_URL ? "PostgreSQL (DATABASE_URL)" : "Eingebettetes PostgreSQL (PGlite)" } });

export const GET = handler(async () => NextResponse.json(await view()));
export const POST = handler(async (req: Request) => {
  const body = (await req.json()) as { prefs?: unknown; secrets?: Record<string, string> };
  if (body.prefs) await setPrefs(body.prefs);
  // Keys are write-only: they are encrypted at rest and never sent back to the browser.
  for (const [k, v] of Object.entries(body.secrets || {})) if ((SECRET_NAMES as readonly string[]).includes(k) && typeof v === "string") await setSecret(k as SecretName, v);
  return NextResponse.json(await view());
});
