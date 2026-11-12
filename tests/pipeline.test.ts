// Integration tests: real FFmpeg/eSpeak pipeline against an in-memory database, plus failure scenarios.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vas-test-"));
process.env.DATA_DIR = tmp;
delete process.env.DATABASE_URL;
for (const k of ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "GEMINI_API_KEY", "YOUTUBE_API_KEY"]) delete process.env[k];

import { closeDb } from "@/lib/db";
import { probe } from "@/lib/exec";
import { ProviderError, setLlmOverride, type Llm } from "@/lib/providers/llm";
import { basis, setVideoOverride, type VideoProvider } from "@/lib/providers/video";
import { espeak, setTtsOverride, type TtsProvider } from "@/lib/providers/tts";
import { technicalChecks } from "@/lib/agents/quality";
import { ContentReview, Metadata, Script, Strategy } from "@/lib/schemas";
import { getSecret, setPrefs, setSecret } from "@/lib/settings";
import { getProject, listEvents, projectCost } from "@/lib/store";
import { applyAction, cancel, createAndStart, resume, waitFor } from "@/lib/workflow/engine";
import { heuristicStrategy } from "@/lib/agents/market";
import { heuristicScript } from "@/lib/agents/script";
import { heuristicMetadata } from "@/lib/agents/seo";

const produce = async (brief: Record<string, unknown>, mode: "custom" | "autopilot" = "custom") => {
  const p = await createAndStart(mode, { topic: "Warum ist der Himmel blau", durationSec: 15, ...brief });
  await waitFor(p.id);
  return (await getProject(p.id))!;
};
const file = (id: string, name: string) => path.join(tmp, "projects", id, name);

beforeAll(() => setLlmOverride(null));
afterAll(async () => { setLlmOverride(undefined); setTtsOverride(undefined); setVideoOverride(undefined); await closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe("Produktionspipeline (Basis-Modus, ohne Schlüssel)", () => {
  let id = "";
  it("erzeugt eine echte MP4 mit Bild- und Tonspur, SRT und Cover", async () => {
    const p = await produce({});
    id = p.id;
    expect(p.status).toBe("completed");
    const r = p.state.render!;
    const info = await probe(file(id, r.video));
    expect(info.video).toMatchObject({ codec: "h264", width: 1080, height: 1920, pixFmt: "yuv420p" });
    expect(info.audio).toMatchObject({ codec: "aac", sampleRate: 48000, channels: 2 });
    expect(info.duration).toBeGreaterThan(5);
    expect(fs.readFileSync(file(id, r.srt), "utf8")).toMatch(/-->/);
    expect(fs.statSync(file(id, r.cover)).size).toBeGreaterThan(1000);
    expect((await projectCost(id)).total).toBe(0);
  });
  it("besteht alle kritischen technischen Prüfungen, gibt aber ohne Inhaltsprüfung nicht frei", async () => {
    const p = (await getProject(id))!;
    expect(p.state.qa!.checks.filter((c) => c.critical && !c.passed)).toEqual([]);
    expect(p.state.qa!.reviewMode).toBe("heuristic");
    expect(p.state.qa!.verdict).toBe("needs_revision");
    expect(p.state.revisions).toBe(0); // no pointless paid/CPU loops when nothing is fixable
    expect(p.state.capabilities!.labels.length).toBeGreaterThan(0);
  });
  it("erstellt unterschiedliche Metadaten je Plattform ohne generische Hashtags", async () => {
    const m = (await getProject(id))!.state.metadata!;
    expect(new Set([m.tiktok.description, m.reels.description, m.shorts.description]).size).toBe(3);
    expect(JSON.stringify(m)).not.toMatch(/#fyp|#viral|#foryou/i);
  });
  it("Szenenänderung vertont nur die betroffene Szene neu", async () => {
    const before = (await getProject(id))!;
    const target = before.state.script!.scenes[1].id;
    const res = await applyAction(id, { type: "editScene", sceneId: target, voiceover: "Das Licht der Sonne wird in der Luft gestreut." });
    expect(res.ok).toBe(true);
    await waitFor(id);
    const after = (await getProject(id))!;
    expect(after.status).toBe("completed");
    expect(after.state.render!.version).toBe(before.state.render!.version + 1);
    for (const s of after.state.script!.scenes) {
      const same = after.state.assets![s.id].audioHash === before.state.assets![s.id].audioHash;
      expect(same).toBe(s.id !== target);
    }
  });
  it("Untertitel-Stiländerung rendert neu, ohne Medien neu zu erzeugen", async () => {
    const before = (await getProject(id))!;
    await applyAction(id, { type: "setSubtitles", style: "karaoke" });
    await waitFor(id);
    const after = (await getProject(id))!;
    expect(after.state.render!.version).toBe(before.state.render!.version + 1);
    expect(after.state.assets).toEqual(before.state.assets);
    expect(fs.readFileSync(file(id, after.state.render!.ass), "utf8").split("Dialogue: 2").length).toBeGreaterThan(before.state.script!.scenes.length * 2);
  });
  it("Reparaturanweisung ohne Szenennummer wird verständlich abgelehnt", async () => {
    expect((await applyAction(id, { type: "repair", instruction: "sieht komisch aus" })).ok).toBe(false);
    expect((await applyAction(id, { type: "repair", instruction: "Szene 99 neu" })).message).toMatch(/existiert nicht/);
  });
  it("erkennt eine beschädigte Videodatei als kritischen Mangel", async () => {
    const p = (await getProject(id))!;
    const f = file(id, p.state.render!.video);
    const original = fs.readFileSync(f);
    fs.writeFileSync(f, original.subarray(0, Math.floor(original.length / 3)));
    const broken = await technicalChecks(p.state, id);
    expect(broken.checks.some((c) => c.critical && !c.passed)).toBe(true);
    fs.writeFileSync(f, Buffer.from("kein video"));
    expect((await technicalChecks(p.state, id)).checks[0]).toMatchObject({ passed: false, critical: true });
    fs.writeFileSync(f, original);
  });
  it("unterstützt weitere Formate (1:1)", async () => {
    const p = await produce({ aspect: "1:1", topic: "Kurztest Quadrat" });
    expect(p.state.render).toMatchObject({ width: 1080, height: 1080 });
    expect(p.state.qa!.checks.find((c) => c.id === "resolution")!.passed).toBe(true);
  });
});

describe("Fehler- und Abbruchverhalten", () => {
  it("Abbruch hält an, Fortsetzen nutzt erledigte Schritte weiter", async () => {
    const p = await createAndStart("custom", { topic: "Abbruchtest", durationSec: 15 });
    await new Promise((r) => setTimeout(r, 2500));
    await cancel(p.id);
    await waitFor(p.id);
    const stopped = (await getProject(p.id))!;
    expect(stopped.status).toBe("cancelled");
    const doneBefore = Object.entries(stopped.state.steps).filter(([, s]) => s!.status === "done").map(([k]) => k);
    expect((await applyAction(p.id, { type: "newVersion" })).ok).toBe(doneBefore.includes("script"));
    await waitFor(p.id);
    await resume(p.id);
    await waitFor(p.id);
    expect((await getProject(p.id))!.status).toBe("completed");
  });
  it("vorübergehende Anbieterfehler werden wiederholt, dauerhafte stoppen verständlich und sind fortsetzbar", async () => {
    let calls = 0;
    const flaky: TtsProvider = { ...espeak, name: "flaky", synthesize: async (req) => { if (++calls <= 2) throw new ProviderError("flaky", "Rate-Limit erreicht", true); return espeak.synthesize(req); } };
    setTtsOverride(flaky);
    const ok = await produce({ topic: "Wiederholungstest" });
    expect(ok.status).toBe("completed");
    expect((await listEvents(ok.id)).some((e) => /neuer Versuch/.test(e.message))).toBe(true);

    setTtsOverride({ ...espeak, name: "down", synthesize: async () => { throw new ProviderError("down", "Der Schlüssel ist ungültig."); } });
    const bad = await produce({ topic: "Fehlertest" });
    expect(bad.status).toBe("failed");
    expect(bad.state.error).toMatch(/Sprachaufnahme: Der Schlüssel ist ungültig/);
    expect(bad.state.steps.script!.status).toBe("done");
    setTtsOverride(undefined);
    await resume(bad.id);
    await waitFor(bad.id);
    const healed = (await getProject(bad.id))!;
    expect(healed.status).toBe("completed");
    expect(healed.state.script!.version).toBe(bad.state.script!.version); // script was reused, not regenerated
  });
  it("beschädigte Clips eines Anbieters werden erkannt statt verarbeitet", async () => {
    setVideoOverride({ ...basis, name: "broken", generate: async ({ outFile }) => fs.writeFileSync(outFile, "garbage") });
    const p = await produce({ topic: "Kaputter Clip" });
    setVideoOverride(undefined);
    expect(p.status).toBe("failed");
    expect(p.state.error).toMatch(/unvollständig oder beschädigt/);
  });
  it("kostenpflichtige Anbieter laufen nie ohne Freigabe und respektieren das Budget", async () => {
    let paidCalls = 0;
    const paid: VideoProvider = { ...basis, name: "paidfake", paid: true, estimate: () => 1.5, generate: async (r) => { paidCalls++; return basis.generate(r); } };
    setVideoOverride(paid);
    const noConsent = await produce({ topic: "Kosten ohne Freigabe", allowPaid: false });
    expect(noConsent.status).toBe("failed");
    expect(noConsent.state.error).toMatch(/nicht freigegeben/);
    expect(paidCalls).toBe(0);
    const capped = await produce({ topic: "Kosten mit Limit", allowPaid: true, budgetUsd: 2 });
    expect(capped.status).toBe("failed");
    expect(capped.state.error).toMatch(/Budgetlimit erreicht/);
    expect(paidCalls).toBe(1);
    expect((await projectCost(capped.id)).total).toBeCloseTo(1.5);
    setVideoOverride(undefined);
  });
  it("Schlüssel werden verschlüsselt gespeichert", async () => {
    await setSecret("ELEVENLABS_API_KEY", "sk_secret_value_123");
    expect(await getSecret("ELEVENLABS_API_KEY")).toBe("sk_secret_value_123");
    const { getDb } = await import("@/lib/db");
    const rows = await (await getDb()).query<{ value: unknown }>("SELECT value FROM settings WHERE key='secret:ELEVENLABS_API_KEY'");
    expect(JSON.stringify(rows[0].value)).not.toContain("sk_secret_value_123");
    await setSecret("ELEVENLABS_API_KEY", "");
    expect(await getSecret("ELEVENLABS_API_KEY")).toBeNull();
  });
});

describe("Agenten mit Sprachmodell (simuliertes LLM, kein echter API-Aufruf)", () => {
  it("nutzt strukturierte Übergaben, führt eine gezielte Überarbeitungsrunde aus und gibt danach frei", async () => {
    const calls: string[] = [];
    let reviews = 0;
    const fake: Llm = {
      name: "fake-llm",
      async generate(req) {
        calls.push(req.agent);
        const state = { brief: { topic: "Warum ist der Himmel blau", language: "de", durationSec: 15, platform: "tiktok", tone: "auto", audience: "auto", style: "auto", geo: "DE" }, revisions: 0, steps: {} } as never;
        const strategy = heuristicStrategy(state, "custom");
        const withStrategy = { ...(state as object), strategy } as never;
        const script = heuristicScript(withStrategy);
        let out: unknown;
        if (req.schema === (Strategy as unknown)) out = strategy;
        else if (req.schema === (Script as unknown)) out = { ...script, selfCritique: { ...script.selfCritique, hook: 8, clarity: 8, dramaturgy: 8, originality: 8, audienceFit: 8, timing: 8, visualFeasibility: 8 } };
        else if (req.schema === (Metadata as unknown)) out = heuristicMetadata({ ...(withStrategy as object), script } as never);
        else if (req.schema === (ContentReview as unknown)) {
          reviews++;
          const cat = { score: 85, reason: "ok" };
          expect(req.images?.length).toBeGreaterThan(0); // the reviewer really receives frames of the rendered file
          out = { hook: cat, story: cat, visual: cat, audio: cat, fit: cat, originality: cat, issues: reviews === 1 ? [{ severity: "major", category: "script", sceneId: "s2", description: "Aussage zu vage", fix: "Konkreter formulieren" }, { severity: "major", category: "facts", sceneId: "s2", description: "Beleg fehlt", fix: "Abschwächen" }] : [] };
        } else out = { scenes: [{ ...script.scenes[1], voiceover: "Blaues Licht wird in der Luft am stärksten gestreut." }] };
        return (req.schema as z.ZodType).parse(out) as never;
      },
    };
    setLlmOverride(fake);
    const p = await produce({ topic: "Warum ist der Himmel blau" });
    setLlmOverride(null);
    expect(p.status).toBe("completed");
    expect(calls).toEqual(expect.arrayContaining(["market_intelligence", "scriptwriter", "quality_manager", "scriptwriter_scene_revision", "seo"]));
    expect(p.state.revisions).toBe(1);
    expect(p.state.script!.scenes[1].voiceover).toMatch(/Blaues Licht/);
    expect(p.state.script!.version).toBe(2);
    expect(p.state.qaHistory).toHaveLength(2);
    expect(p.state.qa).toMatchObject({ verdict: "approved", reviewMode: "llm_multimodal" });
    expect(p.state.render!.version).toBe(2);
  });
  it("ein kritischer Mangel kann nicht durch einen guten Score überstimmt werden und die Schleife endet nach zwei Runden", async () => {
    const cat = { score: 95, reason: "sehr gut" };
    const fake: Llm = {
      name: "fake-llm",
      async generate(req) {
        const state = { brief: { topic: "Test", language: "de", durationSec: 15, platform: "tiktok", tone: "auto", audience: "auto", style: "auto", geo: "DE" }, revisions: 0, steps: {} } as never;
        const strategy = heuristicStrategy(state, "custom");
        const script = heuristicScript({ ...(state as object), strategy } as never);
        if (req.schema === (Strategy as unknown)) return strategy as never;
        if (req.schema === (Script as unknown)) return { ...script, selfCritique: { ...script.selfCritique, hook: 8, clarity: 8, dramaturgy: 8, originality: 8, audienceFit: 8, timing: 8, visualFeasibility: 8 } } as never;
        if (req.schema === (Metadata as unknown)) return heuristicMetadata({ ...(state as object), strategy, script } as never) as never;
        if (req.schema === (ContentReview as unknown)) return { hook: cat, story: cat, visual: cat, audio: cat, fit: cat, originality: cat, issues: [{ severity: "critical", category: "facts", sceneId: "s2", description: "Falsche Tatsachenbehauptung", fix: "Korrigieren" }] } as never;
        return { scenes: [{ ...script.scenes[1], voiceover: `Neue Fassung ${Math.random().toFixed(4)}.` }] } as never;
      },
    };
    setLlmOverride(fake);
    const p = await produce({ topic: "Test" });
    setLlmOverride(null);
    expect(p.status).toBe("completed");
    expect(p.state.revisions).toBe(2);
    expect(p.state.qa!.score).toBeGreaterThan(85);
    expect(p.state.qa!.verdict).toBe("needs_revision");
  });
});
