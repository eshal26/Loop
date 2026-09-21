import { Router } from "express";
import { z } from "zod";
import * as store from "../store/memoryStore.js";
import { extractItems } from "../services/extraction.js";

const router = Router();

const createSessionSchema = z.object({
  transcript: z.string().min(1, "Transcript cannot be empty"),
});

/**
 * POST /sessions
 * Takes a raw transcript from a capture recording, stores it, runs
 * extraction, and creates a Task for each extracted item.
 *
 * Returns the created session, the tasks, and a `degraded` flag so the
 * frontend can show a soft warning ("we had trouble sorting that — you
 * can still edit it below") instead of pretending everything worked.
 */
router.post("/", async (req, res) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const session = store.createSession(parsed.data.transcript);
  const { items, degraded } = await extractItems(parsed.data.transcript);

  const tasks = items.map((item) =>
    store.createTask({
      text: item.text,
      category: item.category,
      urgency: item.urgency,
      origin_session_id: session.id,
    })
  );

  res.status(201).json({ session, tasks, degraded });
});

// --- List past sessions with their tasks (used by the History feature) ---
router.get("/", (_req, res) => {
  const sessions = store.listSessions().map((session) => ({
    ...session,
    tasks: store.getTasksBySession(session.id),
  }));
  res.json(sessions);
});

export default router;
