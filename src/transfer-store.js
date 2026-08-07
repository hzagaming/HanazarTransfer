import { randomBytes, timingSafeEqual } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export class TransferError extends Error {
  constructor(status, message, code = "TRANSFER_ERROR") {
    super(message);
    this.name = "TransferError";
    this.status = status;
    this.code = code;
  }
}

export class TransferStore {
  constructor({
    rootDir,
    ttlMs = DEFAULT_TTL_MS,
    maxTransferBytes = DEFAULT_MAX_BYTES,
    maxFiles = 20,
    codeLength = 8,
    now = Date.now
  }) {
    if (!rootDir) throw new TypeError("rootDir is required");

    this.rootDir = rootDir;
    this.ttlMs = ttlMs;
    this.maxTransferBytes = maxTransferBytes;
    this.maxFiles = maxFiles;
    this.codeLength = codeLength;
    this.now = now;
    this.transfers = new Map();
    this.cleanupTimer = null;
  }

  async init() {
    await mkdir(this.rootDir, { recursive: true });
    const interval = Math.max(1_000, Math.min(this.ttlMs, 60_000));
    this.cleanupTimer = setInterval(() => void this.sweepExpired(), interval);
    this.cleanupTimer.unref();
  }

  async close() {
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  createTransfer(inputFiles) {
    const files = this.#validateFiles(inputFiles);
    const code = this.#createCode();
    const createdAt = this.now();
    const transfer = {
      code,
      uploadToken: randomBytes(32).toString("hex"),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      files: files.map((file) => ({
        ...file,
        id: randomBytes(8).toString("hex"),
        uploaded: false,
        uploading: false
      }))
    };

    mkdirSync(join(this.rootDir, code), { recursive: true });
    this.transfers.set(code, transfer);
    return this.#serialize(transfer, true);
  }

  getTransfer(inputCode) {
    return this.#serialize(this.#getActive(inputCode));
  }

  async saveFile({ code: inputCode, fileId, uploadToken, contentLength, source }) {
    const transfer = this.#getActive(inputCode);
    this.#assertToken(transfer, uploadToken);

    const file = transfer.files.find((candidate) => candidate.id === fileId);
    if (!file) throw new TransferError(404, "文件不存在", "FILE_NOT_FOUND");
    if (file.uploaded) throw new TransferError(409, "文件已上传", "ALREADY_UPLOADED");
    if (file.uploading) throw new TransferError(409, "文件正在上传", "UPLOAD_IN_PROGRESS");
    if (contentLength !== file.size) {
      throw new TransferError(400, "上传大小与文件信息不一致", "SIZE_MISMATCH");
    }

    const directory = join(this.rootDir, transfer.code);
    const partialPath = join(directory, `${file.id}.part`);
    const finalPath = join(directory, file.id);
    let received = 0;
    file.uploading = true;

    const counter = new Transform({
      transform(chunk, encoding, callback) {
        received += Buffer.byteLength(chunk, encoding);
        if (received > file.size) {
          callback(new TransferError(400, "上传内容超过声明大小", "SIZE_MISMATCH"));
          return;
        }
        callback(null, chunk);
      },
      flush(callback) {
        if (received !== file.size) {
          callback(new TransferError(400, "上传内容不完整", "SIZE_MISMATCH"));
          return;
        }
        callback();
      }
    });

    try {
      await pipeline(source, counter, createWriteStream(partialPath, { flags: "wx" }));
      await rename(partialPath, finalPath);
      file.uploaded = true;
      return this.#serialize(transfer);
    } catch (error) {
      await rm(partialPath, { force: true });
      if (error instanceof TransferError) throw error;
      throw new TransferError(500, "文件保存失败", "WRITE_FAILED");
    } finally {
      file.uploading = false;
    }
  }

  openFile(inputCode, fileId) {
    const transfer = this.#getActive(inputCode);
    const file = transfer.files.find((candidate) => candidate.id === fileId);
    if (!file?.uploaded) throw new TransferError(404, "文件不存在", "FILE_NOT_FOUND");

    return {
      path: join(this.rootDir, transfer.code, file.id),
      name: file.name,
      size: file.size,
      type: file.type
    };
  }

  async deleteTransfer(inputCode, uploadToken) {
    const transfer = this.#getActive(inputCode);
    this.#assertToken(transfer, uploadToken);
    this.transfers.delete(transfer.code);
    await rm(join(this.rootDir, transfer.code), { recursive: true, force: true });
  }

  async sweepExpired() {
    const expired = [];
    for (const transfer of this.transfers.values()) {
      if (transfer.expiresAt <= this.now()) expired.push(transfer);
    }

    await Promise.all(expired.map(async (transfer) => {
      this.transfers.delete(transfer.code);
      await rm(join(this.rootDir, transfer.code), { recursive: true, force: true });
    }));
  }

  #getActive(inputCode) {
    const code = normalizeCode(inputCode);
    const transfer = this.transfers.get(code);
    if (!transfer || transfer.expiresAt <= this.now()) {
      if (transfer) {
        this.transfers.delete(code);
        void rm(join(this.rootDir, code), { recursive: true, force: true });
      }
      throw new TransferError(404, "传输码不存在或已过期", "TRANSFER_NOT_FOUND");
    }
    return transfer;
  }

  #assertToken(transfer, inputToken) {
    const expected = Buffer.from(transfer.uploadToken);
    const actual = Buffer.from(typeof inputToken === "string" ? inputToken : "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new TransferError(403, "上传凭证无效", "INVALID_TOKEN");
    }
  }

  #createCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const bytes = randomBytes(this.codeLength);
      let code = "";
      for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (!this.transfers.has(code)) return code;
    }
    throw new TransferError(503, "暂时无法创建传输，请重试", "CODE_EXHAUSTED");
  }

  #validateFiles(inputFiles) {
    if (!Array.isArray(inputFiles) || inputFiles.length === 0) {
      throw new TransferError(400, "请至少选择一个文件", "NO_FILES");
    }
    if (inputFiles.length > this.maxFiles) {
      throw new TransferError(400, `一次最多发送 ${this.maxFiles} 个文件`, "TOO_MANY_FILES");
    }

    const files = inputFiles.map((input) => {
      const name = typeof input?.name === "string" ? input.name.trim() : "";
      if (!name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new TransferError(400, "文件名无效", "INVALID_FILE_NAME");
      }
      if (!Number.isSafeInteger(input.size) || input.size < 0) {
        throw new TransferError(400, "文件大小无效", "INVALID_FILE_SIZE");
      }

      const type = typeof input.type === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(input.type)
        ? input.type
        : "application/octet-stream";
      return { name, size: input.size, type };
    });

    const totalSize = files.reduce((total, file) => total + file.size, 0);
    if (!Number.isSafeInteger(totalSize) || totalSize > this.maxTransferBytes) {
      throw new TransferError(413, "文件总大小超过限制", "TRANSFER_TOO_LARGE");
    }
    return files;
  }

  #serialize(transfer, includeToken = false) {
    const result = {
      code: transfer.code,
      createdAt: new Date(transfer.createdAt).toISOString(),
      expiresAt: new Date(transfer.expiresAt).toISOString(),
      status: transfer.files.every((file) => file.uploaded) ? "ready" : "uploading",
      totalSize: transfer.files.reduce((total, file) => total + file.size, 0),
      files: transfer.files.map(({ id, name, size, type, uploaded }) => ({
        id,
        name,
        size,
        type,
        uploaded
      }))
    };
    if (includeToken) result.uploadToken = transfer.uploadToken;
    return result;
  }
}

export function normalizeCode(code) {
  return typeof code === "string" ? code.replace(/[^a-z0-9]/gi, "").toUpperCase() : "";
}
