export const STATUS_LABEL: Record<string, string> = {
  created: "Wird gestartet", researching: "Recherche läuft", strategy_ready: "Strategie steht", writing_script: "Drehbuch wird geschrieben",
  script_approved: "Drehbuch fertig", producing_audio: "Sprachaufnahme läuft", generating_assets: "Videosequenzen werden generiert",
  editing_video: "Schnitt läuft", rendering: "Rendering läuft", quality_review: "Qualitätsprüfung läuft", revising: "Überarbeitung läuft",
  completed: "Fertig", failed: "Fehlgeschlagen", cancelled: "Abgebrochen",
};
export const PLATFORM_LABEL: Record<string, string> = { tiktok: "TikTok", reels: "Instagram Reels", shorts: "YouTube Shorts" };
export const isActive = (status: string) => !["completed", "failed", "cancelled"].includes(status);
export const fmtDate = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtUsd = (n: number) => (n === 0 ? "0,00 $" : n < 0.01 ? "< 0,01 $" : n.toFixed(2).replace(".", ",") + " $");
export const fmtDur = (s: number | null | undefined) => (s == null ? "–" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
