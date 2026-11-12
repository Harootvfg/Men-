// End-to-end test against a running server (default http://localhost:3000). Uses real FFmpeg renders.
// Usage: npm run build && npm start &  then  npm run test:e2e
import { createRequire } from "node:module";
// Resolved via require so a globally installed Playwright (NODE_PATH) works as well as a local one.
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOTS = process.env.SHOT_DIR || path.join(os.tmpdir(), "vas-e2e");
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
let failed = 0;
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const j = async (url, init) => { const r = await fetch(BASE + url, init); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = (url, body) => j(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const waitDone = async (id, ms = 300_000) => { const t = Date.now(); for (;;) { const { body } = await j(`/api/projects/${id}`); if (!body.running && ["completed", "failed", "cancelled"].includes(body.project.status)) return body; if (Date.now() - t > ms) throw new Error("timeout waiting for " + id); await new Promise((r) => setTimeout(r, 1500)); } };
const probe = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]).toString());

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // 1 Dashboard
  await page.goto(BASE + "/");
  check("Dashboard lädt mit beiden Erstellungsmodi", (await page.getByRole("button", { name: /Virales Video automatisch erstellen/ }).isVisible()) && (await page.getByRole("link", { name: /Eigenes Video erstellen/ }).isVisible()));

  // 2 Custom topic with dynamic questions
  await page.getByRole("link", { name: /Eigenes Video erstellen/ }).click();
  await page.waitForURL("**/create");
  await page.locator("#topic").fill("Warum schlafen Katzen so viel? 20 Sekunden, lustig");
  await page.getByRole("button", { name: "Thema analysieren" }).click();
  await page.locator("fieldset").first().waitFor({ timeout: 30_000 });
  const nQ = await page.locator("fieldset").count();
  check("3–5 Rückfragen werden als anklickbare Optionen dargestellt", nQ >= 3 && nQ <= 5, `${nQ} Fragen`);
  check("Jede Frage bietet „KI entscheiden lassen“", (await page.getByRole("button", { name: /KI entscheiden lassen/ }).count()) === nQ);
  const legends = (await page.locator("legend").allTextContents()).join(" | ");
  check("Bereits genannte Angaben (Länge, Wirkung) werden nicht erneut gefragt", !/Wie lang/.test(legends) && !/Welche Wirkung/.test(legends), legends.slice(0, 160));
  for (let i = 0; i < nQ; i++) await page.locator("fieldset").nth(i).getByRole("button").nth(i === 0 ? 0 : -1).click();
  await page.getByRole("button", { name: "Briefing ansehen" }).click();
  await page.getByText("Produktionsbriefing").waitFor();
  check("Briefing übernimmt erkannte Länge und zeigt Kostenschätzung", (await page.getByText("(aus deiner Eingabe)").first().isVisible()) && (await page.getByText(/^20 Sekunden/).count()) >= 1 && (await page.getByText("Geschätzte Produktionskosten").isVisible()));
  await page.getByRole("button", { name: "Produktion starten" }).click();
  await page.waitForURL("**/projects/*");
  const id = page.url().split("/").pop();
  await page.getByText("Produktionsfortschritt").waitFor();
  await page.screenshot({ path: path.join(SHOTS, "progress.png") });
  const first = await waitDone(id);
  check("Eigenes Thema: Produktion läuft bis „completed“", first.project.status === "completed", first.project.state.error || "");
  check("Antworten landen im Briefing des Projekts", first.project.state.brief.durationSec === 20 && first.project.state.brief.answers.length === nQ, JSON.stringify(first.project.state.brief.answers[0]));
  check("Alle Workflow-Schritte persistiert als erledigt", first.steps.every((s) => s.status === "done"));

  // 3 Player
  await page.reload();
  await page.locator("video").waitFor({ timeout: 20_000 });
  const meta = await page.locator("video").evaluate((v) => new Promise((res) => { const done = () => res({ d: v.duration, w: v.videoWidth, h: v.videoHeight }); if (v.readyState >= 1) done(); else { v.addEventListener("loadedmetadata", done); v.load(); } }));
  check("Video ist im Browser abspielbar (Metadaten geladen)", meta.d > 3 && meta.w === 1080 && meta.h === 1920, JSON.stringify(meta));
  const played = await page.locator("video").evaluate(async (v) => { v.muted = true; await v.play(); await new Promise((r) => setTimeout(r, 1500)); return v.currentTime; });
  check("Wiedergabe läuft tatsächlich", played > 0.5, `currentTime ${played.toFixed(2)}`);
  await page.screenshot({ path: path.join(SHOTS, "studio.png"), fullPage: true });

  // 4 Downloads
  const dl = async (kind, q = "") => { const r = await fetch(`${BASE}/api/projects/${id}/file/${kind}?${q}`); const buf = Buffer.from(await r.arrayBuffer()); const f = path.join(SHOTS, `dl-${kind}`); fs.writeFileSync(f, buf); return { r, buf, f }; };
  const mp4 = await dl("video", "download=1");
  const pr = probe(mp4.f);
  const vs = pr.streams.find((s) => s.codec_type === "video"), as = pr.streams.find((s) => s.codec_type === "audio");
  check("Download liefert gültige MP4 mit H.264-Bild und AAC-Ton", vs?.codec_name === "h264" && as?.codec_name === "aac" && /attachment/.test(mp4.r.headers.get("content-disposition") || ""), `${vs?.width}x${vs?.height}, ${Number(pr.format.duration).toFixed(1)}s, ${(mp4.buf.length / 1e6).toFixed(1)} MB`);
  const vol = execFileSync("ffmpeg", ["-hide_banner", "-i", mp4.f, "-af", "volumedetect", "-vn", "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const range = await fetch(`${BASE}/api/projects/${id}/file/video`, { headers: { range: "bytes=0-99" } });
  check("Range-Requests für den Player (206)", range.status === 206 && (await range.arrayBuffer()).byteLength === 100);
  const srt = await dl("srt", "download=1");
  check("SRT-Export ist gültig", /^1\n00:00:0\d,\d{3} --> /.test(srt.buf.toString()), srt.buf.toString().split("\n")[2]);
  const zip = await dl("zip");
  check("ZIP-Paket ist ein gültiges Archiv mit Video", zip.buf.subarray(0, 2).toString() === "PK" && zip.buf.length > mp4.buf.length);
  const cover = await dl("cover");
  check("Cover ist ein JPEG", cover.buf[0] === 0xff && cover.buf[1] === 0xd8);

  // 5 Metadata + QA
  await page.getByRole("tab", { name: "Veröffentlichen" }).click();
  check("Metadaten für drei Plattformen mit Kopier-Buttons", (await page.getByRole("button", { name: "Kopieren" }).count()) === 12);
  const m = first.project.state.metadata;
  check("Plattformtexte sind nicht identisch", m.tiktok.description !== m.reels.description && m.reels.title !== m.shorts.title);
  await page.getByRole("tab", { name: "Qualität" }).click();
  check("Qualitätsbericht mit technischen Prüfungen wird angezeigt", (await page.getByText("Technische Prüfungen an der fertigen Datei").isVisible()) && first.project.state.qa.checks.length >= 10, `Score ${first.project.state.qa.score}, ${first.project.state.qa.verdict}`);
  check("Ohne Sprachmodell wird nicht fälschlich freigegeben", first.project.state.capabilities.llm !== "regelbasiert" || first.project.state.qa.verdict === "needs_revision");

  // 6 Targeted scene edit
  await page.getByRole("tab", { name: "Szenen" }).click();
  await page.getByRole("button", { name: "Bearbeiten" }).nth(1).click();
  await page.locator("textarea").first().fill("Katzen schlafen bis zu sechzehn Stunden am Tag.");
  await page.getByRole("button", { name: "Speichern und neu produzieren" }).click();
  await page.getByText(/Nur diese Szene wird neu erzeugt/).waitFor({ timeout: 15_000 });
  const second = await waitDone(id);
  const log = second.events.map((e) => e.message).join("\n");
  const reused = (log.match(/Sprachaufnahme für s\d+ erzeugt/g) || []).length;
  check("Szenenänderung: neue Version, nur die geänderte Szene neu vertont", second.project.state.render.version === first.project.state.render.version + 1 && second.project.state.script.scenes[1].voiceover.startsWith("Katzen schlafen") && reused <= first.project.state.script.scenes.length + 1, `Version ${second.project.state.render.version}`);

  // 7 Autopilot
  await page.goto(BASE + "/");
  await page.getByRole("button", { name: /Virales Video automatisch erstellen/ }).click();
  await page.waitForURL("**/projects/*");
  const autoId = page.url().split("/").pop();
  const auto = await waitDone(autoId);
  const okSources = auto.project.state.research?.sources.filter((s) => s.ok) || [];
  check("Autopilot: Produktion ohne Themenvorgabe abgeschlossen", auto.project.status === "completed" && !!auto.project.state.render, `Thema: ${auto.project.title}`);
  check("Autopilot: Quellen, Zeitstempel und Datenbasis sind gespeichert", okSources.length >= 1 && !!auto.project.state.research.fetchedAt && !!auto.project.state.strategy.dataBasisNote, okSources.map((s) => `${s.name} (${s.note})`).join(", "));
  check("Autopilot: mindestens drei Konzepte verglichen", auto.project.state.strategy.concepts.length >= 3);

  // 8 Cancel + resume
  const c = await post("/api/projects", { mode: "custom", brief: { topic: "Abbruchtest zum Thema Kaffee", durationSec: 20 } });
  await new Promise((r) => setTimeout(r, 6000));
  await post(`/api/projects/${c.body.id}/action`, { type: "cancel" });
  const cancelled = await waitDone(c.body.id, 60_000);
  check("Abbruch stoppt die laufende Produktion", cancelled.project.status === "cancelled", `erledigte Schritte: ${cancelled.steps.filter((s) => s.status === "done").map((s) => s.name).join(",")}`);
  const blocked = await post(`/api/projects/${c.body.id}/action`, { type: "resume" });
  const resumed = await waitDone(c.body.id);
  check("Fortsetzen nach Abbruch führt zum fertigen Video", blocked.status === 200 && resumed.project.status === "completed");

  // 9 Negative API cases
  check("Leeres Thema wird abgelehnt (400)", (await post("/api/projects", { mode: "custom", brief: { topic: " " } })).status === 400);
  check("Unbekanntes Projekt liefert 404", (await j("/api/projects/does-not-exist")).status === 404);
  check("Ungültiges JSON liefert 400", (await j("/api/questions", { method: "POST", body: "{" })).status === 400);
  check("Aktion auf laufendem Projekt wird abgelehnt (409)", await (async () => { const r = await post("/api/projects", { mode: "custom", brief: { topic: "Konflikttest", durationSec: 20 } }); const a = await post(`/api/projects/${r.body.id}/action`, { type: "newVersion" }); await post(`/api/projects/${r.body.id}/action`, { type: "cancel" }); await waitDone(r.body.id, 60_000); return a.status === 409; })());

  // 10 Trend radar + settings
  await page.goto(BASE + "/trends");
  await page.getByRole("button", { name: "Video daraus erstellen" }).first().waitFor({ timeout: 40_000 });
  check("Trend Radar zeigt Kandidaten mit Quellenstatus", (await page.getByText(/Google Trends \(RSS\)/).first().isVisible()));
  await page.screenshot({ path: path.join(SHOTS, "trends.png") });
  const s1 = await post("/api/settings", { secrets: { ELEVENLABS_API_KEY: "sk_test_1234567890abcd" } });
  check("API-Schlüssel wird gespeichert, aber nie zurückgegeben", s1.body.secrets.ELEVENLABS_API_KEY.set && !JSON.stringify(s1.body).includes("sk_test_1234567890"));
  await post("/api/settings", { secrets: { ELEVENLABS_API_KEY: "" } });

  // 11 Mobile
  const mobile = await browser.newContext({ ...devices["iPhone 13"] });
  const mp = await mobile.newPage();
  for (const route of ["/", "/create", "/trends", "/videos", "/analytics", "/settings", `/projects/${id}`]) {
    await mp.goto(BASE + route);
    await mp.waitForLoadState("networkidle").catch(() => {});
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`Mobil ohne horizontales Scrollen: ${route.startsWith("/projects") ? "/projects/[id]" : route}`, overflow <= 1, `Überstand ${overflow}px`);
    await mp.screenshot({ path: path.join(SHOTS, `mobile${route.replace(/\//g, "_").replace(id, "id")}.png`) });
  }
  await mobile.close();
  check("Keine JavaScript-Fehler im Browser", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  check("Testlauf ohne Abbruch", false, e.stack || String(e));
} finally {
  await browser.close();
}
console.log(`\n${results.length - failed}/${results.length} Prüfungen bestanden. Screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
