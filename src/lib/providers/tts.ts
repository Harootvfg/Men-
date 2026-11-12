import fs from "node:fs";
import { run, ffmpeg, hasBinary } from "../exec";
import { getPrefs, getSecret } from "../settings";
import { ProviderError } from "./llm";

export interface TtsRequest { text: string; language: "de" | "en"; tone: string; outFile: string /* wav 48k mono */ }
export interface TtsProvider {
  name: string;
  label: string;
  paid: boolean;
  /** Estimated cost in USD for the given text. */
  estimate(text: string): number;
  synthesize(req: TtsRequest): Promise<void>;
}

const toneParams = (tone: string) => {
  const t = tone.toLowerCase();
  if (/emotion|ruhig|calm|warm/.test(t)) return { speed: 148, pitch: 42 };
  if (/energ|dynam|schnell|humor|lustig|fun/.test(t)) return { speed: 178, pitch: 55 };
  if (/spann|dramat|myster|ernst/.test(t)) return { speed: 156, pitch: 38 };
  return { speed: 165, pitch: 48 };
};

/** Local open-source synthesizer. Intelligible but clearly synthetic; the free baseline voice. */
export const espeak: TtsProvider = {
  name: "espeak", label: "Lokale Basisstimme (eSpeak NG, synthetisch)", paid: false,
  estimate: () => 0,
  async synthesize({ text, language, tone, outFile }) {
    if (!(await hasBinary("espeak-ng"))) throw new ProviderError("espeak", "eSpeak NG ist nicht installiert (apt-get install espeak-ng).");
    const prefs = await getPrefs();
    const voice = prefs.espeakVoice !== "auto" ? prefs.espeakVoice : language === "de" ? "de" : "en-us";
    const { speed, pitch } = toneParams(tone);
    const raw = outFile + ".raw.wav";
    await run("espeak-ng", ["-v", voice, "-s", String(speed), "-p", String(pitch), "-g", "2", "-w", raw, text]);
    // Gentle polish: resample, tame harshness, add a little body.
    await ffmpeg(["-i", raw, "-af", "highpass=f=70,lowpass=f=7500,equalizer=f=180:t=q:w=1:g=3,acompressor=threshold=-18dB:ratio=3:attack=5:release=80,aresample=48000", "-ac", "1", outFile]);
    fs.rmSync(raw, { force: true });
  },
};

/** ElevenLabs text-to-speech. Implemented against the public REST API; requires a key (not live-tested without one). */
export function elevenlabs(apiKey: string, voiceId: string): TtsProvider {
  return {
    name: "elevenlabs", label: "ElevenLabs", paid: true,
    estimate: (text) => (text.length / 1000) * 0.3, // rough list-price estimate; depends on plan
    async synthesize({ text, tone, outFile }) {
      const emotional = /emotion|dramat|spann/.test(tone.toLowerCase());
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: emotional ? 0.35 : 0.5, similarity_boost: 0.75 } }),
        signal: AbortSignal.timeout(120_000),
      }).catch((e) => { throw new ProviderError("elevenlabs", `ElevenLabs nicht erreichbar: ${e.message}`, true); });
      if (res.status === 401) throw new ProviderError("elevenlabs", "Der ElevenLabs-Schlüssel ist ungültig.");
      if (res.status === 429) throw new ProviderError("elevenlabs", "Rate-Limit oder Kontingent bei ElevenLabs erreicht.", true);
      if (!res.ok) throw new ProviderError("elevenlabs", `ElevenLabs-Fehler ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status >= 500);
      const mp3 = outFile + ".mp3";
      fs.writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
      await ffmpeg(["-i", mp3, "-ar", "48000", "-ac", "1", outFile]);
      fs.rmSync(mp3, { force: true });
    },
  };
}

type G = typeof globalThis & { __vasTtsOverride?: TtsProvider };
export function setTtsOverride(p: TtsProvider | undefined) { (globalThis as G).__vasTtsOverride = p; }

export async function getTts(allowPaid: boolean): Promise<TtsProvider> {
  const o = (globalThis as G).__vasTtsOverride;
  if (o) return o;
  const prefs = await getPrefs();
  const key = await getSecret("ELEVENLABS_API_KEY");
  const wantEleven = prefs.ttsProvider === "elevenlabs" || (prefs.ttsProvider === "auto" && !!key);
  if (wantEleven && key && prefs.elevenVoiceId && allowPaid) return elevenlabs(key, prefs.elevenVoiceId);
  return espeak;
}
