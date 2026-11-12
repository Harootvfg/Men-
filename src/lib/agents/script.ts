import { getLlm } from "../providers/llm";
import { Script, Scene, type Brief, type Hook, type ProjectState, type Strategy } from "../schemas";
import { z } from "zod";

/** Narration pace used for planning. Measured audio later replaces this estimate. */
export const WORDS_PER_SEC = 2.45;
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const estimateSeconds = (text: string) => wordCount(text) / WORDS_PER_SEC + 0.35;

const hook = (text: string, s: number[]): Hook => ({ text, scores: { curiosity: s[0], clarity: s[1], relevance: s[2], emotion: s[3], credibility: s[4] } });
export const hookTotal = (h: Hook) => h.scores.curiosity * 0.3 + h.scores.clarity * 0.2 + h.scores.relevance * 0.2 + h.scores.emotion * 0.15 + h.scores.credibility * 0.15;

/** Derives speakable forms of a free-text topic (strips "create a video about …", detects questions). */
export function topicForms(input: string, de: boolean) {
  let topic = input.trim().replace(/^(bitte\s+)?(erstelle|erstell|mach|mache|generiere|produziere|create|make|generate)\b[^,:]*?\b(video|clip|reel|short)s?\b\s*(darüber|über|zum thema|zu|about|on)?[\s,:]*/i, "").replace(/[.?!\s]+$/, "");
  if (!topic) topic = input.trim().replace(/[.?!\s]+$/, "");
  topic = topic.charAt(0).toUpperCase() + topic.slice(1);
  const isQuestion = /^(was|wie|warum|wieso|weshalb|wer|wann|wo|what|why|how|who|when|where)\b/i.test(topic) || /\?\s*$/.test(input);
  const words = topic.split(/\s+/);
  return { topic, isQuestion, ref: isQuestion ? (de ? "diese Frage" : "this question") : topic, short: words.length > 5 ? words.slice(0, 4).join(" ") + " …" : topic };
}

/** Template script for the rule-based mode. Structure is real; statements are placeholders tied to supplied context only. */
export function heuristicScript(state: ProjectState): Script {
  const st = state.strategy!;
  const b = state.brief;
  const de = b.language === "de";
  const { topic, isQuestion, ref, short } = topicForms(st.topic, de);
  const ctx = (state.research?.candidates.find((c) => c.title === st.topic && !c.risk)?.signals.flatMap((s) => s.context) || state.research?.demand?.articles || []).slice(0, 2);
  const hooks = de
    ? [hook(isQuestion ? `${topic}?` : `${topic} – warum spricht gerade jeder darüber?`, [7, 8, 7, 5, 8]), hook(isQuestion ? `Eine Frage, die kaum jemand beantworten kann: ${topic}?` : `Hast du dich schon mal gefragt, was hinter ${topic} steckt?`, [6, 7, 7, 5, 7]), hook(isQuestion ? `${topic}? Die Antwort in ${b.durationSec} Sekunden.` : `In ${b.durationSec} Sekunden verstehst du ${topic}.`, [5, 9, 7, 4, 7])]
    : [hook(isQuestion ? `${topic}?` : `${topic} – why is everyone talking about it?`, [7, 8, 7, 5, 8]), hook(isQuestion ? `A question almost nobody can answer: ${topic}?` : `Ever wondered what's really behind ${topic}?`, [6, 7, 7, 5, 7]), hook(isQuestion ? `${topic}? The answer in ${b.durationSec} seconds.` : `Understand ${topic} in ${b.durationSec} seconds.`, [5, 9, 7, 4, 7])];
  const chosen = hooks.map(hookTotal).reduce((best, v, i, a) => (v > a[best] ? i : best), 0);
  const clean = (t: string) => t.replace(/\s[|–-]\s[^|–-]+$/, "").trim();
  const mid = ctx.length
    ? ctx.map((c, i) => ({ vo: de ? `${i === 0 ? "Aktuell heißt es" : "Außerdem berichtet"} ${c.source ? "bei " + c.source : "in den Nachrichten"}: ${clean(c.title)}.` : `${i === 0 ? "Right now" : "Also,"} ${c.source || "the news"} reports: ${clean(c.title)}.`, text: de ? (i === 0 ? "Das ist passiert" : "Und außerdem") : i === 0 ? "What happened" : "Also" }))
    : [{ vo: de ? `Zuerst das Wichtigste: ${ref.charAt(0).toUpperCase() + ref.slice(1)} betrifft mehr Menschen, als man denkt.` : `First things first: ${ref} affects more people than you'd think.`, text: de ? "Das Wichtigste zuerst" : "First things first" },
       { vo: de ? "Der entscheidende Punkt ist, wie die einzelnen Teile zusammenhängen." : "The key is how the pieces fit together.", text: de ? "Der entscheidende Punkt" : "The key point" }];
  const raw: Scene[] = [
    { id: "s1", role: "hook", voiceover: hooks[chosen].text, onScreenText: short, visual: `Opening shot for: ${topic}`, transition: "cut", sfx: "impact", emotion: "Neugier", estSeconds: 0 },
    ...mid.map((m, i): Scene => ({ id: `s${i + 2}`, role: "build", voiceover: m.vo, onScreenText: m.text, visual: `Illustrative shot ${i + 1} for: ${topic}`, transition: i % 2 ? "slideup" : "slideleft", sfx: "whoosh", emotion: "Interesse", estSeconds: 0 })),
    { id: `s${mid.length + 2}`, role: "payoff", voiceover: de ? (isQuestion ? "Genau deshalb lohnt es sich, hier genauer hinzusehen." : `Genau deshalb lohnt es sich, bei ${topic} genauer hinzusehen.`) : isQuestion ? "That's exactly why this deserves a closer look." : `That's exactly why ${topic} deserves a closer look.`, onScreenText: de ? "Darum ist es wichtig" : "Why it matters", visual: `Resolution shot for: ${topic}`, transition: "fade", sfx: "rise", emotion: "Aha-Moment", estSeconds: 0 },
    { id: `s${mid.length + 3}`, role: "cta", voiceover: de ? "Was denkst du darüber? Schreib es in die Kommentare." : "What do you think? Tell me in the comments.", onScreenText: de ? "Deine Meinung?" : "Your take?", visual: "Calm closing background", transition: "fade", sfx: "none", emotion: "Einladung", estSeconds: 0 },
  ];
  const scenes: Scene[] = raw.map((s) => ({ ...s, estSeconds: Number(estimateSeconds(s.voiceover).toFixed(1)) }));
  return {
    title: topic, hooks, chosenHookIndex: chosen, hookReasoning: "Regelbasierte Auswahl nach gewichteter Hook-Bewertung (Vorlagenwerte).",
    scenes, narrativeArc: "Frage → Einordnung → Bedeutung → Einladung zur Diskussion", cta: scenes[scenes.length - 1].voiceover,
    factNotes: ctx.map((c) => ({ claim: clean(c.title), status: "needs_source" as const, note: `Zitat einer Schlagzeile (${c.source || "Quelle unbekannt"}), inhaltlich nicht geprüft: ${c.url}` })),
    selfCritique: { hook: 5, clarity: 7, dramaturgy: 4, originality: 3, audienceFit: 5, timing: 7, visualFeasibility: 8,
      weaknesses: ["Vorlagentext ohne Sprachmodell: keine eigene Recherche, wenig Originalität.", "Szenentexte sollten im Video Studio inhaltlich überarbeitet werden."] },
  };
}

const SYSTEM = (b: Brief) => `Du bist der Elite Scriptwriter eines Kurzvideo-Studios. Du schreibst ein zeitlich strukturiertes Produktionsskript.
Vorgaben:
- Sprache: ${b.language}. Ziel-Dauer: ${b.durationSec} Sekunden gesprochen, Sprechtempo ca. ${WORDS_PER_SEC} Wörter pro Sekunde. Das Voiceover aller Szenen zusammen darf höchstens ${Math.round(b.durationSec * WORDS_PER_SEC)} Wörter haben.
- 4 bis 8 Szenen mit IDs s1, s2, …; die erste Szene (role "hook") spricht exakt den gewählten Hook.
- Entwickle 3 bis 5 Hooks, bewerte sie ehrlich (0–10) und wähle den stärksten. Keine irreführenden Versprechen, kein Clickbait ohne Einlösung.
- voiceover: natürlich gesprochen, kurze Sätze, keine Emojis, keine Regieanweisungen, Zahlen ausgeschrieben, wenn sie gesprochen besser klingen.
- onScreenText: höchstens 5 Wörter, fehlerfrei, ergänzt das Gesprochene statt es zu wiederholen.
- visual: englische, konkrete Bildbeschreibung für ein Videomodell (Motiv, Bewegung, Licht, Kamerastil), ohne Text im Bild, ohne reale Personen oder Marken.
- estSeconds je Szene = Wörter / ${WORDS_PER_SEC}.
- factNotes: Liste jede Tatsachenbehauptung. "verified_common_knowledge" nur für gesichertes Allgemeinwissen; alles andere "needs_source"; Gedankenspiele als "fictional_or_hypothetical". Schreibe nichts als Fakt, dessen du dir nicht sicher bist.
- Vermeide leere Phrasen und austauschbare KI-Floskeln. Jeder Satz muss Information oder Spannung tragen.
- selfCritique: bewerte streng (0–10) und nenne konkrete Schwächen.`;

async function fitToDuration(script: Script, b: Brief, llm: NonNullable<Awaited<ReturnType<typeof getLlm>>>, projectId: string, critiqueHint: string): Promise<Script> {
  const words = script.scenes.reduce((a, s) => a + wordCount(s.voiceover), 0);
  const max = Math.round(b.durationSec * WORDS_PER_SEC * 1.15);
  const sc = script.selfCritique;
  const weak = Math.min(sc.hook, sc.clarity, sc.dramaturgy, sc.originality, sc.audienceFit, sc.timing, sc.visualFeasibility) < 6;
  if (words <= max && !weak) return script;
  return llm.generate({
    agent: "scriptwriter_revision", projectId, schema: Script, effort: "medium", system: SYSTEM(b),
    prompt: `Überarbeite dieses Skript gezielt. ${words > max ? `Es hat ${words} Wörter Voiceover, erlaubt sind höchstens ${Math.round(b.durationSec * WORDS_PER_SEC)}. Kürze, ohne den Spannungsbogen zu zerstören. ` : ""}${weak ? `Behebe die Schwächen aus deiner Selbstkritik: ${sc.weaknesses.join("; ")}. ` : ""}${critiqueHint}
Gib das vollständige überarbeitete Skript zurück.\n\n${JSON.stringify(script)}`,
  });
}

function normalise(s: Script): Script {
  const ids = new Set<string>();
  s.scenes = s.scenes.map((sc, i) => {
    let id = sc.id && !ids.has(sc.id) ? sc.id : `s${i + 1}`;
    while (ids.has(id)) id += "x";
    ids.add(id);
    return { ...sc, id, estSeconds: Number(estimateSeconds(sc.voiceover).toFixed(1)), transition: i === 0 ? "cut" : sc.transition };
  });
  s.chosenHookIndex = Math.min(s.chosenHookIndex, s.hooks.length - 1);
  return s;
}

export async function runScript(state: ProjectState, projectId: string): Promise<Script & { version: number; generatedBy: string }> {
  const version = (state.script?.version || 0) + 1;
  const llm = await getLlm();
  if (!llm) return { ...normalise(heuristicScript(state)), version, generatedBy: "regelbasiert" };
  const st = state.strategy as Strategy;
  const draft = await llm.generate({
    agent: "scriptwriter", projectId, schema: Script, effort: "high", system: SYSTEM(state.brief),
    prompt: `Strategie des Market Intelligence Director:\n${JSON.stringify({ ...st, concepts: undefined, chosenConcept: st.concepts[st.chosenConceptIndex] })}
Nutzer-Briefing: ${JSON.stringify(state.brief)}
Kontext aus der Recherche (Schlagzeilen, nicht geprüft): ${JSON.stringify(state.research?.candidates.find((c) => c.title === st.topic)?.signals.flatMap((s) => s.context.map((c) => c.title)) || state.research?.demand?.articles.map((a) => a.title) || [])}`,
  });
  const final = await fitToDuration(draft, state.brief, llm, projectId, "");
  return { ...normalise(final), version, generatedBy: llm.name };
}

/** Targeted revision: rewrites only the listed scenes following concrete instructions from QA or the user. */
export async function reviseScenes(state: ProjectState, projectId: string, orders: { sceneId: string; instruction: string }[]): Promise<{ changed: string[]; scenes: Scene[] } | null> {
  const llm = await getLlm();
  if (!llm || !state.script) return null;
  const ids = [...new Set(orders.map((o) => o.sceneId))].filter((id) => state.script!.scenes.some((s) => s.id === id));
  if (!ids.length) return null;
  const res = await llm.generate({
    agent: "scriptwriter_scene_revision", projectId, effort: "medium", schema: z.object({ scenes: z.array(Scene) }), system: SYSTEM(state.brief),
    prompt: `Überarbeite ausschließlich die Szenen ${ids.join(", ")} gemäß den Aufträgen. Behalte IDs und Rollen. Gib nur die überarbeiteten Szenen zurück.
Aufträge: ${JSON.stringify(orders)}\nGesamtes Skript zum Kontext: ${JSON.stringify(state.script.scenes)}`,
  });
  const byId = new Map(res.scenes.filter((s) => ids.includes(s.id)).map((s) => [s.id, s]));
  const scenes = state.script.scenes.map((s) => (byId.has(s.id) ? { ...byId.get(s.id)!, role: s.role, estSeconds: Number(estimateSeconds(byId.get(s.id)!.voiceover).toFixed(1)) } : s));
  return { changed: [...byId.keys()], scenes };
}
