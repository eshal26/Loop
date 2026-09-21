/**
 * Thin wrapper around AssemblyAI's LeMUR API.
 *
 * Centralizing this here (rather than calling fetch() inline in each route)
 * gives us one place to change the model, handle timeouts/retries, and —
 * critically — enforce a single JSON-parsing + fallback strategy for every
 * LeMUR call in the app. See parseJsonSafe() below: this is the fallback
 * path flagged as a known gap in the architecture doc.
 */

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const LEMUR_URL = "https://api.assemblyai.com/lemur/v3/generate/task";

if (!ASSEMBLYAI_API_KEY) {
  // Don't throw at import time — lets the rest of the server boot and
  // return a clear 503 from routes that need it, rather than crashing
  // the whole process if the key isn't set yet in dev.
  console.warn("ASSEMBLYAI_API_KEY is not set — LeMUR calls will fail.");
}

export class LemurError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
  }
}

interface LemurRequestOptions {
  prompt: string;
  input_text: string;
  final_model?: string;
  temperature?: number;
  timeoutMs?: number;
}

/**
 * Calls LeMUR with a prompt + input text, returns the raw response string.
 * Throws LemurError on network failure, timeout, or non-2xx response —
 * callers are responsible for deciding the fallback behavior (see
 * extraction.ts for an example of a safe default when this throws).
 */
export async function callLemur({
  prompt,
  input_text,
  final_model = "anthropic/claude-3-5-sonnet",
  temperature = 0,
  timeoutMs = 15000,
}: LemurRequestOptions): Promise<string> {
  if (!ASSEMBLYAI_API_KEY) {
    throw new LemurError("ASSEMBLYAI_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(LEMUR_URL, {
      method: "POST",
      headers: {
        Authorization: ASSEMBLYAI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, input_text, final_model, temperature }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LemurError(`LeMUR request failed: ${res.status} ${body}`);
    }

    const data = await res.json();
    return data.response as string;
  } catch (err) {
    if (err instanceof LemurError) throw err;
    throw new LemurError("LeMUR request failed", err);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Every LeMUR prompt in this app asks for JSON back. LLMs occasionally
 * wrap it in markdown fences or add stray text — strip that defensively
 * before parsing, and throw a typed error (rather than letting JSON.parse's
 * cryptic SyntaxError bubble up) so callers can apply a clean fallback.
 */
export function parseJsonSafe<T>(raw: string): T {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new LemurError(`LeMUR returned non-JSON output: ${cleaned.slice(0, 200)}`, err);
  }
}
