import { NextResponse } from "next/server";
import { z } from "zod";
import { handler } from "@/lib/api";
import { generateQuestions } from "@/lib/agents/questions";
import { getPrefs } from "@/lib/settings";

export const POST = handler(async (req: Request) => {
  const { topic } = z.object({ topic: z.string().trim().min(3, "Bitte beschreibe dein Thema etwas genauer.").max(600) }).parse(await req.json());
  const prefs = await getPrefs();
  return NextResponse.json(await generateQuestions(topic, prefs.language, prefs.geo));
});
