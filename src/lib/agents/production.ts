import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cacheDir, projectDir } from "../config";
import { probe } from "../exec";
import { getTts, getTtsFor } from "../providers/tts";
import { getVideoProvider } from "../providers/video";
import { ProviderError } from "../providers/llm";
import { composeVideo, mixAudio, LEAD_MAX, SCENE_GAP, type ComposeScene } from "../render/compose";
import { buildCues, layout, toAss, toSrt, type SceneTiming } from "../render/subtitles";
import { ASPECTS, type ProjectState, type RenderResult, type SceneAsset } from "../schemas";
import { getPrefs } from "../settings";
import { addCost, projectCost } from "../store";
import { estimateSeconds } from "./script";

const sha = (...parts: unknown[]) => crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
export type Extras = { nonce?: Record<string, number>; subtitleOverrides?: Record<string, string> };
export type PState = ProjectState & Extras;

export interface Ctx { projectId: string; state: PState; signal: AbortSignal; log: (msg: string, level?: "info" | "warn") => Promise<void>; save: () => Promise<void> }

async function retry<T>(fn: () => Promise<T>, ctx: Ctx, what: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable || attempt >= 3 || ctx.signal.aborted) throw e;
      await ctx.log(`${what}: ${e.message} – neuer Versuch ${attempt + 1}/3`, "warn");
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function guardBudget(ctx: Ctx, additionalUsd: number, what: string) {
  if (additionalUsd <= 0) return;
  const b = ctx.state.brief;
  if (!b.allowPaid) throw new ProviderError("budget", `${what} wäre kostenpflichtig, aber kostenpflichtige Generierung ist für dieses Projekt nicht freigegeben.`);
  const spent = (await projectCost(ctx.projectId)).total;
  if (b.budgetUsd > 0 && spent + additionalUsd > b.budgetUsd + 1e-9)
    throw new ProviderError("budget", `Budgetlimit erreicht: ${what} würde ca. ${additionalUsd.toFixed(2)} $ kosten, verbraucht sind ${spent.toFixed(2)} $ von ${b.budgetUsd.toFixed(2)} $.`);
}

/** Cost preview shown before anything is generated. */
export async function estimateCost(state: ProjectState): Promise<{ usd: number; lines: { label: string; usd: number }[] }> {
  const b = state.brief;
  const tts = await getTts(b.allowPaid);
  const video = await getVideoProvider(b.allowPaid);
  const scenes = state.script?.scenes;
  const nScenes = scenes?.length || Math.max(4, Math.round(b.durationSec / 6));
  const chars = scenes ? scenes.reduce((a, s) => a + s.voiceover.length, 0) : b.durationSec * 15;
  const perScene = scenes ? scenes.map((s) => estimateSeconds(s.voiceover)) : Array(nScenes).fill(b.durationSec / nScenes);
  const lines = [
    { label: `Sprachausgabe – ${tts.label}`, usd: tts.estimate("x".repeat(chars)) },
    { label: `Bildmaterial – ${video.label}`, usd: perScene.reduce((a: number, s: number) => a + video.estimate(s), 0) },
  ];
  return { usd: lines.reduce((a, l) => a + l.usd, 0), lines };
}

export async function runAudio(ctx: Ctx) {
  const { state } = ctx;
  const b = state.brief;
  const prefs0 = await getPrefs();
  const tts = b.language === prefs0.language ? await getTts(b.allowPaid) : await getTtsFor(b.language, b.allowPaid);
  const prefs = prefs0;
  const assets: Record<string, SceneAsset> = { ...(state.assets || {}) };
  const keep = new Set(state.script!.scenes.map((s) => s.id));
  for (const k of Object.keys(assets)) if (!keep.has(k)) delete assets[k];
  for (const scene of state.script!.scenes) {
    if (ctx.signal.aborted) throw new Error("abgebrochen");
    const voiceKey = tts.name === "elevenlabs" ? prefs.elevenVoiceId : prefs.espeakVoice;
    const hash = sha("tts", tts.name, voiceKey, b.language, b.tone, scene.voiceover);
    const file = path.join(cacheDir(), `tts-${hash}.wav`);
    const prev = assets[scene.id];
    if (prev?.audioHash === hash && fs.existsSync(file)) continue;
    if (!fs.existsSync(file)) {
      await guardBudget(ctx, tts.estimate(scene.voiceover), `Sprachausgabe für Szene ${scene.id}`);
      const tmp = file.replace(/\.wav$/, `.tmp-${process.pid}.wav`);
      await retry(() => tts.synthesize({ text: scene.voiceover, language: b.language, tone: b.tone, outFile: tmp }), ctx, "Sprachausgabe");
      fs.renameSync(tmp, file);
      if (tts.paid) await addCost(ctx.projectId, tts.name, "tts", tts.estimate(scene.voiceover), `${scene.voiceover.length} Zeichen (Schätzwert)`);
      await ctx.log(`Sprachaufnahme für ${scene.id} erzeugt (${tts.name})`);
    } else await ctx.log(`Sprachaufnahme für ${scene.id} aus dem Cache wiederverwendet`);
    const p = await probe(file);
    if (!p.audio || p.duration < 0.2) { fs.rmSync(file, { force: true }); throw new ProviderError(tts.name, `Die Sprachaufnahme für ${scene.id} ist leer oder beschädigt.`, true); }
    assets[scene.id] = { ...(prev || { visualFile: "", visualHash: "", visualProvider: "" }), audioFile: file, audioSec: p.duration, audioHash: hash, ttsProvider: tts.name };
    state.assets = assets;
    await ctx.save();
  }
  state.assets = assets;
}

export async function runVisuals(ctx: Ctx) {
  const { state } = ctx;
  const b = state.brief;
  const [width, height] = ASPECTS[b.aspect];
  const provider = await getVideoProvider(b.allowPaid);
  const prefs = await getPrefs();
  const mood = state.strategy?.mood || "calm";
  const seed = parseInt(sha(ctx.projectId).slice(0, 6), 16) % 9000;
  const scenes = state.script!.scenes;
  for (let i = 0; i < scenes.length; i++) {
    if (ctx.signal.aborted) throw new Error("abgebrochen");
    const scene = scenes[i];
    const asset = state.assets![scene.id];
    const seconds = Math.ceil((asset.audioSec + SCENE_GAP + LEAD_MAX) * 10) / 10;
    const nonce = state.nonce?.[scene.id] || 0;
    const hash = sha("vis", provider.name, provider.generative ? scene.visual : "", mood, seconds, width, height, i, seed, nonce, prefs.brand.primary, prefs.brand.secondary);
    const file = path.join(cacheDir(), `vis-${hash}.mp4`);
    if (asset.visualHash === hash && fs.existsSync(file)) continue;
    if (!fs.existsSync(file)) {
      await guardBudget(ctx, provider.estimate(seconds), `Videoclip für Szene ${scene.id}`);
      const tmp = file.replace(/\.mp4$/, `.tmp-${process.pid}.mp4`);
      await retry(() => provider.generate({ prompt: `${scene.visual}. Style: ${state.strategy?.visualStyle || ""}`, mood, seconds, width, height, index: i, seed: seed + nonce * 17, brand: prefs.brand, outFile: tmp, signal: ctx.signal }), ctx, "Bildgenerierung");
      const p = await probe(tmp).catch(() => null);
      if (!p?.video || p.duration < seconds - 0.3) { fs.rmSync(tmp, { force: true }); throw new ProviderError(provider.name, `Der Clip für ${scene.id} ist unvollständig oder beschädigt.`, true); }
      fs.renameSync(tmp, file);
      if (provider.paid) await addCost(ctx.projectId, provider.name, "video", provider.estimate(seconds), `${seconds}s (Schätzwert)`);
      await ctx.log(`Bildmaterial für ${scene.id} erzeugt (${provider.name})`);
    } else await ctx.log(`Bildmaterial für ${scene.id} aus dem Cache wiederverwendet`);
    state.assets![scene.id] = { ...asset, visualFile: file, visualHash: hash, visualProvider: provider.name };
    await ctx.save();
  }
}

export function timingsOf(state: PState): SceneTiming[] {
  let at = 0;
  return state.script!.scenes.map((scene) => {
    const a = state.assets![scene.id];
    const duration = Number((a.audioSec + SCENE_GAP).toFixed(3));
    const t = { scene: { ...scene, voiceover: state.subtitleOverrides?.[scene.id] || scene.voiceover }, start: at, duration, speechSec: a.audioSec };
    at = Number((at + duration).toFixed(3));
    return t;
  });
}

export async function runRender(ctx: Ctx): Promise<RenderResult> {
  const { state } = ctx;
  const b = state.brief;
  const prefs = await getPrefs();
  const [width, height] = ASPECTS[b.aspect];
  const dir = projectDir(ctx.projectId);
  const version = (state.render?.version || 0) + 1;
  const timings = timingsOf(state);
  const total = timings.reduce((a, t) => a + t.duration, 0);
  const L = layout(b.platform, width, height);
  const cues = buildCues(timings, L.subChars, b.subtitleStyle);
  const files = { video: `video-v${version}.mp4`, srt: `subtitles-v${version}.srt`, ass: `overlay-v${version}.ass`, cover: `cover-v${version}.jpg` };
  fs.writeFileSync(path.join(dir, files.srt), toSrt(cues));
  fs.writeFileSync(path.join(dir, files.ass), toAss({ width, height, platform: b.platform, style: b.subtitleStyle, font: prefs.brand.font || "Inter", accent: prefs.brand.secondary, watermark: prefs.brand.watermark, timings, cues, leadIn: [] }));
  const scenes: ComposeScene[] = timings.map((t) => ({ scene: t.scene, start: t.start, duration: t.duration, audioFile: state.assets![t.scene.id].audioFile, visualFile: state.assets![t.scene.id].visualFile }));
  for (const s of scenes) if (!fs.existsSync(s.audioFile) || !fs.existsSync(s.visualFile)) throw new ProviderError("render", `Medien für ${s.scene.id} fehlen im Cache – bitte Assets neu erzeugen.`);
  await ctx.log("Tonmischung: Stimme, Musikbett, Effekte, Lautheitsanpassung");
  const mix = path.join(dir, `mix-v${version}.wav`);
  await mixAudio(scenes, state.strategy?.mood || "calm", total, dir, mix, ctx.signal);
  await ctx.log(`Videoschnitt und Rendering (${width}×${height}, H.264/AAC)`);
  const tmp = path.join(dir, `video-v${version}.tmp.mp4`);
  const p = await composeVideo({ scenes, assFile: path.join(dir, files.ass), audioMix: mix, outFile: tmp, coverFile: path.join(dir, files.cover), total, signal: ctx.signal });
  fs.renameSync(tmp, path.join(dir, files.video));
  fs.rmSync(mix, { force: true });
  const providers = [...new Set(Object.values(state.assets!).map((a) => a.visualProvider))];
  return { version, ...files, durationSec: p.duration, width: p.video?.width || 0, height: p.video?.height || 0, sizeBytes: fs.statSync(path.join(dir, files.video)).size, renderedAt: new Date().toISOString(), mode: providers.join("+") };
}
