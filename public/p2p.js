export const SIGNAL_PREFIX = "HT1.";
export const DEFAULT_CHUNK_BYTES = 16 * 1024;

const MAX_SIGNAL_LENGTH = 200_000;
const MAX_FILES = 20;
const MAX_BATCH_BYTES = 512 * 1024 ** 2;
const MAX_SESSION_BYTES = 1024 ** 3;
const MAX_TEXT_LENGTH = 10_000;
const BUFFER_HIGH_WATER = 512 * 1024;
const BUFFER_LOW_WATER = 64 * 1024;
const ACK_TIMEOUT_MS = 60_000;
const CONNECTION_TIMEOUT_MS = 30_000;
const SOUND_STORAGE_KEY = "hanazar-sound";
const PROTOCOL_VERSION = 1;

export function encodeSignal(description) {
  const normalized = normalizeDescription(description);
  const bytes = new TextEncoder().encode(JSON.stringify({ v: PROTOCOL_VERSION, ...normalized }));
  let binary = "";
  for (let index = 0; index < bytes.length; index += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 16_384));
  }
  return `${SIGNAL_PREFIX}${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")}`;
}

export function decodeSignal(input) {
  if (typeof input !== "string") throw new Error("连接信息无效");
  let value = input.trim();
  if (value.length > MAX_SIGNAL_LENGTH) throw new Error("连接信息过长");

  try {
    if (/^https?:\/\//iu.test(value)) {
      const url = new URL(value);
      value = new URLSearchParams(url.hash.slice(1)).get("p2p") || "";
    } else if (value.startsWith("#") || value.startsWith("p2p=")) {
      value = new URLSearchParams(value.replace(/^#/u, "")).get("p2p") || "";
    }
    if (!value.startsWith(SIGNAL_PREFIX)) throw new Error();
    const encoded = value.slice(SIGNAL_PREFIX.length);
    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (payload.v !== PROTOCOL_VERSION) throw new Error();
    return normalizeDescription(payload);
  } catch (error) {
    if (error.message === "连接信息过长") throw error;
    throw new Error("连接信息无效或已损坏");
  }
}

export function buildInviteUrl(baseUrl, signal) {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = `p2p=${signal}`;
  return url.href;
}

export function resolveChunkSize(maxMessageSize) {
  const negotiated = Number(maxMessageSize);
  if (!Number.isFinite(negotiated) || negotiated <= 0) return DEFAULT_CHUNK_BYTES;
  return Math.max(1, Math.min(DEFAULT_CHUNK_BYTES, Math.floor(negotiated)));
}

export function validateFileBatch(fileList, { maxFiles = MAX_FILES, maxBytes = MAX_BATCH_BYTES } = {}) {
  const files = Array.from(fileList || []);
  if (!files.length) throw new Error("请选择文件");
  if (files.length > maxFiles) throw new Error(`一次最多选择 ${maxFiles} 个文件`);
  let totalBytes = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file?.size) || file.size < 0) throw new Error("文件大小无效");
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) {
      throw new Error(`文件总大小不能超过 ${formatBytes(maxBytes)}`);
    }
  }
  return { count: files.length, totalBytes };
}

export function waitForIceComplete(connection, timeoutMs = 12_000) {
  if (connection.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(() => reject(new Error("网络候选收集超时，请重试"))), timeoutMs);
    const onState = () => {
      if (connection.iceGatheringState === "complete") finish(resolve);
    };
    const onCandidate = (event) => {
      if (event.candidate === null) finish(resolve);
    };
    const onClosed = () => {
      if (connection.signalingState === "closed") finish(() => reject(abortError("配对已取消")));
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection.removeEventListener("icegatheringstatechange", onState);
      connection.removeEventListener("icecandidate", onCandidate);
      connection.removeEventListener("signalingstatechange", onClosed);
      callback();
    };
    connection.addEventListener("icegatheringstatechange", onState);
    connection.addEventListener("icecandidate", onCandidate);
    connection.addEventListener("signalingstatechange", onClosed);
  });
}

function normalizeDescription(value) {
  if (!value || !new Set(["offer", "answer"]).has(value.type)) throw new Error("不支持的连接类型");
  if (typeof value.sdp !== "string" || !value.sdp || value.sdp.length > 150_000) throw new Error("连接信息无效");
  return { type: value.type, sdp: value.sdp };
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

if (typeof document !== "undefined") boot();

function boot() {
  const elements = Object.fromEntries([
    "p2p-sound-toggle", "p2p-sound-label", "p2p-header-status", "p2p-state-copy", "p2p-setup", "p2p-unsupported",
    "p2p-imported", "p2p-role-actions", "p2p-create", "p2p-join", "p2p-host-flow", "p2p-invite-output",
    "p2p-copy-invite", "p2p-share-invite", "p2p-host-answer-form", "p2p-host-answer-input", "p2p-apply-answer",
    "p2p-join-flow", "p2p-join-form", "p2p-invite-input", "p2p-generate-answer", "p2p-answer-output-wrap",
    "p2p-answer-output", "p2p-copy-answer", "p2p-share-answer", "p2p-reset", "p2p-workspace",
    "p2p-connection-banner", "p2p-workspace-title", "p2p-remote-name", "p2p-drop-zone", "p2p-file-input",
    "p2p-selected-files", "p2p-clear-files", "p2p-file-list", "p2p-send-progress", "p2p-send-progress-label",
    "p2p-send-progress-value", "p2p-send-files", "p2p-cancel-send", "p2p-receive-progress",
    "p2p-receive-progress-label", "p2p-receive-progress-value", "p2p-text-form", "p2p-text-input",
    "p2p-send-text", "p2p-clear-activity", "p2p-activity-empty", "p2p-activity-list", "p2p-disconnect", "p2p-toast"
  ].map((id) => [id.replace(/^p2p-/u, "").replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()), document.getElementById(id)]));

  let connection = null;
  let channel = null;
  let selectedFiles = [];
  let sending = false;
  let sendController = null;
  let activeSendId = null;
  let incoming = null;
  let receiveQueue = Promise.resolve();
  let intentionalClose = false;
  let disconnectTimer = null;
  let connectionTimer = null;
  let pairingGeneration = 0;
  let soundEnabled = false;
  let audioContext = null;
  let toastTimer = null;
  let remoteName = "另一台设备";
  let receivedBytes = 0;
  const acknowledgements = new Map();
  const activity = [];

  restoreSoundPreference();
  bindEvents();
  resetPairing();

  if (!("RTCPeerConnection" in window)) {
    elements.unsupported.hidden = false;
    elements.roleActions.hidden = true;
    setState("error", "浏览器不支持");
    return;
  }

  importInviteFromHash();

  function bindEvents() {
    elements.soundToggle.addEventListener("click", toggleSound);
    elements.create.addEventListener("click", () => void startHost());
    elements.join.addEventListener("click", showJoinFlow);
    elements.reset.addEventListener("click", () => resetPairing(true));
    elements.copyInvite.addEventListener("click", () => void copySignal(elements.inviteOutput.value, "邀请链接已复制"));
    elements.shareInvite.addEventListener("click", () => void shareSignal("Hanazar P2P 邀请", elements.inviteOutput.value, true));
    elements.hostAnswerForm.addEventListener("submit", (event) => void applyAnswer(event));
    elements.joinForm.addEventListener("submit", (event) => void createAnswer(event));
    elements.copyAnswer.addEventListener("click", () => void copySignal(elements.answerOutput.value, "回复码已复制"));
    elements.shareAnswer.addEventListener("click", () => void shareSignal("Hanazar P2P 回复码", elements.answerOutput.value));
    elements.fileInput.addEventListener("change", () => selectFiles(elements.fileInput.files));
    elements.dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!isConnected() || sending) return;
      elements.dropZone.classList.add("dragging");
    });
    elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("dragging"));
    elements.dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("dragging");
      if (!isConnected() || sending) return;
      selectFiles(event.dataTransfer.files);
    });
    elements.clearFiles.addEventListener("click", clearFiles);
    elements.sendFiles.addEventListener("click", () => void sendSelectedFiles());
    elements.cancelSend.addEventListener("click", cancelSend);
    elements.textForm.addEventListener("submit", sendText);
    elements.clearActivity.addEventListener("click", clearActivity);
    elements.disconnect.addEventListener("click", () => returnToPairing("已断开当前连接"));
    window.addEventListener("hashchange", importInviteFromHash);
    window.addEventListener("pagehide", (event) => {
      if (event.persisted) return;
      closePeer();
      clearActivity();
    });
  }

  function importInviteFromHash() {
    if (!location.hash.includes("p2p=")) return;
    try {
      const offer = decodeSignal(location.href);
      if (offer.type !== "offer") throw new Error("邀请中不包含有效的发起信息");
      showJoinFlow();
      elements.inviteInput.value = encodeSignal(offer);
      elements.imported.hidden = false;
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    } catch {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      showToast("邀请链接无效，请让对方重新生成", true);
    }
  }

  async function startHost() {
    setButtonBusy(elements.create, true, "正在生成…");
    elements.imported.hidden = true;
    let generation;
    try {
      closePeer();
      generation = pairingGeneration;
      connection = createPeer();
      configureChannel(connection.createDataChannel("hanazar-transfer", { ordered: true }));
      setState("connecting", "正在收集连接信息");
      await connection.setLocalDescription(await connection.createOffer());
      await waitForIceComplete(connection);
      if (generation !== pairingGeneration) return;
      const signal = encodeSignal(connection.localDescription);
      elements.inviteOutput.value = buildInviteUrl(location.href, signal);
      elements.roleActions.hidden = true;
      elements.hostFlow.hidden = false;
      elements.joinFlow.hidden = true;
      elements.reset.hidden = false;
      setState("waiting", "等待对方回复");
      elements.copyInvite.focus();
    } catch (error) {
      if (generation !== pairingGeneration || error.name === "AbortError") return;
      closePeer();
      setState("error", "邀请生成失败");
      showToast(friendlyError(error, "无法生成邀请，请重试"), true);
    } finally {
      setButtonBusy(elements.create, false, "发起连接");
    }
  }

  function showJoinFlow() {
    closePeer();
    showSetupAndHistory();
    setTransferEnabled(false);
    elements.roleActions.hidden = true;
    elements.hostFlow.hidden = true;
    elements.joinFlow.hidden = false;
    elements.answerOutputWrap.hidden = true;
    elements.reset.hidden = false;
    setState("idle", "等待邀请");
    elements.inviteInput.focus();
  }

  async function createAnswer(event) {
    event.preventDefault();
    setButtonBusy(elements.generateAnswer, true, "正在生成…");
    let generation;
    try {
      const offer = decodeSignal(elements.inviteInput.value);
      if (offer.type !== "offer") throw new Error("请粘贴发起设备生成的邀请");
      closePeer();
      generation = pairingGeneration;
      connection = createPeer();
      await connection.setRemoteDescription(offer);
      await connection.setLocalDescription(await connection.createAnswer());
      setState("connecting", "正在收集连接信息");
      await waitForIceComplete(connection);
      if (generation !== pairingGeneration) return;
      elements.answerOutput.value = encodeSignal(connection.localDescription);
      elements.answerOutputWrap.hidden = false;
      elements.imported.hidden = true;
      setState("waiting", "等待对方完成连接");
      elements.copyAnswer.focus();
    } catch (error) {
      if ((generation !== undefined && generation !== pairingGeneration) || error.name === "AbortError") return;
      closePeer();
      setState("error", "回复生成失败");
      showToast(friendlyError(error, "无法读取邀请，请让对方重新生成"), true);
    } finally {
      setButtonBusy(elements.generateAnswer, false, "生成回复码");
    }
  }

  async function applyAnswer(event) {
    event.preventDefault();
    setButtonBusy(elements.applyAnswer, true, "正在连接…");
    let peer;
    try {
      if (!connection) throw new Error("邀请已失效，请重新发起连接");
      peer = connection;
      const answer = decodeSignal(elements.hostAnswerInput.value);
      if (answer.type !== "answer") throw new Error("请粘贴加入设备生成的回复码");
      await connection.setRemoteDescription(answer);
      if (peer !== connection) return;
      setState("connecting", "正在建立直连");
      clearTimeout(connectionTimer);
      connectionTimer = setTimeout(() => {
        if (peer === connection && !isConnected()) returnToPairing("直连超时，请确认在同一 Wi-Fi 后重试", true);
      }, CONNECTION_TIMEOUT_MS);
    } catch (error) {
      if (peer && peer !== connection) return;
      setState("error", "连接信息不匹配");
      showToast(friendlyError(error, "回复码无效，请重新复制"), true);
    } finally {
      setButtonBusy(elements.applyAnswer, false, "完成连接");
    }
  }

  function createPeer() {
    intentionalClose = false;
    const peer = new RTCPeerConnection({ iceServers: [] });
    peer.addEventListener("datachannel", (event) => configureChannel(event.channel));
    peer.addEventListener("connectionstatechange", () => handleConnectionState(peer));
    return peer;
  }

  function configureChannel(nextChannel) {
    channel?.close();
    channel = nextChannel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
    channel.addEventListener("open", () => {
      if (channel === nextChannel) handleConnected();
    });
    channel.addEventListener("close", () => {
      if (channel === nextChannel && !intentionalClose) returnToPairing("设备连接已断开", true);
    });
    channel.addEventListener("error", () => {
      if (channel === nextChannel) showToast("P2P 通道发生错误，请重新连接", true);
    });
    channel.addEventListener("message", (event) => {
      if (channel !== nextChannel) return;
      receiveQueue = receiveQueue
        .then(() => {
          if (channel !== nextChannel) return;
          return handleIncomingData(event.data, nextChannel);
        })
        .catch((error) => {
          if (channel !== nextChannel) return;
          showToast(friendlyError(error, "收到无效的传输数据，连接已断开"), true);
          returnToPairing("传输协议错误", true);
        });
    });
  }

  function handleConnectionState(peer) {
    if (peer !== connection) return;
    clearTimeout(disconnectTimer);
    if (peer.connectionState === "failed") returnToPairing("直连失败，请确认在同一 Wi-Fi 后重试", true);
    if (peer.connectionState === "disconnected") {
      setState("connecting", "连接暂时中断");
      disconnectTimer = setTimeout(() => {
        if (peer === connection && peer.connectionState === "disconnected") returnToPairing("连接已中断，请重新配对", true);
      }, 8_000);
    }
    if (peer.connectionState === "connected" && isConnected()) setState("connected", "设备已直连");
  }

  function handleConnected() {
    clearTimeout(connectionTimer);
    connectionTimer = null;
    elements.setup.hidden = true;
    elements.workspace.hidden = false;
    elements.connectionBanner.classList.remove("disconnected");
    elements.workspaceTitle.textContent = "设备已直连";
    elements.remoteName.textContent = "正在识别另一台设备…";
    setState("connected", "设备已直连");
    setTransferEnabled(true);
    sendControl({ t: "hello", name: detectDeviceName() });
    showToast("P2P 连接成功，可以开始传输");
    void playSound("success");
    focusRegion(elements.workspace);
  }

  function returnToPairing(message, isError = false) {
    closePeer();
    showSetupAndHistory();
    elements.roleActions.hidden = false;
    elements.hostFlow.hidden = true;
    elements.joinFlow.hidden = true;
    elements.reset.hidden = true;
    setTransferEnabled(false);
    setState(isError ? "error" : "idle", isError ? "需要重新配对" : "等待配对");
    if (message) showToast(message, isError);
    focusRegion(elements.setup);
  }

  function resetPairing(shouldFocus = false) {
    closePeer();
    showSetupAndHistory();
    elements.roleActions.hidden = false;
    elements.hostFlow.hidden = true;
    elements.joinFlow.hidden = true;
    elements.answerOutputWrap.hidden = true;
    elements.reset.hidden = true;
    elements.imported.hidden = true;
    elements.inviteOutput.value = "";
    elements.hostAnswerInput.value = "";
    elements.inviteInput.value = "";
    elements.answerOutput.value = "";
    setTransferEnabled(false);
    setState("idle", "等待配对");
    if (shouldFocus) focusRegion(elements.setup);
  }

  function showSetupAndHistory() {
    elements.setup.hidden = false;
    elements.workspace.hidden = activity.length === 0;
    if (elements.workspace.hidden) return;
    elements.connectionBanner.classList.add("disconnected");
    elements.workspaceTitle.textContent = "连接已断开";
    elements.remoteName.textContent = "传输记录仍可下载，请重新配对后继续";
  }

  function closePeer() {
    pairingGeneration += 1;
    intentionalClose = true;
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
    clearTimeout(connectionTimer);
    connectionTimer = null;
    channel?.close();
    connection?.close();
    channel = null;
    connection = null;
    incoming = null;
    receiveQueue = Promise.resolve();
    for (const waiter of acknowledgements.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(abortError("连接已断开"));
    }
    acknowledgements.clear();
    sending = false;
    sendController?.abort(new Error("设备连接已断开"));
    sendController = null;
    activeSendId = null;
    renderFiles();
    hideProgress(elements.sendProgress);
    hideProgress(elements.receiveProgress);
  }

  function selectFiles(fileList) {
    if (sending) return;
    try {
      const next = [...selectedFiles];
      for (const file of Array.from(fileList || [])) {
        if (!next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file);
      }
      validateFileBatch(next);
      selectedFiles = next;
      elements.fileInput.value = "";
      renderFiles();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function renderFiles() {
    elements.fileList.replaceChildren();
    selectedFiles.forEach((file, index) => {
      const item = document.createElement("li");
      item.className = "file-item";
      const type = document.createElement("span");
      type.className = "file-type";
      type.textContent = fileExtension(file.name);
      const details = document.createElement("div");
      details.className = "file-details";
      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = file.name;
      name.title = file.name;
      const size = document.createElement("span");
      size.className = "file-size";
      size.textContent = formatBytes(file.size);
      details.append(name, size);
      const remove = document.createElement("button");
      remove.className = "remove-file";
      remove.type = "button";
      remove.textContent = "×";
      remove.disabled = sending;
      remove.setAttribute("aria-label", `移除 ${file.name}`);
      remove.addEventListener("click", () => {
        selectedFiles.splice(index, 1);
        renderFiles();
        if (!selectedFiles.length) elements.fileInput.focus();
      });
      item.append(type, details, remove);
      elements.fileList.append(item);
    });
    elements.selectedFiles.hidden = selectedFiles.length === 0;
    elements.fileInput.disabled = !isConnected() || sending;
    elements.dropZone.setAttribute("aria-disabled", String(!isConnected() || sending));
    elements.sendFiles.disabled = !isConnected() || !selectedFiles.length || sending;
    elements.clearFiles.disabled = sending;
  }

  function clearFiles() {
    if (sending) return;
    selectedFiles = [];
    renderFiles();
    elements.fileInput.focus();
  }

  async function sendSelectedFiles() {
    if (!isConnected() || sending) return;
    try {
      validateFileBatch(selectedFiles);
    } catch (error) {
      showToast(error.message, true);
      return;
    }
    sending = true;
    const controller = new AbortController();
    const { signal } = controller;
    sendController = controller;
    elements.cancelSend.hidden = false;
    elements.cancelSend.disabled = false;
    renderFiles();
    const totalBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
    let completedBytes = 0;
    showProgress(elements.sendProgress, elements.sendProgressLabel, elements.sendProgressValue, 0, "准备发送");

    try {
      for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex += 1) {
        const file = selectedFiles[fileIndex];
        const id = createId();
        activeSendId = id;
        elements.cancelSend.disabled = false;
        elements.cancelSend.textContent = "取消本次发送";
        sendControl({ t: "file-start", id, name: file.name, size: file.size, type: safeMime(file.type) });
        await expectAcknowledgement(id, "file-ready", signal);
        const chunkSize = resolveChunkSize(connection?.sctp?.maxMessageSize);
        let offset = 0;
        while (offset < file.size) {
          throwIfAborted(signal);
          await waitForWritable(signal);
          const end = Math.min(offset + chunkSize, file.size);
          const chunk = await file.slice(offset, end).arrayBuffer();
          throwIfAborted(signal);
          channel.send(chunk);
          offset = end;
          const percent = totalBytes ? Math.round(((completedBytes + offset) / totalBytes) * 100) : 100;
          showProgress(elements.sendProgress, elements.sendProgressLabel, elements.sendProgressValue, percent, `正在发送 ${fileIndex + 1} / ${selectedFiles.length}`);
        }
        throwIfAborted(signal);
        elements.cancelSend.disabled = true;
        elements.cancelSend.textContent = "正在确认送达…";
        sendControl({ t: "file-end", id });
        await expectAcknowledgement(id, "file-ack");
        activeSendId = null;
        completedBytes += file.size;
        addFileActivity(file.name, file.size, "outgoing");
      }
      showProgress(elements.sendProgress, elements.sendProgressLabel, elements.sendProgressValue, 100, "发送完成");
      selectedFiles = [];
      renderFiles();
      showToast("文件已送达另一台设备");
      void playSound("success");
      focusRegion(elements.workspace);
    } catch (error) {
      if (activeSendId && isConnected()) {
        try { sendControl({ t: "file-cancel", id: activeSendId }); } catch {}
      }
      showToast(error.name === "AbortError" ? error.message : friendlyError(error, "文件发送失败，请重新连接后重试"), error.name !== "AbortError");
    } finally {
      sending = false;
      sendController = null;
      activeSendId = null;
      elements.cancelSend.hidden = true;
      elements.cancelSend.disabled = false;
      elements.cancelSend.textContent = "取消本次发送";
      renderFiles();
      setTimeout(() => {
        if (!sending) hideProgress(elements.sendProgress);
      }, 1_200);
    }
  }

  function cancelSend() {
    if (!sending || elements.cancelSend.disabled || sendController?.signal.aborted) return;
    sendController.abort(abortError("发送已取消"));
    elements.cancelSend.disabled = true;
    elements.cancelSend.textContent = "正在取消…";
  }

  async function waitForWritable(signal) {
    throwIfAborted(signal);
    if (!isConnected()) throw new Error("设备连接已断开");
    const activeChannel = channel;
    if (activeChannel.bufferedAmount <= BUFFER_HIGH_WATER) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(() => reject(new Error("发送缓冲区长时间无响应"))), 30_000);
      const onLow = () => finish(resolve);
      const onClose = () => finish(() => reject(new Error("设备连接已断开")));
      const onAbort = () => finish(() => reject(abortReason(signal)));
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeChannel.removeEventListener("bufferedamountlow", onLow);
        activeChannel.removeEventListener("close", onClose);
        signal.removeEventListener("abort", onAbort);
        callback();
      };
      activeChannel.addEventListener("bufferedamountlow", onLow);
      activeChannel.addEventListener("close", onClose);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  function expectAcknowledgement(id, expected, signal) {
    return new Promise((resolve, reject) => {
      let waiter;
      const finish = (callback) => {
        if (acknowledgements.get(id) !== waiter) return;
        clearTimeout(waiter.timer);
        signal?.removeEventListener("abort", waiter.onAbort);
        acknowledgements.delete(id);
        callback();
      };
      const onAbort = () => waiter.reject(abortReason(signal));
      waiter = {
        expected,
        onAbort,
        resolve: () => finish(resolve),
        reject: (error) => finish(() => reject(error)),
        timer: null
      };
      waiter.timer = setTimeout(() => waiter.reject(new Error("接收设备未确认文件，请重试")), ACK_TIMEOUT_MS);
      acknowledgements.set(id, waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  async function handleIncomingData(data, sourceChannel) {
    if (typeof data === "string") {
      if (data.length > 64 * 1024) throw new Error("收到过大的控制消息");
      let message;
      try { message = JSON.parse(data); } catch { throw new Error("收到无法识别的控制消息"); }
      if (message?.v !== PROTOCOL_VERSION || typeof message.t !== "string") throw new Error("传输协议版本不匹配");
      return handleControl(message);
    }
    const buffer = await readActiveChannelData(data, () => channel === sourceChannel);
    if (buffer === null || channel !== sourceChannel) return;
    if (!(buffer instanceof ArrayBuffer) || !incoming) throw new Error("收到顺序异常的文件数据");
    if (incoming.received + buffer.byteLength > incoming.size) throw new Error("收到的文件大小超过声明值");
    incoming.parts.push(buffer);
    incoming.received += buffer.byteLength;
    const percent = incoming.size ? Math.round((incoming.received / incoming.size) * 100) : 100;
    showProgress(elements.receiveProgress, elements.receiveProgressLabel, elements.receiveProgressValue, percent, `正在接收 ${incoming.name}`);
  }

  function handleControl(message) {
    if (message.t === "hello") {
      remoteName = normalizeDeviceName(message.name);
      elements.remoteName.textContent = `${remoteName} 已连接`;
      return;
    }
    if (message.t === "text") {
      if (typeof message.text !== "string" || !message.text.trim() || message.text.length > MAX_TEXT_LENGTH) throw new Error("收到无效文字消息");
      addTextActivity(message.text, "incoming");
      showToast(`${remoteName} 发来文字`);
      void playSound("incoming");
      return;
    }
    if (message.t === "file-start") return startIncomingFile(message);
    if (message.t === "file-end") return finishIncomingFile(message.id);
    if (message.t === "file-cancel") return cancelIncomingFile(message.id);
    if (message.t === "file-ready" || message.t === "file-ack" || message.t === "file-reject") return settleAcknowledgement(message);
    throw new Error("收到未知的传输指令");
  }

  function startIncomingFile(message) {
    if (incoming) throw new Error("同时收到多个文件流");
    if (!validId(message.id) || typeof message.name !== "string" || !Number.isSafeInteger(message.size) || message.size < 0) {
      throw new Error("收到无效的文件信息");
    }
    if (message.size > MAX_BATCH_BYTES || receivedBytes + message.size > MAX_SESSION_BYTES) {
      sendControl({ t: "file-reject", id: message.id, reason: "接收端可用内存不足，请清空记录或缩小文件" });
      return;
    }
    incoming = {
      id: message.id,
      name: normalizeFilename(message.name),
      size: message.size,
      type: safeMime(message.type),
      received: 0,
      parts: []
    };
    sendControl({ t: "file-ready", id: message.id });
    showProgress(elements.receiveProgress, elements.receiveProgressLabel, elements.receiveProgressValue, 0, `正在接收 ${incoming.name}`);
  }

  function finishIncomingFile(id) {
    if (!incoming || incoming.id !== id || incoming.received !== incoming.size) throw new Error("文件接收不完整");
    const file = incoming;
    incoming = null;
    const blob = new Blob(file.parts, { type: file.type });
    const url = URL.createObjectURL(blob);
    receivedBytes += file.size;
    addFileActivity(file.name, file.size, "incoming", url);
    hideProgress(elements.receiveProgress);
    sendControl({ t: "file-ack", id: file.id });
    showToast(`${file.name} 已接收`);
    void playSound("incoming");
  }

  function cancelIncomingFile(id) {
    if (!incoming || incoming.id !== id) return;
    const name = incoming.name;
    incoming = null;
    hideProgress(elements.receiveProgress);
    showToast(`${name} 的发送已取消`);
  }

  function settleAcknowledgement(message) {
    const waiter = acknowledgements.get(message.id);
    if (!waiter) return;
    if (message.t !== waiter.expected && message.t !== "file-reject") return;
    if (message.t === waiter.expected) waiter.resolve();
    else waiter.reject(new Error(typeof message.reason === "string" ? message.reason.slice(0, 120) : "接收设备拒绝了文件"));
  }

  function sendText(event) {
    event.preventDefault();
    const text = elements.textInput.value;
    if (!isConnected()) return showToast("请先连接另一台设备", true);
    if (!text.trim()) return showToast("请输入要发送的文字", true);
    sendControl({ t: "text", text });
    addTextActivity(text, "outgoing");
    elements.textInput.value = "";
    showToast("文字已发送");
    void playSound("confirm");
  }

  function sendControl(payload) {
    if (!isConnected()) throw new Error("设备连接已断开");
    channel.send(JSON.stringify({ v: PROTOCOL_VERSION, ...payload }));
  }

  function addFileActivity(name, size, direction, url = null) {
    const item = createActivityItem(direction, "FILE", name, `${direction === "incoming" ? "已接收" : "已发送"} · ${formatBytes(size)}`);
    let action;
    if (url) {
      action = document.createElement("a");
      action.href = url;
      action.download = name;
      action.textContent = "下载";
      action.setAttribute("aria-label", `下载 ${name}`);
    } else {
      action = document.createElement("span");
      action.textContent = "已送达";
    }
    action.className = "p2p-activity-action";
    if (!url) action.classList.add("delivered");
    item.node.append(action);
    pushActivity({ ...item, url, size: url ? size : 0 });
  }

  function addTextActivity(text, direction) {
    const item = createActivityItem(direction, "TXT", direction === "incoming" ? `${remoteName} 发来文字` : "已发送文字", text);
    const action = document.createElement("button");
    action.className = "p2p-activity-action";
    action.type = "button";
    action.textContent = "复制";
    action.addEventListener("click", () => void copySignal(text, "文字已复制"));
    item.node.append(action);
    pushActivity({ ...item, url: null, size: 0 });
  }

  function createActivityItem(direction, iconText, titleText, metaText) {
    const node = document.createElement("li");
    node.className = `p2p-activity-item ${direction}`;
    const icon = document.createElement("span");
    icon.className = "p2p-activity-icon";
    icon.textContent = iconText;
    const copy = document.createElement("div");
    copy.className = "p2p-activity-copy";
    const title = document.createElement("b");
    title.textContent = titleText;
    title.title = titleText;
    const meta = document.createElement("small");
    meta.textContent = metaText;
    copy.append(title, meta);
    node.append(icon, copy);
    return { node };
  }

  function pushActivity(record) {
    activity.push(record);
    elements.activityList.append(record.node);
    while (activity.length > 50) removeActivity(activity.shift());
    elements.activityEmpty.hidden = true;
    elements.clearActivity.hidden = false;
  }

  function clearActivity() {
    for (const record of activity.splice(0)) removeActivity(record);
    elements.activityList.replaceChildren();
    elements.activityEmpty.hidden = false;
    elements.clearActivity.hidden = true;
    receivedBytes = 0;
    if (!isConnected() && elements.setup.hidden === false) elements.workspace.hidden = true;
    focusRegion(elements.workspace.hidden ? elements.setup : elements.workspace);
  }

  function removeActivity(record) {
    record.node.remove();
    if (record.url) {
      URL.revokeObjectURL(record.url);
      receivedBytes = Math.max(0, receivedBytes - record.size);
    }
  }

  function setTransferEnabled(enabled) {
    elements.fileInput.disabled = !enabled || sending;
    elements.dropZone.setAttribute("aria-disabled", String(!enabled || sending));
    elements.textInput.disabled = !enabled;
    elements.sendText.disabled = !enabled;
    elements.disconnect.disabled = !enabled;
    renderFiles();
  }

  function isConnected() {
    return channel?.readyState === "open";
  }

  function setState(state, label) {
    elements.headerStatus.className = `server-status p2p-status ${state}`;
    elements.headerStatus.lastElementChild.textContent = label;
    elements.stateCopy.textContent = label;
  }

  function showProgress(container, label, value, percent, text) {
    const normalized = Math.max(0, Math.min(100, percent));
    container.hidden = false;
    container.setAttribute("aria-valuenow", String(normalized));
    container.querySelector("i").style.width = `${normalized}%`;
    label.textContent = text;
    value.textContent = `${normalized}%`;
  }

  function hideProgress(container) {
    container.hidden = true;
    container.setAttribute("aria-valuenow", "0");
    container.querySelector("i").style.width = "0%";
  }

  function focusRegion(element) {
    if (document.visibilityState !== "visible") return;
    requestAnimationFrame(() => {
      if (!element.hidden) element.focus();
    });
  }

  async function copySignal(text, successMessage) {
    try {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const helper = document.createElement("textarea");
        helper.value = text;
        helper.className = "clipboard-helper";
        document.body.append(helper);
        try {
          helper.select();
          if (!document.execCommand("copy")) throw new Error();
        } finally {
          helper.remove();
        }
      }
      showToast(successMessage);
    } catch {
      showToast("复制失败，请手动选择并复制", true);
    }
  }

  async function shareSignal(title, value, isUrl = false) {
    if (!navigator.share) return copySignal(value, "当前浏览器不支持分享，内容已复制");
    try {
      await navigator.share(isUrl ? { title, text: "打开链接后生成回复码", url: value } : { title, text: value });
    } catch (error) {
      if (error.name !== "AbortError") showToast("分享失败，请改用复制", true);
    }
  }

  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    elements.toast.className = "toast";
    elements.toast.textContent = "";
    elements.toast.setAttribute("role", isError ? "alert" : "status");
    elements.toast.setAttribute("aria-live", isError ? "assertive" : "polite");
    elements.toast.textContent = message;
    elements.toast.className = `toast show${isError ? " error" : ""}`;
    toastTimer = setTimeout(() => {
      elements.toast.className = "toast";
      elements.toast.textContent = "";
    }, 2_800);
  }

  function restoreSoundPreference() {
    try { soundEnabled = localStorage.getItem(SOUND_STORAGE_KEY) === "on"; } catch { soundEnabled = false; }
    updateSoundToggle();
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    try { localStorage.setItem(SOUND_STORAGE_KEY, soundEnabled ? "on" : "off"); } catch {}
    updateSoundToggle();
    if (soundEnabled) void playSound("confirm");
    else if (audioContext?.state === "running") void audioContext.suspend().catch(() => {});
  }

  function updateSoundToggle() {
    const label = soundEnabled ? "关闭提示音" : "开启提示音";
    elements.soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    elements.soundToggle.setAttribute("aria-label", label);
    elements.soundToggle.title = label;
    elements.soundLabel.textContent = soundEnabled ? "提示音开" : "提示音关";
  }

  async function playSound(type) {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioContext ||= new AudioContextClass();
      if (audioContext.state === "suspended") await audioContext.resume();
      const patterns = { confirm: [[520, 0]], incoming: [[480, 0], [650, 0.11]], success: [[540, 0], [720, 0.1]] };
      const start = audioContext.currentTime + 0.01;
      for (const [frequency, offset] of patterns[type] || patterns.confirm) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start + offset);
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.09, start + offset + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.09);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + 0.1);
      }
    } catch {}
  }
}

export async function readActiveChannelData(data, isActive) {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  return isActive() ? buffer : null;
}

function setButtonBusy(button, busy, label) {
  button.disabled = busy;
  button.classList.toggle("loading", busy);
  const target = button.matches(".p2p-role-button") ? button.querySelector("b") : button.querySelector("span") || button;
  target.textContent = label;
}

function friendlyError(error, fallback) {
  return /[\u3400-\u9fff]/u.test(error?.message || "") ? error.message : fallback;
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validId(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/iu.test(value);
}

function normalizeFilename(value) {
  const name = value.replace(/[\u0000-\u001f\u007f/\\]/gu, "_").slice(0, 255);
  return name || "download";
}

function normalizeDeviceName(value) {
  if (typeof value !== "string") return "另一台设备";
  return value.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 64) || "另一台设备";
}

function safeMime(value) {
  return typeof value === "string" && /^[\w.+-]+\/[\w.+-]+$/u.test(value) ? value.slice(0, 100) : "application/octet-stream";
}

function detectDeviceName() {
  const agent = navigator.userAgent;
  if (/iPhone/iu.test(agent)) return "iPhone";
  if (/iPad/iu.test(agent)) return "iPad";
  if (/Android/iu.test(agent)) return /Mobile/iu.test(agent) ? "Android 手机" : "Android 平板";
  if (/Macintosh/iu.test(agent)) return "Mac";
  if (/Windows/iu.test(agent)) return "Windows 电脑";
  if (/Linux/iu.test(agent)) return "Linux 电脑";
  return "浏览器设备";
}

function fileExtension(name) {
  const extension = name.includes(".") ? name.split(".").pop() : "FILE";
  return extension.slice(0, 4) || "FILE";
}

function abortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal.aborted) throw abortReason(signal);
}

function abortReason(signal) {
  return signal.reason instanceof Error ? signal.reason : abortError("发送已取消");
}
