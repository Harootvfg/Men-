import fs from "node:fs";
import path from "node:path";
import { ffmpeg, probe } from "../exec";
import { generateMusic, generateSfx } from "../providers/music";
import type { Scene } from "../schemas";

export const SCENE_GAP = 0.35;   // breathing room after each narration block
export const LEAD_MAX = 0.5;     // extra footage every scene clip carries for transitions
const TRANSITION_SEC: Record<Scene["transition"], number> = { cut: 0.04, fade: 0.4, slideleft: 0.35, slideup: 0.35, zoomin: 0.4, circleopen: 0.45 };
const XFADE_NAME: Record<Scene["transition"], string> = { cut: "fade", fade: "fade", slideleft: "slideleft", slideup: "slideup", zoomin: "zoomin", circleopen: "circleopen" };

export const transitionSec = (t: Scene["transition"]) => TRANSITION_SEC[t];
const escFilterPath = (p: string) => p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");

export interface ComposeScene { scene: Scene; audioFile: string; visualFile: string; start: number; duration: number }

/** Voice + procedural music (ducked under speech) + transition effects, loudness-normalised to about -14 LUFS. */
export async function mixAudio(scenes: ComposeScene[], mood: string, total: number, workDir: string, outFile: string, signal?: AbortSignal) {
  const music = path.join(workDir, `music-${mood}-${Math.round(total * 10)}.wav`);
  if (!fs.existsSync(music)) await generateMusic(mood, total, music);
  const args: string[] = [];
  const filters: string[] = [];
  scenes.forEach((s, i) => {
    args.push("-i", s.audioFile);
    filters.push(`[${i}:a]aresample=48000,apad=whole_dur=${s.duration.toFixed(3)},atrim=duration=${s.duration.toFixed(3)},asetpts=N/SR/TB[v${i}]`);
  });
  const n = scenes.length;
  filters.push(`${scenes.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=0:a=1,pan=stereo|c0=c0|c1=c0,asplit=2[voice][side]`);
  args.push("-i", music);
  filters.push(`[${n}:a]volume=0.55[m0]`, `[m0][side]sidechaincompress=threshold=0.02:ratio=9:attack=15:release=450[duck]`);
  const mixIn = ["[voice]", "[duck]"];
  let idx = n + 1;
  for (let i = 0; i < n; i++) {
    const kind = scenes[i].scene.sfx;
    if (kind === "none") continue;
    const f = path.join(workDir, `sfx-${kind}.wav`);
    if (!fs.existsSync(f)) await generateSfx(kind, f);
    const at = Math.max(0, scenes[i].start - (kind === "impact" ? 0 : 0.3));
    args.push("-i", f);
    filters.push(`[${idx}:a]volume=0.5,adelay=${Math.round(at * 1000)}:all=1[s${idx}]`);
    mixIn.push(`[s${idx}]`);
    idx++;
  }
  filters.push(`${mixIn.join("")}amix=inputs=${mixIn.length}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,afade=t=in:d=0.05,afade=t=out:st=${Math.max(0, total - 0.4).toFixed(3)}:d=0.4,atrim=duration=${total.toFixed(3)}[out]`);
  await ffmpeg([...args, "-filter_complex", filters.join(";"), "-map", "[out]", "-ac", "2", "-ar", "48000", outFile], signal);
}

/** Joins scene clips with transitions aligned to narration, burns titles + subtitles, muxes the mix. */
export async function composeVideo(o: { scenes: ComposeScene[]; assFile: string; audioMix: string; outFile: string; coverFile: string; total: number; signal?: AbortSignal }) {
  const args: string[] = [];
  const filters: string[] = [];
  o.scenes.forEach((s, i) => {
    const lead = i === 0 ? 0 : transitionSec(s.scene.transition);
    args.push("-i", s.visualFile);
    filters.push(`[${i}:v]trim=duration=${(s.duration + lead).toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p,settb=AVTB[c${i}]`);
  });
  let last = "[c0]";
  for (let i = 1; i < o.scenes.length; i++) {
    const t = transitionSec(o.scenes[i].scene.transition);
    const outLabel = `[x${i}]`;
    filters.push(`${last}[c${i}]xfade=transition=${XFADE_NAME[o.scenes[i].scene.transition]}:duration=${t.toFixed(3)}:offset=${(o.scenes[i].start - t).toFixed(3)}${outLabel}`);
    last = outLabel;
  }
  filters.push(`${last}subtitles=filename='${escFilterPath(o.assFile)}',fade=t=in:d=0.25,fade=t=out:st=${Math.max(0, o.total - 0.35).toFixed(3)}:d=0.35,format=yuv420p[vout]`);
  args.push("-i", o.audioMix);
  await ffmpeg([...args, "-filter_complex", filters.join(";"), "-map", "[vout]", "-map", `${o.scenes.length}:a`, "-t", o.total.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", o.outFile], o.signal);
  await ffmpeg(["-ss", Math.min(1.2, o.total / 3).toFixed(2), "-i", o.outFile, "-frames:v", "1", "-q:v", "3", o.coverFile]);
  return probe(o.outFile);
}
