const elements = {
  pageShell: document.querySelector(".page-shell"),
  soundToggle: document.querySelector("#sound-toggle"),
  soundLabel: document.querySelector("#sound-label"),
  sendTab: document.querySelector("#send-tab"),
  receiveTab: document.querySelector("#receive-tab"),
  sendPanel: document.querySelector("#send-panel"),
  receivePanel: document.querySelector("#receive-panel"),
  sendFormView: document.querySelector("#send-form-view"),
  sendResult: document.querySelector("#send-result"),
  dropZone: document.querySelector("#drop-zone"),
  fileInput: document.querySelector("#file-input"),
  selectedFiles: document.querySelector("#selected-files"),
  sendFileList: document.querySelector("#send-file-list"),
  clearFiles: document.querySelector("#clear-files"),
  sendButton: document.querySelector("#send-button"),
  cancelUpload: document.querySelector("#cancel-upload"),
  transferCode: document.querySelector("#transfer-code"),
  shareLink: document.querySelector("#share-link"),
  copyLink: document.querySelector("#copy-link"),
  shareButton: document.querySelector("#share-button"),
  newTransfer: document.querySelector("#new-transfer"),
  expireCopy: document.querySelector("#expire-copy"),
  receiveForm: document.querySelector("#receive-form"),
  codeInput: document.querySelector("#code-input"),
  receiveButton: document.querySelector("#receive-button"),
  receiveResult: document.querySelector("#receive-result"),
  receiveIcon: document.querySelector("#receive-icon"),
  receiveTitle: document.querySelector("#receive-title"),
  receiveMeta: document.querySelector("#receive-meta"),
  downloadList: document.querySelector("#download-list"),
  lookupAnother: document.querySelector("#lookup-another"),
  limitCopy: document.querySelector("#limit-copy"),
  ttlCopy: document.querySelector("#ttl-copy"),
  serverStatus: document.querySelector("#server-status"),
  staticNotice: document.querySelector("#static-notice"),
  toast: document.querySelector("#toast"),
  peerList: document.querySelector("#peer-list"),
  peerStatus: document.querySelector("#peer-status"),
  peerActions: document.querySelector("#peer-actions"),
  selectedPeerName: document.querySelector("#selected-peer-name"),
  sendTextButton: document.querySelector("#send-text-button"),
  resultKicker: document.querySelector("#result-kicker"),
  textModal: document.querySelector("#text-modal"),
  textForm: document.querySelector("#text-form"),
  textModalTitle: document.querySelector("#text-modal-title"),
  textInput: document.querySelector("#text-input"),
  cancelText: document.querySelector("#cancel-text"),
  incomingModal: document.querySelector("#incoming-modal"),
  incomingIcon: document.querySelector("#incoming-icon"),
  incomingKicker: document.querySelector("#incoming-kicker"),
  incomingTitle: document.querySelector("#incoming-title"),
  incomingFrom: document.querySelector("#incoming-from"),
  incomingContent: document.querySelector("#incoming-content"),
  dismissIncoming: document.querySelector("#dismiss-incoming"),
  incomingAction: document.querySelector("#incoming-action")
};

let config = { maxTransferBytes: 2 * 1024 ** 3, maxFiles: 20, ttlMs: 24 * 60 * 60 * 1000 };
let files = [];
let currentTransfer = null;
let toastTimer;
let peerSession = null;
let eventSource = null;
let reconnectTimer = null;
let nearbyPeers = [];
let selectedPeerId = null;
let incomingMessage = null;
const incomingQueue = [];
let activeUploadRequest = null;
let uploadCancelled = false;
let soundEnabled = false;
let audioContext = null;
let previousFocus = null;
let transferNeedsCleanup = false;
let receiveRefreshTimer = null;
let receiveRefreshGeneration = 0;
let activeReceiveCode = null;
let activeReceiveStatus = null;
let activeReceiveSignature = null;

const SOUND_STORAGE_KEY = "hanazar-sound";
const MAX_INCOMING_QUEUE = 20;
const RECEIVE_REFRESH_MS = 2_000;
const staticDemo = location.hostname.endsWith(".github.io") || location.protocol === "file:";

boot();

async function boot() {
  restoreSoundPreference();
  bindEvents();
  if (staticDemo) {
    setupStaticDemo();
    return;
  }
  await Promise.all([loadConfig(), registerLocalPeer()]);
  const code = normalizeCode(new URL(location.href).searchParams.get("code"));
  if (code) {
    switchMode("receive");
    elements.codeInput.value = code;
    await lookupTransfer(code);
  }
}

function bindEvents() {
  elements.sendTab.addEventListener("click", () => switchMode("send"));
  elements.receiveTab.addEventListener("click", () => switchMode("receive"));
  elements.sendTab.addEventListener("keydown", handleTabKeydown);
  elements.receiveTab.addEventListener("keydown", handleTabKeydown);
  elements.soundToggle.addEventListener("click", toggleSound);
  elements.fileInput.addEventListener("change", () => addFiles(elements.fileInput.files));
  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (staticDemo || elements.sendButton.classList.contains("loading")) return;
    elements.dropZone.classList.add("dragging");
  });
  elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("dragging"));
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
    if (staticDemo || elements.sendButton.classList.contains("loading")) return;
    addFiles(event.dataTransfer.files);
  });
  elements.clearFiles.addEventListener("click", clearFiles);
  elements.sendButton.addEventListener("click", sendFiles);
  elements.cancelUpload.addEventListener("click", cancelUpload);
  elements.newTransfer.addEventListener("click", resetSender);
  elements.copyLink.addEventListener("click", copyShareLink);
  elements.shareButton.addEventListener("click", shareTransfer);
  elements.receiveForm.addEventListener("submit", (event) => {
    event.preventDefault();
    lookupTransfer(elements.codeInput.value);
  });
  elements.codeInput.addEventListener("input", () => {
    elements.codeInput.value = normalizeCode(elements.codeInput.value).slice(0, 8);
  });
  elements.lookupAnother.addEventListener("click", resetReceiver);
  elements.sendTextButton.addEventListener("click", openTextModal);
  elements.cancelText.addEventListener("click", closeTextModal);
  elements.textForm.addEventListener("submit", sendTextMessage);
  elements.dismissIncoming.addEventListener("click", dismissIncomingMessage);
  elements.incomingAction.addEventListener("click", handleIncomingAction);
  document.addEventListener("keydown", handleDocumentKeydown);
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) handlePageExit();
  });
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error();
    config = await response.json();
    setServerStatus("online");
  } catch {
    setServerStatus("offline");
  }
  renderConfigLimits();
}

function setupStaticDemo() {
  elements.pageShell.classList.add("static-demo");
  elements.staticNotice.hidden = false;
  setServerStatus("p2p");
  renderConfigLimits();
  elements.peerStatus.textContent = "局域网服务未启动";
  renderEmptyPeer("可使用 P2P 直传", "点击上方入口，无需运行服务器");
  elements.fileInput.disabled = true;
  elements.dropZone.setAttribute("aria-disabled", "true");
  elements.dropZone.querySelector("strong").textContent = "请使用局域网地址";
  elements.dropZone.querySelector("span:last-child").textContent = "GitHub Pages 不提供文件中转服务";
  elements.sendButton.querySelector("span").textContent = "需连接局域网服务";
  elements.sendButton.setAttribute("aria-label", "需连接局域网服务");
  elements.codeInput.disabled = true;
  elements.codeInput.placeholder = "仅展示";
  elements.receiveButton.disabled = true;
  elements.receiveButton.querySelector("span").textContent = "需连接局域网服务";
  elements.receiveButton.setAttribute("aria-label", "需连接局域网服务");
}

function renderConfigLimits() {
  elements.limitCopy.textContent = `最多 ${config.maxFiles} 个 · 总计 ${formatBytes(config.maxTransferBytes)}`;
  elements.ttlCopy.textContent = `文件将在 ${formatDuration(config.ttlMs)}后清除`;
}

async function registerLocalPeer() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  try {
    peerSession = await readResponse(await fetch("/api/peers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: detectDeviceName(), deviceType: detectDeviceType() })
    }));
    setServerStatus("online");
    openPeerEvents();
  } catch (error) {
    setServerStatus(error.status ? "online" : "offline");
    peerSession = null;
    nearbyPeers = [];
    selectedPeerId = null;
    renderPeers();
    elements.peerStatus.textContent = "设备发现中断，正在重试…";
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void registerLocalPeer();
      }, 3_000);
    }
  }
}

function openPeerEvents() {
  eventSource?.close();
  const source = new EventSource(`/api/peers/${peerSession.id}/events?token=${encodeURIComponent(peerSession.token)}`);
  eventSource = source;
  source.addEventListener("peers", (event) => {
    const peers = parseEventData(event.data);
    if (!Array.isArray(peers)) return;
    nearbyPeers = peers;
    renderPeers();
  });
  source.addEventListener("message", (event) => {
    const message = parseEventData(event.data);
    if (!isIncomingMessage(message)) return;
    if (incomingQueue.length >= MAX_INCOMING_QUEUE) incomingQueue.shift();
    incomingQueue.push(message);
    void showNextIncomingMessage();
  });
  source.onopen = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    setServerStatus("online");
    renderPeers();
  };
  source.onerror = () => {
    setServerStatus("connecting");
    elements.peerStatus.textContent = "正在重新连接…";
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      if (eventSource !== source) return;
      source.close();
      peerSession = null;
      void registerLocalPeer();
    }, 7_000);
  };
}

function setServerStatus(state) {
  const labels = {
    online: "服务在线",
    offline: "服务离线",
    connecting: "服务重连中",
    p2p: "P2P 可用"
  };
  elements.serverStatus.className = `server-status ${state}`;
  elements.serverStatus.lastElementChild.textContent = labels[state];
}

function renderPeers() {
  const selected = nearbyPeers.find((peer) => peer.id === selectedPeerId);
  if (!selected && selectedPeerId) selectedPeerId = null;
  elements.peerList.replaceChildren();
  elements.peerStatus.textContent = nearbyPeers.length ? `${nearbyPeers.length} 台设备在线` : "未发现其他设备";

  if (!nearbyPeers.length) {
    renderEmptyPeer("等待其他设备", "让其他设备打开这个局域网网址");
  } else {
    for (const peer of nearbyPeers) elements.peerList.append(createPeerButton(peer));
  }

  const current = nearbyPeers.find((peer) => peer.id === selectedPeerId);
  elements.peerActions.hidden = !current;
  if (current) elements.selectedPeerName.textContent = current.name;
  updateSendButtonLabel();
}

function renderEmptyPeer(titleText, hintText) {
  elements.peerList.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "peer-empty";
  const radar = document.createElement("span");
  radar.className = "peer-radar";
  radar.setAttribute("aria-hidden", "true");
  const copy = document.createElement("p");
  const title = document.createElement("b");
  title.textContent = titleText;
  const hint = document.createElement("small");
  hint.textContent = hintText;
  copy.append(title, hint);
  empty.append(radar, copy);
  elements.peerList.append(empty);
}

function createPeerButton(peer) {
  const isSelected = peer.id === selectedPeerId;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `peer-button${isSelected ? " selected" : ""}`;
  button.setAttribute("aria-label", `${peer.name}，在线${isSelected ? "，已选择" : ""}`);
  button.setAttribute("aria-pressed", String(isSelected));
  const icon = document.createElement("span");
  icon.className = "peer-icon";
  icon.append(deviceIcon(peer.deviceType));
  const copy = document.createElement("span");
  copy.className = "peer-copy";
  const name = document.createElement("b");
  name.textContent = peer.name;
  name.title = peer.name;
  const status = document.createElement("small");
  status.textContent = "在线";
  copy.append(name, status);
  button.append(icon, copy);
  button.addEventListener("click", () => {
    selectedPeerId = selectedPeerId === peer.id ? null : peer.id;
    renderPeers();
  });
  return button;
}

function deviceIcon(type) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", type === "mobile"
    ? "M8 3h8a1 1 0 011 1v16a1 1 0 01-1 1H8a1 1 0 01-1-1V4a1 1 0 011-1zm3 15h2"
    : type === "tablet"
      ? "M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zm5 15h2"
      : "M4 5h16a1 1 0 011 1v10H3V6a1 1 0 011-1zm-2 11h20M9 20h6");
  svg.append(path);
  return svg;
}

function detectDeviceType() {
  const agent = navigator.userAgent;
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(agent)) return "tablet";
  if (/iPhone|Android.*Mobile|Mobile/i.test(agent)) return "mobile";
  return "desktop";
}

function detectDeviceName() {
  const agent = navigator.userAgent;
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/iPad/i.test(agent)) return "iPad";
  if (/Android/i.test(agent)) return detectDeviceType() === "tablet" ? "Android 平板" : "Android 手机";
  if (/Macintosh/i.test(agent)) return "Mac";
  if (/Windows/i.test(agent)) return "Windows 电脑";
  if (/Linux/i.test(agent)) return "Linux 电脑";
  return "浏览器设备";
}

function disconnectLocalPeer() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  eventSource?.close();
  eventSource = null;
  const session = peerSession;
  peerSession = null;
  if (!session) return;
  void fetch(`/api/peers/${session.id}`, {
    method: "DELETE",
    headers: { "x-peer-token": session.token },
    keepalive: true
  }).catch(() => {});
}

function handlePageExit() {
  disconnectLocalPeer();
  if (!transferNeedsCleanup || !currentTransfer) return;
  transferNeedsCleanup = false;
  void fetch(`/api/transfers/${encodeURIComponent(currentTransfer.code)}`, {
    method: "DELETE",
    headers: { "x-upload-token": currentTransfer.uploadToken },
    keepalive: true
  }).catch(() => {});
}

function switchMode(mode) {
  const isSend = mode === "send";
  elements.sendTab.classList.toggle("active", isSend);
  elements.sendTab.setAttribute("aria-selected", String(isSend));
  elements.sendTab.tabIndex = isSend ? 0 : -1;
  elements.receiveTab.classList.toggle("active", !isSend);
  elements.receiveTab.setAttribute("aria-selected", String(!isSend));
  elements.receiveTab.tabIndex = isSend ? -1 : 0;
  elements.sendPanel.hidden = !isSend;
  elements.receivePanel.hidden = isSend;
}

function handleTabKeydown(event) {
  const tabs = [elements.sendTab, elements.receiveTab];
  const currentIndex = tabs.indexOf(event.currentTarget);
  let nextIndex;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else return;
  event.preventDefault();
  const nextTab = tabs[nextIndex];
  switchMode(nextTab === elements.sendTab ? "send" : "receive");
  nextTab.focus();
}

function addFiles(fileList) {
  if (staticDemo || elements.sendButton.classList.contains("loading")) return;
  const incoming = Array.from(fileList);
  if (!incoming.length) return;
  const merged = [...files];
  for (const file of incoming) {
    const duplicate = merged.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
    if (!duplicate) merged.push(file);
  }
  if (merged.length > config.maxFiles) {
    showToast(`一次最多发送 ${config.maxFiles} 个文件`, true);
    return;
  }
  const totalSize = merged.reduce((total, file) => total + file.size, 0);
  if (totalSize > config.maxTransferBytes) {
    showToast(`文件总大小不能超过 ${formatBytes(config.maxTransferBytes)}`, true);
    return;
  }
  files = merged;
  elements.fileInput.value = "";
  renderSelectedFiles();
}

function renderSelectedFiles(progress = new Map()) {
  elements.sendFileList.replaceChildren();
  files.forEach((file, index) => {
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

    const progressText = document.createElement("span");
    progressText.className = "file-progress";
    progressText.textContent = progress.has(index) ? `${progress.get(index)}%` : "待发送";
    const remove = document.createElement("button");
    remove.className = "remove-file";
    remove.type = "button";
    remove.setAttribute("aria-label", `移除 ${file.name}`);
    remove.textContent = "×";
    remove.disabled = elements.sendButton.classList.contains("loading");
    remove.addEventListener("click", () => {
      files.splice(index, 1);
      renderSelectedFiles();
      if (!files.length) elements.fileInput.focus();
    });
    item.append(type, details, progressText, remove);
    elements.sendFileList.append(item);
  });

  elements.selectedFiles.hidden = files.length === 0;
  elements.sendButton.disabled = files.length === 0 || elements.sendButton.classList.contains("loading");
}

async function sendFiles() {
  if (!files.length || elements.sendButton.classList.contains("loading")) return;
  uploadCancelled = false;
  transferNeedsCleanup = false;
  setSending(true, "正在创建安全传输…", false);
  const progress = new Map();
  const targetPeer = nearbyPeers.find((peer) => peer.id === selectedPeerId);
  let notifiedPeer = null;

  try {
    const response = await fetch("/api/transfers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: files.map(({ name, size, type }) => ({ name, size, type })) })
    });
    currentTransfer = await readResponse(response);
    transferNeedsCleanup = true;

    for (let index = 0; index < files.length; index += 1) {
      if (uploadCancelled) throw cancelledUploadError();
      setSending(true, `正在上传 ${index + 1} / ${files.length}`);
      await uploadFile(currentTransfer, currentTransfer.files[index], files[index], (percent) => {
        progress.set(index, percent);
        renderSelectedFiles(progress);
      });
      progress.set(index, 100);
      renderSelectedFiles(progress);
    }
    transferNeedsCleanup = false;
    setSending(true, targetPeer ? "正在通知接收设备…" : "正在完成传输…", false);
    if (targetPeer) {
      try {
        await sendPeerMessage(targetPeer.id, "transfer", { code: currentTransfer.code });
        notifiedPeer = targetPeer;
        showToast(`已通知 ${targetPeer.name}`);
      } catch (error) {
        showToast(`${userErrorMessage(error)}，请改用传输码`, true);
      }
    }
    showSendResult(currentTransfer, notifiedPeer);
    void playSound("success");
  } catch (error) {
    const cancelled = uploadCancelled || error.name === "AbortError";
    setSending(true, "正在清理未完成传输…", false);
    if (currentTransfer) await discardTransfer(currentTransfer);
    transferNeedsCleanup = false;
    currentTransfer = null;
    showToast(cancelled ? "上传已取消" : userErrorMessage(error), !cancelled);
    setSending(false);
    renderSelectedFiles();
  } finally {
    activeUploadRequest = null;
    uploadCancelled = false;
  }
}

function uploadFile(transfer, remoteFile, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    activeUploadRequest = request;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      if (activeUploadRequest === request) activeUploadRequest = null;
      callback();
    };
    request.open("PUT", `/api/transfers/${encodeURIComponent(transfer.code)}/files/${remoteFile.id}`);
    request.setRequestHeader("x-upload-token", transfer.uploadToken);
    request.setRequestHeader("content-type", "application/octet-stream");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) finish(resolve);
      else finish(() => reject(new Error(parseError(request.responseText))));
    });
    request.addEventListener("error", () => finish(() => reject(new Error("网络中断，请重新发送"))));
    request.addEventListener("abort", () => finish(() => reject(cancelledUploadError())));
    request.send(file);
  });
}

function cancelUpload() {
  if (!elements.sendButton.classList.contains("loading") || uploadCancelled) return;
  uploadCancelled = true;
  elements.cancelUpload.disabled = true;
  elements.sendButton.querySelector("span").textContent = "正在取消…";
  elements.sendButton.setAttribute("aria-label", "正在取消上传");
  activeUploadRequest?.abort();
}

async function discardTransfer(transfer) {
  try {
    await fetch(`/api/transfers/${encodeURIComponent(transfer.code)}`, {
      method: "DELETE",
      headers: { "x-upload-token": transfer.uploadToken }
    });
  } catch {
    // The server will remove an unreachable transfer when it expires.
  }
}

function cancelledUploadError() {
  const error = new Error("上传已取消");
  error.name = "AbortError";
  return error;
}

function showSendResult(transfer, targetPeer) {
  const shareUrl = new URL(location.href);
  shareUrl.search = "";
  shareUrl.hash = "";
  shareUrl.searchParams.set("code", transfer.code);
  elements.transferCode.replaceChildren(...Array.from(transfer.code, (character) => {
    const span = document.createElement("span");
    span.textContent = character;
    return span;
  }));
  elements.transferCode.setAttribute("aria-label", `传输码 ${Array.from(transfer.code).join(" ")}`);
  elements.shareLink.value = shareUrl.href;
  elements.resultKicker.textContent = targetPeer
    ? `已发送给 ${targetPeer.name}，也可使用下方传输码`
    : "在另一台设备输入传输码";
  elements.expireCopy.textContent = `有效至 ${formatDate(transfer.expiresAt)}`;
  elements.sendFormView.hidden = true;
  elements.sendResult.hidden = false;
  setSending(false);
  focusRegion(elements.sendResult);
}

async function lookupTransfer(inputCode) {
  stopReceiveRefresh();
  const generation = receiveRefreshGeneration;
  const code = normalizeCode(inputCode);
  if (code.length !== 8) {
    showToast("请输入完整的 8 位传输码", true);
    elements.codeInput.focus();
    return;
  }
  setLookupLoading(true);
  try {
    const transfer = await readResponse(await fetch(`/api/transfers/${encodeURIComponent(code)}`));
    if (generation !== receiveRefreshGeneration) return;
    activeReceiveCode = code;
    activeReceiveStatus = transfer.status;
    activeReceiveSignature = receiveSignature(transfer);
    renderDownloads(transfer);
    focusRegion(elements.receiveResult);
    scheduleReceiveRefresh(generation);
    const url = new URL(location.href);
    url.searchParams.set("code", code);
    history.replaceState(null, "", url);
  } catch (error) {
    if (generation === receiveRefreshGeneration) showToast(userErrorMessage(error), true);
  } finally {
    if (generation === receiveRefreshGeneration) setLookupLoading(false);
  }
}

function scheduleReceiveRefresh(generation) {
  clearTimeout(receiveRefreshTimer);
  receiveRefreshTimer = null;
  if (generation !== receiveRefreshGeneration || activeReceiveStatus !== "uploading") return;
  receiveRefreshTimer = setTimeout(() => void refreshActiveTransfer(generation), RECEIVE_REFRESH_MS);
}

async function refreshActiveTransfer(generation) {
  const code = activeReceiveCode;
  if (!code || generation !== receiveRefreshGeneration) return;
  try {
    const transfer = await readResponse(await fetch(`/api/transfers/${encodeURIComponent(code)}`));
    if (code !== activeReceiveCode || generation !== receiveRefreshGeneration) return;
    const becameReady = activeReceiveStatus === "uploading" && transfer.status === "ready";
    const signature = receiveSignature(transfer);
    activeReceiveStatus = transfer.status;
    if (signature !== activeReceiveSignature) {
      activeReceiveSignature = signature;
      renderDownloads(transfer);
    }
    if (becameReady) {
      showToast("文件已全部上传，可以下载了");
      void playSound("success");
    }
  } catch (error) {
    if (code !== activeReceiveCode || generation !== receiveRefreshGeneration) return;
    if (error.status === 404) {
      resetReceiver();
      showToast(error.message, true);
      return;
    }
    setServerStatus("connecting");
  }
  scheduleReceiveRefresh(generation);
}

function stopReceiveRefresh() {
  clearTimeout(receiveRefreshTimer);
  receiveRefreshTimer = null;
  receiveRefreshGeneration += 1;
  activeReceiveCode = null;
  activeReceiveStatus = null;
  activeReceiveSignature = null;
}

function receiveSignature(transfer) {
  return `${transfer.status}:${transfer.files.map((file) => Number(file.uploaded)).join("")}`;
}

function renderDownloads(transfer) {
  const uploaded = transfer.files.filter((file) => file.uploaded).length;
  const isReady = transfer.status === "ready";
  elements.receiveForm.hidden = true;
  elements.receiveResult.hidden = false;
  elements.receiveIcon.className = `ready-icon${isReady ? "" : " pending"}`;
  elements.receiveIcon.textContent = isReady ? "✓" : "…";
  elements.receiveTitle.textContent = isReady ? "文件可以下载" : "发送方仍在上传";
  elements.receiveMeta.textContent = `${uploaded} / ${transfer.files.length} 个文件 · ${formatBytes(transfer.totalSize)} · ${formatDate(transfer.expiresAt)} 过期`;
  elements.downloadList.replaceChildren();

  for (const file of transfer.files) {
    const item = document.createElement("li");
    item.className = `download-item${file.uploaded ? "" : " pending"}`;
    const details = document.createElement("div");
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.name;
    const meta = document.createElement("span");
    meta.className = "file-size";
    meta.textContent = file.uploaded ? formatBytes(file.size) : "等待上传";
    details.append(name, meta);
    const action = document.createElement(file.uploaded ? "a" : "span");
    action.className = "download-action";
    action.textContent = file.uploaded ? "下载" : "等待中";
    action.setAttribute("aria-label", file.uploaded ? `下载 ${file.name}` : `${file.name} 等待上传`);
    if (file.uploaded) {
      action.href = `/api/transfers/${encodeURIComponent(transfer.code)}/files/${file.id}`;
      action.download = file.name;
    } else {
      action.setAttribute("aria-disabled", "true");
    }
    item.append(details, action);
    elements.downloadList.append(item);
  }
}

function resetSender() {
  transferNeedsCleanup = false;
  currentTransfer = null;
  files = [];
  elements.sendResult.hidden = true;
  elements.sendFormView.hidden = false;
  renderSelectedFiles();
  updateSendButtonLabel();
  elements.fileInput.focus();
}

function resetReceiver() {
  stopReceiveRefresh();
  elements.receiveResult.hidden = true;
  elements.receiveForm.hidden = false;
  elements.codeInput.value = "";
  const url = new URL(location.href);
  url.searchParams.delete("code");
  history.replaceState(null, "", url);
  elements.codeInput.focus();
}

function clearFiles() {
  files = [];
  renderSelectedFiles();
  elements.fileInput.focus();
}

function openTextModal() {
  const peer = nearbyPeers.find((candidate) => candidate.id === selectedPeerId);
  if (!peer) {
    showToast("目标设备已离线，请重新选择", true);
    return;
  }
  elements.textModalTitle.textContent = `发送文字给 ${peer.name}`;
  elements.textInput.value = "";
  showModal(elements.textModal, elements.textInput);
}

function closeTextModal() {
  const hasIncoming = incomingQueue.length > 0;
  hideModal(elements.textModal, !hasIncoming);
  if (hasIncoming) void showNextIncomingMessage();
}

async function sendTextMessage(event) {
  event.preventDefault();
  const peer = nearbyPeers.find((candidate) => candidate.id === selectedPeerId);
  const text = elements.textInput.value;
  if (!peer) {
    closeTextModal();
    showToast("目标设备已离线，请重新选择", true);
    return;
  }
  if (!text.trim()) {
    showToast("请输入要发送的文字", true);
    elements.textInput.focus();
    return;
  }
  const button = elements.textForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await sendPeerMessage(peer.id, "text", { text });
    closeTextModal();
    showToast(`文字已发送给 ${peer.name}`);
    void playSound("success");
  } catch (error) {
    if (error.code === "PEER_OFFLINE" || error.code === "PEER_NOT_FOUND") {
      selectedPeerId = null;
      closeTextModal();
      renderPeers();
    }
    showToast(userErrorMessage(error), true);
  } finally {
    button.disabled = false;
  }
}

async function sendPeerMessage(to, type, payload) {
  if (!peerSession) throw new Error("局域网设备连接尚未就绪");
  return readResponse(await fetch(`/api/peers/${peerSession.id}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-peer-token": peerSession.token
    },
    body: JSON.stringify({ to, type, payload })
  }));
}

async function showNextIncomingMessage() {
  if (incomingMessage || !incomingQueue.length || !elements.textModal.hidden || !elements.incomingModal.hidden) return;
  incomingMessage = incomingQueue.shift();
  const message = incomingMessage;
  const isTransfer = incomingMessage.type === "transfer";
  elements.incomingIcon.textContent = isTransfer ? "↓" : "T";
  elements.incomingKicker.textContent = isTransfer ? "收到新文件" : "收到新文字";
  elements.incomingTitle.textContent = isTransfer ? "附近设备发来文件" : "附近设备发来文字";
  elements.incomingFrom.textContent = `来自 ${incomingMessage.from.name}`;
  elements.incomingAction.textContent = isTransfer ? "查看并下载" : "复制文字";

  if (isTransfer) {
    elements.incomingContent.textContent = "正在读取文件信息…";
  } else {
    elements.incomingContent.textContent = incomingMessage.payload.text;
  }
  showModal(elements.incomingModal, elements.incomingAction);
  void playSound("incoming");

  if (isTransfer) {
    try {
      const transfer = await readResponse(await fetch(`/api/transfers/${encodeURIComponent(incomingMessage.payload.code)}`));
      if (incomingMessage !== message) return;
      elements.incomingContent.textContent = `${transfer.files.length} 个文件 · ${formatBytes(transfer.totalSize)}\n${transfer.files.map((file) => file.name).join("\n")}`;
    } catch {
      if (incomingMessage !== message) return;
      elements.incomingContent.textContent = `传输码：${incomingMessage.payload.code}`;
    }
  }
}

function dismissIncomingMessage() {
  const hasIncoming = incomingQueue.length > 0;
  hideModal(elements.incomingModal, !hasIncoming);
  incomingMessage = null;
  void showNextIncomingMessage();
}

async function handleIncomingAction() {
  if (!incomingMessage) return;
  if (incomingMessage.type === "text") {
    try {
      await copyText(incomingMessage.payload.text);
      showToast("文字已复制");
      dismissIncomingMessage();
    } catch (error) {
      showToast(userErrorMessage(error, "复制失败，请手动选择文字"), true);
    }
    return;
  }

  const code = incomingMessage.payload.code;
  dismissIncomingMessage();
  switchMode("receive");
  resetReceiver();
  elements.codeInput.value = code;
  await lookupTransfer(code);
}

async function copyShareLink() {
  try {
    await copyText(elements.shareLink.value, elements.shareLink);
    showToast("分享链接已复制");
  } catch (error) {
    showToast(userErrorMessage(error, "复制失败，请手动复制链接"), true);
  }
}

async function copyText(text, fallbackInput) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = fallbackInput || document.createElement("textarea");
    if (!fallbackInput) {
      input.value = text;
      input.className = "clipboard-helper";
      document.body.append(input);
    }
    try {
      input.select();
      if (!document.execCommand("copy")) throw new Error("复制失败，请手动复制");
    } finally {
      if (!fallbackInput) input.remove();
    }
  }
}

async function shareTransfer() {
  if (!currentTransfer) return;
  if (navigator.share) {
    try {
      await navigator.share({
        title: "Hanazar Transfer 文件",
        text: `使用传输码 ${currentTransfer.code} 接收文件`,
        url: elements.shareLink.value
      });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  await copyShareLink();
}

function setSending(active, label = defaultSendLabel(), cancelable = active) {
  elements.sendButton.classList.toggle("loading", active);
  elements.sendButton.disabled = active || files.length === 0;
  elements.sendButton.querySelector("span").textContent = label;
  elements.sendButton.setAttribute("aria-label", label);
  elements.fileInput.disabled = active;
  elements.dropZone.classList.remove("dragging");
  elements.dropZone.setAttribute("aria-disabled", String(staticDemo || active));
  elements.clearFiles.disabled = active;
  elements.cancelUpload.hidden = !cancelable;
  elements.cancelUpload.disabled = !cancelable;
  for (const button of elements.sendFileList.querySelectorAll(".remove-file")) button.disabled = active;
}

function focusRegion(element) {
  if (document.visibilityState !== "visible") return;
  requestAnimationFrame(() => {
    if (!element.hidden) element.focus();
  });
}

function updateSendButtonLabel() {
  if (elements.sendButton.classList.contains("loading")) return;
  const label = defaultSendLabel();
  elements.sendButton.querySelector("span").textContent = label;
  elements.sendButton.setAttribute("aria-label", label);
}

function defaultSendLabel() {
  const peer = nearbyPeers.find((candidate) => candidate.id === selectedPeerId);
  return peer ? `发送给 ${peer.name}` : "生成传输码并发送";
}

function setLookupLoading(active) {
  const label = active ? "正在查找文件" : "查找文件";
  elements.receiveButton.disabled = active;
  elements.receiveButton.classList.toggle("loading", active);
  elements.receiveButton.querySelector("span").textContent = active ? "正在查找…" : label;
  elements.receiveButton.setAttribute("aria-label", label);
}

async function readResponse(response) {
  setServerStatus("online");
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || "请求失败，请稍后重试");
    error.status = response.status;
    error.code = body.error?.code;
    throw error;
  }
  return body;
}

function parseError(value) {
  try {
    return JSON.parse(value).error?.message || "上传失败，请重试";
  } catch {
    return "上传失败，请重试";
  }
}

function userErrorMessage(error, fallback = "网络中断，请稍后重试") {
  if (error instanceof TypeError || error?.message === "Failed to fetch") return fallback;
  return error?.message || fallback;
}

function parseEventData(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isIncomingMessage(message) {
  if (!message || typeof message.from?.name !== "string") return false;
  if (message.type === "text") return typeof message.payload?.text === "string";
  return message.type === "transfer" && typeof message.payload?.code === "string";
}

function showModal(modal, focusTarget) {
  if (previousFocus === null && elements.textModal.hidden && elements.incomingModal.hidden) {
    previousFocus = document.activeElement;
  }
  modal.hidden = false;
  elements.pageShell.inert = true;
  elements.pageShell.setAttribute("aria-hidden", "true");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => {
    if (!modal.hidden) focusTarget.focus();
  });
}

function hideModal(modal, restoreFocus = true) {
  modal.hidden = true;
  if (!elements.textModal.hidden || !elements.incomingModal.hidden) return;
  if (!restoreFocus) return;
  elements.pageShell.inert = false;
  elements.pageShell.removeAttribute("aria-hidden");
  document.body.classList.remove("modal-open");
  const target = previousFocus;
  previousFocus = null;
  requestAnimationFrame(() => {
    if (target?.isConnected) target.focus();
  });
}

function handleDocumentKeydown(event) {
  const modal = !elements.textModal.hidden
    ? elements.textModal
    : !elements.incomingModal.hidden
      ? elements.incomingModal
      : null;
  if (!modal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (modal === elements.textModal) closeTextModal();
    else dismissIncomingMessage();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...modal.querySelectorAll("button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]")]
    .filter((element) => !element.hidden);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function restoreSoundPreference() {
  try {
    soundEnabled = localStorage.getItem(SOUND_STORAGE_KEY) === "on";
  } catch {
    soundEnabled = false;
  }
  updateSoundToggle();
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, soundEnabled ? "on" : "off");
  } catch {
    // Sound still works for the current page when storage is unavailable.
  }
  updateSoundToggle();
  if (soundEnabled) {
    void playSound("confirm");
  } else if (audioContext?.state === "running") {
    void audioContext.suspend().catch(() => {});
  }
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
    const patterns = {
      confirm: [[520, 0]],
      incoming: [[480, 0], [650, 0.11]],
      success: [[540, 0], [720, 0.1]]
    };
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
  } catch {
    // Audio is optional and must never block a transfer.
  }
}

function normalizeCode(value) {
  return typeof value === "string" ? value.replace(/[^a-z0-9]/gi, "").toUpperCase() : "";
}

function fileExtension(name) {
  const extension = name.includes(".") ? name.split(".").pop() : "FILE";
  return extension.slice(0, 4) || "FILE";
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDuration(milliseconds) {
  const hours = Math.round(milliseconds / 3_600_000);
  return hours % 24 === 0 ? `${hours / 24} 天` : `${hours} 小时`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
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
  }, 2600);
}
