import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Uniform error envelope so the UI can always show an understandable message. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try { return await fn(...args); } catch (e) {
      if (e instanceof ZodError) return NextResponse.json({ error: "Ungültige Eingabe: " + e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
      if (e instanceof SyntaxError) return NextResponse.json({ error: "Ungültige Anfrage (kein gültiges JSON)." }, { status: 400 });
      console.error(JSON.stringify({ t: new Date().toISOString(), level: "error", message: e instanceof Error ? e.stack : String(e) }));
      return NextResponse.json({ error: e instanceof Error ? e.message : "Unbekannter Fehler" }, { status: 500 });
    }
  };
}
