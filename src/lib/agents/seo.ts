import { getLlm } from "../providers/llm";
import { Metadata, type ProjectState } from "../schemas";

const tagify = (s: string) => "#" + s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "");
const STOP = new Set("der die das und oder ein eine einen über von mit für was wie warum wenn würde ist sind the a an of and or to in on for what why how if would is are about".split(" "));

export function heuristicMetadata(state: ProjectState): Metadata {
  const de = state.brief.language === "de";
  const topic = state.strategy!.topic;
  const hook = state.script!.scenes[0].voiceover;
  const words = [...new Set(topic.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !STOP.has(w)))].slice(0, 4);
  const tags = [...new Set([tagify(topic), ...words.map(tagify)])].filter((t) => t.length > 3 && t.length < 30).slice(0, 4);
  const kw = [topic, ...words];
  return {
    tiktok: { title: hook.slice(0, 90), description: `${hook} ${de ? "Was meinst du?" : "What do you think?"}`, hashtags: tags.slice(0, 4), keywords: kw, category: null },
    reels: { title: topic.slice(0, 80), description: `${hook}\n\n${de ? "Speichere dir das Reel für später und schreib deine Meinung in die Kommentare." : "Save this reel for later and share your take in the comments."}`, hashtags: tags.slice(0, 4), keywords: kw, category: null },
    shorts: { title: `${topic}${de ? " – kurz erklärt" : " – explained"}`.slice(0, 95), description: `${hook}\n\n${de ? "Kurz erklärt in unter einer Minute." : "Explained in under a minute."}`, hashtags: [...tags.slice(0, 2), "#shorts"], keywords: kw, category: null },
  };
}

export async function runMetadata(state: ProjectState, projectId: string): Promise<Metadata & { generatedBy: string }> {
  const llm = await getLlm();
  if (!llm) return { ...heuristicMetadata(state), generatedBy: "regelbasiert" };
  const m = await llm.generate({
    agent: "seo", projectId, schema: Metadata, effort: "low",
    system: `Du erstellst plattformspezifische Veröffentlichungspakete in der Sprache "${state.brief.language}". Die drei Pakete dürfen nicht identisch sein.
- TikTok: Caption-Einstieg als title (max. 90 Zeichen), natürliche Beschreibung, 3–5 themenspezifische Hashtags, Suchbegriffe.
- Instagram Reels: Caption mit starkem ersten Satz, optional Call-to-Action, 3–5 themenspezifische Hashtags.
- YouTube Shorts: suchgerechter Titel (max. 95 Zeichen), Beschreibung mit den wichtigsten Suchbegriffen, 2–3 Hashtags inklusive #shorts, keywords als Tags.
Keine generischen Hashtags ohne Themenbezug (#fyp, #viral, #foryou), kein Hashtag-Spam, keine Reichweitenversprechen. Hashtags mit führendem #, ohne Leerzeichen.`,
    prompt: `Thema: ${state.strategy!.topic}\nZielgruppe: ${state.strategy!.audience}\nDrehbuch: ${JSON.stringify(state.script!.scenes.map((s) => s.voiceover))}`,
  });
  for (const k of ["tiktok", "reels", "shorts"] as const) m[k].hashtags = [...new Set(m[k].hashtags.map((h) => (h.startsWith("#") ? h : "#" + h).replace(/\s+/g, "")))].slice(0, 6);
  return { ...m, generatedBy: llm.name };
}
