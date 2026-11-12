import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { estimateCost } from "@/lib/agents/production";
import { Brief } from "@/lib/schemas";
import { getPrefs } from "@/lib/settings";
import { getLlm } from "@/lib/providers/llm";

export const POST = handler(async (req: Request) => {
  const prefs = await getPrefs();
  const brief = Brief.parse({ allowPaid: prefs.allowPaid, budgetUsd: prefs.maxCostUsd, ...(await req.json()) });
  const est = await estimateCost({ brief, revisions: 0, steps: {} });
  const llm = await getLlm();
  return NextResponse.json({ ...est, llm: llm?.name || null, note: llm ? "Zusätzlich fallen Sprachmodell-Kosten an (typisch wenige Cent pro Video, abhängig vom Modell)." : "Kein Sprachmodell konfiguriert: Texte entstehen regelbasiert, es fallen keine API-Kosten an." });
});
