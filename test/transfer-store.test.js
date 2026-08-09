import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { TransferError, TransferStore } from "../src/transfer-store.js";

async function withStore(run, options = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "hanazar-transfer-test-"));
  const store = new TransferStore({ rootDir, ...options });
  await store.init();

  try {
    await run(store, rootDir);
  } finally {
    await store.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("creates a multi-file transfer without exposing its upload token", async () => {
  await withStore(async (store) => {
    const transfer = store.createTransfer([
      { name: "photo.jpg", size: 4, type: "image/jpeg" },
      { name: "notes.txt", size: 2, type: "text/plain" }
    ]);

    assert.match(transfer.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    assert.match(transfer.uploadToken, /^[a-f0-9]{64}$/);
    assert.equal(transfer.files.length, 2);

    const publicTransfer = store.getTransfer(transfer.code);
    assert.equal(publicTransfer.uploadToken, undefined);
    assert.equal(publicTransfer.status, "uploading");
    assert.equal(publicTransfer.totalSize, 6);
  });
});

test("streams an upload and marks the transfer ready", async () => {
  await withStore(async (store, rootDir) => {
    const transfer = store.createTransfer([
      { name: "hello.txt", size: 5, type: "text/plain" }
    ]);
    const [file] = transfer.files;

    await store.saveFile({
      code: transfer.code,
      fileId: file.id,
      uploadToken: transfer.uploadToken,
      contentLength: 5,
      source: Readable.from([Buffer.from("hello")])
    });

    const ready = store.getTransfer(transfer.code);
    assert.equal(ready.status, "ready");
    assert.equal(ready.files[0].uploaded, true);

    const stored = store.openFile(transfer.code, file.id);
    assert.equal(await readFile(stored.path, "utf8"), "hello");
    assert.equal(stored.name, "hello.txt");
    assert.ok(stored.path.startsWith(rootDir));
    createReadStream(stored.path).destroy();
  });
});

test("rejects invalid tokens and mismatched upload sizes", async () => {
  await withStore(async (store, rootDir) => {
    const transfer = store.createTransfer([
      { name: "hello.txt", size: 5, type: "text/plain" }
    ]);
    const [file] = transfer.files;

    await assert.rejects(
      store.saveFile({
        code: transfer.code,
        fileId: file.id,
        uploadToken: "invalid",
        contentLength: 5,
        source: Readable.from(["hello"])
      }),
      (error) => error instanceof TransferError && error.status === 403
    );

    await assert.rejects(
      store.saveFile({
        code: transfer.code,
        fileId: file.id,
        uploadToken: transfer.uploadToken,
        contentLength: 5,
        source: Readable.from(["four"])
      }),
      (error) => error instanceof TransferError && error.status === 400
    );

    assert.equal(store.getTransfer(transfer.code).files[0].uploaded, false);
    assert.deepEqual(await readFile(join(rootDir, transfer.code, `${file.id}.part`)).catch(() => null), null);
  });
});

test("enforces transfer limits", async () => {
  await withStore(
    async (store) => {
      assert.throws(
        () => store.createTransfer([{ name: "large.bin", size: 11, type: "application/octet-stream" }]),
        (error) => error instanceof TransferError && error.status === 413
      );
    },
    { maxTransferBytes: 10 }
  );
});

test("replaces unsafe media types with a download-safe default", async () => {
  await withStore(async (store) => {
    const transfer = store.createTransfer([
      { name: "report.txt", size: 1, type: "text/plain\r\nx-injected: yes" }
    ]);

    assert.equal(transfer.files[0].type, "application/octet-stream");
  });
});

test("preserves valid whitespace in file names", async () => {
  await withStore(async (store) => {
    const transfer = store.createTransfer([
      { name: " report.txt ", size: 0, type: "text/plain" }
    ]);

    assert.equal(transfer.files[0].name, " report.txt ");
  });
});

test("expires transfers and deletes their files", async () => {
  let now = 1_000;
  await withStore(
    async (store, rootDir) => {
      const transfer = store.createTransfer([{ name: "old.txt", size: 3, type: "text/plain" }]);
      const [file] = transfer.files;

      await store.saveFile({
        code: transfer.code,
        fileId: file.id,
        uploadToken: transfer.uploadToken,
        contentLength: 3,
        source: Readable.from(["old"])
      });

      now += 101;
      await store.sweepExpired();

      assert.throws(
        () => store.getTransfer(transfer.code),
        (error) => error instanceof TransferError && error.status === 404
      );
      assert.equal(await readFile(join(rootDir, transfer.code, file.id)).catch(() => null), null);
    },
    { ttlMs: 100, now: () => now }
  );
});
