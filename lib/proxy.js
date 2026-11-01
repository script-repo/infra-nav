import crypto from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const sessions = new Map();
const SESSION_MS = 10 * 60 * 1000;

export function rememberConsole(target) {
  const id = crypto.randomUUID();
  sessions.set(id, { ...target, createdAt: Date.now() });
  return id;
}

export function attachConsoleProxy(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch (_error) {
      socket.destroy();
      return;
    }
    const match = pathname.match(/^\/ws-proxy\/([^/]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (clientSocket) => {
      bridge(clientSocket, decodeURIComponent(match[1]));
    });
  });
}

function bridge(clientSocket, sessionId) {
  const session = sessions.get(sessionId);
  if (!session || Date.now() - session.createdAt > SESSION_MS) {
    sessions.delete(sessionId);
    clientSocket.close(1011, "Session expired");
    return;
  }
  const headers = {
    "NTNX-Request-Id": crypto.randomUUID(),
    "X-Request-Id": crypto.randomUUID()
  };
  if (session.cookie) headers.Cookie = session.cookie;
  if (!session.cookie || session.sendBasic) headers.Authorization = `Basic ${session.basicAuth}`;
  const upstream = new WebSocket(session.targetUrl, {
    rejectUnauthorized: !session.tlsSkipVerify,
    headers
  });
  upstream.on("open", () => {
    sessions.delete(sessionId);
  });
  upstream.on("message", (data) => {
    if (clientSocket.readyState === WebSocket.OPEN) clientSocket.send(data);
  });
  clientSocket.on("message", (data) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
  });
  const closeBoth = () => {
    if (clientSocket.readyState === WebSocket.OPEN) clientSocket.close();
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  };
  upstream.on("close", () => {
    if (clientSocket.readyState === WebSocket.OPEN) clientSocket.close();
  });
  clientSocket.on("close", closeBoth);
  upstream.on("error", closeBoth);
  clientSocket.on("error", closeBoth);
}
