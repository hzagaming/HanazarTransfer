import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHandler } from "../src/app.js";
import { PeerRegistry } from "../src/peer-registry.js";
import { TransferStore } from "../src/transfer-store.js";

async function withApp(run) {
  const rootDir = await mkdtemp(join(tmpdir(), "hanazar-transfer-api-test-"));
  const store = new TransferStore({ rootDir, maxTransferBytes: 1024, maxFiles: 3 });
  const peerRegistry = new PeerRegistry({ disconnectGraceMs: 0 });
  await store.init();
  const server = createServer(createHandler({ store, peerRegistry }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    peerRegistry.close();
    await store.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("serves the web app and public configuration", async () => {
  await withApp(async (origin) => {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /^text\/html/);
    assert.match(await page.text(), /Hanazar Transfer/);

    const script = await fetch(`${origin}/app.js`);
    assert.equal(script.headers.get("cache-control"), "no-cache");

    const p2pPage = await fetch(`${origin}/p2p.html`);
    assert.equal(p2pPage.status, 200);
    assert.match(await p2pPage.text(), /P2P 直传/);
    assert.equal((await fetch(`${origin}/p2p.js`)).status, 200);
    assert.equal((await fetch(`${origin}/p2p.css`)).status, 200);

    const config = await fetch(`${origin}/api/config`).then((response) => response.json());
    assert.deepEqual(config, { maxTransferBytes: 1024, maxFiles: 3, ttlMs: 86_400_000 });
  });
});

test("supports the complete create, upload, inspect and download flow", async () => {
  await withApp(async (origin) => {
    const createdResponse = await fetch(`${origin}/api/transfers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: [{ name: "你好.txt", size: 5, type: "text/plain" }] })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.status, "uploading");

    const [file] = created.files;
    const uploadResponse = await fetch(`${origin}/api/transfers/${created.code}/files/${file.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-token": created.uploadToken
      },
      body: Buffer.from("hello")
    });
    assert.equal(uploadResponse.status, 200);
    assert.equal((await uploadResponse.json()).status, "ready");

    const inspected = await fetch(`${origin}/api/transfers/${created.code}`).then((response) => response.json());
    assert.equal(inspected.uploadToken, undefined);
    assert.equal(inspected.files[0].uploaded, true);

    const download = await fetch(`${origin}/api/transfers/${created.code}/files/${file.id}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-length"), "5");
    assert.match(download.headers.get("content-disposition"), /filename\*=UTF-8''/);
    assert.equal(await download.text(), "hello");
  });
});

test("returns structured errors for invalid requests", async () => {
  await withApp(async (origin) => {
    const malformed = await fetch(`${origin}/api/transfers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json"
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: { code: "INVALID_JSON", message: "请求内容不是有效的 JSON" }
    });

    const missing = await fetch(`${origin}/api/transfers/NOTREAL`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "TRANSFER_NOT_FOUND");

    const unknown = await fetch(`${origin}/api/nope`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, "NOT_FOUND");
  });
});

test("rejects JSON values that do not contain a file list", async () => {
  await withApp(async (origin) => {
    const response = await fetch(`${origin}/api/transfers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null"
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "NO_FILES");
  });
});

test("rejects cross-origin state-changing requests", async () => {
  await withApp(async (origin) => {
    const response = await fetch(`${origin}/api/peers`, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "origin": "https://malicious.example"
      },
      body: JSON.stringify({ name: "Injected", deviceType: "desktop" })
    });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "CROSS_ORIGIN_REQUEST");
  });
});

test("registers LAN devices and delivers real-time messages over SSE", { timeout: 3_000 }, async () => {
  await withApp(async (origin) => {
    const sender = await registerPeer(origin, "Laptop", "desktop");
    const receiver = await registerPeer(origin, "Phone", "mobile");
    const controller = new AbortController();
    const eventsResponse = await fetch(
      `${origin}/api/peers/${receiver.id}/events?token=${receiver.token}`,
      { signal: controller.signal }
    );
    assert.equal(eventsResponse.status, 200);
    assert.match(eventsResponse.headers.get("content-type"), /^text\/event-stream/);
    const reader = eventsResponse.body.getReader();
    const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /event: peers/);

    const messageResponse = await fetch(`${origin}/api/peers/${sender.id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-peer-token": sender.token
      },
      body: JSON.stringify({
        to: receiver.id,
        type: "text",
        payload: { text: "局域网消息" }
      })
    });
    assert.equal(messageResponse.status, 202);
    const event = decoder.decode((await reader.read()).value);
    assert.match(event, /event: message/);
    assert.match(event, /局域网消息/);
    await reader.cancel();
    controller.abort();
  });
});

test("rejects invalid SSE credentials before opening the event stream", async () => {
  await withApp(async (origin) => {
    const peer = await registerPeer(origin, "Laptop", "desktop");
    const response = await fetch(`${origin}/api/peers/${peer.id}/events?token=invalid`);

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: { code: "INVALID_PEER_TOKEN", message: "设备凭证无效" }
    });
  });
});

async function registerPeer(origin, name, deviceType) {
  const response = await fetch(`${origin}/api/peers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, deviceType })
  });
  assert.equal(response.status, 201);
  return response.json();
}
