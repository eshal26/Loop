import type { Server } from "http";
import WebSocket, { WebSocketServer } from "ws";

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
const ASSEMBLYAI_STREAM_URL =
  "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&speech_model=universal-3-5-pro&format_turns=true";

type AssemblyTurnMessage = {
  type: "Turn";
  transcript?: string;
  end_of_turn?: boolean;
};

type AssemblyMessage = AssemblyTurnMessage | { type: string; [key: string]: unknown };

function sendJson(client: WebSocket, payload: Record<string, unknown>) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
}

export function attachStreamingTranscription(server: Server) {
  const wss = new WebSocketServer({ server, path: "/stream-transcript" });

  wss.on("connection", (client) => {
    if (!ASSEMBLYAI_API_KEY) {
      sendJson(client, {
        type: "error",
        message: "ASSEMBLYAI_API_KEY is not configured on the backend.",
      });
      client.close(1011, "AssemblyAI API key missing");
      return;
    }

    const assembly = new WebSocket(ASSEMBLYAI_STREAM_URL, {
      headers: { Authorization: ASSEMBLYAI_API_KEY },
    });

    let assemblyReady = false;
    const queuedAudio: WebSocket.RawData[] = [];

    assembly.on("open", () => {
      assemblyReady = true;
      sendJson(client, { type: "ready" });
      while (queuedAudio.length && assembly.readyState === WebSocket.OPEN) {
        assembly.send(queuedAudio.shift()!);
      }
    });

    assembly.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as AssemblyMessage;

        if (data.type === "Turn" && data.transcript) {
          sendJson(client, {
            type: "transcript",
            text: data.transcript,
            final: Boolean(data.end_of_turn),
          });
          return;
        }

        if (data.type === "Begin" || data.type === "SpeechStarted") {
          sendJson(client, { type: data.type });
        }
      } catch (err) {
        console.error("Could not parse AssemblyAI streaming message:", err);
      }
    });

    assembly.on("error", (err) => {
      console.error("AssemblyAI streaming error:", err);
      sendJson(client, {
        type: "error",
        message: "AssemblyAI streaming connection failed.",
      });
    });

    assembly.on("close", (code, reason) => {
      sendJson(client, {
        type: "closed",
        code,
        reason: reason.toString(),
      });
      if (client.readyState === WebSocket.OPEN) client.close();
    });

    client.on("message", (chunk, isBinary) => {
      if (!isBinary) return;

      if (!assemblyReady) {
        queuedAudio.push(chunk);
        return;
      }

      if (assembly.readyState === WebSocket.OPEN) {
        assembly.send(chunk);
      }
    });

    client.on("close", () => {
      if (assembly.readyState === WebSocket.OPEN || assembly.readyState === WebSocket.CONNECTING) {
        assembly.close();
      }
    });

    client.on("error", (err) => {
      console.error("Browser streaming socket error:", err);
      if (assembly.readyState === WebSocket.OPEN || assembly.readyState === WebSocket.CONNECTING) {
        assembly.close();
      }
    });
  });
}
