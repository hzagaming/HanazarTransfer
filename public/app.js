const elements = {
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
  receiveTitle: document.querySelector("#receive-title"),
  receiveMeta: document.querySelector("#receive-meta"),
  downloadList: document.querySelector("#download-list"),
  lookupAnother: document.querySelector("#lookup-another"),
  limitCopy: document.querySelector("#limit-copy"),
  ttlCopy: document.querySelector("#ttl-copy"),
  serverStatus: document.querySelector("#server-status"),
  toast: document.querySelector("#toast")
};

let config = { maxTransferBytes: 2 * 1024 ** 3, maxFiles: 20, ttlMs: 24 * 60 * 60 * 1000 };
let files = [];
let currentTransfer = null;
let toastTimer;

boot();

async function boot() {
  bindEvents();
  await loadConfig();
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
  elements.fileInput.addEventListener("change", () => addFiles(elements.fileInput.files));
  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
  elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("dragging"));
  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
    addFiles(event.dataTransfer.files);
  });
  elements.clearFiles.addEventListener("click", clearFiles);
  elements.sendButton.addEventListener("click", sendFiles);
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
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error();
    config = await response.json();
    elements.serverStatus.className = "server-status online";
    elements.serverStatus.lastElementChild.textContent = "服务在线";
  } catch {
    elements.serverStatus.className = "server-status offline";
    elements.serverStatus.lastElementChild.textContent = "服务离线";
  }
  elements.limitCopy.textContent = `最多 ${config.maxFiles} 个 · 总计 ${formatBytes(config.maxTransferBytes)}`;
  elements.ttlCopy.textContent = `文件将在 ${formatDuration(config.ttlMs)}后清除`;
}

function switchMode(mode) {
  const isSend = mode === "send";
  elements.sendTab.classList.toggle("active", isSend);
  elements.sendTab.setAttribute("aria-selected", String(isSend));
  elements.receiveTab.classList.toggle("active", !isSend);
  elements.receiveTab.setAttribute("aria-selected", String(!isSend));
  elements.sendPanel.hidden = !isSend;
  elements.receivePanel.hidden = isSend;
  if (!isSend) requestAnimationFrame(() => elements.codeInput.focus());
}

function addFiles(fileList) {
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
    });
    item.append(type, details, progressText, remove);
    elements.sendFileList.append(item);
  });

  elements.selectedFiles.hidden = files.length === 0;
  elements.sendButton.disabled = files.length === 0;
}

async function sendFiles() {
  if (!files.length || elements.sendButton.classList.contains("loading")) return;
  setSending(true, "正在创建安全传输…");
  const progress = new Map();

  try {
    const response = await fetch("/api/transfers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files: files.map(({ name, size, type }) => ({ name, size, type })) })
    });
    currentTransfer = await readResponse(response);

    for (let index = 0; index < files.length; index += 1) {
      setSending(true, `正在上传 ${index + 1} / ${files.length}`);
      await uploadFile(currentTransfer, currentTransfer.files[index], files[index], (percent) => {
        progress.set(index, percent);
        renderSelectedFiles(progress);
      });
      progress.set(index, 100);
      renderSelectedFiles(progress);
    }
    showSendResult(currentTransfer);
  } catch (error) {
    showToast(error.message, true);
    setSending(false);
  }
}

function uploadFile(transfer, remoteFile, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", `/api/transfers/${encodeURIComponent(transfer.code)}/files/${remoteFile.id}`);
    request.setRequestHeader("x-upload-token", transfer.uploadToken);
    request.setRequestHeader("content-type", "application/octet-stream");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(parseError(request.responseText)));
    });
    request.addEventListener("error", () => reject(new Error("网络中断，请重新发送")));
    request.send(file);
  });
}

function showSendResult(transfer) {
  const shareUrl = new URL(location.href);
  shareUrl.search = "";
  shareUrl.hash = "";
  shareUrl.searchParams.set("code", transfer.code);
  elements.transferCode.replaceChildren(...Array.from(transfer.code, (character) => {
    const span = document.createElement("span");
    span.textContent = character;
    return span;
  }));
  elements.shareLink.value = shareUrl.href;
  elements.expireCopy.textContent = `有效至 ${formatDate(transfer.expiresAt)}`;
  elements.sendFormView.hidden = true;
  elements.sendResult.hidden = false;
  setSending(false);
}

async function lookupTransfer(inputCode) {
  const code = normalizeCode(inputCode);
  if (code.length !== 8) {
    showToast("请输入完整的 8 位传输码", true);
    elements.codeInput.focus();
    return;
  }
  setLookupLoading(true);
  try {
    const transfer = await readResponse(await fetch(`/api/transfers/${encodeURIComponent(code)}`));
    renderDownloads(transfer);
    const url = new URL(location.href);
    url.searchParams.set("code", code);
    history.replaceState(null, "", url);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setLookupLoading(false);
  }
}

function renderDownloads(transfer) {
  const uploaded = transfer.files.filter((file) => file.uploaded).length;
  elements.receiveForm.hidden = true;
  elements.receiveResult.hidden = false;
  elements.receiveTitle.textContent = transfer.status === "ready" ? "文件可以下载" : "发送方仍在上传";
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
    const download = document.createElement("a");
    download.href = `/api/transfers/${encodeURIComponent(transfer.code)}/files/${file.id}`;
    download.download = file.name;
    download.textContent = file.uploaded ? "下载" : "等待中";
    item.append(details, download);
    elements.downloadList.append(item);
  }
}

function resetSender() {
  currentTransfer = null;
  files = [];
  elements.sendResult.hidden = true;
  elements.sendFormView.hidden = false;
  renderSelectedFiles();
}

function resetReceiver() {
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
}

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(elements.shareLink.value);
    showToast("分享链接已复制");
  } catch {
    elements.shareLink.select();
    document.execCommand("copy");
    showToast("分享链接已复制");
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

function setSending(active, label = "生成传输码并发送") {
  elements.sendButton.classList.toggle("loading", active);
  elements.sendButton.disabled = active || files.length === 0;
  elements.sendButton.querySelector("span").textContent = label;
  elements.fileInput.disabled = active;
  elements.clearFiles.disabled = active;
}

function setLookupLoading(active) {
  elements.receiveButton.disabled = active;
  elements.receiveButton.classList.toggle("loading", active);
  elements.receiveButton.querySelector("span").textContent = active ? "正在查找…" : "查找文件";
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || "请求失败，请稍后重试");
  return body;
}

function parseError(value) {
  try {
    return JSON.parse(value).error?.message || "上传失败，请重试";
  } catch {
    return "上传失败，请重试";
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
  elements.toast.textContent = message;
  elements.toast.className = `toast show${isError ? " error" : ""}`;
  toastTimer = setTimeout(() => { elements.toast.className = "toast"; }, 2600);
}
