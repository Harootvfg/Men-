"use client";
import { useEffect, useState } from "react";
import { api, Badge, Button, Card, ErrorNote, Field, inputCls, Note, PageHeader, useData } from "@/components/ui";

interface Prefs { language: string; geo: string; durationSec: number; platform: string; profile: string; maxCostUsd: number; allowPaid: boolean; llmModel: string; ttsProvider: string; videoProvider: string; elevenVoiceId: string; espeakVoice: string; veoModel: string; veoUsdPerSecond: number; subtitleStyle: string; brand: { primary: string; secondary: string; font: string; watermark: string } }
interface Data { prefs: Prefs; secrets: Record<string, { set: boolean; source: string | null; hint: string }>; system: { ffmpeg: boolean; espeak: boolean; database: string } }
const KEYS: [string, string, string][] = [
  ["ANTHROPIC_API_KEY", "Anthropic (Claude)", "Sprachmodell für Strategie, Drehbuch, Qualitätsprüfung und Metadaten."],
  ["ELEVENLABS_API_KEY", "ElevenLabs", "Natürlich klingende Sprachausgabe. Kostenpflichtig; Integration ohne Schlüssel nicht live getestet."],
  ["GEMINI_API_KEY", "Google AI (Veo)", "Generative Videoclips. Kostenpflichtig; experimentell und nicht live getestet."],
  ["YOUTUBE_API_KEY", "YouTube Data API", "Zusätzliche Trendquelle (meistgesehene Videos). Kostenloses Kontingent."],
];

export default function Settings() {
  const { data, error } = useData<Data>("/api/settings");
  const [view, setView] = useState<Data | null>(null);
  const [p, setP] = useState<Prefs | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setView(data); setP(data.prefs); } }, [data]);
  if (error) return <><PageHeader title="Einstellungen" /><ErrorNote>{error}</ErrorNote></>;
  if (!p || !view) return null;
  const set = (patch: Partial<Prefs>) => { setP({ ...p, ...patch }); setSaved(false); };
  const save = async (secrets?: Record<string, string>) => {
    setBusy(true); setErr(null);
    try { const d = await api<Data>("/api/settings", { prefs: p, secrets: secrets ?? keys }); setView(d); setP(d.prefs); setKeys({}); setSaved(true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Einstellungen" subtitle="Anbieter, Kostenkontrolle, Standards und Brand-Kit." />
      {err && <ErrorNote>{err}</ErrorNote>}
      <Card className="p-5">
        <h2 className="text-base font-semibold">API-Schlüssel</h2>
        <p className="mt-1 text-sm text-stone-600">Schlüssel werden verschlüsselt (AES-256-GCM) in der Datenbank gespeichert und nie an den Browser zurückgegeben. Alternativ per Umgebungsvariable.</p>
        <div className="mt-4 space-y-4">{KEYS.map(([name, label, hint]) => { const st = view.secrets[name]; return (
          <div key={name}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2"><label htmlFor={name} className="text-sm font-medium">{label}</label>{st.set ? <Badge tone="good">hinterlegt {st.hint} ({st.source === "env" ? "Umgebung" : "App"})</Badge> : <Badge>nicht gesetzt</Badge>}</div>
            <div className="flex gap-2"><input id={name} type="password" autoComplete="off" className={inputCls} placeholder={st.set ? "Neuen Schlüssel eingeben, um zu ersetzen" : "Schlüssel einfügen"} value={keys[name] || ""} onChange={(e) => setKeys({ ...keys, [name]: e.target.value })} />{st.source === "app" && <Button variant="danger" onClick={() => save({ [name]: "" })}>Entfernen</Button>}</div>
            <p className="mt-1 text-xs text-stone-500">{hint}</p>
          </div>
        ); })}</div>
      </Card>
      <Card className="p-5">
        <h2 className="text-base font-semibold">Kostenkontrolle</h2>
        <label className="mt-4 flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 accent-(--color-accent)" checked={p.allowPaid} onChange={(e) => set({ allowPaid: e.target.checked })} /><span className="text-sm"><span className="font-medium">Kostenpflichtige Generierung freigeben</span><span className="block text-stone-600">Ohne diese Freigabe nutzt die Produktion ausschließlich kostenlose lokale Anbieter (Basis-Renderer, lokale Stimme), auch wenn Schlüssel hinterlegt sind. Sprachmodell-Aufrufe fallen an, sobald ein Anthropic-Schlüssel gesetzt ist.</span></span></label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Budgetlimit pro Video (USD)" hint="0 = kein Limit. Wird vor jedem kostenpflichtigen Medienaufruf geprüft."><input inputMode="decimal" className={inputCls} value={String(p.maxCostUsd)} onChange={(e) => set({ maxCostUsd: Number(e.target.value.replace(",", ".")) || 0 })} /></Field>
          <Field label="Qualitätsprofil" hint="Economy nutzt Cache und günstige Modelle; Premium priorisiert Qualität."><select className={inputCls} value={p.profile} onChange={(e) => set({ profile: e.target.value })}><option value="economy">Economy</option><option value="balanced">Balanced</option><option value="premium">Premium</option></select></Field>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-base font-semibold">Anbieter</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Sprachmodell" hint="Modell-ID der Claude API."><select className={inputCls} value={p.llmModel} onChange={(e) => set({ llmModel: e.target.value })}>{["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"].map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Videoanbieter"><select className={inputCls} value={p.videoProvider} onChange={(e) => set({ videoProvider: e.target.value })}><option value="basis">Basis-Renderer (lokal, kostenlos)</option><option value="veo">Google Veo (experimentell)</option></select></Field>
          <Field label="Sprachausgabe"><select className={inputCls} value={p.ttsProvider} onChange={(e) => set({ ttsProvider: e.target.value })}><option value="auto">Automatisch</option><option value="espeak">Lokale Basisstimme</option><option value="elevenlabs">ElevenLabs</option></select></Field>
          <Field label="ElevenLabs Voice-ID" hint="Aus deiner ElevenLabs-Stimmenbibliothek. Nur eigene oder lizenzierte Stimmen verwenden."><input className={inputCls} value={p.elevenVoiceId} onChange={(e) => set({ elevenVoiceId: e.target.value.trim() })} /></Field>
          <Field label="Lokale Stimme" hint="eSpeak-Stimmenname, z. B. de, en-us, en-gb."><input className={inputCls} value={p.espeakVoice} onChange={(e) => set({ espeakVoice: e.target.value.trim() || "auto" })} /></Field>
          <Field label="Veo-Modell und Preis je Sekunde (USD)" hint="Bitte mit der aktuellen Google-Preisliste abgleichen."><div className="flex gap-2"><input className={inputCls} value={p.veoModel} onChange={(e) => set({ veoModel: e.target.value.trim() })} /><input inputMode="decimal" className={inputCls + " max-w-24"} value={String(p.veoUsdPerSecond)} onChange={(e) => set({ veoUsdPerSecond: Number(e.target.value.replace(",", ".")) || 0 })} /></div></Field>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-base font-semibold">Standards</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Sprache"><select className={inputCls} value={p.language} onChange={(e) => set({ language: e.target.value })}><option value="de">Deutsch</option><option value="en">Englisch</option></select></Field>
          <Field label="Markt (Ländercode)" hint="Für Trendquellen, z. B. DE, AT, CH, US."><input className={inputCls} maxLength={2} value={p.geo} onChange={(e) => set({ geo: e.target.value.toUpperCase() })} /></Field>
          <Field label="Bevorzugte Videodauer"><select className={inputCls} value={p.durationSec} onChange={(e) => set({ durationSec: Number(e.target.value) })}>{[18, 30, 45, 60, 75].map((d) => <option key={d} value={d}>{d} Sekunden</option>)}</select></Field>
          <Field label="Zielplattform"><select className={inputCls} value={p.platform} onChange={(e) => set({ platform: e.target.value })}><option value="tiktok">TikTok</option><option value="reels">Instagram Reels</option><option value="shorts">YouTube Shorts</option></select></Field>
          <Field label="Untertitelstil"><select className={inputCls} value={p.subtitleStyle} onChange={(e) => set({ subtitleStyle: e.target.value })}><option value="bold">Kräftig</option><option value="clean">Dezent mit Hintergrund</option><option value="karaoke">Wort für Wort</option></select></Field>
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="text-base font-semibold">Brand-Kit</h2>
        <p className="mt-1 text-sm text-stone-600">Standard ist neutral und ohne Wasserzeichen.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Primärfarbe"><div className="flex gap-2"><input type="color" aria-label="Primärfarbe wählen" className="h-11 w-14 rounded-lg border border-stone-200" value={p.brand.primary} onChange={(e) => set({ brand: { ...p.brand, primary: e.target.value } })} /><input className={inputCls} value={p.brand.primary} onChange={(e) => set({ brand: { ...p.brand, primary: e.target.value } })} /></div></Field>
          <Field label="Akzentfarbe (Titel, Hervorhebungen)"><div className="flex gap-2"><input type="color" aria-label="Akzentfarbe wählen" className="h-11 w-14 rounded-lg border border-stone-200" value={p.brand.secondary} onChange={(e) => set({ brand: { ...p.brand, secondary: e.target.value } })} /><input className={inputCls} value={p.brand.secondary} onChange={(e) => set({ brand: { ...p.brand, secondary: e.target.value } })} /></div></Field>
          <Field label="Schriftart" hint="Muss auf dem Server installiert sein (Standard: Inter)."><input className={inputCls} value={p.brand.font} onChange={(e) => set({ brand: { ...p.brand, font: e.target.value } })} /></Field>
          <Field label="Wasserzeichen-Text (optional)" hint="Ein Logo-Upload ist noch nicht umgesetzt."><input className={inputCls} value={p.brand.watermark} onChange={(e) => set({ brand: { ...p.brand, watermark: e.target.value } })} /></Field>
        </div>
      </Card>
      <Card className="p-5 text-sm"><h2 className="text-base font-semibold">System</h2><ul className="mt-3 space-y-1.5"><li>{view.system.ffmpeg ? "✓" : "✗"} FFmpeg {view.system.ffmpeg ? "gefunden" : "fehlt – ohne FFmpeg kann nicht gerendert werden"}</li><li>{view.system.espeak ? "✓" : "✗"} eSpeak NG {view.system.espeak ? "gefunden" : "fehlt – lokale Sprachausgabe nicht möglich"}</li><li>✓ Datenbank: {view.system.database}</li></ul></Card>
      <div className="sticky bottom-16 z-10 flex items-center gap-3 rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-(--shadow-card) backdrop-blur lg:bottom-4"><Button variant="primary" busy={busy} onClick={() => save()}>Einstellungen speichern</Button>{saved && <span className="text-sm text-emerald-700" role="status">Gespeichert ✓</span>}</div>
      <Note>Hex-Farben bitte im Format #RRGGBB eingeben.</Note>
    </div>
  );
}
