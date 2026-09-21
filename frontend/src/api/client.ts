export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export type TaskCategory = "task" | "reminder" | "open_loop";
export type TaskStatus = "open" | "done" | "snoozed";

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

export interface Session {
  id: string;
  raw_transcript: string;
  created_at: string;
}

export interface SessionWithTasks extends Session {
  tasks: Task[];
}

export interface CreateSessionResponse {
  session: Session;
  tasks: Task[];
  degraded: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || `Request failed: ${res.status}`, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  tasks: {
    list: (params?: { status?: string; category?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return request<Task[]>(`/tasks${qs ? `?${qs}` : ""}`);
    },
    update: (id: string, data: Record<string, unknown>) =>
      request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),
    create: (data: { text: string; category: TaskCategory }) =>
      request<Task>("/tasks", { method: "POST", body: JSON.stringify(data) }),
  },
  sessions: {
    create: (transcript: string) =>
      request<CreateSessionResponse>("/sessions", { method: "POST", body: JSON.stringify({ transcript }) }),
    list: () => request<SessionWithTasks[]>("/sessions"),
  },
};
