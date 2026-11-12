import { z } from "zod";

export const STATUSES = [
  "created", "researching", "strategy_ready", "writing_script", "script_approved", "producing_audio",
  "generating_assets", "editing_video", "rendering", "quality_review", "revising", "completed", "failed", "cancelled",
] as const;
export type Status = (typeof STATUSES)[number];
export const TERMINAL: Status[] = ["completed", "failed", "cancelled"];

export const ASPECTS = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] } as const;
export type Aspect = keyof typeof ASPECTS;

/** How a number was obtained. Shown in the UI so estimates never pose as measurements. */
export const Evidence = z.enum(["measured", "estimated", "qualitative"]);

export const Brief = z.object({
  topic: z.string().default(""),
  language: z.enum(["de", "en"]).default("de"),
  platform: z.enum(["tiktok", "reels", "shorts"]).default("tiktok"),
  aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
  durationSec: z.number().min(8).max(120).default(30),
  tone: z.string().default("auto"),
  audience: z.string().default("auto"),
  style: z.string().default("auto"),
  voice: z.string().default("auto"),
  profile: z.enum(["economy", "balanced", "premium"]).default("economy"),
  budgetUsd: z.number().min(0).default(0),
  allowPaid: z.boolean().default(false),
  geo: z.string().default("DE"),
  subtitleStyle: z.enum(["clean", "bold", "karaoke"]).default("bold"),
  answers: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  notes: z.string().default(""),
});
export type Brief = z.infer<typeof Brief>;

export const TrendSignal = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  sourceUrl: z.string(),
  fetchedAt: z.string(),
  publishedAt: z.string().nullable(),
  geo: z.string(),
  metricLabel: z.string().nullable(),
  metricValue: z.number().nullable(),
  context: z.array(z.object({ title: z.string(), url: z.string(), source: z.string() })).default([]),
});
export type TrendSignal = z.infer<typeof TrendSignal>;

export const ScoreComponent = z.object({
  name: z.string(), value: z.number(), weight: z.number(), evidence: Evidence, reason: z.string(),
});
export const TrendCandidate = z.object({
  id: z.string(),
  title: z.string(),
  signals: z.array(TrendSignal),
  score: z.number(),
  components: z.array(ScoreComponent),
  growth: z.string(),
  risk: z.string().nullable(),
});
export type TrendCandidate = z.infer<typeof TrendCandidate>;

export const Concept = z.object({
  title: z.string(),
  angle: z.string(),
  format: z.string(),
  hookIdea: z.string(),
  ratings: z.object({
    audienceFit: z.number().min(0).max(10), growthPotential: z.number().min(0).max(10), originality: z.number().min(0).max(10),
    feasibility: z.number().min(0).max(10), retention: z.number().min(0).max(10),
  }),
  reasoning: z.string(),
});
export type Concept = z.infer<typeof Concept>;

export const Strategy = z.object({
  topic: z.string(),
  audience: z.string(),
  marketLanguage: z.string(),
  platform: z.string(),
  primaryInterest: z.string(),
  hookStrategy: z.string(),
  recommendedDurationSec: z.number(),
  visualStyle: z.string(),
  emotionalTrigger: z.string(),
  valueProposition: z.string(),
  mood: z.enum(["dramatic", "uplifting", "calm", "energetic", "mysterious"]),
  risks: z.array(z.string()),
  dataBasis: z.enum(["current_trend_data", "partial_data", "no_current_data"]),
  dataBasisNote: z.string(),
  concepts: z.array(Concept).min(3),
  chosenConceptIndex: z.number().int().min(0),
  choiceReasoning: z.string(),
});
export type Strategy = z.infer<typeof Strategy>;

export const Hook = z.object({
  text: z.string(),
  scores: z.object({
    curiosity: z.number().min(0).max(10), clarity: z.number().min(0).max(10), relevance: z.number().min(0).max(10),
    emotion: z.number().min(0).max(10), credibility: z.number().min(0).max(10),
  }),
});
export type Hook = z.infer<typeof Hook>;

export const Scene = z.object({
  id: z.string(),
  role: z.enum(["hook", "build", "payoff", "cta"]),
  voiceover: z.string(),
  onScreenText: z.string(),
  visual: z.string(),
  transition: z.enum(["cut", "fade", "slideleft", "slideup", "zoomin", "circleopen"]),
  sfx: z.enum(["none", "whoosh", "impact", "rise"]),
  emotion: z.string(),
  estSeconds: z.number(),
});
export type Scene = z.infer<typeof Scene>;

export const Script = z.object({
  title: z.string(),
  hooks: z.array(Hook).min(1),
  chosenHookIndex: z.number().int().min(0),
  hookReasoning: z.string(),
  scenes: z.array(Scene).min(2),
  narrativeArc: z.string(),
  cta: z.string(),
  factNotes: z.array(z.object({ claim: z.string(), status: z.enum(["verified_common_knowledge", "needs_source", "fictional_or_hypothetical"]), note: z.string() })),
  selfCritique: z.object({
    hook: z.number().min(0).max(10), clarity: z.number().min(0).max(10), dramaturgy: z.number().min(0).max(10), originality: z.number().min(0).max(10),
    audienceFit: z.number().min(0).max(10), timing: z.number().min(0).max(10), visualFeasibility: z.number().min(0).max(10),
    weaknesses: z.array(z.string()),
  }),
});
export type Script = z.infer<typeof Script>;

export const Question = z.object({
  id: z.string(),
  field: z.enum(["tone", "audience", "style", "durationSec", "language", "voice", "platform", "angle", "other"]),
  question: z.string(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).min(2).max(6),
  allowFreeText: z.boolean(),
});
export const QuestionSet = z.object({
  analysis: z.string(),
  detected: z.array(z.object({ field: z.string(), value: z.string() })),
  questions: z.array(Question).min(3).max(5),
});
export type QuestionSet = z.infer<typeof QuestionSet>;

export const PlatformMeta = z.object({
  title: z.string(), description: z.string(), hashtags: z.array(z.string()), keywords: z.array(z.string()), category: z.string().nullable(),
});
export const Metadata = z.object({ tiktok: PlatformMeta, reels: PlatformMeta, shorts: PlatformMeta });
export type Metadata = z.infer<typeof Metadata>;

export const ContentReview = z.object({
  hook: z.object({ score: z.number().min(0).max(100), reason: z.string() }),
  story: z.object({ score: z.number().min(0).max(100), reason: z.string() }),
  visual: z.object({ score: z.number().min(0).max(100), reason: z.string() }),
  audio: z.object({ score: z.number().min(0).max(100), reason: z.string() }),
  fit: z.object({ score: z.number().min(0).max(100), reason: z.string() }),
  originality: z.object({ score: z.number().min(0).max(100), reason: z.string() }),
  issues: z.array(z.object({
    severity: z.enum(["critical", "major", "minor"]),
    category: z.enum(["facts", "copyright", "script", "visual", "audio", "subtitles", "spelling"]),
    sceneId: z.string().nullable(),
    description: z.string(),
    fix: z.string(),
  })),
});
export type ContentReview = z.infer<typeof ContentReview>;

export interface Check { id: string; label: string; passed: boolean; critical: boolean; detail: string }
export interface QaIssue { severity: "critical" | "major" | "minor"; category: string; sceneId: string | null; description: string; fix: string; owner: "script" | "production" | "strategy" }
export interface QaReport {
  version: number;
  checkedAt: string;
  checks: Check[];
  categories: { key: string; label: string; weight: number; score: number; reason: string; basis: "llm_multimodal" | "llm_text" | "heuristic" | "technical" }[];
  score: number;
  verdict: "approved" | "needs_revision";
  issues: QaIssue[];
  reviewMode: "llm_multimodal" | "llm_text" | "heuristic";
  disclaimer: string;
}

export interface SceneAsset { audioFile: string; audioSec: number; audioHash: string; visualFile: string; visualHash: string; visualProvider: string; ttsProvider: string }
export interface RenderResult { version: number; video: string; srt: string; cover: string; ass: string; durationSec: number; width: number; height: number; sizeBytes: number; renderedAt: string; mode: string }
export interface StepInfo { status: "pending" | "running" | "done" | "failed"; startedAt?: string; finishedAt?: string; error?: string; note?: string }

export const STEPS = ["research", "strategy", "script", "audio", "visuals", "render", "quality", "metadata"] as const;
export type StepName = (typeof STEPS)[number];

export interface ProjectState {
  brief: Brief;
  capabilities?: { llm: string; tts: string; video: string; labels: string[] };
  research?: { candidates: TrendCandidate[]; fetchedAt: string; sources: { name: string; ok: boolean; note: string }[]; demand?: { query: string; recentArticles: number; articles: { title: string; url: string; source: string }[] } };
  strategy?: Strategy & { generatedBy: string };
  script?: Script & { version: number; generatedBy: string };
  assets?: Record<string, SceneAsset>;
  render?: RenderResult;
  qa?: QaReport;
  qaHistory?: QaReport[];
  metadata?: Metadata & { generatedBy: string };
  revisions: number;
  steps: Partial<Record<StepName, StepInfo>>;
  estimate?: { usd: number; lines: { label: string; usd: number }[] };
  error?: string;
}

export interface Project {
  id: string; mode: "autopilot" | "custom"; title: string; status: Status; cancelRequested: boolean;
  state: ProjectState; createdAt: string; updatedAt: string;
}
