import { getDb } from "../db";
import { getLlm } from "../providers/llm";
import { fetchAllSignals, newsDemand, type SourceResult } from "../providers/research";
import { Strategy, type Brief, type Concept, type ProjectState, type TrendCandidate, type TrendSignal } from "../schemas";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
const SENSITIVE = /(\b(tot|tod|died|death|dead|killed|war|crash|rape|kz)\b|gestorben|stirbt|verstorben|mord|mörder|anschlag|terror|amok|krieg|unfall|absturz|missbrauch|vergewaltig|suizid|geisel|attentat|murder|shooting|abuse|suicide|höß|hitler|holocaust)/i;

export const SCORE_DISCLAIMER = "Der Trend-Score ist eine interne Priorisierung aus den unten genannten Komponenten und keine Vorhersage von Reichweite oder Viralität.";

/** Pure scoring: merges signals from several sources into candidates with a transparent 0–100 score. */
export function scoreCandidates(results: SourceResult[], previous: Record<string, number> = {}, now = Date.now()): TrendCandidate[] {
  const groups = new Map<string, TrendSignal[]>();
  const maxBySource = new Map<string, number>();
  for (const r of results) for (const s of r.signals) {
    if (s.metricValue != null) maxBySource.set(s.source, Math.max(maxBySource.get(s.source) || 0, s.metricValue));
    const key = norm(s.title);
    const existing = [...groups.keys()].find((k) => k === key || (k.length > 5 && key.length > 5 && (k.includes(key) || key.includes(k))));
    groups.set(existing || key, [...(groups.get(existing || key) || []), s]);
  }
  const out: TrendCandidate[] = [];
  for (const [key, signals] of groups) {
    const main = signals[0];
    const dates = signals.map((s) => s.publishedAt).filter(Boolean) as string[];
    const ageH = dates.length ? (now - Math.max(...dates.map((d) => Date.parse(d)))) / 36e5 : null;
    const fresh = ageH == null ? 40 : Math.max(0, Math.min(100, 100 - ((Math.max(ageH, 6) - 6) / 66) * 100));
    const rel = signals.filter((s) => s.metricValue != null).map((s) => Math.log10(1 + s.metricValue!) / Math.log10(1 + (maxBySource.get(s.source) || 1)));
    const attention = rel.length ? Math.round(Math.max(...rel) * 100) : 30;
    const nSources = new Set(signals.map((s) => s.source)).size;
    const confirm = nSources >= 3 ? 100 : nSources === 2 ? 75 : 30;
    const hasContext = signals.some((s) => s.context.length > 0);
    const feasible = hasContext ? 70 : 55;
    const text = [main.title, ...signals.flatMap((s) => s.context.map((c) => c.title))].join(" ");
    const risky = SENSITIVE.test(text + " ");
    const withMetric = signals.find((s) => s.metricValue != null);
    const prev = withMetric ? previous[withMetric.id] : undefined;
    const growth = withMetric && prev ? `${withMetric.metricValue! >= prev ? "+" : ""}${(((withMetric.metricValue! - prev) / prev) * 100).toFixed(0)} % gegenüber der letzten Erhebung (${withMetric.source})` : "kein Vergleichswert (erste Erhebung)";
    const components = [
      { name: "Aktualität", value: Math.round(fresh), weight: 0.25, evidence: ageH == null ? "estimated" as const : "measured" as const, reason: ageH == null ? "kein Zeitstempel in der Quelle" : `jüngstes Signal vor ${ageH.toFixed(0)} h` },
      { name: "Aufmerksamkeit", value: attention, weight: 0.3, evidence: rel.length ? "measured" as const : "estimated" as const, reason: withMetric ? `${withMetric.metricLabel}: ${withMetric.metricValue!.toLocaleString("de-DE")} (relativ zum Spitzenwert der Quelle)` : "keine Messzahl in der Quelle" },
      { name: "Quellenbestätigung", value: confirm, weight: 0.15, evidence: "measured" as const, reason: `${nSources} unabhängige Quelle(n)` },
      { name: "Umsetzbarkeit", value: feasible, weight: 0.15, evidence: "estimated" as const, reason: hasContext ? "Kontextartikel vorhanden – Thema lässt sich erklären" : "wenig Kontext – Einordnung nötig" },
      { name: "Eignung", value: risky ? 10 : 80, weight: 0.15, evidence: "qualitative" as const, reason: risky ? "sensibles Thema (Stichwortprüfung)" : "kein offensichtliches Risiko erkannt (Stichwortprüfung)" },
    ];
    out.push({
      id: key.replace(/ /g, "-").slice(0, 60) || main.id, title: main.title, signals,
      score: Math.round(components.reduce((a, c) => a + c.value * c.weight, 0)), components, growth,
      risk: risky ? "Sensibles Nachrichtenthema – für Unterhaltungsformate ungeeignet." : null,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export async function researchTrends(geo: string, lang: string) {
  const db = await getDb();
  const results = await fetchAllSignals(geo, lang);
  const prevRows = await db.query<{ data: Record<string, number> | string }>("SELECT data FROM trend_snapshots WHERE geo=$1 AND fetched_at < now() - interval '30 minutes' ORDER BY id DESC LIMIT 1", [geo]);
  const prev = prevRows[0] ? (typeof prevRows[0].data === "string" ? JSON.parse(prevRows[0].data) : prevRows[0].data) : {};
  const candidates = scoreCandidates(results, prev);
  const snap: Record<string, number> = {};
  for (const r of results) for (const s of r.signals) if (s.metricValue != null) snap[s.id] = s.metricValue;
  if (Object.keys(snap).length) await db.query("INSERT INTO trend_snapshots(geo, data) VALUES ($1,$2)", [geo, JSON.stringify(snap)]);
  return { candidates: candidates.slice(0, 40), fetchedAt: new Date().toISOString(), sources: results.map(({ name, ok, note }) => ({ name, ok, note })) };
}

export async function runResearch(state: ProjectState, mode: "autopilot" | "custom"): Promise<NonNullable<ProjectState["research"]>> {
  const { geo, language, topic } = state.brief;
  const base = await researchTrends(geo, language);
  if (mode === "custom" && topic) {
    try {
      const demand = await newsDemand(topic.split(/\s+/).slice(0, 8).join(" "), language, geo);
      return { ...base, demand, sources: [...base.sources, { name: "Google News (Suche)", ok: true, note: `${demand.recentArticles} Artikel in 30 Tagen` }] };
    } catch (e) {
      return { ...base, sources: [...base.sources, { name: "Google News (Suche)", ok: false, note: e instanceof Error ? e.message : String(e) }] };
    }
  }
  return base;
}

const moodFrom = (tone: string, topic: string): Strategy["mood"] => {
  const t = (tone + " " + topic).toLowerCase();
  if (/motiv|disziplin|erfolg|uplift|inspir/.test(t)) return "uplifting";
  if (/spann|dramat|gefahr|katastroph|verschwind|untergang/.test(t)) return "dramatic";
  if (/geheim|myster|rätsel|unbekannt|weltall|universum/.test(t)) return "mysterious";
  if (/humor|lustig|fun|schnell|dynam|energ/.test(t)) return "energetic";
  return "calm";
};

const concept = (title: string, angle: string, format: string, hookIdea: string, r: number[], reasoning: string): Concept => ({
  title, angle, format, hookIdea, reasoning,
  ratings: { audienceFit: r[0], growthPotential: r[1], originality: r[2], feasibility: r[3], retention: r[4] },
});
const total = (c: Concept) => c.ratings.audienceFit * 0.25 + c.ratings.growthPotential * 0.2 + c.ratings.originality * 0.2 + c.ratings.feasibility * 0.15 + c.ratings.retention * 0.2;

/** Rule-based strategy used when no language model is configured. Ratings are template defaults, flagged as such. */
export function heuristicStrategy(state: ProjectState, mode: "autopilot" | "custom"): Strategy {
  const b = state.brief;
  const usable = (state.research?.candidates || []).filter((c) => !c.risk);
  const pick = mode === "autopilot" ? usable[0] : undefined;
  const topic = mode === "custom" ? b.topic : pick?.title || "Eine Gewohnheit, die deinen Tag verändert";
  const hasData = mode === "autopilot" ? !!pick : (state.research?.demand?.recentArticles || 0) > 0;
  const de = b.language === "de";
  const concepts = [
    concept(de ? `${topic}: Das steckt dahinter` : `${topic}: what's behind it`, de ? "Kurze Einordnung in drei Schritten" : "Short explainer in three beats", "Erklärvideo", de ? `Warum reden gerade so viele über ${topic}?` : `Why is everyone talking about ${topic}?`, [7, 6, 5, 8, 6], "Solide verständlich, leicht umsetzbar."),
    concept(de ? `3 Dinge über ${topic}` : `3 things about ${topic}`, de ? "Listenformat mit klarer Struktur" : "List format", "Listicle", de ? `Drei Dinge über ${topic}, die du kennen solltest.` : `Three things about ${topic} you should know.`, [6, 6, 4, 9, 7], "Listen halten Zuschauer bis zum letzten Punkt, sind aber austauschbar."),
    concept(de ? `${topic} – die eine Frage` : `${topic} – the one question`, de ? "Eine zugespitzte Frage, die am Ende beantwortet wird" : "One pointed question answered at the end", "Frage–Antwort", de ? `Eine Frage zu ${topic} lässt mich nicht los.` : `One question about ${topic} won't let go.`, [7, 6, 7, 7, 7], "Offene Frage erzeugt Spannung bis zur Auflösung."),
  ];
  const chosen = concepts.map(total).reduce((best, v, i, a) => (v > a[best] ? i : best), 0);
  return {
    topic, audience: b.audience === "auto" ? (de ? "Breite Zielgruppe, 18–34" : "Broad audience, 18–34") : b.audience,
    marketLanguage: `${b.geo} / ${b.language}`, platform: b.platform,
    primaryInterest: de ? "Schnelle Einordnung eines aktuellen oder interessanten Themas" : "Quick context on a timely topic",
    hookStrategy: de ? "Direkte Frage in den ersten zwei Sekunden, Auflösung erst am Ende" : "Direct question in the first two seconds, payoff at the end",
    recommendedDurationSec: b.durationSec, visualStyle: b.style === "auto" ? "Typografie auf animierten Farbflächen" : b.style,
    emotionalTrigger: b.tone === "auto" ? "Neugier" : b.tone, valueProposition: de ? "Kompakter Überblick in unter einer Minute" : "Compact overview in under a minute",
    mood: moodFrom(b.tone, topic),
    risks: ["Ohne Sprachmodell wurden keine inhaltlichen Aussagen recherchiert oder geprüft.", ...(pick?.risk ? [pick.risk] : [])],
    dataBasis: hasData ? (mode === "autopilot" ? "current_trend_data" : "partial_data") : "no_current_data",
    dataBasisNote: hasData
      ? mode === "autopilot" ? `Thema stammt aus aktuellen Trendquellen (Score ${pick!.score}, ${pick!.signals.map((s) => s.source).join(", ")}).` : `${state.research?.demand?.recentArticles} aktuelle Nachrichtenartikel zum Thema gefunden; kein direkter Social-Media-Trendnachweis.`
      : "Keine belastbaren aktuellen Trenddaten gefunden – zeitlose Content-Strategie statt Trendnachweis.",
    concepts, chosenConceptIndex: chosen,
    choiceReasoning: "Regelbasierte Auswahl nach gewichteter Bewertung (Zielgruppe 25 %, Wachstum 20 %, Originalität 20 %, Umsetzbarkeit 15 %, Bindung 20 %). Die Einzelwerte sind Vorlagenwerte, keine Messungen.",
  };
}

export async function runStrategy(state: ProjectState, mode: "autopilot" | "custom", projectId: string): Promise<Strategy & { generatedBy: string }> {
  const llm = await getLlm();
  if (!llm) return { ...heuristicStrategy(state, mode), generatedBy: "regelbasiert" };
  const b = state.brief;
  const cands = (state.research?.candidates || []).slice(0, 15).map((c) => ({
    title: c.title, score: c.score, risk: c.risk, growth: c.growth,
    signals: c.signals.map((s) => ({ source: s.source, metric: s.metricLabel ? `${s.metricLabel}: ${s.metricValue}` : null, publishedAt: s.publishedAt, fetchedAt: s.fetchedAt, context: s.context.map((x) => x.title) })),
  }));
  const s = await llm.generate({
    agent: "market_intelligence", projectId, schema: Strategy, effort: "medium",
    system: `Du bist der Market Intelligence Director eines Videostudios. Du arbeitest datenorientiert und ehrlich.
Regeln:
- Stütze dich nur auf die gelieferten Daten. Erfinde keine Trends, Zahlen oder Quellen.
- dataBasis: "current_trend_data" nur, wenn das gewählte Thema direkt aus den gelieferten Trendsignalen stammt; "partial_data" bei indirekten Hinweisen; sonst "no_current_data" mit einer zeitlosen Strategie.
- Meide sensible Nachrichtenthemen (Todesfälle, Gewalt, Katastrophen) und Themen mit Risiko-Hinweis.
- Entwickle mindestens drei wirklich unterschiedliche Konzepte, bewerte sie 0–10 und wähle nicht automatisch das Thema mit den meisten Aufrufen, sondern nach Zielgruppenrelevanz, Wachstum, Originalität, Umsetzbarkeit und Zuschauerbindung.
- Die Produktion nutzt kurze Szenen mit Sprecherstimme, Bildschirmtext und Bewegtbild; wähle Konzepte, die so umsetzbar sind.
- Antworte in der Sprache "${b.language}".`,
    prompt: `Modus: ${mode === "autopilot" ? "Autopilot – wähle selbst das stärkste Thema aus den Trendsignalen" : "Eigenes Thema des Nutzers"}
Briefing: ${JSON.stringify({ ...b, answers: b.answers })}
Markt: ${b.geo}, Plattform: ${b.platform}, Ziel-Dauer: ${b.durationSec}s
Erhebungszeitpunkt: ${state.research?.fetchedAt}
Quellenstatus: ${JSON.stringify(state.research?.sources)}
Nachfrage-Check (Nachrichten zum Thema): ${JSON.stringify(state.research?.demand || null)}
Trendkandidaten (interner Score, kein Viralitätsversprechen): ${JSON.stringify(cands)}`,
  });
  s.chosenConceptIndex = Math.min(s.chosenConceptIndex, s.concepts.length - 1);
  if (mode === "custom" && s.dataBasis === "current_trend_data" && !(state.research?.demand?.recentArticles)) s.dataBasis = "partial_data";
  return { ...s, generatedBy: llm.name };
}
