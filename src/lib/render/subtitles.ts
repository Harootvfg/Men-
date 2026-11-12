import type { Scene } from "../schemas";

export interface Cue { start: number; end: number; text: string; sceneId: string }
export interface SceneTiming { scene: Scene; start: number; duration: number; speechSec: number }
export type SubtitleStyle = "clean" | "bold" | "karaoke";

/** Fractions of the frame that platform UI may cover. Text must stay outside these bands. */
export function safeArea(platform: string, width: number, height: number) {
  const portrait = height > width;
  const f = !portrait ? { top: 0.06, bottom: 0.1, side: 0.06 }
    : platform === "shorts" ? { top: 0.1, bottom: 0.2, side: 0.1 }
    : platform === "reels" ? { top: 0.11, bottom: 0.22, side: 0.1 }
    : { top: 0.1, bottom: 0.22, side: 0.11 };
  return { top: Math.round(height * f.top), bottom: Math.round(height * f.bottom), side: Math.round(width * f.side) };
}

export function layout(platform: string, width: number, height: number) {
  const safe = safeArea(platform, width, height);
  const base = Math.min(width, (height * 9) / 16);
  const subSize = Math.round(base * 0.066);
  const headSize = Math.round(base * 0.086);
  const usable = width - 2 * safe.side;
  return {
    safe, subSize, headSize,
    subMarginV: safe.bottom + Math.round(height * 0.03),
    headMarginV: safe.top + Math.round(height * 0.12),
    subChars: Math.max(10, Math.floor(usable / (subSize * 0.56))),
    headChars: Math.max(8, Math.floor(usable / (headSize * 0.58))),
  };
}

export function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + " " + w).length > maxChars) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Split narration into display chunks that fit on at most two lines. */
export function chunkText(text: string, maxChars: number, wordByWord = false): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (wordByWord) return words;
  const chunks: string[] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) { chunks.push(cur.join(" ")); cur = []; } };
  for (const w of words) {
    if (cur.length && (cur.join(" ").length + 1 + w.length > maxChars * 2 - 4 || cur.length >= 7)) flush();
    cur.push(w);
    if (/[.!?…:]$/.test(w) || (/[,;–]$/.test(w) && cur.join(" ").length > maxChars)) flush();
  }
  flush();
  return chunks;
}

/**
 * Timing model: each chunk gets a share of the scene's measured speech duration proportional to its length
 * (characters plus a pause allowance for punctuation). Accuracy is sentence-level, not forced-aligned.
 */
export function buildCues(timings: SceneTiming[], maxChars: number, style: SubtitleStyle): Cue[] {
  const cues: Cue[] = [];
  for (const t of timings) {
    const chunks = chunkText(t.scene.voiceover, maxChars, style === "karaoke");
    if (!chunks.length) continue;
    const weight = (c: string) => c.replace(/\s/g, "").length + (/[.!?…]$/.test(c) ? 6 : /[,;:–]$/.test(c) ? 3 : 0) + 1;
    const total = chunks.reduce((a, c) => a + weight(c), 0);
    let at = t.start + 0.03;
    for (const c of chunks) {
      const dur = (t.speechSec * weight(c)) / total;
      cues.push({ start: at, end: Math.min(at + dur, t.start + t.duration), text: c, sceneId: t.scene.id });
      at += dur;
    }
  }
  return cues;
}

const srtTime = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const assTime = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(cs / 360000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
};

/** SRT with readable cues: display chunks are merged up to ~2 lines of 42 characters. */
export function toSrt(cues: Cue[]): string {
  const merged: Cue[] = [];
  for (const c of cues) {
    const last = merged[merged.length - 1];
    if (last && last.sceneId === c.sceneId && (last.text + " " + c.text).length <= 84 && !/[.!?…]$/.test(last.text)) { last.text += " " + c.text; last.end = c.end; }
    else merged.push({ ...c });
  }
  return merged.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${wrap(c.text, 42).join("\n")}\n`).join("\n");
}

export function parseSrt(srt: string): { start: number; end: number; text: string }[] {
  const t = (s: string) => { const m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : NaN; };
  return srt.split(/\r?\n\r?\n/).map((b) => b.trim().split(/\r?\n/)).filter((l) => l.length >= 3 && l[1].includes("-->")).map((l) => {
    const [a, b] = l[1].split("-->");
    return { start: t(a), end: t(b), text: l.slice(2).join("\n") };
  });
}

const assColor = (hexColor: string, alpha = "00") => { const h = hexColor.replace("#", ""); return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase(); };
const esc = (s: string) => s.replace(/\\/g, "").replace(/[{}]/g, "").replace(/\n/g, "\\N");

export interface AssOptions {
  width: number; height: number; platform: string; style: SubtitleStyle; font: string; accent: string; watermark: string;
  timings: SceneTiming[]; cues: Cue[]; leadIn: number[];
}

export function toAss(o: AssOptions): string {
  const L = layout(o.platform, o.width, o.height);
  const out = Math.max(3, Math.round(L.subSize * 0.085));
  const subStyle = o.style === "clean"
    ? `Style: Sub,${o.font},${Math.round(L.subSize * 0.82)},&H00FFFFFF,&H00FFFFFF,&HA0101010,&HA0101010,-1,0,0,0,100,100,0,0,3,${Math.round(out * 2.2)},0,2,${L.safe.side},${L.safe.side},${L.subMarginV},1`
    : `Style: Sub,${o.font},${o.style === "karaoke" ? Math.round(L.subSize * 1.35) : L.subSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,1,${out},${Math.round(out / 2)},2,${L.safe.side},${L.safe.side},${L.subMarginV},1`;
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${o.width}`, `PlayResY: ${o.height}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    subStyle,
    `Style: Head,${o.font},${L.headSize},&H00FFFFFF,&H00FFFFFF,&H50101010,&H64000000,-1,0,0,0,100,100,-1,0,1,${Math.round(out * 0.7)},${out},8,${L.safe.side},${L.safe.side},${L.headMarginV},1`,
    `Style: Mark,${o.font},${Math.round(L.subSize * 0.5)},&H50FFFFFF,&H00FFFFFF,&H64000000,&H64000000,0,0,0,0,100,100,0,0,1,1,0,7,${L.safe.side},${L.safe.side},${L.safe.top},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const accent = assColor(o.accent);
  o.timings.forEach((t, i) => {
    if (!t.scene.onScreenText.trim()) return;
    const start = t.start + (i === 0 ? 0.1 : 0.15);
    const end = t.start + t.duration - 0.1;
    const wrapped = wrap(esc(t.scene.onScreenText), L.headChars);
    // The first line carries the accent colour so the headline has a visual anchor.
    const text = wrapped.map((l, j) => (j === 0 ? `{\\c${accent}}${l}{\\c&HFFFFFF&}` : l)).join("\\N");
    const big = t.scene.role === "hook" ? `\\fs${Math.round(L.headSize * 1.18)}` : "";
    lines.push(`Dialogue: 1,${assTime(start)},${assTime(end)},Head,,0,0,0,,{\\fad(180,160)${big}\\fscx82\\fscy82\\t(0,240,\\fscx100\\fscy100)}${text}`);
  });
  for (const c of o.cues) {
    const text = wrap(esc(c.text), L.subChars).slice(0, 3).join("\\N");
    const pop = o.style === "clean" ? "{\\fad(60,60)}" : o.style === "karaoke" ? `{\\c${accent}\\fscx70\\fscy70\\t(0,90,\\fscx100\\fscy100)}` : "{\\fscx90\\fscy90\\t(0,80,\\fscx100\\fscy100)}";
    lines.push(`Dialogue: 2,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,${pop}${text}`);
  }
  if (o.watermark.trim()) {
    const end = o.timings.reduce((a, t) => Math.max(a, t.start + t.duration), 0);
    lines.push(`Dialogue: 0,${assTime(0)},${assTime(end)},Mark,,0,0,0,,${esc(o.watermark)}`);
  }
  return lines.join("\n") + "\n";
}

/** Structural validation used by the quality manager. */
export function validateCues(cues: { start: number; end: number; text: string }[], duration: number, maxLineChars: number) {
  const problems: string[] = [];
  cues.forEach((c, i) => {
    if (!(c.end > c.start)) problems.push(`Untertitel ${i + 1}: Ende liegt nicht nach dem Start`);
    if (c.start < -0.01 || c.end > duration + 0.25) problems.push(`Untertitel ${i + 1}: außerhalb der Videolänge`);
    if (i > 0 && c.start < cues[i - 1].end - 0.02) problems.push(`Untertitel ${i + 1}: überlappt mit dem vorherigen`);
    if (!c.text.trim()) problems.push(`Untertitel ${i + 1}: leer`);
    if (c.text.split("\n").some((l) => l.length > maxLineChars)) problems.push(`Untertitel ${i + 1}: Zeile zu lang`);
    const cps = c.text.replace(/\s/g, "").length / Math.max(0.05, c.end - c.start);
    if (cps > 32) problems.push(`Untertitel ${i + 1}: zu schnell lesbar (${cps.toFixed(0)} Zeichen/s)`);
  });
  return problems;
}
