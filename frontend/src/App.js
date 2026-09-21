import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import "./App.css";
const filters = [
    { id: "today", label: "Today" },
    { id: "reminder", label: "Reminders" },
    { id: "task", label: "Tasks" },
    { id: "open_loop", label: "Open loops" },
    { id: "done", label: "Done" },
];
const categories = [
    { id: "task", label: "Task" },
    { id: "reminder", label: "Reminder" },
    { id: "open_loop", label: "Open loop" },
];
function categoryLabel(category) {
    return categories.find((item) => item.id === category)?.label ?? category;
}
function statusLabel(status) {
    return status[0].toUpperCase() + status.slice(1);
}
function formatDate(value) {
    if (!value)
        return "";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(value));
}
function getTaskAgeScore(task) {
    const ageMs = Date.now() - new Date(task.first_flagged_at).getTime();
    return Math.min(5, Math.max(0, Math.floor(ageMs / 86400000)));
}
export default function App() {
    const [view, setView] = useState("capture");
    const [filter, setFilter] = useState("today");
    const [tasks, setTasks] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [transcript, setTranscript] = useState("");
    const [manualText, setManualText] = useState("");
    const [manualCategory, setManualCategory] = useState("task");
    const [loading, setLoading] = useState(false);
    const [sorting, setSorting] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [message, setMessage] = useState("");
    const [expandedSessionId, setExpandedSessionId] = useState(null);
    const [timeAvailable, setTimeAvailable] = useState("15 min");
    const [energyLevel, setEnergyLevel] = useState("medium");
    const recognitionRef = useRef(null);
    async function refreshData() {
        setLoading(true);
        try {
            const [nextTasks, nextSessions] = await Promise.all([api.tasks.list(), api.sessions.list()]);
            setTasks(nextTasks);
            setSessions(nextSessions);
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not load Loop data.");
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void refreshData();
        return () => {
            recognitionRef.current?.stop();
        };
    }, []);
    const visibleTasks = useMemo(() => {
        if (filter === "done")
            return tasks.filter((task) => task.status === "done");
        if (filter === "today")
            return tasks.filter((task) => task.status !== "done");
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
        const weekAgo = Date.now() - 7 * 86400000;
        return tasks.filter((task) => task.status === "done" && new Date(task.updated_at).getTime() >= weekAgo).length;
    }, [tasks]);
    function startSpeechCapture() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setMessage("Live mic capture is not available in this browser yet. Paste or type a transcript for now.");
            return;
        }
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        recognition.onresult = (event) => {
            let finalText = "";
            let interimText = "";
            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                const result = event.results[index];
                if (result.isFinal)
                    finalText += result[0].transcript;
                else
                    interimText += result[0].transcript;
            }
            if (finalText) {
                setTranscript((current) => `${current}${current ? " " : ""}${finalText.trim()}`);
            }
            if (interimText) {
                setMessage(interimText.trim());
            }
        };
        recognition.onerror = () => {
            setIsRecording(false);
            setMessage("Mic capture stopped. Check microphone permission, then try again.");
        };
        recognition.onend = () => setIsRecording(false);
        recognition.start();
        recognitionRef.current = recognition;
        setIsRecording(true);
        setMessage("Listening...");
    }
    function stopSpeechCapture() {
        recognitionRef.current?.stop();
        recognitionRef.current = null;
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
            setMessage(result.degraded
                ? "Saved as one open loop because AI extraction was unavailable."
                : `Created ${result.tasks.length} item${result.tasks.length === 1 ? "" : "s"}.`);
            await refreshData();
            setView("tasks");
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not extract this transcript.");
        }
        finally {
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
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not add task.");
        }
    }
    async function updateTask(id, data) {
        try {
            await api.tasks.update(id, data);
            await refreshData();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not update task.");
        }
    }
    async function deleteTask(id) {
        try {
            await api.tasks.delete(id);
            setMessage("Task deleted.");
            await refreshData();
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Could not delete task.");
        }
    }
    async function snoozeTask(task) {
        const reason = window.prompt("Why snooze this?", task.snooze_reason ?? "");
        if (reason === null)
            return;
        const tomorrow = new Date(Date.now() + 86400000).toISOString();
        await updateTask(task.id, {
            status: "snoozed",
            snoozedUntil: tomorrow,
            snoozeReason: reason.trim() || "Later",
        });
    }
    return (_jsxs("main", { className: "app-shell", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Loop" }), _jsx("h1", { children: "Capture messy thoughts, turn them into next actions." })] }), _jsx("div", { className: "status-pill", children: loading ? "Syncing" : "Local API ready" })] }), _jsx("nav", { className: "tabs", "aria-label": "Loop sections", children: ["capture", "tasks", "guide", "history", "progress"].map((item) => (_jsx("button", { className: view === item ? "active" : "", onClick: () => setView(item), children: item === "guide" ? "Guide Me" : item[0].toUpperCase() + item.slice(1) }, item))) }), message && _jsx("div", { className: "notice", children: message }), view === "capture" && (_jsxs("section", { className: "panel", children: [_jsxs("div", { className: "section-title", children: [_jsx("h2", { children: "Capture" }), _jsx("button", { className: isRecording ? "danger" : "", onClick: isRecording ? stopSpeechCapture : startSpeechCapture, children: isRecording ? "Stop mic" : "Start mic" })] }), _jsx("textarea", { value: transcript, onChange: (event) => setTranscript(event.target.value), placeholder: "Paste or dictate a ramble here. Example: I need to email Sam, book the dentist, and I keep worrying about the budget.", rows: 8 }), sorting && _jsx("div", { className: "sorting", children: "Sorting into tasks..." }), _jsxs("div", { className: "actions", children: [_jsx("button", { onClick: submitTranscript, disabled: sorting, children: "Extract tasks" }), _jsx("button", { className: "secondary", onClick: () => setTranscript(""), children: "Clear" })] })] })), view === "tasks" && (_jsxs("section", { className: "panel", children: [_jsxs("div", { className: "section-title", children: [_jsx("h2", { children: "Task Manager" }), _jsx("button", { className: "secondary", onClick: refreshData, children: "Refresh" })] }), _jsxs("div", { className: "manual-add", children: [_jsx("input", { value: manualText, onChange: (event) => setManualText(event.target.value), placeholder: "Add a task manually" }), _jsx("select", { value: manualCategory, onChange: (event) => setManualCategory(event.target.value), children: categories.map((category) => (_jsx("option", { value: category.id, children: category.label }, category.id))) }), _jsx("button", { onClick: addTask, children: "Add" })] }), _jsx("div", { className: "chips", children: filters.map((item) => (_jsx("button", { className: filter === item.id ? "active" : "", onClick: () => setFilter(item.id), children: item.label }, item.id))) }), _jsx(TaskList, { tasks: visibleTasks, onUpdate: updateTask, onDelete: deleteTask, onSnooze: snoozeTask })] })), view === "guide" && (_jsxs("section", { className: "panel", children: [_jsxs("div", { className: "section-title", children: [_jsx("h2", { children: "Guide Me" }), _jsx("span", { className: "muted", children: "Local preview until backend endpoint exists" })] }), _jsx("div", { className: "choice-grid", children: ["5 min", "15 min", "30 min"].map((item) => (_jsx("button", { className: timeAvailable === item ? "active" : "", onClick: () => setTimeAvailable(item), children: item }, item))) }), _jsx("div", { className: "choice-grid", children: ["low", "medium", "high"].map((item) => (_jsxs("button", { className: energyLevel === item ? "active" : "", onClick: () => setEnergyLevel(item), children: [item, " energy"] }, item))) }), guideTask ? (_jsxs("div", { className: "guide-result", children: [_jsxs("p", { className: "muted", children: ["Best next task for ", timeAvailable, ", ", energyLevel, " energy"] }), _jsx("h3", { children: guideTask.text }), _jsxs("p", { children: ["This has urgency ", guideTask.urgency, " and has been sitting since ", formatDate(guideTask.first_flagged_at), "."] }), _jsx("p", { className: "first-step", children: "First step: open the place where this task starts and do two minutes." }), _jsxs("div", { className: "actions", children: [_jsx("button", { onClick: () => updateTask(guideTask.id, { status: "done" }), children: "Done already" }), _jsx("button", { className: "secondary", onClick: () => snoozeTask(guideTask), children: "Not this one" })] })] })) : (_jsx("div", { className: "empty", children: "No open tasks yet." }))] })), view === "history" && (_jsxs("section", { className: "panel", children: [_jsxs("div", { className: "section-title", children: [_jsx("h2", { children: "History" }), _jsxs("span", { className: "muted", children: [sessions.length, " capture session", sessions.length === 1 ? "" : "s"] })] }), _jsxs("div", { className: "history-list", children: [sessions.length === 0 && _jsx("div", { className: "empty", children: "Captured sessions will appear here." }), sessions.map((session) => (_jsxs("article", { className: "history-item", children: [_jsxs("button", { className: "history-toggle", onClick: () => setExpandedSessionId(expandedSessionId === session.id ? null : session.id), children: [_jsx("span", { children: formatDate(session.created_at) }), _jsxs("span", { children: [session.tasks.length, " item", session.tasks.length === 1 ? "" : "s"] })] }), expandedSessionId === session.id && (_jsxs("div", { className: "history-detail", children: [_jsx("p", { children: session.raw_transcript }), _jsx(TaskList, { tasks: session.tasks, onUpdate: updateTask, onDelete: deleteTask, onSnooze: snoozeTask, compact: true })] }))] }, session.id)))] })] })), view === "progress" && (_jsxs("section", { className: "panel metrics", children: [_jsx("h2", { children: "Progress" }), _jsxs("div", { className: "metric-grid", children: [_jsxs("div", { children: [_jsx("strong", { children: completionsThisWeek }), _jsx("span", { children: "completed this week" })] }), _jsxs("div", { children: [_jsx("strong", { children: tasks.filter((task) => task.category === "open_loop" && task.status === "done").length }), _jsx("span", { children: "open loops resolved" })] }), _jsxs("div", { children: [_jsx("strong", { children: openTasks.length }), _jsx("span", { children: "open tasks" })] })] })] }))] }));
}
function TaskList({ tasks, onUpdate, onDelete, onSnooze, compact = false, }) {
    if (tasks.length === 0) {
        return _jsx("div", { className: "empty", children: "No tasks here yet." });
    }
    return (_jsx("div", { className: compact ? "task-list compact" : "task-list", children: tasks.map((task) => (_jsxs("article", { className: `task-item ${task.status}`, children: [_jsxs("div", { children: [_jsx("h3", { children: task.text }), _jsxs("div", { className: "task-meta", children: [_jsx("span", { children: categoryLabel(task.category) }), _jsx("span", { children: statusLabel(task.status) }), _jsxs("span", { children: ["Urgency ", task.urgency] }), task.snoozed_until && _jsxs("span", { children: ["Snoozed until ", formatDate(task.snoozed_until)] })] }), task.snooze_reason && _jsx("p", { className: "muted", children: task.snooze_reason })] }), _jsxs("div", { className: "task-actions", children: [task.status !== "done" && _jsx("button", { onClick: () => onUpdate(task.id, { status: "done" }), children: "Done" }), task.status !== "snoozed" && _jsx("button", { className: "secondary", onClick: () => onSnooze(task), children: "Snooze" }), _jsx("button", { className: "danger", onClick: () => onDelete(task.id), children: "Delete" })] })] }, task.id))) }));
}
