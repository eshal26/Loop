# Loop

Loop is a full-stack TypeScript app for capturing messy spoken thoughts, transcribing them live, extracting structured tasks, and managing the resulting list.

Current flow:

```text
browser mic -> backend WebSocket -> AssemblyAI Streaming -> live transcript -> POST /sessions -> LeMUR extraction -> tasks
```

## Tech Stack

- Frontend: React 18, Vite, TypeScript
- Backend: Express, TypeScript, `ws`
- AI/STT: AssemblyAI Streaming v3 and LeMUR
- Storage: in-memory arrays, no database yet
- Auth: none, single shared task list
- Future database: PostgreSQL schema is in `backend/future-postgres/schema.sql`

## Implemented

### Frontend

- Minimal app UI with tabs: Capture, Tasks, Guide Me, History, Progress
- Live mic capture with `getUserMedia`
- Audio conversion to PCM16 mono 16 kHz before streaming
- Live transcript rendering in the Capture textarea
- Transcript extraction via `POST /sessions`
- Task manager wired to backend:
  - list tasks
  - manual add
  - filters: Today, Reminders, Tasks, Open loops, Done
  - mark done
  - snooze with reason
  - delete
- History view from `GET /sessions`
- Local-only Guide Me preview
- Local-only progress metrics

### Backend

- `GET /health`
- `GET /tasks`
- `POST /tasks`
- `PATCH /tasks/:id`
- `DELETE /tasks/:id`
- `POST /sessions`
- `GET /sessions`
- `ws://localhost:4000/stream-transcript`
- AssemblyAI Streaming proxy keeps the API key server-side
- LeMUR extraction wrapper with fallback
- In-memory store matching the future Postgres schema shape

## Setup

Backend:

```powershell
cd backend
npm.cmd install
npm.cmd run dev
```

Frontend:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`.

## Environment

`backend/.env`:

```env
ASSEMBLYAI_API_KEY=your_key_here
PORT=4000
CLIENT_URL=http://localhost:5173
```

`frontend/.env`:

```env
VITE_API_URL=http://localhost:4000
```

## Run URLs

```text
Frontend: http://localhost:5173
Backend:  http://localhost:4000
Health:   http://localhost:4000/health
```

## Verify

```powershell
curl http://localhost:4000/health
curl -X POST http://localhost:4000/tasks -H "Content-Type: application/json" -d "{\"text\":\"Test task\",\"category\":\"task\"}"
curl http://localhost:4000/tasks
```

Expected health response:

```json
{"ok":true}
```

## Audio Pipeline Details

The browser captures mic audio with `navigator.mediaDevices.getUserMedia`.

The frontend converts browser `Float32Array` audio samples into:

```text
PCM16 signed little-endian
mono
16 kHz
```

Those chunks are sent to:

```text
ws://localhost:4000/stream-transcript
```

The backend forwards binary audio chunks to AssemblyAI Streaming v3:

```text
wss://streaming.assemblyai.com/v3/ws
```

AssemblyAI `Turn` messages are sent back to the browser as transcript updates.

## Current Limitations

- Data resets when the backend restarts
- No auth or user accounts
- No automated tests yet
- Guide Me is currently a frontend-only preview
- Progress is currently frontend-only
- Duplicate detection is not implemented yet
- No confirm-to-merge flow yet
- No task update/re-ramble endpoint yet

## Next Features

### Backend

- `GET /progress`
- `POST /guide-me`
- `POST /guide-me/:eventId/feedback`
- `POST /tasks/:id/updates`
- Duplicate detection for new extracted items
- Confirm-to-merge flow instead of silent auto-merge
- Persist data with Postgres using `backend/future-postgres/schema.sql`

### AI Pipeline

- Improve extraction schema with confidence, due hints, and AI reasoning
- Compare new extracted items against existing tasks
- Use LeMUR to suggest duplicate matches
- Let users confirm create vs merge
- Use time, energy, urgency, and task age for Guide Me scoring
- Log Guide Me accept/reject feedback for future personalization

### Frontend

- Split the current minimal UI into real components:
  - `MicButton`
  - `LiveTranscript`
  - `SortingTransition`
  - `TaskListView`
  - `GuideMe`
  - `History`
  - `Progress`
- Add better loading/error states
- Add reconnect handling for dropped transcription sockets
- Add merge confirmation UI
- Add polished visual design

## Database Plan

The app currently uses `backend/src/store/memoryStore.ts`.

Later, run:

```text
backend/future-postgres/schema.sql
```

Then replace the internals of the store functions with database queries while keeping the same exported function names. Routes and frontend code should not need a rewrite.
