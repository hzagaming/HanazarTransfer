import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createHandler } from "./app.js";
import { TransferStore } from "./transfer-store.js";

const port = readInteger("PORT", 3000);
const host = process.env.HOST || "0.0.0.0";
const dataBaseDir = resolve(process.env.DATA_DIR || join(tmpdir(), "hanazar-transfer"));
await mkdir(dataBaseDir, { recursive: true });
const sessionDir = await mkdtemp(join(dataBaseDir, "session-"));

const store = new TransferStore({
  rootDir: sessionDir,
  ttlMs: readInteger("TRANSFER_TTL_MS", 24 * 60 * 60 * 1_000),
  maxTransferBytes: readInteger("MAX_TRANSFER_BYTES", 2 * 1024 * 1024 * 1024),
  maxFiles: readInteger("MAX_FILES", 20)
});
await store.init();

const server = createServer(createHandler({ store }));
server.requestTimeout = readInteger("UPLOAD_TIMEOUT_MS", 2 * 60 * 60 * 1_000);
server.headersTimeout = 60_000;
server.listen(port, host, () => {
  console.log(`Hanazar Transfer is running at http://${host}:${port}`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise((resolveClose) => server.close(resolveClose));
  await store.close();
  await rm(sessionDir, { recursive: true, force: true });
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

function readInteger(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return parsed;
}
