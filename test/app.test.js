import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHandler } from "../src/app.js";
import { TransferStore } from "../src/transfer-store.js";

async function withApp(run) {
  const rootDir = await mkdtemp(join(tmpdir(), "hanazar-transfer-api-test-"));
  const store = new TransferStore({ rootDir, maxTransferBytes: 1024, maxFiles: 3 });
  await store.init();
  const server = createServer(createHandler({ store }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
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
