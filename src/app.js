import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TransferError } from "./transfer-store.js";

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"],
  ["/favicon.svg", "favicon.svg"]
]);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
};

export function createHandler({ store, peerRegistry, publicDir = DEFAULT_PUBLIC_DIR, logger = console }) {
  return (request, response) => {
    route({ request, response, store, peerRegistry, publicDir }).catch((error) => {
      if (!(error instanceof TransferError)) logger.error(error);
      if (!response.headersSent) sendError(response, error);
      else response.destroy();
    });
  };
}

async function route({ request, response, store, peerRegistry, publicDir }) {
  setSecurityHeaders(response);
  const url = new URL(request.url, "http://localhost");
  const path = url.pathname;
  assertSameOrigin(request);

  if (request.method === "GET" && path === "/api/config") {
    sendJson(response, 200, {
      maxTransferBytes: store.maxTransferBytes,
      maxFiles: store.maxFiles,
      ttlMs: store.ttlMs
    });
    return;
  }

  if (request.method === "GET" && path === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && path === "/api/peers") {
    const body = await readJson(request);
    sendJson(response, 201, peerRegistry.register(body));
    return;
  }

  const peerEventsMatch = path.match(/^\/api\/peers\/([a-f0-9]{16})\/events$/);
  if (peerEventsMatch && request.method === "GET") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no"
    });
    response.write("retry: 2000\n\n");
    const unsubscribe = peerRegistry.subscribe(
      peerEventsMatch[1],
      url.searchParams.get("token"),
      (type, data) => sendEvent(response, type, data)
    );
    const heartbeat = setInterval(() => response.write(": keepalive\n\n"), 15_000);
    heartbeat.unref();
    response.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return;
  }

  const peerMessageMatch = path.match(/^\/api\/peers\/([a-f0-9]{16})\/messages$/);
  if (peerMessageMatch && request.method === "POST") {
    const body = await readJson(request);
    const message = peerRegistry.sendMessage({
      fromId: peerMessageMatch[1],
      token: request.headers["x-peer-token"],
      toId: body?.to,
      type: body?.type,
      payload: body?.payload
    });
    sendJson(response, 202, message);
    return;
  }

  const peerMatch = path.match(/^\/api\/peers\/([a-f0-9]{16})$/);
  if (peerMatch && request.method === "DELETE") {
    peerRegistry.remove(peerMatch[1], request.headers["x-peer-token"]);
    response.writeHead(204).end();
    return;
  }

  if (request.method === "POST" && path === "/api/transfers") {
    const body = await readJson(request);
    const transfer = store.createTransfer(body?.files);
    sendJson(response, 201, transfer);
    return;
  }

  const fileMatch = path.match(/^\/api\/transfers\/([^/]+)\/files\/([a-f0-9]{16})$/);
  if (fileMatch && request.method === "PUT") {
    const contentLength = parseContentLength(request.headers["content-length"]);
    const transfer = await store.saveFile({
      code: fileMatch[1],
      fileId: fileMatch[2],
      uploadToken: request.headers["x-upload-token"],
      contentLength,
      source: request
    });
    sendJson(response, 200, transfer);
    return;
  }

  if (fileMatch && request.method === "GET") {
    const file = store.openFile(fileMatch[1], fileMatch[2]);
    response.writeHead(200, {
      "content-type": file.type,
      "content-length": file.size,
      "content-disposition": contentDisposition(file.name),
      "cache-control": "private, no-store"
    });
    createReadStream(file.path)
      .on("error", () => response.destroy())
      .pipe(response);
    return;
  }

  const transferMatch = path.match(/^\/api\/transfers\/([^/]+)$/);
  if (transferMatch && request.method === "GET") {
    sendJson(response, 200, store.getTransfer(transferMatch[1]));
    return;
  }

  if (transferMatch && request.method === "DELETE") {
    await store.deleteTransfer(
      transferMatch[1],
      request.headers["x-upload-token"]
    );
    response.writeHead(204).end();
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && STATIC_FILES.has(path)) {
    const name = STATIC_FILES.get(path);
    const content = await readFile(join(publicDir, name));
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(name)] ?? "application/octet-stream",
      "content-length": content.length,
      "cache-control": "no-cache"
    });
    response.end(request.method === "HEAD" ? undefined : content);
    return;
  }

  throw new TransferError(404, "页面或接口不存在", "NOT_FOUND");
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      throw new TransferError(413, "请求内容过大", "BODY_TOO_LARGE");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new TransferError(400, "请求内容不是有效的 JSON", "INVALID_JSON");
  }
}

function parseContentLength(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new TransferError(411, "上传请求缺少有效的 Content-Length", "CONTENT_LENGTH_REQUIRED");
  }
  return size;
}

function assertSameOrigin(request) {
  if (!new Set(["POST", "PUT", "PATCH", "DELETE"]).has(request.method)) return;
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    if (new URL(origin).host === request.headers.host) return;
  } catch {
    // Invalid origins are rejected below.
  }
  throw new TransferError(403, "拒绝跨站请求", "CROSS_ORIGIN_REQUEST");
}

function contentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function setSecurityHeaders(response) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendEvent(response, type, data) {
  response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendError(response, error) {
  const status = error instanceof TransferError ? error.status : 500;
  sendJson(response, status, {
    error: {
      code: error instanceof TransferError ? error.code : "INTERNAL_ERROR",
      message: error instanceof TransferError ? error.message : "服务器暂时无法处理请求"
    }
  });
}
