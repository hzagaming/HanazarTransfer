import assert from "node:assert/strict";
import test from "node:test";

import { PeerRegistry } from "../src/peer-registry.js";
import { TransferError } from "../src/transfer-store.js";

function collectEvents() {
  const events = [];
  return { events, emit: (type, data) => events.push({ type, data }) };
}

test("registers peers without exposing their tokens", () => {
  const registry = new PeerRegistry({ disconnectGraceMs: 0 });
  const peer = registry.register({ name: "Charlie's Mac", deviceType: "desktop" });

  assert.match(peer.id, /^[a-f0-9]{16}$/);
  assert.match(peer.token, /^[a-f0-9]{64}$/);
  assert.deepEqual(registry.getPeer(peer.id), {
    id: peer.id,
    name: "Charlie's Mac",
    deviceType: "desktop"
  });
});

test("gives duplicate device names a readable suffix", () => {
  const registry = new PeerRegistry({ disconnectGraceMs: 0 });
  const first = registry.register({ name: "iPhone", deviceType: "mobile" });
  const second = registry.register({ name: "iPhone", deviceType: "mobile" });

  assert.equal(first.name, "iPhone");
  assert.equal(second.name, "iPhone 2");
});

test("expires registrations that never open an event stream", async () => {
  const registry = new PeerRegistry({ registrationGraceMs: 10 });
  const peer = registry.register({ name: "Abandoned", deviceType: "desktop" });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.throws(
    () => registry.getPeer(peer.id),
    (error) => error instanceof TransferError && error.status === 404
  );
});

test("limits the number of registered devices", () => {
  const registry = new PeerRegistry({ maxPeers: 1 });
  registry.register({ name: "First", deviceType: "desktop" });

  assert.throws(
    () => registry.register({ name: "Second", deviceType: "mobile" }),
    (error) => error instanceof TransferError && error.status === 429
  );
});

test("broadcasts the current online device list", () => {
  const registry = new PeerRegistry({ disconnectGraceMs: 0 });
  const first = registry.register({ name: "Laptop", deviceType: "desktop" });
  const second = registry.register({ name: "Phone", deviceType: "mobile" });
  const firstEvents = collectEvents();
  const secondEvents = collectEvents();

  registry.subscribe(first.id, first.token, firstEvents.emit);
  registry.subscribe(second.id, second.token, secondEvents.emit);

  assert.deepEqual(firstEvents.events.at(-1), {
    type: "peers",
    data: [{ id: second.id, name: "Phone", deviceType: "mobile" }]
  });
  assert.deepEqual(secondEvents.events.at(-1), {
    type: "peers",
    data: [{ id: first.id, name: "Laptop", deviceType: "desktop" }]
  });
});

test("routes authenticated text and transfer messages", () => {
  let now = Date.parse("2026-08-08T08:00:00.000Z");
  const registry = new PeerRegistry({ disconnectGraceMs: 0, now: () => now });
  const sender = registry.register({ name: "Laptop", deviceType: "desktop" });
  const receiver = registry.register({ name: "Phone", deviceType: "mobile" });
  const receiverEvents = collectEvents();
  registry.subscribe(sender.id, sender.token, () => {});
  registry.subscribe(receiver.id, receiver.token, receiverEvents.emit);

  registry.sendMessage({
    fromId: sender.id,
    token: sender.token,
    toId: receiver.id,
    type: "text",
    payload: { text: "局域网消息" }
  });
  now += 1_000;
  registry.sendMessage({
    fromId: sender.id,
    token: sender.token,
    toId: receiver.id,
    type: "transfer",
    payload: { code: "ABCDEFGH" }
  });

  assert.deepEqual(receiverEvents.events.slice(-2), [
    {
      type: "message",
      data: {
        type: "text",
        from: { id: sender.id, name: "Laptop", deviceType: "desktop" },
        payload: { text: "局域网消息" },
        createdAt: "2026-08-08T08:00:00.000Z"
      }
    },
    {
      type: "message",
      data: {
        type: "transfer",
        from: { id: sender.id, name: "Laptop", deviceType: "desktop" },
        payload: { code: "ABCDEFGH" },
        createdAt: "2026-08-08T08:00:01.000Z"
      }
    }
  ]);
});

test("preserves meaningful whitespace in shared text", () => {
  const registry = new PeerRegistry({ disconnectGraceMs: 0 });
  const sender = registry.register({ name: "Laptop", deviceType: "desktop" });
  const receiver = registry.register({ name: "Phone", deviceType: "mobile" });
  const receiverEvents = collectEvents();
  registry.subscribe(receiver.id, receiver.token, receiverEvents.emit);

  registry.sendMessage({
    fromId: sender.id,
    token: sender.token,
    toId: receiver.id,
    type: "text",
    payload: { text: "  const value = 1;\n" }
  });

  assert.equal(receiverEvents.events.at(-1).data.payload.text, "  const value = 1;\n");
});

test("rejects invalid tokens, payloads and offline recipients", () => {
  const registry = new PeerRegistry({ disconnectGraceMs: 0 });
  const sender = registry.register({ name: "Laptop", deviceType: "desktop" });
  const receiver = registry.register({ name: "Phone", deviceType: "mobile" });
  registry.subscribe(sender.id, sender.token, () => {});

  assert.throws(
    () => registry.sendMessage({ fromId: sender.id, token: "bad", toId: receiver.id, type: "text", payload: { text: "hi" } }),
    (error) => error instanceof TransferError && error.status === 403
  );
  assert.throws(
    () => registry.sendMessage({ fromId: sender.id, token: sender.token, toId: receiver.id, type: "text", payload: { text: "" } }),
    (error) => error instanceof TransferError && error.status === 400
  );
  assert.throws(
    () => registry.sendMessage({ fromId: sender.id, token: sender.token, toId: receiver.id, type: "transfer", payload: { code: "ABCDEFGH" } }),
    (error) => error instanceof TransferError && error.status === 409
  );
});
