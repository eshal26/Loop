import { Router } from "express";
import { z } from "zod";
import * as store from "../store/memoryStore.js";

const router = Router();

// --- List tasks, filterable by status/category ---
router.get("/", (req, res) => {
  const { status, category } = req.query;
  const tasks = store.listTasks({
    status: typeof status === "string" ? status : undefined,
    category: typeof category === "string" ? category : undefined,
  });
  res.json(tasks);
});

const updateSchema = z.object({
  status: z.enum(["open", "done", "snoozed"]).optional(),
  urgency: z.number().min(1).max(5).optional(),
  snoozedUntil: z.string().optional(),
  snoozeReason: z.string().optional(),
  text: z.string().optional(),
});

// --- Update a task (mark done/snoozed, edit text, override urgency) ---
router.patch("/:id", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { snoozedUntil, snoozeReason, ...rest } = parsed.data;
  const updated = store.updateTask(req.params.id, {
    ...rest,
    ...(snoozedUntil ? { snoozed_until: snoozedUntil } : {}),
    ...(snoozeReason !== undefined ? { snooze_reason: snoozeReason } : {}),
  });

  if (!updated) return res.status(404).json({ error: "Task not found" });
  res.json(updated);
});

// --- Delete a task ---
router.delete("/:id", (req, res) => {
  const deleted = store.deleteTask(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Task not found" });
  res.status(204).send();
});

// --- Manual add (bypassing voice capture) ---
const createSchema = z.object({
  text: z.string().min(1),
  category: z.enum(["task", "reminder", "open_loop"]),
});

router.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const task = store.createTask(parsed.data);
  res.status(201).json(task);
});

export default router;
