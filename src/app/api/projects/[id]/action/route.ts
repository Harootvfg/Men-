import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { applyAction, cancel, resume, type Action } from "@/lib/workflow/engine";

type P = { params: Promise<{ id: string }> };
export const POST = handler(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as { type: string } & Record<string, unknown>;
  if (body.type === "cancel") { await cancel(id); return NextResponse.json({ ok: true, message: "Abbruch angefordert." }); }
  if (body.type === "resume") { await resume(id); return NextResponse.json({ ok: true, message: "Produktion wird fortgesetzt." }); }
  const res = await applyAction(id, body as unknown as Action);
  return NextResponse.json(res, { status: res.ok ? 200 : 409 });
});
