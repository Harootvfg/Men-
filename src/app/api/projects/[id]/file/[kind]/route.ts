import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { handler } from "@/lib/api";
import { projectDir } from "@/lib/config";
import { getProject } from "@/lib/store";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string; kind: string }> };
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "video";
const PLATFORM_NAME = { tiktok: "TikTok", reels: "Instagram Reels", shorts: "YouTube Shorts" } as const;

export const GET = handler(async (req: Request, { params }: P) => {
  const { id, kind } = await params;
  const p = await getProject(id);
  const r = p?.state.render;
  if (!p || !r) return NextResponse.json({ error: "Für dieses Projekt gibt es noch kein fertiges Video." }, { status: 404 });
  const dir = projectDir(id);
  const base = slug(p.title);
  const download = new URL(req.url).searchParams.get("download");
  const meta = p.state.metadata;
  const metaText = (k: keyof typeof PLATFORM_NAME) => meta ? `${PLATFORM_NAME[k]}\n\nTitel:\n${meta[k].title}\n\nBeschreibung:\n${meta[k].description}\n\nHashtags:\n${meta[k].hashtags.join(" ")}\n\nSuchbegriffe:\n${meta[k].keywords.join(", ")}\n` : "";

  if (kind === "zip") {
    const files: Record<string, Uint8Array> = {
      [`${base}.mp4`]: fs.readFileSync(path.join(dir, r.video)),
      [`${base}.srt`]: fs.readFileSync(path.join(dir, r.srt)),
      [`${base}-cover.jpg`]: fs.readFileSync(path.join(dir, r.cover)),
    };
    if (meta) for (const k of ["tiktok", "reels", "shorts"] as const) files[`metadaten-${k}.txt`] = strToU8(metaText(k));
    files["qualitaetsbericht.json"] = strToU8(JSON.stringify({ qa: p.state.qa, capabilities: p.state.capabilities, strategy: p.state.strategy, sources: p.state.research?.sources }, null, 2));
    const zip = zipSync(files, { level: 0 });
    return new Response(Buffer.from(zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${base}-paket.zip"`, "content-length": String(zip.length) } });
  }
  if (kind === "metadata") {
    const k = (new URL(req.url).searchParams.get("platform") || "tiktok") as keyof typeof PLATFORM_NAME;
    return new Response(metaText(k in PLATFORM_NAME ? k : "tiktok"), { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${base}-${k}.txt"` } });
  }
  const map: Record<string, [string, string, string]> = {
    video: [r.video, "video/mp4", `${base}${download && download !== "1" ? "-" + slug(download) : ""}.mp4`],
    srt: [r.srt, "application/x-subrip; charset=utf-8", `${base}.srt`],
    cover: [r.cover, "image/jpeg", `${base}-cover.jpg`],
  };
  const entry = map[kind];
  if (!entry) return NextResponse.json({ error: "Unbekannter Dateityp." }, { status: 404 });
  const file = path.join(dir, entry[0]);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "Die Datei existiert nicht mehr. Bitte neu rendern." }, { status: 404 });
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = { "content-type": entry[1], "accept-ranges": "bytes", "cache-control": "no-store" };
  if (download) headers["content-disposition"] = `attachment; filename="${entry[2]}"`;
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
});
