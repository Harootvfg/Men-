import { getLlm } from "../providers/llm";
import { newsDemand } from "../providers/research";
import { QuestionSet } from "../schemas";

type Q = QuestionSet["questions"][number];
const AI = { label: "KI entscheiden lassen", value: "auto" };
const opt = (...labels: string[]) => [...labels.map((l) => ({ label: l, value: l })), AI];

/** Detects answers the user already gave in the prompt so they are not asked again. */
export function detectFromPrompt(topic: string): { field: string; value: string }[] {
  const t = topic.toLowerCase();
  const out: { field: string; value: string }[] = [];
  const d = t.match(/(\d{2,3})\s*(?:sekunden|sek\b|seconds|secs?\b|s\b)/);
  if (d) out.push({ field: "durationSec", value: String(Math.max(10, Math.min(90, Number(d[1])))) });
  else if (/\b(eine|1)\s*minute\b|one minute/.test(t)) out.push({ field: "durationSec", value: "60" });
  if (/\b(auf englisch|in english|englisch(es|e)?\b)/.test(t)) out.push({ field: "language", value: "en" });
  else if (/\b(auf deutsch|in german|deutsch(es|e)?\b)/.test(t)) out.push({ field: "language", value: "de" });
  const tones: [RegExp, string][] = [[/emotional|berührend|gefühlvoll/, "Emotional"], [/spannend|dramatisch|thrill|packend/, "Spannung und Neugier"], [/lustig|humor|witzig|funny/, "Humor"], [/sachlich|informativ|seriös|professionell/, "Sachlich und informativ"], [/motivier|inspirier/, "Motivierend"]];
  const tone = tones.find(([re]) => re.test(t));
  if (tone) out.push({ field: "tone", value: tone[1] });
  const aud: [RegExp, string][] = [[/jugendliche|teenager|schüler|teens/, "Jugendliche"], [/kinder\b|kids/, "Kinder"], [/studierende|studenten|junge erwachsene/, "Junge Erwachsene"], [/unternehmer|gründer|b2b|fachpublikum|experten/, "Fachlich interessierte Menschen"]];
  const a = aud.find(([re]) => re.test(t));
  if (a) out.push({ field: "audience", value: a[1] });
  if (/dokumentar|doku\b/.test(t)) out.push({ field: "style", value: "Dokumentarisch" });
  else if (/animiert|animation|cartoon/.test(t)) out.push({ field: "style", value: "Animiert" });
  else if (/filmisch|cinematic|realistisch/.test(t)) out.push({ field: "style", value: "Realistisch und filmisch" });
  if (/tiktok/.test(t)) out.push({ field: "platform", value: "tiktok" });
  else if (/reels?|instagram/.test(t)) out.push({ field: "platform", value: "reels" });
  else if (/shorts|youtube/.test(t)) out.push({ field: "platform", value: "shorts" });
  return out;
}

type Category = "wissen" | "motivation" | "produkt" | "story" | "allgemein";
export function categorise(topic: string): Category {
  const t = topic.toLowerCase();
  if (/motivation|disziplin|erfolg|gewohnheit|mindset|selbstvertrauen|durchhalten/.test(t)) return "motivation";
  if (/was (würde|wäre|passiert)|warum|wieso|wie funktioniert|erklär|fakten|wissenschaft|geschichte|sonne|weltall|universum|planet|what if|why|how does/.test(t)) return "wissen";
  if (/produkt|kaufen|shop|marke|angebot|launch|app\b|dienstleistung|restaurant|kunden/.test(t)) return "produkt";
  if (/geschichte von|story|erlebnis|märchen|legende|grusel|horror|krimi/.test(t)) return "story";
  return "allgemein";
}

/** Rule-based question generator: questions and options depend on the topic category and on what is still unknown. */
export function heuristicQuestions(topic: string): QuestionSet {
  const detected = detectFromPrompt(topic);
  const has = (f: string) => detected.some((d) => d.field === f);
  const cat = categorise(topic);
  const pool: Q[] = [];
  const angle: Record<Category, Q> = {
    wissen: { id: "angle", field: "angle", question: "Wie tief soll das Video einsteigen?", options: opt("Verblüffender Fakt zuerst, dann Erklärung", "Schritt-für-Schritt-Gedankenexperiment", "Mythos aufdecken und richtigstellen", "Größenvergleich, der es greifbar macht"), allowFreeText: true },
    motivation: { id: "angle", field: "angle", question: "Welcher Zugang passt zu deiner Botschaft?", options: opt("Persönliche Geschichte mit Wendepunkt", "Harte, direkte Ansage", "Ruhige, nachdenkliche Reflexion", "Konkrete Schritte für heute"), allowFreeText: true },
    produkt: { id: "angle", field: "angle", question: "Was soll das Video beim Zuschauer auslösen?", options: opt("Problem zeigen, Lösung vorstellen", "Vorher-Nachher-Effekt", "Drei überzeugende Vorteile", "Blick hinter die Kulissen"), allowFreeText: true },
    story: { id: "angle", field: "angle", question: "Wie soll die Geschichte erzählt werden?", options: opt("Aus der Ich-Perspektive", "Als Erzähler mit offenem Ende", "Mit überraschender Wendung am Schluss", "Chronologisch und ruhig"), allowFreeText: true },
    allgemein: { id: "angle", field: "angle", question: "Welcher Blickwinkel interessiert dich am meisten?", options: opt("Überraschende Einordnung", "Praktischer Nutzen für den Alltag", "Kontroverse Frage zur Diskussion", "Kurzer Überblick für Einsteiger"), allowFreeText: true },
  };
  pool.push(angle[cat]);
  if (!has("tone")) pool.push({ id: "tone", field: "tone", question: "Welche Wirkung soll dein Video erzielen?", allowFreeText: true,
    options: cat === "motivation" ? opt("Aufrüttelnd und energisch", "Emotional und berührend", "Ruhig und bestärkend") : cat === "wissen" ? opt("Spannung und Neugier", "Staunen und Überraschung", "Sachlich und informativ", "Humor") : cat === "produkt" ? opt("Vertrauen und Seriosität", "Begeisterung", "Humor und Leichtigkeit") : opt("Spannung und Neugier", "Emotionen", "Wissen und Überraschung", "Humor") });
  if (!has("audience")) pool.push({ id: "audience", field: "audience", question: "Für wen ist das Video gedacht?", allowFreeText: true,
    options: cat === "produkt" ? opt("Bestehende Kundschaft", "Neue Interessenten", "Fachpublikum der Branche") : cat === "wissen" ? opt("Neugierige ohne Vorwissen", "Jugendliche und Schüler", "Wissenschaftsinteressierte mit Vorwissen") : opt("Jugendliche", "Junge Erwachsene", "Breite Zielgruppe", "Fachlich interessierte Menschen") });
  if (!has("durationSec")) pool.push({ id: "durationSec", field: "durationSec", question: "Wie lang soll das Video sein?", allowFreeText: false, options: [{ label: "15–20 Sekunden", value: "18" }, { label: "30 Sekunden", value: "30" }, { label: "45–60 Sekunden", value: "50" }, { label: "60–90 Sekunden", value: "75" }, AI] });
  if (!has("language")) pool.push({ id: "language", field: "language", question: "In welcher Sprache soll gesprochen werden?", allowFreeText: false, options: [{ label: "Deutsch", value: "de" }, { label: "Englisch", value: "en" }, AI] });
  if (!has("style")) pool.push({ id: "style", field: "style", question: "Welcher Videostil passt am besten?", allowFreeText: true, options: opt("Realistisch und filmisch", "Dokumentarisch", "Dynamisch und schnell geschnitten", "Animiert") });
  if (!has("platform")) pool.push({ id: "platform", field: "platform", question: "Wo willst du das Video zuerst veröffentlichen?", allowFreeText: false, options: [{ label: "TikTok", value: "tiktok" }, { label: "Instagram Reels", value: "reels" }, { label: "YouTube Shorts", value: "shorts" }, AI] });
  const label: Record<Category, string> = { wissen: "Wissens- bzw. Gedankenexperiment-Thema", motivation: "Motivationsthema", produkt: "Produkt- oder Unternehmensthema", story: "erzählerisches Thema", allgemein: "allgemeines Thema" };
  return { analysis: `Erkannt als ${label[cat]} (regelbasierte Analyse ohne Sprachmodell).${detected.length ? ` Bereits aus deiner Eingabe übernommen: ${detected.map((d) => `${d.field}=${d.value}`).join(", ")}.` : ""}`, detected, questions: pool.slice(0, 5) };
}

export async function generateQuestions(topic: string, language: string, geo: string): Promise<QuestionSet & { generatedBy: string; demand: Awaited<ReturnType<typeof newsDemand>> | null }> {
  const demand = await newsDemand(topic.split(/\s+/).slice(0, 8).join(" "), language, geo).catch(() => null);
  const llm = await getLlm();
  if (!llm) return { ...heuristicQuestions(topic), generatedBy: "regelbasiert", demand };
  const q = await llm.generate({
    agent: "briefing", projectId: null, schema: QuestionSet, effort: "low",
    system: `Du bereitest eine Kurzvideo-Produktion vor. Analysiere das Thema des Nutzers und stelle 3 bis 5 Rückfragen, die die Produktion wirklich verändern.
- Jede Frage hat 3–4 konkrete, zum Thema passende Antwortoptionen plus als letzte Option {label:"KI entscheiden lassen", value:"auto"}.
- Stelle keine Frage, die der Nutzer in seiner Eingabe schon beantwortet hat; trage solche Angaben in "detected" ein.
- field ordnet die Antwort zu: tone, audience, style, durationSec (value = Sekunden als Zahl, 15–90), language (value "de" oder "en"), platform (value "tiktok", "reels" oder "shorts"), angle oder other. Bei den übrigen Feldern ist value gleich label.
- Keine Standardfragen von der Stange: Formuliere Fragen und Optionen themenspezifisch. Schreibe auf Deutsch.`,
    prompt: `Thema des Nutzers: "${topic}"\nNachfrage-Check: ${demand ? `${demand.recentArticles} Nachrichtenartikel in 30 Tagen, z. B. ${demand.articles.slice(0, 3).map((a) => a.title).join(" | ")}` : "nicht verfügbar"}`,
  });
  return { ...q, generatedBy: llm.name, demand };
}
