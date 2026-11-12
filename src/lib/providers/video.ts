import fs from "node:fs";
import { ffmpeg } from "../exec";
import { getPrefs, getSecret } from "../settings";
import { ProviderError } from "./llm";

export interface VisualRequest {
  prompt: string; mood: string; seconds: number; width: number; height: number; index: number; seed: number;
  brand: { primary: string; secondary: string }; outFile: string; signal?: AbortSignal;
}
export interface VideoProvider {
  name: string;
  label: string;
  paid: boolean;
  generative: boolean;
  estimate(seconds: number): number;
  generate(req: VisualRequest): Promise<void>;
}

const PALETTES: Record<string, string[][]> = {
  dramatic: [["0x0B1026", "0x3B1D5E", "0xC2410C"], ["0x111827", "0x7F1D1D", "0xF59E0B"], ["0x020617", "0x1E3A8A", "0x9333EA"]],
  mysterious: [["0x020617", "0x134E4A", "0x6D28D9"], ["0x0F172A", "0x312E81", "0x0E7490"], ["0x030712", "0x4C1D95", "0x155E75"]],
  uplifting: [["0xF97316", "0xFACC15", "0xEC4899"], ["0x0EA5E9", "0x22D3EE", "0xA78BFA"], ["0xF59E0B", "0xEF4444", "0x8B5CF6"]],
  calm: [["0x0F766E", "0x38BDF8", "0x1E3A8A"], ["0x1E40AF", "0x7DD3FC", "0x5EEAD4"], ["0x334155", "0x64748B", "0x0EA5E9"]],
  energetic: [["0xDB2777", "0x7C3AED", "0x2563EB"], ["0xEA580C", "0xDC2626", "0x7C3AED"], ["0x06B6D4", "0x3B82F6", "0xD946EF"]],
};
const hex = (c: string) => "0x" + c.replace("#", "").toUpperCase();

/**
 * Basis renderer: original procedural motion backgrounds (animated colour fields, light sweep, grain, vignette).
 * It is NOT generative film footage. Scene meaning is carried by typography, which the compositor adds later.
 */
export const basis: VideoProvider = {
  name: "basis", label: "Basis-Renderer (prozedurale Motion-Hintergründe, keine KI-Videogenerierung)", paid: false, generative: false,
  estimate: () => 0,
  async generate({ mood, seconds, width, height, index, seed, brand, outFile, signal }) {
    const pal = [...(PALETTES[mood] || PALETTES.calm)[index % 3]];
    if (index % 3 === 2) { pal[1] = hex(brand.primary); pal[2] = hex(brand.secondary); }
    const d = seconds.toFixed(3);
    // Render at half resolution and upscale: soft gradients lose nothing and encoding is ~4x faster.
    const w = Math.round(width / 4) * 2, h = Math.round(height / 4) * 2;
    const grad = `gradients=s=${w}x${h}:c0=${pal[0]}:c1=${pal[1]}:c2=${pal[2]}:c3=${pal[0]}:n=4:speed=${(0.012 + (index % 3) * 0.006).toFixed(3)}:seed=${seed + index}:d=${d}:r=30`;
    const sweep = `gradients=s=${w}x${h}:c0=0x000000:c1=0xFFFFFF:c2=0x000000:n=3:type=radial:speed=0.03:seed=${seed + 99 + index}:d=${d}:r=30`;
    const zoom = index % 2 === 0 ? `1+0.06*t/${d}` : `1.06-0.06*t/${d}`;
    const filter = [
      `[0:v]format=gbrp[a]`, `[1:v]format=gbrp,gblur=sigma=40,lutrgb=r=val*0.28:g=val*0.28:b=val*0.28[b]`,
      `[a][b]blend=all_mode=screen,scale=w='trunc(${width}*(${zoom})/2)*2':h='trunc(${height}*(${zoom})/2)*2':eval=frame:flags=bilinear,crop=${width}:${height},vignette=PI/4.5,noise=alls=4:allf=t,format=yuv420p[v]`,
    ].join(";");
    await ffmpeg(["-f", "lavfi", "-i", grad, "-f", "lavfi", "-i", sweep, "-filter_complex", filter, "-map", "[v]", "-t", d, "-r", "30",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-an", outFile], signal);
  },
};

/**
 * Gemini Omni Flash via the Gemini Interactions API (successor of Veo 3.1 in the Gemini API, which Google shut down on 2026-10-22).
 * Request and response shape follow https://aistudio.google.com/docs/omni (REST): one synchronous POST, the clip comes back
 * base64-encoded in steps[].content[]. Clips are 3–15 s with native audio; the audio is dropped because the studio adds its own narration mix.
 */
const OMNI_USD_PER_SEC: Record<string, number> = { "360p": 0.023, "720p": 0.07, "1080p": 0.104 }; // from the pricing page, 2026-11
export function omni(apiKey: string, model: string, resolution: "360p" | "720p" | "1080p"): VideoProvider {
  const clip = (seconds: number) => Math.max(3, Math.min(15, Math.ceil(seconds)));
  return {
    name: "omni", label: `Gemini Omni Flash (${model}, ${resolution})`, paid: true, generative: true,
    estimate: (seconds) => clip(seconds) * (OMNI_USD_PER_SEC[resolution] ?? 0.07),
    async generate({ prompt, seconds, width, height, outFile, signal }) {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST", headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600_000)]) : AbortSignal.timeout(600_000),
        body: JSON.stringify({
          model, input: `${prompt}. No on-screen text, no captions, no logos, no dialogue.`,
          response_format: { type: "video", aspect_ratio: width >= height * 1.2 ? "16:9" : "9:16", resolution, duration: `${clip(seconds)}s` },
        }),
      }).catch((e) => { throw new ProviderError("omni", `Gemini API nicht erreichbar: ${e.message}`, true); });
      if (res.status === 401 || res.status === 403) throw new ProviderError("omni", `Der Gemini-API-Schlüssel ist ungültig oder hat keinen Zugriff auf ${model} (kostenpflichtiger Tarif nötig).`);
      if (res.status === 429) throw new ProviderError("omni", "Rate-Limit oder Kontingent bei Google erreicht.", true);
      if (!res.ok) throw new ProviderError("omni", `Gemini-Fehler ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status >= 500);
      const body = (await res.json()) as { status?: string; steps?: { type: string; content?: { type: string; data?: string }[] }[] };
      const data = body.steps?.flatMap((st) => st.content || []).find((c) => c.type === "video" && c.data)?.data;
      if (!data) throw new ProviderError("omni", `Gemini lieferte kein Video (Status: ${body.status || "unbekannt"}; möglicherweise durch Inhaltsfilter blockiert).`);
      const raw = outFile + ".src.mp4";
      fs.writeFileSync(raw, Buffer.from(data, "base64"));
      // Conform to target size / duration (loop if the clip is shorter than the narration), drop native audio.
      await ffmpeg(["-stream_loop", "-1", "-i", raw, "-t", seconds.toFixed(3), "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,format=yuv420p`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-an", outFile], signal);
      fs.rmSync(raw, { force: true });
    },
  };
}

type G = typeof globalThis & { __vasVideoOverride?: VideoProvider };
export function setVideoOverride(p: VideoProvider | undefined) { (globalThis as G).__vasVideoOverride = p; }

export async function getVideoProvider(allowPaid: boolean): Promise<VideoProvider> {
  const o = (globalThis as G).__vasVideoOverride;
  if (o) return o;
  const prefs = await getPrefs();
  const key = await getSecret("GEMINI_API_KEY");
  if (prefs.videoProvider === "omni" && key && allowPaid) return omni(key, prefs.videoModel, prefs.profile === "premium" ? "1080p" : "720p");
  return basis;
}
