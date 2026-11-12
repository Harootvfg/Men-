import { describe, expect, it } from "vitest";
import { scoreCandidates } from "@/lib/agents/market";
import { planRevision } from "@/lib/agents/quality";
import { detectFromPrompt, heuristicQuestions } from "@/lib/agents/questions";
import { topicForms } from "@/lib/agents/script";
import { buildCues, chunkText, layout, parseSrt, safeArea, toAss, toSrt, validateCues } from "@/lib/render/subtitles";
import { Brief, type QaReport, type Scene, type TrendSignal } from "@/lib/schemas";

const scene = (id: string, voiceover: string): Scene => ({ id, role: "build", voiceover, onScreenText: "Titel", visual: "x", transition: "fade", sfx: "none", emotion: "", estSeconds: 3 });
const sig = (over: Partial<TrendSignal>): TrendSignal => ({ id: "a", title: "Thema A", source: "Google Trends", sourceUrl: "", fetchedAt: new Date().toISOString(), publishedAt: new Date().toISOString(), geo: "DE", metricLabel: "Suchen", metricValue: 1000, context: [], ...over });

describe("Untertitel", () => {
  const timings = [
    { scene: scene("s1", "Das ist der erste Satz. Und hier kommt direkt der zweite, etwas längere Satz hinterher."), start: 0, duration: 6.35, speechSec: 6 },
    { scene: scene("s2", "Kurzer Schluss."), start: 6.35, duration: 2.35, speechSec: 2 },
  ];
  it("erzeugt lückenlose, nicht überlappende Cues innerhalb der Szenen", () => {
    const cues = buildCues(timings, 21, "bold");
    expect(cues.length).toBeGreaterThan(2);
    expect(validateCues(cues, 8.7, 44)).toEqual([]);
    expect(cues.filter((c) => c.sceneId === "s2")[0].start).toBeGreaterThanOrEqual(6.35);
    expect(cues.map((c) => c.text).join(" ")).toBe(timings.map((t) => t.scene.voiceover).join(" "));
  });
  it("SRT lässt sich verlustfrei wieder einlesen", () => {
    const srt = toSrt(buildCues(timings, 21, "bold"));
    const parsed = parseSrt(srt);
    expect(parsed.length).toBeGreaterThan(1);
    expect(parsed[0].start).toBeCloseTo(0.03, 2);
    expect(validateCues(parsed, 8.7, 44)).toEqual([]);
  });
  it("Wort-für-Wort-Stil liefert ein Cue pro Wort", () => {
    expect(chunkText("eins zwei drei", 20, true)).toEqual(["eins", "zwei", "drei"]);
  });
  it("hält Untertitel aus den Sperrzonen der Plattform-UI", () => {
    for (const platform of ["tiktok", "reels", "shorts"]) {
      const L = layout(platform, 1080, 1920), safe = safeArea(platform, 1080, 1920);
      expect(L.subMarginV).toBeGreaterThanOrEqual(safe.bottom);
      expect(L.headMarginV).toBeGreaterThanOrEqual(safe.top);
    }
  });
  it("ASS entfernt Steuerzeichen aus Nutzertext", () => {
    const t = [{ scene: { ...scene("s1", "Hallo {\\b1}Welt"), onScreenText: "{\\pos(0,0)}Titel" }, start: 0, duration: 3, speechSec: 2.5 }];
    const ass = toAss({ width: 1080, height: 1920, platform: "tiktok", style: "bold", font: "Inter", accent: "#22D3EE", watermark: "", timings: t, cues: buildCues(t, 21, "bold"), leadIn: [] });
    expect(ass).not.toContain("\\pos(0,0)");
    expect(ass).not.toContain("{\\b1}");
  });
  it("meldet kaputte Cues", () => {
    expect(validateCues([{ start: 2, end: 1, text: "x" }, { start: 0.5, end: 30, text: "" }], 10, 44).length).toBeGreaterThanOrEqual(3);
  });
});

describe("Trend-Score", () => {
  it("bleibt zwischen 0 und 100 und kennzeichnet die Evidenzart", () => {
    const [c] = scoreCandidates([{ name: "g", ok: true, note: "", signals: [sig({})] }]);
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(100);
    expect(c.components.reduce((a, k) => a + k.weight, 0)).toBeCloseTo(1);
    expect(c.components.find((k) => k.name === "Umsetzbarkeit")!.evidence).toBe("estimated");
    expect(c.growth).toMatch(/kein Vergleichswert/);
  });
  it("führt dasselbe Thema aus mehreren Quellen zusammen und belohnt Bestätigung", () => {
    const res = scoreCandidates([
      { name: "g", ok: true, note: "", signals: [sig({ title: "Mondfinsternis" }), sig({ id: "b", title: "Anderes Thema" })] },
      { name: "w", ok: true, note: "", signals: [sig({ id: "w1", title: "mondfinsternis", source: "Wikipedia" })] },
    ]);
    expect(res).toHaveLength(2);
    expect(res[0].title).toBe("Mondfinsternis");
    expect(res[0].signals).toHaveLength(2);
  });
  it("stuft sensible Nachrichtenthemen herab und markiert sie", () => {
    const [a, b] = scoreCandidates([{ name: "g", ok: true, note: "", signals: [sig({ title: "Neuer Kinofilm" }), sig({ id: "x", title: "Schauspieler gestorben" })] }]);
    expect(a.title).toBe("Neuer Kinofilm");
    expect(b.risk).toBeTruthy();
  });
  it("berechnet Wachstum nur mit echtem Vergleichswert", () => {
    const [c] = scoreCandidates([{ name: "g", ok: true, note: "", signals: [sig({ metricValue: 1500 })] }], { a: 1000 });
    expect(c.growth).toMatch(/\+50 %/);
  });
  it("veraltete Signale verlieren Aktualität", () => {
    const old = scoreCandidates([{ name: "g", ok: true, note: "", signals: [sig({ publishedAt: new Date(Date.now() - 80 * 36e5).toISOString() })] }])[0];
    expect(old.components.find((k) => k.name === "Aktualität")!.value).toBe(0);
  });
});

describe("Rückfragen", () => {
  it("erkennt Angaben aus dem Prompt", () => {
    const d = detectFromPrompt("Ein emotionales Video über Disziplin, 45 Sekunden, auf Englisch für TikTok");
    expect(d).toEqual(expect.arrayContaining([{ field: "durationSec", value: "45" }, { field: "language", value: "en" }, { field: "tone", value: "Emotional" }, { field: "platform", value: "tiktok" }]));
  });
  it("fragt Erkanntes nicht erneut und variiert je nach Thema", () => {
    const a = heuristicQuestions("Ein emotionales Motivationsvideo über Disziplin");
    const b = heuristicQuestions("Was würde passieren, wenn die Sonne plötzlich verschwinden würde?");
    expect(a.questions.some((q) => q.field === "tone")).toBe(false);
    expect(b.questions.some((q) => q.field === "tone")).toBe(true);
    expect(a.questions[0].question).not.toBe(b.questions[0].question);
    for (const set of [a, b]) {
      expect(set.questions.length).toBeGreaterThanOrEqual(3);
      expect(set.questions.length).toBeLessThanOrEqual(5);
      for (const q of set.questions) expect(q.options.at(-1)!.value).toBe("auto");
    }
  });
});

describe("Drehbuch-Hilfen", () => {
  it("bereinigt Auftragsformulierungen und erkennt Fragen", () => {
    const f = topicForms("Erstelle ein spannendes Video darüber, was passieren würde, wenn die Sonne verschwindet.", true);
    expect(f.topic).toBe("Was passieren würde, wenn die Sonne verschwindet");
    expect(f.isQuestion).toBe(true);
    expect(f.short.split(" ").length).toBeLessThanOrEqual(5);
    expect(topicForms("Kaffee", true)).toMatchObject({ topic: "Kaffee", isQuestion: false, short: "Kaffee" });
  });
});

describe("Qualitäts-Verbesserungsschleife", () => {
  const base: QaReport = { version: 1, checkedAt: "", checks: [], categories: [], score: 80, verdict: "needs_revision", issues: [], reviewMode: "heuristic", disclaimer: "" };
  it("plant nichts für freigegebene Videos", () => {
    expect(planRevision({ ...base, verdict: "approved" }, true)).toBeNull();
  });
  it("leitet technische Mängel an die Produktion", () => {
    const plan = planRevision({ ...base, issues: [{ severity: "critical", category: "technical", sceneId: null, description: "Schwarzbild", fix: "", owner: "production" }] }, false);
    expect(plan).toMatchObject({ rerender: true, sceneOrders: [] });
  });
  it("leitet Textmängel nur mit Sprachmodell an den Drehbuch-Agenten und vermeidet sinnlose Runden", () => {
    const issues: QaReport["issues"] = [{ severity: "major", category: "script", sceneId: "s2", description: "zu lang", fix: "kürzen", owner: "script" }];
    expect(planRevision({ ...base, issues }, true)!.sceneOrders).toHaveLength(1);
    expect(planRevision({ ...base, issues }, false)).toBeNull();
  });
});

describe("Briefing-Schema", () => {
  it("setzt sichere Standardwerte: nichts Kostenpflichtiges ohne Freigabe", () => {
    const b = Brief.parse({ topic: "x" });
    expect(b.allowPaid).toBe(false);
    expect(b.aspect).toBe("9:16");
  });
  it("weist unzulässige Werte zurück", () => {
    expect(() => Brief.parse({ durationSec: 900 })).toThrow();
    expect(() => Brief.parse({ aspect: "3:2" })).toThrow();
  });
});
