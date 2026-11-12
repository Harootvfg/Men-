# Testprotokoll

Stand: 12.11.2026, Cloud-Umgebung (Node 22, FFmpeg 6.1, eSpeak NG 1.51), ohne Anbieter-Schlüssel.

| Suite | Befehl | Ergebnis |
|---|---|---|
| Typprüfung | `npm run typecheck` | fehlerfrei |
| Unit (19) + Integration (15) | `npm test` | 34/34 bestanden, ca. 10 Minuten |
| End-to-End im Browser | `npm run test:e2e` | 39/39 bestanden |
| Produktions-Build | `npm run build` | erfolgreich |

## Was die Tests abdecken

**Unit** (`tests/unit.test.ts`): Untertitel-Timing und SRT-Roundtrip, sichere Textbereiche je Plattform, Bereinigung von Nutzertext im Overlay, Trend-Score (Wertebereich, Zusammenführung mehrerer Quellen, Herabstufung sensibler Themen, Wachstum nur mit Vergleichswert), Erkennung bereits gegebener Antworten, themenabhängige Rückfragen, Überarbeitungsplanung, sichere Standardwerte im Briefing.

**Integration** (`tests/pipeline.test.ts`, echte FFmpeg- und eSpeak-Läufe):
- MP4 mit H.264 (1080×1920, yuv420p) und AAC (48 kHz, Stereo), SRT, Cover; Kosten 0
- alle kritischen technischen Prüfungen bestanden; ohne Inhaltsprüfung keine Freigabe
- Szenenänderung vertont nur die betroffene Szene neu; Stilwechsel der Untertitel erzeugt keine Medien neu
- beschädigte und abgeschnittene Videodatei wird als kritischer Mangel erkannt
- Format 1:1
- Abbruch und Fortsetzen; Wiederholung bei vorübergehenden Anbieterfehlern; verständlicher Fehler bei dauerhaften, danach Fortsetzen ohne neues Drehbuch
- beschädigter Clip eines Anbieters wird abgewiesen
- kostenpflichtiger Anbieter läuft nie ohne Freigabe; Budgetlimit stoppt nach dem ersten Clip
- Schlüssel liegen verschlüsselt in der Datenbank
- mit simuliertem Sprachmodell: strukturierte Übergaben aller Agenten, Prüfer erhält Einzelbilder der gerenderten Datei, eine gezielte Überarbeitungsrunde und anschließende Freigabe; kritischer Mangel wird trotz Score über 85 nicht freigegeben; Schleife endet nach zwei Runden

**End-to-End** (`scripts/e2e.mjs`, Chromium gegen den laufenden Server, Live-Trenddaten): Dashboard, eigenes Thema mit Rückfragen bis zum fertigen Video, Wiedergabe im Browser, Downloads (MP4 per ffprobe geprüft, SRT, Cover, ZIP), Range-Requests, Metadaten mit Kopier-Buttons, Qualitätsbericht, Szenenänderung über die Oberfläche, Autopilot mit Google Trends und Wikipedia, Abbruch und Fortsetzen, Fehlerfälle der API (400/404/409), Trend Radar, Schlüsselablage, sieben Seiten in iPhone-13-Größe ohne horizontales Scrollen, keine JavaScript-Fehler.

## Was nicht getestet wurde

- Kein echter Aufruf der Claude API, von ElevenLabs, Veo oder der YouTube Data API. In dieser Umgebung lag kein nutzbarer Schlüssel vor.
- PostgreSQL über `DATABASE_URL`, Docker-Build, docker-compose.
- Formate 16:9 und 4:5 als eigene Testfälle.
- Hörprüfung durch einen Menschen: Lautheit, Stille und Verständlichkeit sind nur messtechnisch geprüft.
- Neustart des Servers während einer laufenden Produktion (die Wiederaufnahme nutzt denselben Code wie „Fortsetzen“, der getestet ist).
