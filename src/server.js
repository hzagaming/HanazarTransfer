import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createHandler } from "./app.js";
import { PeerRegistry } from "./peer-registry.js";
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
const peerRegistry = new PeerRegistry();

const server = createServer(createHandler({ store, peerRegistry }));
server.requestTimeout = readInteger("UPLOAD_TIMEOUT_MS", 2 * 60 * 60 * 1_000);
server.headersTimeout = 60_000;
server.listen(port, host, () => {
  console.log("Hanazar Transfer is ready:");
  for (const url of getAccessUrls(host, port)) console.log(`  ${url}`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  peerRegistry.close();
  await new Promise((resolveClose) => {
    server.close(resolveClose);
    server.closeAllConnections();
  });
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

function getAccessUrls(host, port) {
  if (host !== "0.0.0.0" && host !== "::") return [`http://${host}:${port}`];
  const addresses = new Set([`http://localhost:${port}`]);
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const address of interfaces || []) {
      if (address.family === "IPv4" && !address.internal) {
        addresses.add(`http://${address.address}:${port}`);
      }
    }
  }
  return [...addresses];
}
