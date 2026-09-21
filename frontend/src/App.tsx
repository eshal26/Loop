import { useEffect, useMemo, useRef, useState } from "react";
import { API_URL, api, Task, TaskCategory, TaskStatus, SessionWithTasks } from "./api/client";
import "./App.css";

type View = "capture" | "tasks" | "guide" | "history" | "progress";
type Filter = "today" | "reminder" | "task" | "open_loop" | "done";
type Energy = "low" | "medium" | "high";
type TimeAvailable = "5 min" | "15 min" | "30 min";

type StreamMessage =
  | { type: "ready" | "Begin" | "SpeechStarted" | "closed" }
  | { type: "transcript"; text: string; final: boolean }
  | { type: "error"; message: string };

type AudioCapture = {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  stream: MediaStream;
  socket: WebSocket;
};

const filters: { id: Filter; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "reminder", label: "Reminders" },
  { id: "task", label: "Tasks" },
  { id: "open_loop", label: "Open loops" },
  { id: "done", label: "Done" },
];

const categories: { id: TaskCategory; label: string }[] = [
  { id: "task", label: "Task" },
  { id: "reminder", label: "Reminder" },
  { id: "open_loop", label: "Open loop" },
];

function categoryLabel(category: TaskCategory): string {
  return categories.find((item) => item.id === category)?.label ?? category;
}

function statusLabel(status: TaskStatus): string {
  return status[0].toUpperCase() + status.slice(1);
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function getTaskAgeScore(task: Task): number {
  const ageMs = Date.now() - new Date(task.first_flagged_at).getTime();
  return Math.min(5, Math.max(0, Math.floor(ageMs / 86_400_000)));
}

function convertFloat32ToPcm16(input: Float32Array, sourceSampleRate: number, targetSampleRate: number): ArrayBuffer {
  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new ArrayBuffer(outputLength * 2);
  const view = new DataView(output);

  for (let index = 0; index < outputLength; index += 1) {
    const inputIndex = Math.floor(index * ratio);
    const sample = Math.max(-1, Math.min(1, input[inputIndex]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return output;
}

export default function App() {
  const [view, setView] = useState<View>("capture");
  const [filter, setFilter] = useState<Filter>("today");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<SessionWithTasks[]>([]);
  const [transcript, setTranscript] = useState("");
  const [manualText, setManualText] = useState("");
  const [manualCategory, setManualCategory] = useState<TaskCategory>("task");
  const [loading, setLoading] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [timeAvailable, setTimeAvailable] = useState<TimeAvailable>("15 min");
  const [energyLevel, setEnergyLevel] = useState<Energy>("medium");
  const captureRef = useRef<AudioCapture | null>(null);
  const finalTranscriptRef = useRef("");

  async function refreshData() {
    setLoading(true);
    try {
      const [nextTasks, nextSessions] = await Promise.all([api.tasks.list(), api.sessions.list()]);
      setTasks(nextTasks);
      setSessions(nextSessions);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Loop data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshData();

    return () => {
      stopSpeechCapture();
    };
  }, []);

  const visibleTasks = useMemo(() => {
    if (filter === "done") return tasks.filter((task) => task.status === "done");
    if (filter === "today") return tasks.filter((task) => task.status !== "done");
    return tasks.filter((task) => task.category === filter && task.status !== "done");
  }, [filter, tasks]);

  const openTasks = useMemo(() => tasks.filter((task) => task.status === "open"), [tasks]);

  const guideTask = useMemo(() => {
    return [...openTasks].sort((a, b) => {
      const aScore = a.urgency * 2 + getTaskAgeScore(a);
      const bScore = b.urgency * 2 + getTaskAgeScore(b);
      return bScore - aScore;
    })[0];
  }, [openTasks]);

  const completionsThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    return tasks.filter((task) => task.status === "done" && new Date(task.updated_at).getTime() >= weekAgo).length;
  }, [tasks]);

  async function startSpeechCapture() {
    if (captureRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      const wsUrl = new URL(API_URL);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.pathname = "/stream-transcript";
      wsUrl.search = "";

      const socket = new WebSocket(wsUrl.toString());
      socket.binaryType = "arraybuffer";

      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);

      finalTranscriptRef.current = transcript.trim();

      socket.onopen = () => {
        setMessage("Connecting to live transcription...");
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data) as StreamMessage;

        if (data.type === "ready") {
          setMessage("Listening...");
          return;
        }

        if (data.type === "SpeechStarted") {
          setMessage("Speech detected.");
          return;
        }

        if (data.type === "transcript") {
          const base = finalTranscriptRef.current;
          const nextText = data.text.trim();
          setTranscript([base, nextText].filter(Boolean).join(" "));

          if (data.final && nextText) {
            finalTranscriptRef.current = [base, nextText].filter(Boolean).join(" ");
          }
          return;
        }

        if (data.type === "error") {
          setMessage(data.message);
          stopSpeechCapture();
        }
      };

      socket.onerror = () => {
        setMessage("Live transcription socket failed. Check backend and AssemblyAI key.");
        stopSpeechCapture();
      };

      socket.onclose = () => {
        if (captureRef.current?.socket === socket) {
          stopSpeechCapture();
        }
      };

      processor.onaudioprocess = (event) => {
        if (socket.readyState !== WebSocket.OPEN) return;

        const input = event.inputBuffer.getChannelData(0);
        const pcm = convertFloat32ToPcm16(input, context.sampleRate, 16000);
        if (pcm.byteLength > 0) socket.send(pcm);
      };

      source.connect(processor);
      processor.connect(context.destination);

      captureRef.current = { context, source, processor, stream, socket };
      setIsRecording(true);
      setMessage("Requesting microphone...");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start microphone capture.");
      stopSpeechCapture();
    }
  }

  function stopSpeechCapture() {
    const capture = captureRef.current;
    captureRef.current = null;

    if (capture) {
      capture.processor.disconnect();
      capture.source.disconnect();
      capture.stream.getTracks().forEach((track) => track.stop());
      if (capture.socket.readyState === WebSocket.OPEN || capture.socket.readyState === WebSocket.CONNECTING) {
        capture.socket.close();
      }
      void capture.context.close();
    }

    setIsRecording(false);
    setMessage("Recording stopped. Review the transcript, then extract tasks.");
  }

  async function submitTranscript() {
    if (!transcript.trim()) {
      setMessage("Add a transcript first.");
      return;
    }

    setSorting(true);
    setMessage("Sorting transcript into tasks...");
    try {
      const result = await api.sessions.create(transcript.trim());
      setTranscript("");
      setMessage(
        result.degraded
          ? "Saved as one open loop because AI extraction was unavailable."
          : `Created ${result.tasks.length} item${result.tasks.length === 1 ? "" : "s"}.`
      );
      await refreshData();
      setView("tasks");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not extract this transcript.");
    } finally {
      setSorting(false);
    }
  }

  async function addTask() {
    if (!manualText.trim()) {
      setMessage("Add task text first.");
      return;
    }

    try {
      await api.tasks.create({ text: manualText.trim(), category: manualCategory });
      setManualText("");
      setMessage("Task added.");
      await refreshData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add task.");
    }
  }

  async function updateTask(id: string, data: Record<string, unknown>) {
    try {
      await api.tasks.update(id, data);
      await refreshData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update task.");
    }
  }

  async function deleteTask(id: string) {
    try {
      await api.tasks.delete(id);
      setMessage("Task deleted.");
      await refreshData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete task.");
    }
  }

  async function snoozeTask(task: Task) {
    const reason = window.prompt("Why snooze this?", task.snooze_reason ?? "");
    if (reason === null) return;

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await updateTask(task.id, {
      status: "snoozed",
      snoozedUntil: tomorrow,
      snoozeReason: reason.trim() || "Later",
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Loop</p>
          <h1>Capture messy thoughts, turn them into next actions.</h1>
        </div>
        <div className="status-pill">{loading ? "Syncing" : "Local API ready"}</div>
      </header>

      <nav className="tabs" aria-label="Loop sections">
        {(["capture", "tasks", "guide", "history", "progress"] as View[]).map((item) => (
          <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
            {item === "guide" ? "Guide Me" : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>

      {message && <div className="notice">{message}</div>}

      {view === "capture" && (
        <section className="panel">
          <div className="section-title">
            <h2>Capture</h2>
            <button className={isRecording ? "danger" : ""} onClick={isRecording ? stopSpeechCapture : startSpeechCapture}>
              {isRecording ? "Stop mic" : "Start mic"}
            </button>
          </div>
          <textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Paste or dictate a ramble here. Example: I need to email Sam, book the dentist, and I keep worrying about the budget."
            rows={8}
          />
          {sorting && <div className="sorting">Sorting into tasks...</div>}
          <div className="actions">
            <button onClick={submitTranscript} disabled={sorting}>
              Extract tasks
            </button>
            <button className="secondary" onClick={() => setTranscript("")}>
              Clear
            </button>
          </div>
        </section>
      )}

      {view === "tasks" && (
        <section className="panel">
          <div className="section-title">
            <h2>Task Manager</h2>
            <button className="secondary" onClick={refreshData}>
              Refresh
            </button>
          </div>

          <div className="manual-add">
            <input
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              placeholder="Add a task manually"
            />
            <select value={manualCategory} onChange={(event) => setManualCategory(event.target.value as TaskCategory)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
            <button onClick={addTask}>Add</button>
          </div>

          <div className="chips">
            {filters.map((item) => (
              <button key={item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>
                {item.label}
              </button>
            ))}
          </div>

          <TaskList tasks={visibleTasks} onUpdate={updateTask} onDelete={deleteTask} onSnooze={snoozeTask} />
        </section>
      )}

      {view === "guide" && (
        <section className="panel">
          <div className="section-title">
            <h2>Guide Me</h2>
            <span className="muted">Local preview until backend endpoint exists</span>
          </div>
          <div className="choice-grid">
            {(["5 min", "15 min", "30 min"] as TimeAvailable[]).map((item) => (
              <button key={item} className={timeAvailable === item ? "active" : ""} onClick={() => setTimeAvailable(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="choice-grid">
            {(["low", "medium", "high"] as Energy[]).map((item) => (
              <button key={item} className={energyLevel === item ? "active" : ""} onClick={() => setEnergyLevel(item)}>
                {item} energy
              </button>
            ))}
          </div>
          {guideTask ? (
            <div className="guide-result">
              <p className="muted">Best next task for {timeAvailable}, {energyLevel} energy</p>
              <h3>{guideTask.text}</h3>
              <p>
                This has urgency {guideTask.urgency} and has been sitting since {formatDate(guideTask.first_flagged_at)}.
              </p>
              <p className="first-step">First step: open the place where this task starts and do two minutes.</p>
              <div className="actions">
                <button onClick={() => updateTask(guideTask.id, { status: "done" })}>Done already</button>
                <button className="secondary" onClick={() => snoozeTask(guideTask)}>Not this one</button>
              </div>
            </div>
          ) : (
            <div className="empty">No open tasks yet.</div>
          )}
        </section>
      )}

      {view === "history" && (
        <section className="panel">
          <div className="section-title">
            <h2>History</h2>
            <span className="muted">{sessions.length} capture session{sessions.length === 1 ? "" : "s"}</span>
          </div>
          <div className="history-list">
            {sessions.length === 0 && <div className="empty">Captured sessions will appear here.</div>}
            {sessions.map((session) => (
              <article key={session.id} className="history-item">
                <button
                  className="history-toggle"
                  onClick={() => setExpandedSessionId(expandedSessionId === session.id ? null : session.id)}
                >
                  <span>{formatDate(session.created_at)}</span>
                  <span>{session.tasks.length} item{session.tasks.length === 1 ? "" : "s"}</span>
                </button>
                {expandedSessionId === session.id && (
                  <div className="history-detail">
                    <p>{session.raw_transcript}</p>
                    <TaskList tasks={session.tasks} onUpdate={updateTask} onDelete={deleteTask} onSnooze={snoozeTask} compact />
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {view === "progress" && (
        <section className="panel metrics">
          <h2>Progress</h2>
          <div className="metric-grid">
            <div>
              <strong>{completionsThisWeek}</strong>
              <span>completed this week</span>
            </div>
            <div>
              <strong>{tasks.filter((task) => task.category === "open_loop" && task.status === "done").length}</strong>
              <span>open loops resolved</span>
            </div>
            <div>
              <strong>{openTasks.length}</strong>
              <span>open tasks</span>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function TaskList({
  tasks,
  onUpdate,
  onDelete,
  onSnooze,
  compact = false,
}: {
  tasks: Task[];
  onUpdate: (id: string, data: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSnooze: (task: Task) => Promise<void>;
  compact?: boolean;
}) {
  if (tasks.length === 0) {
    return <div className="empty">No tasks here yet.</div>;
  }

  return (
    <div className={compact ? "task-list compact" : "task-list"}>
      {tasks.map((task) => (
        <article key={task.id} className={`task-item ${task.status}`}>
          <div>
            <h3>{task.text}</h3>
            <div className="task-meta">
              <span>{categoryLabel(task.category)}</span>
              <span>{statusLabel(task.status)}</span>
              <span>Urgency {task.urgency}</span>
              {task.snoozed_until && <span>Snoozed until {formatDate(task.snoozed_until)}</span>}
            </div>
            {task.snooze_reason && <p className="muted">{task.snooze_reason}</p>}
          </div>
          <div className="task-actions">
            {task.status !== "done" && <button onClick={() => onUpdate(task.id, { status: "done" })}>Done</button>}
            {task.status !== "snoozed" && <button className="secondary" onClick={() => onSnooze(task)}>Snooze</button>}
            <button className="danger" onClick={() => onDelete(task.id)}>Delete</button>
          </div>
        </article>
      ))}
    </div>
  );
}
