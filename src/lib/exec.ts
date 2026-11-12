import { spawn } from "node:child_process";

export class ExecError extends Error {
  constructor(public cmd: string, public code: number | null, public stderr: string) {
    super(`${cmd} fehlgeschlagen (Exit ${code}): ${stderr.split("\n").filter(Boolean).slice(-4).join(" | ")}`);
  }
}

export function run(cmd: string, args: string[], opts: { input?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], signal: opts.signal });
    let stdout = "", stderr = "";
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => { stderr += d; if (stderr.length > 400_000) stderr = stderr.slice(-200_000); });
    child.on("error", (e) => { if (timer) clearTimeout(timer); reject(new ExecError(cmd, null, String(e.message))); });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr }); else reject(new ExecError(cmd, code, stderr));
    });
    if (opts.input) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

export const ffmpeg = (args: string[], signal?: AbortSignal) =>
  run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], { signal, timeoutMs: 15 * 60_000 });

export interface Probe {
  duration: number;
  video?: { codec: string; width: number; height: number; fps: number; pixFmt: string };
  audio?: { codec: string; sampleRate: number; channels: number };
  formatName: string;
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const j = JSON.parse(stdout);
  const v = j.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
  const a = j.streams?.find((s: { codec_type: string }) => s.codec_type === "audio");
  const [n, d] = String(v?.avg_frame_rate || "0/1").split("/").map(Number);
  return {
    duration: Number(j.format?.duration || 0),
    formatName: String(j.format?.format_name || ""),
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: d ? n / d : 0, pixFmt: v.pix_fmt } : undefined,
    audio: a ? { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels } : undefined,
  };
}

export async function hasBinary(name: string): Promise<boolean> {
  try { await run("which", [name]); return true; } catch { return false; }
}
