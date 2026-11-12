# Viral AI Studio

Webanwendung, die aus einem Thema (oder ganz ohne Vorgabe) ein fertiges Kurzvideo produziert: Recherche → Strategie → Drehbuch → Sprachaufnahme → Bildmaterial → Schnitt mit Untertiteln → Qualitätsprüfung → Veröffentlichungstexte → MP4-Download.

**Wichtig zum Stand:** Ohne Anbieter-Schlüssel läuft die App im **Basis-Modus**. Dabei entsteht eine echte, gültige MP4 (1080×1920, H.264/AAC, Untertitel, Musikbett), aber mit prozeduralen Motion-Hintergründen, einer synthetischen Stimme und regelbasierten Texten. Das ist keine generative Filmproduktion und wird in der Oberfläche auch so gekennzeichnet. Was getestet ist und was nicht, steht unter [Stand der Funktionen](#stand-der-funktionen).

## Schnellstart

Voraussetzungen: Node.js ≥ 22, FFmpeg ≥ 6 (mit libass), eSpeak NG, Schriftart Inter (optional).

```bash
# Debian/Ubuntu
sudo apt-get install -y ffmpeg espeak-ng fonts-inter

npm ci
cp .env.example .env.local      # optional, alle Werte dürfen leer bleiben
npm run build && npm start      # http://localhost:3000
# oder für die Entwicklung: npm run dev
```

Eine Datenbank muss nicht eingerichtet werden: Ohne `DATABASE_URL` nutzt die App ein eingebettetes PostgreSQL (PGlite) unter `./data/pg`. Migrationen (`migrations/*.sql`) laufen beim Start automatisch. Für den Betrieb mit echtem PostgreSQL `DATABASE_URL` setzen oder `docker compose up` verwenden.

Ein Video ohne Oberfläche erzeugen:

```bash
npm run doctor -- "Warum ist der Himmel blau"   # ohne Argument: Autopilot
```

## Schlüssel und Kosten

Alle Schlüssel sind optional und können in der App unter **Einstellungen** hinterlegt werden (AES-256-GCM-verschlüsselt in der Datenbank, nie an den Browser zurückgegeben) oder als Umgebungsvariable.

| Schlüssel | Wofür | Kosten |
|---|---|---|
| `ANTHROPIC_API_KEY` | Agenten: Strategie, Drehbuch, Qualitätsprüfung mit Einzelbildern, Metadaten, Rückfragen | Tokenpreise des gewählten Modells; die App erfasst sie je Aufruf |
| `ELEVENLABS_API_KEY` + Voice-ID | Natürliche Stimme | je Zeichen, abhängig vom Tarif |
| `GEMINI_API_KEY` | Veo-Videoclips (experimentell) | je Sekunde; Preis in den Einstellungen pflegen |
| `YOUTUBE_API_KEY` | Zusätzliche Trendquelle | kostenloses Kontingent |

Kostenschutz: Kostenpflichtige Medienanbieter laufen nur, wenn „Kostenpflichtige Generierung freigeben“ aktiv ist. Vor jedem kostenpflichtigen Aufruf wird das Budgetlimit pro Video geprüft. Automatische Überarbeitungsrunden sind auf zwei begrenzt. Unveränderte Szenen kommen aus dem Cache.

## Architektur

Ein Next.js-Prozess (App Router, TypeScript, Tailwind) mit API-Routen und einer eingebauten Workflow-Engine. Bewusst ohne Redis/BullMQ und ohne Microservices: Der Zustand jedes Schritts liegt in PostgreSQL, unterbrochene Produktionen werden beim Start fortgesetzt.

```
src/lib/
  schemas.ts            Zod-Schemas für alle Übergaben zwischen Agenten
  workflow/engine.ts    Zustandsmaschine: Schritte, Abbruch, Fortsetzen, Überarbeitungsschleife, Nutzeraktionen
  agents/
    market.ts           Agent 1: Trendbewertung (transparenter Score), Strategie, Konzeptvergleich
    script.ts           Agent 2: Hooks, Szenenplan, Selbstkritik, gezielte Szenenüberarbeitung
    production.ts       Agent 3: Sprachaufnahme, Bildmaterial, Rendering, Kosten- und Budgetprüfung
    quality.ts          Agent 4: technische Prüfungen an der Datei, Inhaltsprüfung, Überarbeitungsplan
    seo.ts, questions.ts  Veröffentlichungstexte, dynamische Rückfragen
  providers/            austauschbare Adapter: llm, research, tts, video, music
  render/               Untertitel (ASS/SRT, sichere Bereiche), FFmpeg-Komposition und Tonmischung
src/app/                Oberfläche und API-Routen
migrations/             SQL-Migrationen
tests/                  Unit- und Integrationstests (Vitest)
scripts/e2e.mjs         End-to-End-Test im Browser (Playwright)
```

Zustände eines Projekts: `created → researching → strategy_ready → writing_script → script_approved → producing_audio → generating_assets → editing_video → rendering → quality_review → (revising) → completed | failed | cancelled`.

Die Sprachaufnahme läuft vor dem Bildmaterial, weil die gemessene Sprechdauer die Länge jeder Szene bestimmt.

### Datenquellen der Recherche

| Quelle | Zugang | Status |
|---|---|---|
| Google Trends „Trending now“ (RSS) | öffentlich | live getestet |
| Wikipedia Pageviews (Wikimedia REST) | öffentlich | live getestet |
| Google News Suche (RSS), Nachfrage-Check für eigene Themen | öffentlich | live getestet |
| YouTube Data API `mostPopular` | Schlüssel nötig | implementiert, nicht live getestet |
| TikTok, Instagram | keine offene Trend-API | manuelle Erfassung im Trend Radar |

Der Trend-Score (0–100) setzt sich aus Aktualität, Aufmerksamkeit, Quellenbestätigung, Umsetzbarkeit und Eignung zusammen. Jede Komponente ist als Messwert, Schätzung oder Einschätzung gekennzeichnet. Er ist eine interne Priorisierung, keine Viralitätsprognose.

## Tests

```bash
npm run typecheck
npm test                 # Unit + Integration, rendert echte Videos (ca. 5–10 Minuten)
npm run build && npm start &
npm run test:e2e         # benötigt Playwright (npm i -D playwright && npx playwright install chromium)
```

Ergebnisse des letzten Laufs: siehe [TESTS.md](TESTS.md).

## Stand der Funktionen

**Getestet und funktionsfähig**

- Beide Erstellungsmodi (Autopilot, eigenes Thema mit 3–5 dynamischen Rückfragen)
- Workflow-Engine mit persistierten Schritten, Abbruch, Fortsetzen, Wiederholungsversuchen
- Basis-Pipeline bis zur MP4 mit Tonspur, eingebrannten Untertiteln, SRT, Cover, ZIP
- Formate 9:16 und 1:1 (16:9 und 4:5 nutzen denselben Code, sind aber nicht einzeln getestet)
- Technische Qualitätsprüfung an der fertigen Datei (Streams, Auflösung, Länge, Dekodierung, Schwarzbild, Stille, Standbild, Lautheit, Untertitel, sichere Bereiche)
- Szenenänderung und Szenenreparatur, die nur die betroffene Szene neu erzeugen
- Hook-Wechsel, Stimmen- und Untertitelstil-Wechsel, neue Version
- Trend Radar mit Live-Daten, Quellen und Zeitstempeln
- Kostenerfassung, Budgetlimit, Freigabepflicht für kostenpflichtige Anbieter
- Verschlüsselte Schlüsselablage, responsive Oberfläche

**Implementiert, aber nur mit simuliertem Anbieter getestet (experimentell)**

- Claude-Anbindung der Agenten (`providers/llm.ts`): Der Datenfluss inklusive Überarbeitungsschleife und Übergabe von Einzelbildern ist mit einem simulierten Sprachmodell getestet. Ein echter API-Aufruf wurde nicht ausgeführt.
- ElevenLabs-Sprachausgabe: nicht live getestet.
- Google Veo: nach öffentlicher API-Beschreibung geschrieben, nie ausgeführt. Modellname, Antwortformat und Preis vor dem ersten Einsatz prüfen.
- PostgreSQL über `DATABASE_URL`, Dockerfile, docker-compose: nicht getestet (die App nutzt dieselben SQL-Abfragen wie mit PGlite).

**Nicht umgesetzt**

- Runway, Kling, fal.ai, Bildgenerierung, Transkription (wortgenaue Untertitel-Zeiten); die Untertitel sind satzgenau aus der gemessenen Sprechdauer geschätzt
- Anbindung von Plattformkonten für Analytics (Kennzahlen werden manuell erfasst), automatisches Veröffentlichen
- Logo-Upload im Brand-Kit (nur Farben, Schrift, Textwasserzeichen)
- Content-Batching (ein Thema → mehrere Videovarianten)
- Qualitätsprofile Balanced/Premium wählen noch keine anderen Modelle
- Nutzerkonten und Zugriffsschutz: Die App ist für den Einzelbetrieb gedacht und darf nicht ungeschützt ins Internet gestellt werden
- Objekt-Storage: Medien liegen im Dateisystem unter `DATA_DIR`

## Rechtliches

- Musik und Effekte werden zur Laufzeit synthetisiert; es werden keine fremden Aufnahmen verwendet.
- Im Autopilot werden Schlagzeilen aus den Trendquellen als Kontext zitiert und als „Quelle prüfen“ markiert. Vor einer Veröffentlichung müssen Aussagen geprüft werden.
- Sensible Nachrichtenthemen (Todesfälle, Gewalt usw.) werden per Stichwortliste herabgestuft. Das ersetzt keine redaktionelle Prüfung.
- KI-generierte Inhalte müssen je nach Plattform beim Upload gekennzeichnet werden. Das übernimmt die App nicht.
- Für ElevenLabs nur eigene oder lizenzierte Stimmen verwenden.
- Remotion wird nicht verwendet (lizenzpflichtig für Unternehmen); das Rendering basiert vollständig auf FFmpeg.
