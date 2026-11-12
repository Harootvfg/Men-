import { MAX_AUTO_REVISIONS } from "../config";
import { runResearch, runStrategy } from "../agents/market";
import { estimateCost, runAudio, runRender, runVisuals, type Ctx, type PState } from "../agents/production";
import { planRevision, runQuality } from "../agents/quality";
import { reviseScenes, runScript, estimateSeconds, hookTotal } from "../agents/script";
import { runMetadata } from "../agents/seo";
import { getLlm } from "../providers/llm";
import { getTts } from "../providers/tts";
import { getVideoProvider } from "../providers/video";
import { Brief, STEPS, TERMINAL, type Project, type ProjectState, type Status, type StepName } from "../schemas";
import { createProject, getProject, isCancelRequested, listProjects, logEvent, saveProject, setCancel } from "../store";

type G = typeof globalThis & { __vasRunning?: Map<string, Promise<void>>; __vasResumed?: boolean };
const g = globalThis as G;
const running = (g.__vasRunning ||= new Map());

const STATUS_AT_START: Record<StepName, Status> = {
  research: "researching", strategy: "researching", script: "writing_script", audio: "producing_audio",
  visuals: "generating_assets", render: "editing_video", quality: "quality_review", metadata: "quality_review",
};
const STATUS_AFTER: Partial<Record<StepName, Status>> = { strategy: "strategy_ready", script: "script_approved" };
export const STEP_LABEL: Record<StepName, string> = {
  research: "Trend- und Themenrecherche", strategy: "Strategie und Konzeptauswahl", script: "Drehbuch", audio: "Sprachaufnahme",
  visuals: "Videosequenzen", render: "Schnitt, Untertitel und Rendering", quality: "Qualitätsprüfung", metadata: "Titel, Beschreibungen, Hashtags",
};

class Cancelled extends Error {}

/** Marks a step and everything after it as pending so the engine redoes them (caches keep unchanged scenes cheap). */
export function invalidateFrom(state: ProjectState, step: StepName) {
  for (const s of STEPS.slice(STEPS.indexOf(step))) state.steps[s] = { status: "pending" };
}

async function describeCapabilities(state: ProjectState) {
  const llm = await getLlm(), tts = await getTts(state.brief.allowPaid), video = await getVideoProvider(state.brief.allowPaid);
  const labels: string[] = [];
  if (!llm) labels.push("Regelbasierte Texte (kein Sprachmodell konfiguriert)");
  if (!video.generative) labels.push("Basis-Renderer statt generativer Videomodelle");
  if (tts.name === "espeak") labels.push("Synthetische Basisstimme");
  return { llm: llm?.name || "regelbasiert", tts: tts.label, video: video.label, labels };
}

async function execute(id: string) {
  const loaded = await getProject(id);
  if (!loaded) return;
  const p: Project = loaded;
  const state = p.state as PState;
  const abort = new AbortController();
  const save = () => saveProject(p);
  const log = (msg: string, level: "info" | "warn" = "info", step = "engine") => logEvent(id, level, step, msg);
  const poll = setInterval(async () => { if (await isCancelRequested(id).catch(() => false)) abort.abort(); }, 700);
  let current: StepName | null = null;
  try {
    state.capabilities = await describeCapabilities(state);
    state.error = undefined;
    for (;;) {
      for (const step of STEPS) {
        if (state.steps[step]?.status === "done") continue;
        if (abort.signal.aborted || (await isCancelRequested(id))) throw new Cancelled();
        current = step;
        state.steps[step] = { status: "running", startedAt: new Date().toISOString() };
        p.status = state.revisions > 0 && step !== "quality" && step !== "metadata" ? "revising" : STATUS_AT_START[step];
        await save();
        await log(`${STEP_LABEL[step]} gestartet`, "info", step);
        const ctx: Ctx = { projectId: id, state, signal: abort.signal, save, log: (m, l) => log(m, l, step) };
        let note: string | undefined;
        switch (step) {
          case "research": {
            state.research = await runResearch(state, p.mode);
            const ok = state.research.sources.filter((s) => s.ok).length;
            note = `${state.research.candidates.length} Kandidaten aus ${ok}/${state.research.sources.length} Quellen`;
            for (const s of state.research.sources.filter((x) => !x.ok)) await log(`Quelle „${s.name}“ nicht verfügbar: ${s.note}`, "warn", step);
            break;
          }
          case "strategy":
            state.strategy = await runStrategy(state, p.mode, id);
            if (state.brief.durationSec === 30 && p.mode === "autopilot") state.brief.durationSec = Math.max(15, Math.min(60, Math.round(state.strategy.recommendedDurationSec)));
            p.title = state.strategy.topic.slice(0, 120);
            note = state.strategy.dataBasisNote;
            break;
          case "script":
            // A script produced by a targeted revision is kept; only a missing script is written from scratch.
            if (!state.script || state.steps.script?.note !== "revised") state.script = await runScript(state, id);
            p.title = (state.script.title || p.title).slice(0, 120);
            note = `Version ${state.script.version}, ${state.script.scenes.length} Szenen, Hook: „${state.script.hooks[state.script.chosenHookIndex]?.text}“`;
            state.estimate = await estimateCost(state);
            break;
          case "audio": await runAudio(ctx); break;
          case "visuals": await runVisuals(ctx); break;
          case "render":
            p.status = state.revisions > 0 ? "revising" : "rendering";
            state.render = await runRender(ctx);
            note = `Version ${state.render.version}, ${state.render.durationSec.toFixed(1)} s`;
            break;
          case "quality":
            state.qa = await runQuality(state, id, (m) => log(m, "info", step));
            state.qaHistory = [...(state.qaHistory || []), state.qa].slice(-6);
            note = `Score ${state.qa.score}/100 – ${state.qa.verdict === "approved" ? "freigegeben" : "Überarbeitung erforderlich"}`;
            break;
          case "metadata": state.metadata = await runMetadata(state, id); break;
        }
        if (abort.signal.aborted) throw new Cancelled();
        state.steps[step] = { ...state.steps[step], status: "done", finishedAt: new Date().toISOString(), note };
        if (STATUS_AFTER[step]) p.status = STATUS_AFTER[step]!;
        await save();
        await log(`${STEP_LABEL[step]} abgeschlossen${note ? ` – ${note}` : ""}`, "info", step);
      }
      current = null;
      // Improvement loop: bounded, targeted, and only for findings an agent can actually fix.
      const plan = state.qa ? planRevision(state.qa, !!(await getLlm())) : null;
      if (!plan || state.revisions >= MAX_AUTO_REVISIONS) break;
      state.revisions++;
      p.status = "revising";
      await log(`Überarbeitungsrunde ${state.revisions}/${MAX_AUTO_REVISIONS}: ${plan.summary}`, "warn", "quality");
      let from: StepName = "render";
      if (plan.sceneOrders.length) {
        const res = await reviseScenes(state, id, plan.sceneOrders);
        if (res?.changed.length) {
          state.script = { ...state.script!, scenes: res.scenes, version: state.script!.version + 1 };
          await log(`Drehbuch-Agent hat ${res.changed.join(", ")} überarbeitet`, "info", "script");
          from = "audio";
        }
      }
      if (plan.regenVisual.length) {
        state.nonce = { ...(state.nonce || {}) };
        for (const sid of plan.regenVisual) state.nonce[sid] = (state.nonce[sid] || 0) + 1;
        if (from === "render") from = "visuals";
      }
      invalidateFrom(state, from);
      await save();
    }
    p.status = "completed";
    await save();
    await log(`Produktion abgeschlossen – ${state.qa?.verdict === "approved" ? "freigegeben" : "Überarbeitung erforderlich"}`);
  } catch (e) {
    if (current && state.steps[current]?.status === "running") state.steps[current] = { status: e instanceof Cancelled || abort.signal.aborted ? "pending" : "failed", error: e instanceof Error ? e.message : String(e) };
    if (e instanceof Cancelled || abort.signal.aborted) {
      p.status = "cancelled";
      await save();
      await log("Produktion vom Nutzer abgebrochen", "warn");
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      p.status = "failed";
      state.error = `${current ? STEP_LABEL[current] + ": " : ""}${msg}`;
      await save();
      await logEvent(id, "error", current || "engine", msg);
    }
  } finally {
    clearInterval(poll);
    running.delete(id);
  }
}

export function start(id: string): Promise<void> {
  if (!running.has(id)) running.set(id, execute(id));
  return running.get(id)!;
}
export const isRunning = (id: string) => running.has(id);
export const waitFor = (id: string) => running.get(id) || Promise.resolve();

export async function createAndStart(mode: Project["mode"], briefInput: unknown): Promise<Project> {
  const brief = Brief.parse(briefInput);
  const state: ProjectState = { brief, revisions: 0, steps: {} };
  state.estimate = await estimateCost(state);
  const p = await createProject(mode, mode === "autopilot" ? "Autopilot: Thema wird recherchiert …" : brief.topic.slice(0, 120), state);
  void start(p.id);
  return p;
}

export async function cancel(id: string) {
  await setCancel(id, true);
  if (!running.has(id)) {
    const p = await getProject(id);
    if (p && !TERMINAL.includes(p.status)) { p.status = "cancelled"; await saveProject(p); }
  }
}

/** Continue a failed, cancelled or interrupted project. Finished steps and cached media are reused. */
export async function resume(id: string) {
  const p = await getProject(id);
  if (!p || running.has(id)) return;
  await setCancel(id, false);
  for (const s of STEPS) if (p.state.steps[s] && p.state.steps[s]!.status !== "done") p.state.steps[s] = { status: "pending" };
  p.state.error = undefined;
  p.status = "created";
  await saveProject(p);
  void start(id);
}

/** Called once per server process: picks up productions that were interrupted by a restart. */
export async function resumeInterrupted() {
  if (g.__vasResumed) return;
  g.__vasResumed = true;
  for (const p of await listProjects()) if (!TERMINAL.includes(p.status) && !running.has(p.id)) {
    await logEvent(p.id, "warn", "engine", "Unterbrochene Produktion wird nach Neustart fortgesetzt");
    await resume(p.id);
  }
}

export type Action =
  | { type: "editScene"; sceneId: string; voiceover?: string; onScreenText?: string; visual?: string; transition?: string }
  | { type: "regenerateScene"; sceneId: string }
  | { type: "repair"; instruction: string }
  | { type: "selectHook"; index: number }
  | { type: "setSubtitles"; overrides?: Record<string, string>; style?: "clean" | "bold" | "karaoke" }
  | { type: "setVoice"; tone: string }
  | { type: "newVersion" };

/** User-driven changes on a finished project. Each one invalidates only what depends on it. */
export async function applyAction(id: string, a: Action): Promise<{ ok: boolean; message: string }> {
  const p = await getProject(id);
  if (!p) return { ok: false, message: "Projekt nicht gefunden." };
  if (running.has(id) || !TERMINAL.includes(p.status)) return { ok: false, message: "Die Produktion läuft noch. Bitte warten oder zuerst abbrechen." };
  const state = p.state as PState;
  if (!state.script) return { ok: false, message: "Es gibt noch kein Drehbuch, das geändert werden könnte." };
  const scene = (sid: string) => state.script!.scenes.find((s) => s.id === sid);
  let from: StepName = "render";
  let message = "";
  const bump = () => { state.script = { ...state.script!, version: state.script!.version + 1 }; };
  switch (a.type) {
    case "editScene": {
      const s = scene(a.sceneId);
      if (!s) return { ok: false, message: `Szene ${a.sceneId} existiert nicht.` };
      if (a.voiceover != null && a.voiceover.trim() && a.voiceover !== s.voiceover) { s.voiceover = a.voiceover.trim(); s.estSeconds = Number(estimateSeconds(s.voiceover).toFixed(1)); from = "audio"; if (state.subtitleOverrides) delete state.subtitleOverrides[s.id]; }
      if (a.onScreenText != null) s.onScreenText = a.onScreenText.trim();
      if (a.visual != null && a.visual !== s.visual) { s.visual = a.visual.trim(); if (from === "render") from = "visuals"; }
      if (a.transition && ["cut", "fade", "slideleft", "slideup", "zoomin", "circleopen"].includes(a.transition)) s.transition = a.transition as typeof s.transition;
      bump();
      message = `Szene ${a.sceneId} geändert. Nur diese Szene wird neu erzeugt, der Rest stammt aus dem Cache.`;
      break;
    }
    case "regenerateScene": {
      if (!scene(a.sceneId)) return { ok: false, message: `Szene ${a.sceneId} existiert nicht.` };
      state.nonce = { ...(state.nonce || {}), [a.sceneId]: (state.nonce?.[a.sceneId] || 0) + 1 };
      from = "visuals";
      message = `Bildmaterial für ${a.sceneId} wird neu erzeugt, alle anderen Szenen bleiben unverändert.`;
      break;
    }
    case "repair": {
      const m = a.instruction.match(/(?:szene|scene)\s*#?\s*(\d+)/i);
      if (!m) return { ok: false, message: "Bitte nenne die Szene, z. B. „Szene 3 sieht unrealistisch aus …“." };
      const target = state.script.scenes[Number(m[1]) - 1];
      if (!target) return { ok: false, message: `Szene ${m[1]} existiert nicht (das Video hat ${state.script.scenes.length} Szenen).` };
      const res = await reviseScenes(state, id, [{ sceneId: target.id, instruction: a.instruction }]).catch(() => null);
      if (res?.changed.length) {
        const before = target.voiceover;
        state.script = { ...state.script, scenes: res.scenes, version: state.script.version + 1 };
        from = scene(target.id)!.voiceover !== before ? "audio" : "visuals";
        message = `Szene ${m[1]} wurde vom Drehbuch-Agenten nach deiner Anweisung überarbeitet; nur sie wird neu produziert.`;
      } else {
        from = "visuals";
        message = `Ohne Sprachmodell kann die Anweisung nicht inhaltlich umgesetzt werden. Das Bildmaterial von Szene ${m[1]} wird mit neuer Variante erzeugt; Texte kannst du direkt in der Szene bearbeiten.`;
      }
      state.nonce = { ...(state.nonce || {}), [target.id]: (state.nonce?.[target.id] || 0) + 1 };
      break;
    }
    case "selectHook": {
      const h = state.script.hooks[a.index];
      if (!h) return { ok: false, message: "Dieser Hook existiert nicht." };
      state.script.chosenHookIndex = a.index;
      state.script.scenes[0].voiceover = h.text;
      state.script.scenes[0].estSeconds = Number(estimateSeconds(h.text).toFixed(1));
      state.script.hookReasoning = `Vom Nutzer gewählt (gewichtete Bewertung ${hookTotal(h).toFixed(1)}/10).`;
      bump();
      from = "audio";
      message = "Hook gewechselt. Nur die erste Szene wird neu vertont.";
      break;
    }
    case "setSubtitles":
      if (a.overrides) state.subtitleOverrides = Object.fromEntries(Object.entries(a.overrides).filter(([k, v]) => scene(k) && v.trim() && v.trim() !== scene(k)!.voiceover).map(([k, v]) => [k, v.trim()]));
      if (a.style) state.brief.subtitleStyle = a.style;
      message = "Untertitel aktualisiert. Bild und Ton bleiben erhalten, es wird nur neu gerendert.";
      break;
    case "setVoice":
      state.brief.tone = a.tone;
      from = "audio";
      message = "Stimme geändert. Alle Szenen werden neu vertont, das Bildmaterial wird wiederverwendet, soweit die Längen passen.";
      break;
    case "newVersion":
      from = "script";
      state.steps.script = { status: "pending" };
      message = "Neue Version: Drehbuch wird neu geschrieben und komplett produziert.";
      break;
  }
  invalidateFrom(state, from);
  if (a.type !== "newVersion" && STEPS.indexOf(from) > STEPS.indexOf("script")) state.steps.script = { ...(state.steps.script || { status: "done" }), status: "done" };
  state.revisions = 0;
  state.error = undefined;
  p.status = "created";
  await setCancel(id, false);
  await saveProject(p);
  await logEvent(id, "info", "engine", `Nutzeraktion: ${message}`);
  void start(id);
  return { ok: true, message };
}
