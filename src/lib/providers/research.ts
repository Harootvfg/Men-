import { XMLParser } from "fast-xml-parser";
import { getDb } from "../db";
import { getSecret } from "../settings";
import type { TrendSignal } from "../schemas";

const UA = "viral-ai-studio/0.1 (trend research)";
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}
const arr = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const xml = new XMLParser({ ignoreAttributes: true, processEntities: true });

export interface SourceResult { name: string; ok: boolean; note: string; signals: TrendSignal[] }
export interface ResearchAdapter { name: string; fetch(geo: string, lang: string): Promise<TrendSignal[]> }

function parseTraffic(s: string | undefined): number | null {
  if (!s) return null;
  const m = String(s).replace(/[.,]/g, "").match(/(\d+)\s*([KkMm]?)/);
  if (!m) return null;
  return Number(m[1]) * (m[2].toLowerCase() === "k" ? 1e3 : m[2].toLowerCase() === "m" ? 1e6 : 1);
}

/** Google's public "Trending now" RSS feed: real search trends with an approximate search volume. */
export const googleTrends: ResearchAdapter = {
  name: "Google Trends (RSS)",
  async fetch(geo) {
    const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
    const doc = xml.parse(await (await get(url)).text());
    const now = new Date().toISOString();
    return arr(doc?.rss?.channel?.item).map((it: Record<string, unknown>): TrendSignal => ({
      id: `gt-${slug(String(it.title))}`,
      title: String(it.title),
      source: "Google Trends",
      sourceUrl: `https://trends.google.com/trending?geo=${geo}`,
      fetchedAt: now,
      publishedAt: it.pubDate ? new Date(String(it.pubDate)).toISOString() : null,
      geo,
      metricLabel: "Suchanfragen (ca., laut Google)",
      metricValue: parseTraffic(it["ht:approx_traffic"] as string),
      context: arr(it["ht:news_item"] as Record<string, string>[]).slice(0, 3).map((n) => ({
        title: String(n["ht:news_item_title"] || ""), url: String(n["ht:news_item_url"] || ""), source: String(n["ht:news_item_source"] || ""),
      })),
    }));
  },
};

const WIKI_SKIP = /^(Wikipedia:|Spezial:|Special:|Datei:|File:|Portal:|Hauptseite|Main_Page|Kategorie:|Category:|Benutzer|User|Hilfe:|Help:|Diskussion|Talk:)/;
/** Wikimedia Pageviews API: most viewed articles of the latest fully counted day. */
export const wikipediaTop: ResearchAdapter = {
  name: "Wikipedia Pageviews",
  async fetch(geo, lang) {
    const now = new Date().toISOString();
    for (const back of [1, 2, 3]) {
      const d = new Date(Date.now() - back * 864e5);
      const p = [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0")];
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${p.join("/")}`;
      let res: Response;
      try { res = await get(url); } catch { continue; }
      const j = await res.json();
      const articles: { article: string; views: number }[] = j.items?.[0]?.articles || [];
      return articles.filter((a) => !WIKI_SKIP.test(a.article)).slice(0, 25).map((a): TrendSignal => ({
        id: `wp-${slug(a.article)}`,
        title: a.article.replace(/_/g, " "),
        source: "Wikipedia",
        sourceUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(a.article)}`,
        fetchedAt: now,
        publishedAt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)).toISOString(),
        geo: `${lang}.wikipedia`,
        metricLabel: "Seitenaufrufe (Tag)",
        metricValue: a.views,
        context: [],
      }));
    }
    throw new Error("keine Tagesdaten verfügbar");
  },
};

/** YouTube Data API v3 "mostPopular" chart. Needs a key; not live-tested without one. */
export const youtubePopular: ResearchAdapter = {
  name: "YouTube Data API",
  async fetch(geo, lang) {
    const key = await getSecret("YOUTUBE_API_KEY");
    if (!key) throw new Error("kein API-Schlüssel hinterlegt");
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&maxResults=25&regionCode=${geo}&hl=${lang}`;
    const j = await (await get(url, { "x-goog-api-key": key })).json();
    const now = new Date().toISOString();
    return arr(j.items).map((v: { id: string; snippet: { title: string; publishedAt: string; channelTitle: string }; statistics: { viewCount?: string } }): TrendSignal => ({
      id: `yt-${v.id}`, title: v.snippet.title, source: "YouTube", sourceUrl: `https://www.youtube.com/watch?v=${v.id}`, fetchedAt: now,
      publishedAt: v.snippet.publishedAt, geo, metricLabel: "Aufrufe", metricValue: v.statistics.viewCount ? Number(v.statistics.viewCount) : null,
      context: [{ title: v.snippet.channelTitle, url: `https://www.youtube.com/watch?v=${v.id}`, source: "YouTube-Kanal" }],
    }));
  },
};

/** Manually entered observations (TikTok / Instagram have no open trend API). */
export const manualTrends: ResearchAdapter = {
  name: "Manuelle Eingaben",
  async fetch(geo) {
    const rows = await (await getDb()).query<{ id: number; created_at: Date; platform: string; title: string; note: string | null; url: string | null }>(
      "SELECT * FROM manual_trends WHERE created_at > now() - interval '14 days' ORDER BY id DESC");
    return rows.map((r): TrendSignal => ({
      id: `manual-${r.id}`, title: r.title, source: `Manuell (${r.platform})`, sourceUrl: r.url || "", fetchedAt: new Date().toISOString(),
      publishedAt: new Date(r.created_at).toISOString(), geo, metricLabel: null, metricValue: null,
      context: r.note ? [{ title: r.note, url: r.url || "", source: "Notiz" }] : [],
    }));
  },
};

export const ADAPTERS: ResearchAdapter[] = [googleTrends, wikipediaTop, youtubePopular, manualTrends];

export async function fetchAllSignals(geo: string, lang: string, adapters = ADAPTERS): Promise<SourceResult[]> {
  return Promise.all(adapters.map(async (a): Promise<SourceResult> => {
    try {
      const signals = await a.fetch(geo, lang);
      return { name: a.name, ok: true, note: `${signals.length} Signale`, signals };
    } catch (e) {
      return { name: a.name, ok: false, note: e instanceof Error ? e.message : String(e), signals: [] };
    }
  }));
}

/** Demand check for a user topic: how many recent news articles exist (Google News RSS search). */
export async function newsDemand(query: string, lang: string, geo: string) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query + " when:30d")}&hl=${lang}&gl=${geo}&ceid=${geo}:${lang}`;
  const doc = xml.parse(await (await get(url)).text());
  const items = arr(doc?.rss?.channel?.item) as { title: string; link: string; source?: string }[];
  return {
    query, recentArticles: items.length,
    articles: items.slice(0, 6).map((i) => ({ title: String(i.title), url: String(i.link), source: typeof i.source === "string" ? i.source : "" })),
  };
}
