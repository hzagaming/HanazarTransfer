import { randomBytes, timingSafeEqual } from "node:crypto";

import { TransferError } from "./transfer-store.js";

const DEVICE_TYPES = new Set(["desktop", "mobile", "tablet"]);
const MESSAGE_TYPES = new Set(["text", "transfer"]);

export class PeerRegistry {
  constructor({ disconnectGraceMs = 5_000, registrationGraceMs = 10_000, maxPeers = 100, now = Date.now } = {}) {
    this.disconnectGraceMs = disconnectGraceMs;
    this.registrationGraceMs = registrationGraceMs;
    this.maxPeers = maxPeers;
    this.now = now;
    this.peers = new Map();
  }

  register(input = {}) {
    if (this.peers.size >= this.maxPeers) {
      throw new TransferError(429, "在线设备数量已达上限", "PEER_LIMIT_REACHED");
    }
    const name = this.#uniqueName(sanitizeName(input.name));
    const deviceType = DEVICE_TYPES.has(input.deviceType) ? input.deviceType : "desktop";
    const peer = {
      id: randomBytes(8).toString("hex"),
      token: randomBytes(32).toString("hex"),
      name,
      deviceType,
      connections: new Set(),
      disconnectTimer: null
    };
    this.peers.set(peer.id, peer);
    this.#scheduleRemoval(peer, this.registrationGraceMs);
    return { ...this.#publicPeer(peer), token: peer.token };
  }

  getPeer(id) {
    return this.#publicPeer(this.#findPeer(id));
  }

  subscribe(id, token, emit) {
    const peer = this.#authenticate(id, token);
    if (typeof emit !== "function") throw new TypeError("emit must be a function");
    clearTimeout(peer.disconnectTimer);
    peer.disconnectTimer = null;
    peer.connections.add(emit);
    this.#broadcastPeers();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      peer.connections.delete(emit);
      if (peer.connections.size > 0) return;

      this.#scheduleRemoval(peer, this.disconnectGraceMs);
    };
  }

  sendMessage({ fromId, token, toId, type, payload }) {
    const sender = this.#authenticate(fromId, token);
    const recipient = this.#findPeer(toId);
    if (!MESSAGE_TYPES.has(type)) {
      throw new TransferError(400, "消息类型无效", "INVALID_MESSAGE_TYPE");
    }
    const validatedPayload = validatePayload(type, payload);
    if (recipient.connections.size === 0) {
      throw new TransferError(409, "接收设备已离线", "PEER_OFFLINE");
    }

    const message = {
      type,
      from: this.#publicPeer(sender),
      payload: validatedPayload,
      createdAt: new Date(this.now()).toISOString()
    };
    for (const emit of recipient.connections) emit("message", message);
    return message;
  }

  remove(id, token) {
    const peer = this.#authenticate(id, token);
    clearTimeout(peer.disconnectTimer);
    this.peers.delete(peer.id);
    this.#broadcastPeers();
  }

  close() {
    for (const peer of this.peers.values()) clearTimeout(peer.disconnectTimer);
    this.peers.clear();
  }

  #broadcastPeers() {
    const online = [...this.peers.values()].filter((peer) => peer.connections.size > 0);
    for (const peer of online) {
      const peers = online
        .filter((candidate) => candidate.id !== peer.id)
        .map((candidate) => this.#publicPeer(candidate));
      for (const emit of peer.connections) emit("peers", peers);
    }
  }

  #findPeer(id) {
    const peer = this.peers.get(typeof id === "string" ? id : "");
    if (!peer) throw new TransferError(404, "设备不存在或已离线", "PEER_NOT_FOUND");
    return peer;
  }

  #authenticate(id, token) {
    const peer = this.#findPeer(id);
    const expected = Buffer.from(peer.token);
    const actual = Buffer.from(typeof token === "string" ? token : "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new TransferError(403, "设备凭证无效", "INVALID_PEER_TOKEN");
    }
    return peer;
  }

  #publicPeer({ id, name, deviceType }) {
    return { id, name, deviceType };
  }

  #scheduleRemoval(peer, delay) {
    const remove = () => {
      if (peer.connections.size > 0) return;
      this.peers.delete(peer.id);
      this.#broadcastPeers();
    };
    if (delay === 0) remove();
    else {
      peer.disconnectTimer = setTimeout(remove, delay);
      peer.disconnectTimer.unref();
    }
  }

  #uniqueName(baseName) {
    const names = new Set([...this.peers.values()].map((peer) => peer.name));
    if (!names.has(baseName)) return baseName;
    let suffix = 2;
    while (names.has(`${baseName} ${suffix}`)) suffix += 1;
    return `${baseName} ${suffix}`;
  }
}

function sanitizeName(input) {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
    return "未知设备";
  }
  return name;
}

function validatePayload(type, input) {
  if (type === "text") {
    const text = typeof input?.text === "string" ? input.text : "";
    if (!text.trim() || text.length > 10_000) {
      throw new TransferError(400, "文字内容无效", "INVALID_TEXT");
    }
    return { text };
  }

  const code = typeof input?.code === "string" ? input.code.toUpperCase() : "";
  if (!/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(code)) {
    throw new TransferError(400, "传输码无效", "INVALID_TRANSFER_CODE");
  }
  return { code };
}
