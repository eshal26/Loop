import { randomUUID } from "crypto";

/**
 * In-memory data store — no database, no persistence across server
 * restarts. This exists to remove all setup friction (Docker, Postgres
 * credentials, migrations) while the core product (Capture → Extraction
 * → Guide Me) gets built and demoed.
 *
 * Field names deliberately match future-postgres/schema.sql exactly
 * (snake_case, same columns). When you're ready to add Postgres back:
 *   1. Run future-postgres/schema.sql against a real database
 *   2. Replace the internals of each function below with real queries
 *      (Kysely or plain `pg`) — keep the same function signatures
 *   3. Nothing in routes/, services/, or the frontend needs to change,
 *      since they only ever call these exported functions.
 */

export type TaskCategory = "task" | "reminder" | "open_loop";
export type TaskStatus = "open" | "done" | "snoozed";

export interface Session {
  id: string;
  raw_transcript: string;
  created_at: string;
}

export interface Task {
  id: string;
  origin_session_id: string | null;
  text: string;
  category: TaskCategory;
  status: TaskStatus;
  urgency: number;
  first_flagged_at: string;
  snoozed_until: string | null;
  snooze_reason: string | null;
  created_at: string;
  updated_at: string;
}

const sessions: Session[] = [];
const tasks: Task[] = [];

function now(): string {
  return new Date().toISOString();
}

// ---------- Tasks ----------

export function listTasks(filter?: { status?: string; category?: string }): Task[] {
  return tasks
    .filter((t) => (filter?.status ? t.status === filter.status : true))
    .filter((t) => (filter?.category ? t.category === filter.category : true))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export function getTask(id: string): Task | undefined {
  return tasks.find((t) => t.id === id);
}

export function createTask(data: {
  text: string;
  category: TaskCategory;
  urgency?: number;
  origin_session_id?: string | null;
}): Task {
  const timestamp = now();
  const task: Task = {
    id: randomUUID(),
    origin_session_id: data.origin_session_id ?? null,
    text: data.text,
    category: data.category,
    status: "open",
    urgency: data.urgency ?? 3,
    first_flagged_at: timestamp,
    snoozed_until: null,
    snooze_reason: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  tasks.push(task);
  return task;
}

export function updateTask(
  id: string,
  data: Partial<Pick<Task, "status" | "urgency" | "text" | "snoozed_until" | "snooze_reason">>
): Task | undefined {
  const task = tasks.find((t) => t.id === id);
  if (!task) return undefined;
  Object.assign(task, data, { updated_at: now() });
  return task;
}

export function deleteTask(id: string): boolean {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;
  tasks.splice(index, 1);
  return true;
}

// ---------- Sessions ----------

export function createSession(rawTranscript: string): Session {
  const session: Session = { id: randomUUID(), raw_transcript: rawTranscript, created_at: now() };
  sessions.push(session);
  return session;
}

export function listSessions(): Session[] {
  return [...sessions].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function getTasksBySession(sessionId: string): Task[] {
  return tasks.filter((t) => t.origin_session_id === sessionId);
}
