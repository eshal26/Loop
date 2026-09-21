import { callLemur, parseJsonSafe, LemurError } from "./lemur.js";

export type TaskCategory = "task" | "reminder" | "open_loop";

export interface ExtractedItem {
  text: string;
  category: TaskCategory;
  urgency: number; // 1-5
}

const EXTRACTION_PROMPT = `You are helping someone with ADHD turn a rambling voice thought-dump into a clear, actionable list.

Read the transcript below and extract distinct items. For each item, decide:
- category: "task" (a concrete action to complete), "reminder" (a specific thing to remember, often time-bound), or "open_loop" (a recurring worry, unresolved thought, or something without a clear next action)
- urgency: 1 (low) to 5 (high), based on language cues like deadlines, stress, or repetition

Rules:
- Do not invent tasks that aren't in the transcript.
- Merge sentences that describe the same underlying item.
- Keep each item's text short and actionable (under 15 words), in the user's own words as much as possible — do not add commentary.
- If the transcript contains nothing extractable, return an empty array.

Return ONLY a JSON array, no other text, in this exact shape:
[{ "text": "...", "category": "task", "urgency": 3 }]`;

/**
 * Extracts categorized items from a raw transcript via LeMUR.
 *
 * On any failure (LeMUR down, timeout, malformed JSON), this does NOT
 * throw up to the route — it returns a single fallback item so the user
 * always gets *something* back rather than a dead "sorting..." screen.
 * This is the fallback behavior flagged as a gap in the architecture doc.
 */
export async function extractItems(transcript: string): Promise<{
  items: ExtractedItem[];
  degraded: boolean;
}> {
  if (!transcript.trim()) {
    return { items: [], degraded: false };
  }

  try {
    const raw = await callLemur({
      prompt: EXTRACTION_PROMPT,
      input_text: transcript,
    });

    const parsed = parseJsonSafe<ExtractedItem[]>(raw);

    // Defensive validation — LeMUR can return well-formed JSON that still
    // doesn't match our expected shape (wrong category string, missing
    // field, urgency out of range). Filter rather than trust blindly.
    const valid = parsed.filter(
      (item): item is ExtractedItem =>
        typeof item.text === "string" &&
        item.text.trim().length > 0 &&
        ["task", "reminder", "open_loop"].includes(item.category) &&
        Number.isInteger(item.urgency) &&
        item.urgency >= 1 &&
        item.urgency <= 5
    );

    return { items: valid, degraded: false };
  } catch (err) {
    console.error("Extraction failed, falling back to single open_loop item:", err);

    // Fallback: never lose the user's words. Store the whole ramble as
    // one open_loop item at default urgency so it's still visible and
    // actionable (they can manually re-categorize), rather than silently
    // dropping the capture session.
    return {
      items: [{ text: transcript.slice(0, 200), category: "open_loop", urgency: 3 }],
      degraded: true,
    };
  }
}
