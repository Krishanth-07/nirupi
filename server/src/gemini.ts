import { GoogleGenAI, ThinkingLevel, type Schema } from "@google/genai";

// Active Gemini models.
export const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-4-hydrogen";

// Used when the main model is overloaded (503), rate-limited (429) or too slow to start.
export const TEXT_FALLBACK_MODEL = process.env.GEMINI_TEXT_FALLBACK_MODEL || "gemini-3.1-flash-lite";

/**
 * Circuit breaker: once the main model fails with an overload/timeout, skip it for a while
 * and go straight to the fallback, so users don't wait on a model that isn't answering.
 */
const BREAKER_MS = 10 * 60 * 1000;
let mainModelDownUntil = 0;
const mainModelDown = () => Date.now() < mainModelDownUntil;

// A second fallback, so one overloaded or exhausted model can never block the app.
export const TEXT_FALLBACK_MODEL_2 = process.env.GEMINI_TEXT_FALLBACK_MODEL_2 || "gemini-3.5-flash-lite";
const MODELS = [...new Set([TEXT_MODEL, TEXT_FALLBACK_MODEL, TEXT_FALLBACK_MODEL_2])];

/** Models whose daily quota is used up → when we may try them again. */
const exhaustedUntil = new Map<string, number>();
const DAILY_SKIP_MS = 6 * 60 * 60 * 1000;
const isExhausted = (m: string) => (exhaustedUntil.get(m) ?? 0) > Date.now();

/**
 * Runs a Gemini call across the model chain with retries.
 * - Transient errors (429 per-minute, 500/503/504, timeouts, network): retry, preferring a different model.
 * - Daily quota used up on a model: skip that model for a few hours and move on (doesn't count as an attempt).
 * - Only when every model's daily quota is gone do we surface a QuotaError.
 */
export async function withRetry<T>(
  label: string,
  fn: (model: string) => Promise<T>,
  opts: { signal?: AbortSignal; onRetry?: (attempt: number, model: string) => void } = {},
): Promise<T> {
  const MAX_ATTEMPTS = 3;
  let attempts = 0;
  let last: string | undefined;
  let wait = 0;
  for (;;) {
    const available = MODELS.filter((m) => !isExhausted(m));
    if (available.length === 0) {
      throw new QuotaError(
        "Today's free Gemini quota for this API key is used up on every model. Enable billing on the key's Google Cloud project (or use another key) and try again.",
      );
    }
    // Skip the main model while its breaker is open, unless it's the only one left.
    const preferred = available.filter((m) => !(m === TEXT_MODEL && mainModelDown()));
    const pool = preferred.length ? preferred : available;
    const model = pool.find((m) => m !== last) ?? pool[0];

    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("aborted");
    try {
      const out = await fn(model);
      if (model === TEXT_MODEL) mainModelDownUntil = 0; // main model is healthy again
      return out;
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      last = model;

      if (/PerDay|per day/i.test(String((err as Error)?.message ?? err))) {
        exhaustedUntil.set(model, Date.now() + DAILY_SKIP_MS);
        console.warn(`[gemini] ${model}: daily quota used up — skipping it for a few hours`);
        wait = 0;
        continue; // try the next model straight away; not a real attempt
      }

      attempts++;
      if (!isTransient(err) || attempts >= MAX_ATTEMPTS) throw err;
      if (model === TEXT_MODEL) {
        mainModelDownUntil = Date.now() + BREAKER_MS;
        console.warn(`[gemini] ${TEXT_MODEL} looks overloaded — using the fallback models for the next 10 minutes`);
      }
      // Per-minute limits (429) say how long to wait; honour it (capped) instead of burning retries.
      wait = (err as { status?: number })?.status === 429 ? Math.min(retryAfterMs(err) + 500, 30_000) : attempts === 1 ? 500 : 3000;
      console.warn(`[${label}] attempt ${attempts} on ${model} failed (${describe(err)}); retrying`);
      opts.onRetry?.(attempts + 1, model);
    }
  }
}

/** Startup probe so even the first request after a restart avoids a dead main model. */
export async function probeMainModel(): Promise<void> {
  if (!process.env.GEMINI_API_KEY || TEXT_MODEL === TEXT_FALLBACK_MODEL) return;
  const started = Date.now();
  try {
    await gemini().models.generateContent({
      model: TEXT_MODEL,
      contents: "Reply with: ok",
      config: { abortSignal: AbortSignal.timeout(15_000), thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    console.log(`[gemini] ${TEXT_MODEL} is healthy (${Date.now() - started}ms)`);
  } catch (err) {
    if (/PerDay|per day/i.test(String((err as Error)?.message ?? err))) exhaustedUntil.set(TEXT_MODEL, Date.now() + DAILY_SKIP_MS);
    else mainModelDownUntil = Date.now() + BREAKER_MS;
    console.warn(`[gemini] ${TEXT_MODEL} unavailable at startup (${describe(err)}) — starting on ${TEXT_FALLBACK_MODEL}`);
  }
}

export class GeminiTimeoutError extends Error {}

/**
 * An AbortSignal that fires when the caller aborts, when no output has arrived
 * within `firstChunkMs`, or when the whole call exceeds `totalMs`.
 * Call `gotChunk()` on the first streamed chunk.
 */
export function attemptDeadline(outer: AbortSignal | undefined, firstChunkMs: number, totalMs: number) {
  const ctrl = new AbortController();
  const fail = (why: string) => ctrl.abort(new GeminiTimeoutError(why));
  const first = setTimeout(() => fail(`no response within ${firstChunkMs / 1000}s`), firstChunkMs);
  const total = setTimeout(() => fail(`not finished within ${totalMs / 1000}s`), totalMs);
  const onOuter = () => ctrl.abort(outer!.reason);
  outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: ctrl.signal,
    gotChunk: () => clearTimeout(first),
    /** Re-throws a timeout as GeminiTimeoutError so withRetry treats it as transient. */
    rethrow(err: unknown): never {
      if (ctrl.signal.reason instanceof GeminiTimeoutError && !outer?.aborted) throw ctrl.signal.reason;
      throw err;
    },
    done: () => {
      clearTimeout(first);
      clearTimeout(total);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

function isTransient(err: unknown): boolean {
  if (err instanceof GeminiTimeoutError) return true;
  const status = (err as { status?: number })?.status;
  if (status && [429, 500, 503, 504].includes(status)) return true;
  return /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(String(err));
}

/** A quota problem the user needs to act on (message is safe to show in the UI). */
export class QuotaError extends Error {}

/** Reads Gemini's suggested wait from a 429 ("retryDelay": "3s" / "Please retry in 3.4s"). */
function retryAfterMs(err: unknown): number {
  const text = String((err as Error)?.message ?? err);
  const m = text.match(/retry in ([\d.]+)\s*s/i) ?? text.match(/retryDelay\W+(\d+(?:\.\d+)?)s/i);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : 5_000;
}

function describe(err: unknown): string {
  const status = (err as { status?: number })?.status;
  return status ? `HTTP ${status}` : String(err).slice(0, 80);
}

/**
 * One structured-JSON Gemini call (responseSchema), with retries, model fallback
 * and a per-attempt deadline. Use for every Gemini call that feeds the UI.
 */
export async function generateJson<T>(opts: {
  label: string;
  system: string;
  prompt: string;
  schema: Schema;
  thinking?: ThinkingLevel;
  timeoutMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, model: string) => void;
}): Promise<T & { _model: string }> {
  return withRetry(
    opts.label,
    async (model) => {
      // Small JSON prompts answer in a few seconds when Gemini is healthy; fail over quickly when it isn't.
      const deadline = attemptDeadline(opts.signal, opts.timeoutMs ?? 25_000, opts.timeoutMs ?? 25_000);
      try {
        const res = await gemini().models.generateContent({
          model,
          contents: opts.prompt,
          config: {
            systemInstruction: opts.system,
            responseMimeType: "application/json",
            responseSchema: opts.schema,
            thinkingConfig: { thinkingLevel: opts.thinking ?? ThinkingLevel.LOW },
            abortSignal: deadline.signal,
          },
        });
        const text = res.text ?? "";
        try {
          return { ...(JSON.parse(text) as T), _model: model };
        } catch {
          throw new Error(`[${opts.label}] Gemini returned malformed JSON`);
        }
      } catch (err) {
        return deadline.rethrow(err);
      } finally {
        deadline.done();
      }
    },
    { signal: opts.signal, onRetry: opts.onRetry },
  );
}

let client: GoogleGenAI | null = null;

/** Server-only Gemini client. The API key never leaves this process. */
export function gemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      apiVersion: "v1beta",
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
  return client;
}
