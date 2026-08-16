import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CHUNK_BYTES,
  SIGNAL_PREFIX,
  buildInviteUrl,
  decodeSignal,
  encodeSignal,
  readActiveChannelData,
  resolveChunkSize,
  trySendControl,
  trySendText,
  validateFileBatch,
  waitForIceComplete
} from "../public/p2p.js";

test("round-trips WebRTC descriptions through compact invitation signals", () => {
  const description = { type: "offer", sdp: "v=0\r\na=ice-ufrag:你好\r\n" };
  const signal = encodeSignal(description);

  assert.match(signal, new RegExp(`^${SIGNAL_PREFIX.replace(".", "\\.")}`));
  assert.equal(signal.includes("="), false);
  assert.deepEqual(decodeSignal(signal), description);
});

test("extracts an invitation from a URL fragment without leaking query data", () => {
  const description = { type: "offer", sdp: "v=0\r\n" };
  const signal = encodeSignal(description);
  const invite = buildInviteUrl("https://example.com/p2p.html?code=SECRET#old", signal);

  assert.equal(invite, `https://example.com/p2p.html#p2p=${signal}`);
  assert.deepEqual(decodeSignal(invite), description);
});

test("rejects malformed, oversized and unsupported signaling payloads", () => {
  assert.throws(() => decodeSignal("not-a-signal"), /连接信息无效/);
  assert.throws(() => encodeSignal({ type: "rollback", sdp: "v=0" }), /连接类型/);
  assert.throws(() => decodeSignal(`${SIGNAL_PREFIX}${"a".repeat(200_001)}`), /连接信息过长/);
});

test("uses interoperable chunks without exceeding the negotiated SCTP limit", () => {
  assert.equal(resolveChunkSize(), DEFAULT_CHUNK_BYTES);
  assert.equal(resolveChunkSize(65_536), DEFAULT_CHUNK_BYTES);
  assert.equal(resolveChunkSize(8_192), 8_192);
  assert.equal(resolveChunkSize(0), DEFAULT_CHUNK_BYTES);
});

test("validates file batches before allocating transfer state", () => {
  const files = [{ name: "a.bin", size: 10 }, { name: "b.bin", size: 20 }];
  assert.deepEqual(validateFileBatch(files, { maxFiles: 2, maxBytes: 30 }), { count: 2, totalBytes: 30 });
  assert.throws(() => validateFileBatch([], { maxFiles: 2, maxBytes: 30 }), /选择文件/);
  assert.throws(() => validateFileBatch([...files, { name: "c.bin", size: 0 }], { maxFiles: 2, maxBytes: 30 }), /最多选择/);
  assert.throws(() => validateFileBatch(files, { maxFiles: 2, maxBytes: 29 }), /总大小/);
  assert.throws(() => validateFileBatch([{ name: "bad", size: -1 }], { maxFiles: 2, maxBytes: 30 }), /文件大小/);
});

test("stops ICE gathering immediately when a pairing connection closes", async () => {
  class FakeConnection extends EventTarget {
    iceGatheringState = "gathering";
    signalingState = "stable";
  }
  const connection = new FakeConnection();
  const waiting = waitForIceComplete(connection, 1_000);
  connection.signalingState = "closed";
  connection.dispatchEvent(new Event("signalingstatechange"));
  await assert.rejects(waiting, { name: "AbortError" });
});

test("drops a Blob payload when its DataChannel becomes stale during decoding", async () => {
  let finishRead;
  class DeferredBlob extends Blob {
    arrayBuffer() {
      return new Promise((resolve) => { finishRead = resolve; });
    }
  }

  let active = true;
  const reading = readActiveChannelData(new DeferredBlob(), () => active);
  active = false;
  finishRead(new ArrayBuffer(1));

  assert.equal(await reading, null);
});

test("contains DataChannel errors while sending text", () => {
  const sent = [];
  assert.equal(trySendText((payload) => sent.push(payload), "hello"), true);
  assert.deepEqual(sent, [{ t: "text", text: "hello" }]);
  assert.equal(trySendText(() => { throw new Error("channel closed"); }, "retry"), false);
});

test("contains DataChannel errors while sending the connection greeting", () => {
  const greeting = { t: "hello", name: "Mac" };
  const sent = [];
  assert.equal(trySendControl((payload) => sent.push(payload), greeting), true);
  assert.deepEqual(sent, [greeting]);
  assert.equal(trySendControl(() => { throw new Error("channel closed"); }, greeting), false);
});
