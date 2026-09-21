import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import taskRoutes from "./routes/tasks.js";
import sessionRoutes from "./routes/sessions.js";
import { attachStreamingTranscription } from "./services/streamingTranscription.js";

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

app.use("/tasks", taskRoutes);
app.use("/sessions", sessionRoutes);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Centralized error handler — without this, an uncaught error in any
// route above would crash the process or leak a stack trace to the client.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const server = http.createServer(app);
attachStreamingTranscription(server);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Loop backend listening on port ${PORT}`);
});
