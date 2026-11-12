import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDb } from "./db";
import { dataDir } from "./config";

export const SECRET_NAMES = ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "GEMINI_API_KEY", "YOUTUBE_API_KEY"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export const Prefs = z.object({
  language: z.enum(["de", "en"]).default("de"),
  geo: z.string().default("DE"),
  durationSec: z.number().default(30),
  platform: z.enum(["tiktok", "reels", "shorts"]).default("tiktok"),
  profile: z.enum(["economy", "balanced", "premium"]).default("economy"),
  maxCostUsd: z.number().min(0).default(0),
  allowPaid: z.boolean().default(false),
  llmModel: z.string().default("claude-opus-5-5"),
  ttsProvider: z.enum(["auto", "espeak", "elevenlabs"]).default("auto"),
  videoProvider: z.enum(["basis", "veo"]).default("basis"),
  elevenVoiceId: z.string().default(""),
  espeakVoice: z.string().default("auto"),
  veoModel: z.string().default("veo-3.1-fast-generate-preview"),
  veoUsdPerSecond: z.number().default(0.15),
  subtitleStyle: z.enum(["clean", "bold", "karaoke"]).default("bold"),
  brand: z.object({
    primary: z.string().default("#6D5EF6"),
    secondary: z.string().default("#22D3EE"),
    font: z.string().default("Inter"),
    watermark: z.string().default(""),
  }).default({ primary: "#6D5EF6", secondary: "#22D3EE", font: "Inter", watermark: "" }),
});
export type Prefs = z.infer<typeof Prefs>;

function appKey(): Buffer {
  if (process.env.APP_SECRET && /^[0-9a-f]{64}$/i.test(process.env.APP_SECRET)) return Buffer.from(process.env.APP_SECRET, "hex");
  if (process.env.DATA_DIR === ":memory:") return crypto.createHash("sha256").update("memory").digest();
  const file = path.join(dataDir(), "secret.key");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}
function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", appKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", appKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

async function getRaw<T>(key: string): Promise<T | null> {
  const rows = await (await getDb()).query<{ value: T | string }>("SELECT value FROM settings WHERE key=$1", [key]);
  if (!rows[0]) return null;
  return typeof rows[0].value === "string" ? JSON.parse(rows[0].value as string) : (rows[0].value as T);
}
async function setRaw(key: string, value: unknown) {
  await (await getDb()).query("INSERT INTO settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [key, JSON.stringify(value)]);
}

export async function getPrefs(): Promise<Prefs> {
  return Prefs.parse((await getRaw("prefs")) || {});
}
export async function setPrefs(patch: unknown): Promise<Prefs> {
  const merged = Prefs.parse({ ...(await getPrefs()), ...(patch as object) });
  await setRaw("prefs", merged);
  return merged;
}

/** Secrets: stored value (AES-256-GCM) wins over the environment variable. Never returned to the browser. */
export async function getSecret(name: SecretName): Promise<string | null> {
  const stored = await getRaw<{ enc: string }>(`secret:${name}`);
  if (stored?.enc) { try { return decrypt(stored.enc); } catch { return null; } }
  return process.env[name] || null;
}
export async function setSecret(name: SecretName, value: string) {
  if (!value) await (await getDb()).query("DELETE FROM settings WHERE key=$1", [`secret:${name}`]);
  else await setRaw(`secret:${name}`, { enc: encrypt(value.trim()) });
}
export async function secretStatus(): Promise<Record<SecretName, { set: boolean; source: "app" | "env" | null; hint: string }>> {
  const out = {} as Record<SecretName, { set: boolean; source: "app" | "env" | null; hint: string }>;
  for (const n of SECRET_NAMES) {
    const stored = await getRaw<{ enc: string }>(`secret:${n}`);
    const v = await getSecret(n);
    out[n] = { set: !!v, source: stored?.enc ? "app" : v ? "env" : null, hint: v ? `…${v.slice(-4)}` : "" };
  }
  return out;
}
