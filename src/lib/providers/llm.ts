import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getPrefs, getSecret } from "../settings";
import { addCost } from "../store";

export class ProviderError extends Error {
  constructor(public provider: string, message: string, public retryable = false) { super(message); }
}

export interface LlmRequest<S extends z.ZodType> {
  agent: string;
  projectId: string | null;
  system: string;
  prompt: string;
  schema: S;
  images?: { mediaType: "image/jpeg" | "image/png"; base64: string }[];
  effort?: "low" | "medium" | "high";
}
export interface Llm {
  name: string;
  generate<S extends z.ZodType>(req: LlmRequest<S>): Promise<z.infer<S>>;
}

// USD per million tokens (input, output). Used for cost tracking only; verify against current pricing.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5], "claude-fable-5-2": [8, 40],
};

class AnthropicLlm implements Llm {
  name: string;
  private client: Anthropic;
  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 180_000 });
    this.name = `anthropic:${model}`;
  }
  async generate<S extends z.ZodType>(req: LlmRequest<S>): Promise<z.infer<S>> {
    const content: Anthropic.ContentBlockParam[] = [
      ...(req.images || []).map((i): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.base64 } })),
      { type: "text", text: req.prompt },
    ];
    try {
      const res = await this.client.messages.parse({
        model: this.model,
        max_tokens: 16000,
        system: req.system,
        messages: [{ role: "user", content }],
        output_config: { effort: req.effort || "medium", format: zodOutputFormat(req.schema) },
      });
      const [pin, pout] = PRICES[this.model] || [0, 0];
      await addCost(req.projectId, "anthropic", `llm:${req.agent}`, (res.usage.input_tokens * pin + res.usage.output_tokens * pout) / 1e6, `${res.usage.input_tokens} in / ${res.usage.output_tokens} out`);
      if (res.stop_reason === "refusal") throw new ProviderError("anthropic", "Das Sprachmodell hat die Anfrage abgelehnt (Sicherheitsfilter). Bitte Thema anpassen.");
      if (res.stop_reason === "max_tokens" || res.parsed_output == null) throw new ProviderError("anthropic", "Die Antwort des Sprachmodells war unvollständig.", true);
      return res.parsed_output as z.infer<S>;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new ProviderError("anthropic", "Der Anthropic-API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.");
      if (e instanceof Anthropic.PermissionDeniedError) throw new ProviderError("anthropic", "Der Anthropic-API-Schlüssel hat keine Berechtigung für dieses Modell.");
      if (e instanceof Anthropic.NotFoundError) throw new ProviderError("anthropic", `Das Modell „${this.model}“ wurde nicht gefunden. Bitte in den Einstellungen prüfen.`);
      if (e instanceof Anthropic.RateLimitError) throw new ProviderError("anthropic", "Rate-Limit bei Anthropic erreicht. Bitte später fortsetzen.", true);
      if (e instanceof Anthropic.APIConnectionError) throw new ProviderError("anthropic", "Anthropic ist nicht erreichbar (Netzwerkfehler).", true);
      if (e instanceof Anthropic.APIError) throw new ProviderError("anthropic", `Anthropic-Fehler ${e.status}: ${e.message}`, (e.status ?? 0) >= 500);
      throw e;
    }
  }
}

type G = typeof globalThis & { __vasLlmOverride?: Llm | null };
/** Test hook: inject a fake LLM (or null to force the rule-based mode). */
export function setLlmOverride(llm: Llm | null | undefined) { (globalThis as G).__vasLlmOverride = llm; }

/** Returns null when no LLM is configured; agents then use their clearly labelled rule-based mode. */
export async function getLlm(): Promise<Llm | null> {
  const o = (globalThis as G).__vasLlmOverride;
  if (o !== undefined) return o;
  const key = await getSecret("ANTHROPIC_API_KEY");
  if (!key) return null;
  return new AnthropicLlm(key, (await getPrefs()).llmModel);
}
