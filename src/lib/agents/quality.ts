import fs from "node:fs";
import path from "node:path";
import { projectDir } from "../config";
import { ffmpeg, probe, run } from "../exec";
import { getLlm } from "../providers/llm";
import { layout, parseSrt, safeArea, validateCues } from "../render/subtitles";
import { ASPECTS, ContentReview, type Check, type ProjectState, type QaIssue, type QaReport } from "../schemas";

export const QA_DISCLAIMER = "Der Qualitäts-Score ist eine interne Heuristik und keine Vorhersage von Aufrufzahlen.";
const WEIGHTS = [
  ["hook", "Hook und Aufmerksamkeit", 0.2], ["story", "Storytelling und Verständlichkeit", 0.2], ["visual", "Bild- und Schnittqualität", 0.2],
  ["audio", "Audioproduktion", 0.15], ["fit", "Zielgruppen- und Plattformfit", 0.15], ["originality", "Originalität und Mehrwert", 0.1],
] as const;

const intervals = (stderr: string, startKey: string, durKey: string) => {
  const out: { start: number; dur: number }[] = [];
  const re = new RegExp(`${startKey}[:=]\\s*([\\d.]+)[\\s\\S]*?${durKey}[:=]\\s*([\\d.]+)`, "g");
  let m; while ((m = re.exec(stderr))) out.push({ start: Number(m[1]), dur: Number(m[2]) });
  return out;
};

/** Objective checks on the rendered file itself. */
export async function technicalChecks(state: ProjectState, projectId: string): Promise<{ checks: Check[]; lufs: number | null }> {
  const checks: Check[] = [];
  const add = (id: string, label: string, passed: boolean, critical: boolean, detail: string) => checks.push({ id, label, passed, critical, detail });
  const r = state.render;
  const file = r ? path.join(projectDir(projectId), r.video) : "";
  if (!r || !fs.existsSync(file) || fs.statSync(file).size < 2000) { add("file", "Videodatei vorhanden", false, true, "Die MP4-Datei fehlt oder ist leer."); return { checks, lufs: null }; }
  let p;
  try { p = await probe(file); } catch (e) { add("file", "Videodatei lesbar", false, true, `ffprobe kann die Datei nicht lesen: ${e instanceof Error ? e.message.slice(0, 160) : e}`); return { checks, lufs: null }; }
  add("file", "Videodatei vorhanden und lesbar", true, true, `${(fs.statSync(file).size / 1e6).toFixed(1)} MB, Container ${p.formatName.split(",")[0]}`);
  add("streams", "Bild- und Tonspur (H.264 / AAC)", p.video?.codec === "h264" && p.audio?.codec === "aac", true, `Video: ${p.video?.codec || "fehlt"}, Audio: ${p.audio?.codec || "fehlt"}`);
  const [w, h] = ASPECTS[state.brief.aspect];
  add("resolution", `Format ${state.brief.aspect}, ${w}×${h}`, p.video?.width === w && p.video?.height === h, true, `gemessen: ${p.video?.width}×${p.video?.height}, ${p.video?.fps.toFixed(0)} fps`);
  const planned = Object.entries(state.assets || {}).filter(([id]) => state.script!.scenes.some((s) => s.id === id)).reduce((a, [, x]) => a + x.audioSec + 0.35, 0);
  add("duration", "Vollständige Länge", p.duration > 3 && Math.abs(p.duration - planned) < 0.6, true, `gemessen ${p.duration.toFixed(1)} s, geplant ${planned.toFixed(1)} s`);

  let decodeErr = "", det = "";
  try {
    const res = await ffmpeg(["-v", "info", "-xerror", "-i", file, "-vf", "blackdetect=d=0.6:pix_th=0.08,freezedetect=n=-55dB:d=2.5", "-af", "silencedetect=noise=-45dB:d=1.5,ebur128", "-f", "null", "-"]);
    det = res.stderr;
  } catch (e) { decodeErr = e instanceof Error ? e.message : String(e); }
  add("decode", "Keine beschädigten Frames (vollständige Dekodierung)", !decodeErr, true, decodeErr ? decodeErr.slice(0, 200) : "Datei wurde fehlerfrei komplett dekodiert");
  const black = intervals(det, "black_start", "black_duration");
  const worstBlack = Math.max(0, ...black.map((b) => b.dur));
  add("black", "Keine ungewollten Schwarzbilder", worstBlack < 0.9, true, black.length ? `${black.length} Stelle(n), längste ${worstBlack.toFixed(1)} s` : "keine gefunden");
  const silence = intervals(det, "silence_start", "silence_duration");
  const worstSilence = Math.max(0, ...silence.map((s) => s.dur));
  add("silence", "Keine ungewollten stillen Stellen", worstSilence < 2, true, silence.length ? `${silence.length} Stelle(n), längste ${worstSilence.toFixed(1)} s` : "keine gefunden");
  const freeze = intervals(det, "freeze_start", "freeze_duration");
  add("freeze", "Keine eingefrorenen Bilder", freeze.length === 0, false, freeze.length ? `${freeze.length} Standbild-Phase(n) über 2,5 s` : "keine gefunden");
  const lm = det.match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/);
  const lufs = lm ? Number(lm[1]) : null;
  add("loudness", "Lautheit im Zielbereich (−17 bis −11 LUFS)", lufs != null && lufs > -17 && lufs < -11, false, lufs != null ? `gemessen ${lufs.toFixed(1)} LUFS` : "nicht messbar");

  const srtFile = path.join(projectDir(projectId), r.srt);
  const cues = fs.existsSync(srtFile) ? parseSrt(fs.readFileSync(srtFile, "utf8")) : [];
  const problems = validateCues(cues, p.duration, 44);
  add("subtitles", "Untertitel vorhanden und strukturell gültig", cues.length > 0 && problems.length === 0, false, cues.length ? (problems.length ? problems.slice(0, 3).join("; ") : `${cues.length} Einblendungen, lückenlos innerhalb der Videolänge`) : "keine Untertitel");
  const spoken = state.script!.scenes.map((s) => s.voiceover).join(" ").replace(/\s+/g, " ").trim();
  const shown = cues.map((c) => c.text.replace(/\n/g, " ")).join(" ").replace(/\s+/g, " ").trim();
  const overridden = Object.keys((state as { subtitleOverrides?: object }).subtitleOverrides || {}).length > 0;
  add("subtitle_text", "Untertiteltext entspricht dem Sprechertext", overridden || spoken === shown, false, overridden ? "manuell bearbeitete Untertitel – Abgleich übersprungen" : spoken === shown ? "wortgleich" : "Abweichung zwischen gesprochenem und eingeblendetem Text");
  const L = layout(state.brief.platform, w, h), safe = safeArea(state.brief.platform, w, h);
  add("safe_area", "Texte innerhalb der sicheren Bereiche", L.subMarginV >= safe.bottom && L.headMarginV >= safe.top, false, `Untertitel ${L.subMarginV}px über dem unteren Rand (Sperrzone ${safe.bottom}px), Seitenrand ${safe.side}px`);
  const longText = state.script!.scenes.filter((s) => s.onScreenText.split(/\s+/).length > 7).map((s) => s.id);
  add("screen_text", "Bildschirmtexte kurz und lesbar", longText.length === 0, false, longText.length ? `zu lang in ${longText.join(", ")}` : "alle Einblendungen höchstens 7 Wörter");
  return { checks, lufs };
}

async function frames(file: string, duration: number, dir: string, n = 5): Promise<{ mediaType: "image/jpeg"; base64: string }[]> {
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = path.join(dir, `qa-frame-${i}.jpg`);
    await run("ffmpeg", ["-hide_banner", "-y", "-ss", ((duration * (i + 0.5)) / n).toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5", f]);
    out.push({ mediaType: "image/jpeg" as const, base64: fs.readFileSync(f).toString("base64") });
    fs.rmSync(f, { force: true });
  }
  return out;
}

const OWNER: Record<string, QaIssue["owner"]> = { facts: "script", script: "script", spelling: "script", copyright: "production", visual: "production", audio: "production", subtitles: "production" };

export async function runQuality(state: ProjectState, projectId: string, log: (m: string) => Promise<void>): Promise<QaReport> {
  const { checks, lufs } = await technicalChecks(state, projectId);
  const failed = checks.filter((c) => !c.passed);
  // Only defects a fresh render can plausibly cure are routed to production; deterministic text problems go to the script agent.
  const RENDER_FIXABLE = new Set(["file", "streams", "decode", "duration", "black", "silence", "freeze"]);
  const issues: QaIssue[] = [];
  for (const c of failed) {
    if (c.id === "screen_text") {
      for (const s of state.script!.scenes.filter((x) => x.onScreenText.split(/\s+/).length > 7))
        issues.push({ severity: "major", category: "script", sceneId: s.id, description: `Bildschirmtext in ${s.id} ist zu lang (${s.onScreenText.split(/\s+/).length} Wörter).`, fix: "onScreenText auf höchstens fünf Wörter kürzen.", owner: "script" });
    } else issues.push({ severity: c.critical ? "critical" : "major", category: RENDER_FIXABLE.has(c.id) ? "technical" : "technical_static", sceneId: null, description: `${c.label}: ${c.detail}`, fix: RENDER_FIXABLE.has(c.id) ? "Betroffene Komponente neu rendern." : "Einstellungen oder Texte anpassen.", owner: "production" });
  }
  const basisVideo = (state.render?.mode || "basis").includes("basis");
  const espeakVoice = Object.values(state.assets || {}).some((a) => a.ttsProvider === "espeak");
  const piperVoice = Object.values(state.assets || {}).some((a) => a.ttsProvider === "piper");
  const techOk = (ids: string[]) => ids.every((id) => checks.find((c) => c.id === id)?.passed);
  let review: ContentReview | null = null;
  let reviewMode: QaReport["reviewMode"] = "heuristic";
  const llm = await getLlm();
  const fileReadable = checks.find((c) => c.id === "file")?.passed && state.render;
  if (llm && fileReadable) {
    const file = path.join(projectDir(projectId), state.render!.video);
    let imgs: Awaited<ReturnType<typeof frames>> = [];
    try { imgs = await frames(file, state.render!.durationSec, projectDir(projectId)); reviewMode = "llm_multimodal"; } catch { reviewMode = "llm_text"; }
    await log(`Inhaltliche Prüfung durch ${llm.name} (${imgs.length} Einzelbilder)`);
    review = await llm.generate({
      agent: "quality_manager", projectId, schema: ContentReview, effort: "high", images: imgs,
      system: `Du bist der Executive Quality Manager eines Kurzvideo-Studios. Du prüfst streng und konkret; ein mittelmäßiges Video bekommt mittelmäßige Noten.
Du erhältst Strategie, Drehbuch, technische Messwerte und ${imgs.length} gleichmäßig verteilte Einzelbilder des fertig gerenderten Videos. Den Ton kannst du nicht hören: bewerte Audio nur anhand der Messwerte und des genannten Sprachanbieters und sage das in der Begründung.
Bewerte jede Kategorie 0–100 mit Begründung. Melde Mängel als issues mit Schweregrad, betroffener Szene (ID oder null) und einem konkreten Verbesserungsauftrag.
"critical" nur für: nachweislich falsche Tatsachenbehauptung, erkennbares Urheberrechts-/Markenproblem, unlesbarer oder falsch geschriebener Text im Bild, Bild passt klar nicht zum Gesprochenen.
Der Score ist eine interne Qualitätsheuristik, keine Reichweitenprognose.`,
      prompt: `Strategie: ${JSON.stringify({ ...state.strategy, concepts: undefined })}
Drehbuch (Version ${state.script?.version}): ${JSON.stringify(state.script)}
Produktion: Bildmaterial=${state.render!.mode}, Sprachausgabe=${[...new Set(Object.values(state.assets || {}).map((a) => a.ttsProvider))].join(",")}, Lautheit=${lufs} LUFS, Dauer=${state.render!.durationSec.toFixed(1)}s, Plattform=${state.brief.platform}
Technische Prüfungen: ${JSON.stringify(checks)}`,
    });
    for (const i of review.issues) issues.push({ ...i, owner: OWNER[i.category] || "production" });
  }

  const sc = state.script!.selfCritique;
  const heur: Record<string, { score: number; reason: string }> = {
    hook: { score: sc.hook * 10, reason: "Selbsteinschätzung des Drehbuch-Agenten, nicht unabhängig geprüft." },
    story: { score: ((sc.clarity + sc.dramaturgy) / 2) * 10, reason: "Selbsteinschätzung des Drehbuch-Agenten, nicht unabhängig geprüft." },
    fit: { score: sc.audienceFit * 10, reason: "Selbsteinschätzung des Drehbuch-Agenten, nicht unabhängig geprüft." },
    originality: { score: sc.originality * 10, reason: "Selbsteinschätzung des Drehbuch-Agenten, nicht unabhängig geprüft." },
    visual: { score: !techOk(["decode", "black", "resolution"]) ? 20 : basisVideo ? 50 : 70, reason: basisVideo ? "Technisch sauber, aber prozedurale Hintergründe statt szenenspezifischer Bilder (Basis-Renderer)." : "Technisch sauber; Bildinhalt nicht multimodal geprüft." },
    audio: { score: !techOk(["silence", "streams"]) ? 20 : (espeakVoice ? 45 : piperVoice ? 62 : 75) + (techOk(["loudness"]) ? 10 : 0), reason: `${espeakVoice ? "Synthetische Basisstimme (eSpeak)" : piperVoice ? "Lokale neuronale Stimme (Piper), nicht durch Anhören geprüft" : "Externer Sprachanbieter"}; Lautheit ${lufs?.toFixed(1) ?? "?"} LUFS.` },
  };
  const categories = WEIGHTS.map(([key, label, weight]) => {
    if (review) {
      const r = review[key];
      // Objective failures cap what a content reviewer can award.
      const cap = key === "visual" && !techOk(["decode", "black", "resolution"]) ? 30 : key === "audio" && !techOk(["silence", "streams"]) ? 30 : 100;
      return { key, label, weight, score: Math.min(cap, Math.round(r.score)), reason: r.reason, basis: (key === "audio" ? "llm_text" : reviewMode) as QaReport["categories"][number]["basis"] };
    }
    return { key, label, weight, score: Math.round(heur[key].score), reason: heur[key].reason, basis: (key === "visual" || key === "audio" ? "technical" : "heuristic") as QaReport["categories"][number]["basis"] };
  });
  const score = Math.round(categories.reduce((a, c) => a + c.score * c.weight, 0));
  const hasCritical = issues.some((i) => i.severity === "critical");
  // A good overall score can never outvote a critical technical or legal defect.
  const verdict: QaReport["verdict"] = hasCritical || failed.some((c) => c.critical) || score < 65 || issues.filter((i) => i.severity === "major").length > 1 ? "needs_revision"
    : review ? "approved" : "needs_revision";
  if (!review) issues.push({ severity: "major", category: "content", sceneId: null, owner: "script", description: "Inhalt wurde ohne Sprachmodell erstellt und nicht inhaltlich geprüft (Fakten, Originalität, Bild-Text-Passung).", fix: "Anthropic-Schlüssel in den Einstellungen hinterlegen und neue Version erzeugen, oder Szenentexte im Studio selbst prüfen und überarbeiten." });
  return { version: state.render?.version || 0, checkedAt: new Date().toISOString(), checks, categories, score, verdict, issues, reviewMode, disclaimer: QA_DISCLAIMER };
}

export interface RevisionPlan { rerender: boolean; sceneOrders: { sceneId: string; instruction: string }[]; regenVisual: string[]; summary: string }

/** Maps findings to the responsible agent and the smallest set of components to redo. */
export function planRevision(report: QaReport, llmAvailable: boolean): RevisionPlan | null {
  if (report.verdict === "approved") return null;
  const actionable = report.issues.filter((i) => i.severity !== "minor");
  const tech = actionable.filter((i) => i.category === "technical");
  const sceneOrders = llmAvailable ? actionable.filter((i) => i.owner === "script" && i.sceneId).map((i) => ({ sceneId: i.sceneId!, instruction: `${i.description} → ${i.fix}` })) : [];
  const regenVisual = actionable.filter((i) => i.owner === "production" && i.category === "visual" && i.sceneId).map((i) => i.sceneId!);
  if (!tech.length && !sceneOrders.length && !regenVisual.length) return null;
  const parts = [tech.length ? `${tech.length} technische(r) Mangel → Produktion rendert neu` : "", sceneOrders.length ? `${sceneOrders.length} Textauftrag/-aufträge → Drehbuch-Agent` : "", regenVisual.length ? `Bildmaterial neu für ${[...new Set(regenVisual)].join(", ")}` : ""].filter(Boolean);
  return { rerender: tech.length > 0, sceneOrders, regenVisual: [...new Set(regenVisual)], summary: parts.join("; ") };
}
