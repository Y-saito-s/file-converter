(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const fileInput = $("fileInput");
  const dropZone = $("dropZone");
  const fileList = $("fileList");
  const fileCount = $("fileCount");
  const emptyState = $("emptyState");
  const operation = $("operation");
  const operationHelp = $("operationHelp");
  const convertButton = $("convertButton");
  const status = $("status");
  const resultSection = $("resultSection");
  const downloadButton = $("downloadButton");
const outputNameInput = $("outputName");

  let entries = [];
  let nextId = 1;
  let outputBlob = null;
  let outputName = "";
  let outputIsZip = false;
let dragSourceId = null;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const imageExts = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "avif"]);
  const extOf = (name) => (name.split(".").pop() || "").toLowerCase();
  const isPdf = (entry) => extOf(entry.file.name) === "pdf";
  const isImage = (entry) => imageExts.has(extOf(entry.file.name)) || entry.file.type.startsWith("image/");
  const safeBase = (name) => name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "converted";
  const formatSize = (n) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
  let ffmpegInstance = null;
  let ffmpegLoading = null;
  let audioFiles = [];
  let videoFiles = [];

  function setStatus(message = "", error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  function updateUI() {
    fileCount.textContent = String(entries.length);
    emptyState.hidden = entries.length > 0;
    fileList.innerHTML = "";
    entries.forEach((entry, index) => {
      const li = document.createElement("li");
      li.className = "file-item";
      const ext = extOf(entry.file.name).toUpperCase().slice(0, 5) || "FILE";
      const badge = document.createElement("div");
      badge.className = "file-badge" + (ext === "PDF" ? " pdf" : "");
      badge.textContent = ext;
      const info = document.createElement("div");
      info.className = "file-info";
      const name = document.createElement("div");
      name.className = "file-name";
      name.textContent = entry.file.name;
      name.title = entry.file.name;
      const meta = document.createElement("div");
      meta.className = "file-meta";
      meta.textContent = `${formatSize(entry.file.size)} · ${isPdf(entry) ? "PDF" : isImage(entry) ? "画像" : "未対応形式"}`;
      info.append(name, meta);
      const actions = document.createElement("div");
actions.className = "file-actions";

// 右端のつまみだけをドラッグ可能にする
const handle = document.createElement("button");
handle.className = "icon-button drag-handle";
handle.type = "button";
handle.draggable = true;
handle.textContent = "⠿";
handle.title = "ドラッグして並べ替え";

handle.addEventListener("dragstart", (event) => {
  if ($("sortMode").value !== "manual") {
    event.preventDefault();
    return;
  }

  dragSourceId = entry.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(entry.id));
});

handle.addEventListener("dragend", () => {
  dragSourceId = null;

  fileList.querySelectorAll(".file-item").forEach((item) => {
    item.classList.remove("dragging", "drag-target");
  });
});

const up = document.createElement("button");

// ファイル行をドロップ先にする
li.addEventListener("dragover", (event) => {
  if (
    dragSourceId === null ||
    dragSourceId === entry.id ||
    $("sortMode").value !== "manual"
  ) return;

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
});

li.addEventListener("drop", (event) => {
  if (
    dragSourceId === null ||
    dragSourceId === entry.id ||
    $("sortMode").value !== "manual"
  ) return;

  event.preventDefault();

  const from = entries.findIndex(
    (item) => item.id === dragSourceId
  );
  const to = entries.findIndex(
    (item) => item.id === entry.id
  );

  if (from < 0 || to < 0) return;

  const [moved] = entries.splice(from, 1);
  entries.splice(to, 0, moved);

  invalidateResult();
  updateUI();
});
      up.className = "icon-button";
      up.type = "button";
      up.textContent = "↑";
      up.title = "上へ移動";
      up.setAttribute("aria-label", `${entry.file.name}を上へ移動`);
      up.disabled = index === 0 || $("sortMode").value !== "manual";
      up.addEventListener("click", () => moveEntry(index, -1));
      const down = document.createElement("button");
      down.className = "icon-button";
      down.type = "button";
      down.textContent = "↓";
      down.title = "下へ移動";
      down.setAttribute("aria-label", `${entry.file.name}を下へ移動`);
      down.disabled = index === entries.length - 1 || $("sortMode").value !== "manual";
      down.addEventListener("click", () => moveEntry(index, 1));
      const remove = document.createElement("button");
      remove.className = "icon-button";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "削除";
      remove.setAttribute("aria-label", `${entry.file.name}を削除`);
      remove.addEventListener("click", () => {
        entries = entries.filter((item) => item.id !== entry.id);
        invalidateResult();
        updateUI();
      });
      actions.append(up, down, remove, handle);
      li.append(badge, info, actions);
      fileList.append(li);
    });
    $("clearFiles").disabled = entries.length === 0;
    convertButton.disabled = entries.length === 0;
    updateOperationHelp();
  }

  function moveEntry(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= entries.length) return;
    [entries[index], entries[target]] = [entries[target], entries[index]];
    invalidateResult();
    updateUI();
  }

  function invalidateResult() {
    outputBlob = null;
    resultSection.hidden = true;
    setStatus("");
  }

  function addFiles(fileListLike) {
    const incoming = Array.from(fileListLike || []);
    let added = 0;
    for (const file of incoming) {
      const ext = extOf(file.name);
      if (ext !== "pdf" && !imageExts.has(ext) && !file.type.startsWith("image/")) continue;
      entries.push({ id: nextId++, file, addedAt: Date.now() + added });
      added++;
    }
    if (added !== incoming.length) setStatus("対応形式以外のファイルは追加しませんでした。");
    else setStatus(added ? `${added}件のファイルを追加しました。` : "");
    if (added) invalidateResult();
    if ($("sortMode").value === "name") sortEntries("name");
    else if ($("sortMode").value === "added") sortEntries("added");
    updateUI();
    fileInput.value = "";
  }

  function sortEntries(mode) {
    if (mode === "name") entries.sort((a, b) => a.file.name.localeCompare(b.file.name, "ja", { numeric: true, sensitivity: "base" }));
    if (mode === "added") entries.sort((a, b) => a.addedAt - b.addedAt);
    updateUI();
  }

  function updateOperationHelp() {
    const messages = {
      "images-combined": "選択した画像とPDFを、一覧の順番どおりに1つのPDFにまとめます。",
      "images-individual": "画像ごとにPDFを作成し、複数ファイルはZIPにまとめてダウンロードします。",
      "pdf-merge": "追加したPDFを一覧の順番で1つに結合します。",
      "pdf-split": "各PDFを1ページずつのPDFに分割し、ZIPにまとめます。",
      "pdf-jpg": "各PDFページをJPG画像に変換し、ZIPにまとめます。"
    };
    operationHelp.textContent = messages[operation.value];
  }

  function requireEntries(predicate, description) {
    const matches = entries.filter(predicate);
    if (!matches.length) throw new Error(`${description}が見つかりません。対応するファイルを追加してください。`);
    return matches;
  }

  async function loadImageBytes(entry) {
    let file = entry.file;
    const ext = extOf(file.name);
    if (ext === "heic" || ext === "heif") {
      if (typeof heic2any !== "function") throw new Error("HEIC変換ライブラリを読み込めませんでした。インターネット接続を確認してください。");
      const converted = await heic2any({ blob: file, toType: "image/png", quality: 0.95 });
      file = Array.isArray(converted) ? converted[0] : converted;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { bytes, type: file.type || (["jpg", "jpeg"].includes(ext) ? "image/jpeg" : `image/${ext}`), name: entry.file.name };
  }

  async function imageToPdfBytes(entry) {
    const { PDFDocument } = PDFLib;
    const pdf = await PDFDocument.create();
    const loaded = await loadImageBytes(entry);
    let image;
    const ext = extOf(entry.file.name);
    if (ext === "jpg" || ext === "jpeg" || loaded.type === "image/jpeg") image = await pdf.embedJpg(loaded.bytes);
    else if (ext === "png" || loaded.type === "image/png") image = await pdf.embedPng(loaded.bytes);
    else {
      // PDF-lib accepts JPEG and PNG; other browser-supported image types are rasterized to PNG first.
      const png = await rasterizeImageToPng(entry);
      image = await pdf.embedPng(png);
    }
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    return await pdf.save();
  }

  async function rasterizeImageToPng(entry) {
    let blob = entry.file;
    const ext = extOf(blob.name);
    if (ext === "heic" || ext === "heif") {
      const converted = await heic2any({ blob, toType: "image/png", quality: 0.95 });
      blob = Array.isArray(converted) ? converted[0] : converted;
    }
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pngBlob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("画像を読み込めませんでした。")), "image/png"));
      return new Uint8Array(await pngBlob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function createCombinedImagePdf(imageEntries) {
    const pdf = await PDFLib.PDFDocument.create();
    for (let i = 0; i < imageEntries.length; i++) {
      setStatus(`画像を処理中… ${i + 1}/${imageEntries.length}`);
      const bytes = await imageToPdfBytes(imageEntries[i]);
      const src = await PDFLib.PDFDocument.load(bytes);
      const [page] = await pdf.copyPages(src, [0]);
      pdf.addPage(page);
    }
    return await pdf.save();
  }

  async function mergePdfs(pdfEntries) {
    const merged = await PDFLib.PDFDocument.create();
    for (let i = 0; i < pdfEntries.length; i++) {
      setStatus(`PDFを結合中… ${i + 1}/${pdfEntries.length}`);
      const src = await PDFLib.PDFDocument.load(await pdfEntries[i].file.arrayBuffer());
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }
    return await merged.save();
  }
async function createMixedPdf(allEntries) {
  const output = await PDFLib.PDFDocument.create();

  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i];

    setStatus(
      `統合PDFを作成中… ${i + 1}/${allEntries.length}`
    );

    let source;

    if (isPdf(entry)) {
      // PDFは全ページを取り込む
      source = await PDFLib.PDFDocument.load(
        await entry.file.arrayBuffer()
      );
    } else if (isImage(entry)) {
      // 画像は1ページのPDFに変換して取り込む
      const bytes = await imageToPdfBytes(entry);
      source = await PDFLib.PDFDocument.load(bytes);
    } else {
      throw new Error(
        `対応していない形式です：${entry.file.name}`
      );
    }

    const pages = await output.copyPages(
      source,
      source.getPageIndices()
    );

    pages.forEach((page) => output.addPage(page));
  }

  return await output.save();
}

  async function makeZip(items) {
    if (!window.JSZip) throw new Error("ZIPライブラリを読み込めませんでした。インターネット接続を確認してください。");
    const zip = new JSZip();
    items.forEach((item) => zip.file(item.name, item.bytes));
    return await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 5 } });
  }

  async function splitPdfs(pdfEntries) {
    const outputs = [];
    for (const entry of pdfEntries) {
      setStatus(`分割中：${entry.file.name}`);
      const src = await PDFLib.PDFDocument.load(await entry.file.arrayBuffer());
      const base = safeBase(entry.file.name);
      for (const pageIndex of src.getPageIndices()) {
        const one = await PDFLib.PDFDocument.create();
        const [page] = await one.copyPages(src, [pageIndex]);
        one.addPage(page);
        outputs.push({ name: `${base}_page-${String(pageIndex + 1).padStart(3, "0")}.pdf`, bytes: await one.save() });
      }
    }
    return outputs;
  }

  async function pdfsToJpg(pdfEntries) {
    if (!window.pdfjsLib) throw new Error("PDF画像変換ライブラリを読み込めませんでした。");
    const outputs = [];
    for (const entry of pdfEntries) {
      const loading = pdfjsLib.getDocument({ data: new Uint8Array(await entry.file.arrayBuffer()) });
      const doc = await loading.promise;
      const base = safeBase(entry.file.name);
      for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
        setStatus(`JPGに変換中：${entry.file.name} (${pageNo}/${doc.numPages})`);
        const page = await doc.getPage(pageNo);
        const viewport = page.getViewport({ scale: 1.7 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("JPGを書き出せませんでした。")), "image/jpeg", 0.92));
        outputs.push({ name: `${base}_page-${String(pageNo).padStart(3, "0")}.jpg`, bytes: new Uint8Array(await blob.arrayBuffer()) });
        canvas.width = 0; canvas.height = 0;
      }
    }
    return outputs;
  }
function getOutputFilename(extension) {
  const input = $("outputName");

  let name = input.value.trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\.(pdf|zip|wav|mp3|m4a|mp4|mov|webm)$/i, "");

  if (!name) name = "converted";

  return `${name}.${extension}`;
}

  async function performConversion() {
    if (!entries.length) return;
    invalidateResult();
    setBusy(true);
    try {
      const op = operation.value;
      if (op === "images-combined") {
  const compatible = entries.filter(
    (entry) => isImage(entry) || isPdf(entry)
  );

  if (compatible.length === 0) {
    throw new Error("画像またはPDFを追加してください。");
  }

  const bytes = await createMixedPdf(compatible);

  await setFinalOutput(
    new Blob([bytes], { type: "application/pdf" }),
    getOutputFilename("pdf"),
    false,
    `${compatible.length}個のファイルを統合しました。`
  );
      } else if (op === "images-individual") {
        const imgs = requireEntries(isImage, "画像");
        const outputs = [];
        for (let i = 0; i < imgs.length; i++) {
          setStatus(`PDFを作成中… ${i + 1}/${imgs.length}`);
          outputs.push({ name: `${safeBase(imgs[i].file.name)}.pdf`, bytes: await imageToPdfBytes(imgs[i]) });
        }
        if (outputs.length === 1) await setFinalOutput(new Blob([outputs[0].bytes], { type: "application/pdf" }), getOutputFilename("pdf"), false, "PDFを作成しました。");
        else await setFinalOutput(await makeZip(outputs), getOutputFilename("zip"), true, `${outputs.length}個のPDFをZIPにまとめました。`);
      } else if (op === "pdf-merge") {
        const pdfs = requireEntries(isPdf, "PDF");
        if (pdfs.length < 2) throw new Error("結合にはPDFが2つ以上必要です。");
        const bytes = await mergePdfs(pdfs);
        await setFinalOutput(new Blob([bytes], { type: "application/pdf" }), getOutputFilename("pdf"), false, `${pdfs.length}個のPDFを結合しました。`);
      } else if (op === "pdf-split") {
        const pdfs = requireEntries(isPdf, "PDF");
        const outputs = await splitPdfs(pdfs);
        if (!outputs.length) throw new Error("分割できるページがありません。");
        await setFinalOutput(await makeZip(outputs), getOutputFilename("zip"), true, `${outputs.length}ページ分のPDFを作成しました。`);
      } else if (op === "pdf-jpg") {
        const pdfs = requireEntries(isPdf, "PDF");
        const outputs = await pdfsToJpg(pdfs);
        if (!outputs.length) throw new Error("変換できるページがありません。");
        await setFinalOutput(await makeZip(outputs), getOutputFilename("zip"), true, `${outputs.length}枚のJPG画像を作成しました。`);
      }
    } catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : "変換中にエラーが発生しました。", true);
    } finally {
      setBusy(false);
    }
  }

  async function setFinalOutput(blob, name, alreadyZip, description) {
    const wantsZip = $("zipOutput").checked;
    if (wantsZip && !alreadyZip) {
      if (!window.JSZip) throw new Error("ZIPライブラリを読み込めませんでした。インターネット接続を確認してください。");
      const zip = new JSZip();
      zip.file(name, blob);
      blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 5 } });
      name = getOutputFilename("zip");
      alreadyZip = true;
      description += " ZIP形式で出力しました。";
    }
    setOutput(blob, name, alreadyZip, description);
  }

  function setOutput(blob, name, zip, description) {
    outputBlob = blob;
    outputName = name;
    outputIsZip = zip;
    $("resultTitle").textContent = "変換が完了しました";
    $("resultDescription").textContent = description;
    resultSection.hidden = false;
    setStatus("");
  }

  function setBusy(busy) {
    convertButton.disabled = busy || entries.length === 0;
    $("clearFiles").disabled = busy || entries.length === 0;
    convertButton.querySelector(".button-text").textContent = busy ? "変換中…" : "変換する";
    convertButton.querySelector(".spinner").hidden = !busy;
    operation.disabled = busy;
    $("sortMode").disabled = busy;
    $("chooseFiles").disabled = busy;
  }

  function downloadOutput() {
    if (!outputBlob) return;
    const url = URL.createObjectURL(outputBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outputName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  $("chooseFiles").addEventListener("click", (event) => { event.stopPropagation(); fileInput.click(); });
  dropZone.addEventListener("click", (event) => { if (event.target !== $("chooseFiles")) fileInput.click(); });
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", () => addFiles(fileInput.files));
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("dragging"); });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("dragging"); });
  }
  dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
  $("clearFiles").addEventListener("click", () => {
    entries = [];
    invalidateResult();
    updateUI();
  });
  $("sortMode").addEventListener("change", () => {
    if ($("sortMode").value !== "manual") sortEntries($("sortMode").value);
    else updateUI();
  });
  operation.addEventListener("change", () => { invalidateResult(); updateOperationHelp(); });
  convertButton.addEventListener("click", performConversion);
  downloadButton.addEventListener("click", downloadOutput);

  // タブ切り替え
  const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
  tabButtons.forEach((button) => button.addEventListener("click", () => {
    const selected = button.dataset.tab;
    tabButtons.forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== selected;
    });
    invalidateResult();
    setStatus("");
  }));

  async function getFFmpeg() {
    if (!window.FFmpeg || !window.FFmpeg.createFFmpeg) {
      throw new Error("音声変換ライブラリを読み込めませんでした。ページを再読み込みしてください。");
    }
    if (ffmpegInstance && ffmpegInstance.isLoaded()) return ffmpegInstance;
    if (ffmpegLoading) return ffmpegLoading;
    ffmpegLoading = (async () => {
      setStatus("音声変換エンジンを読み込み中です。初回は時間がかかります…");
      const instance = window.FFmpeg.createFFmpeg({
        log: false,
        mainName: "main",
        corePath: "https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js",
        progress: ({ ratio }) => {
          if (Number.isFinite(ratio)) setStatus(`変換中… ${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`);
        }
      });
      await instance.load();
      ffmpegInstance = instance;
      return instance;
    })();
    try { return await ffmpegLoading; }
    finally { ffmpegLoading = null; }
  }

  function safeVirtualName(name, fallback) {
    return safeBase(name).replace(/[^a-zA-Z0-9_\--￿]/g, "_") || fallback;
  }

  async function convertMediaFiles(files, mode) {
    if (!files.length) throw new Error("先にファイルを選択してください。");
    const ffmpeg = await getFFmpeg();
    const outputs = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const inputExt = extOf(file.name) || (mode === "audio-wav" ? "mp3" : "mp4");
      const inputName = `input_${i}.${inputExt}`;
      const outputExt = mode === "audio-wav" ? "wav" : "mp3";
      const outputVirtual = `output_${i}.${outputExt}`;
      setStatus(`変換中… ${i + 1}/${files.length}：${file.name}`);
      ffmpeg.FS("writeFile", inputName, await window.FFmpeg.fetchFile(file));
      const args = mode === "audio-wav"
        ? ["-i", inputName, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", outputVirtual]
        : ["-i", inputName, "-vn", "-codec:a", "libmp3lame", "-q:a", "2", outputVirtual];
      await ffmpeg.run(...args);
      const data = ffmpeg.FS("readFile", outputVirtual);
      outputs.push({
        name: `${safeBase(file.name)}.${outputExt}`,
        bytes: new Uint8Array(data)
      });
      try { ffmpeg.FS("unlink", inputName); } catch (_) {}
      try { ffmpeg.FS("unlink", outputVirtual); } catch (_) {}
    }
    const mime = mode === "audio-wav" ? "audio/wav" : "audio/mpeg";
    if (outputs.length === 1) {
      const name = getOutputFilename(mode === "audio-wav" ? "wav" : "mp3");
      await setFinalOutput(new Blob([outputs[0].bytes], { type: mime }), name, false, "変換が完了しました。");
    } else {
      await setFinalOutput(await makeZip(outputs), getOutputFilename("zip"), true, `${outputs.length}個のファイルを変換しました。`);
    }
  }

  $("audioInput").addEventListener("change", () => {
    audioFiles = Array.from($("audioInput").files || []);
    $("audioFileSummary").textContent = audioFiles.length ? audioFiles.map((f) => f.name).join("、") : "ファイルが選択されていません。";
    $("audioConvertButton").disabled = audioFiles.length === 0;
    invalidateResult();
  });
  $("videoInput").addEventListener("change", () => {
    videoFiles = Array.from($("videoInput").files || []);
    $("videoFileSummary").textContent = videoFiles.length ? videoFiles.map((f) => f.name).join("、") : "ファイルが選択されていません。";
    $("videoConvertButton").disabled = videoFiles.length === 0;
    invalidateResult();
  });
  async function runMediaConversion(button, files, mode) {
    button.disabled = true;
    $("chooseFiles").disabled = true;
    $("convertButton").disabled = true;
    $("audioConvertButton").disabled = true;
    $("videoConvertButton").disabled = true;
    invalidateResult();
    try { await convertMediaFiles(files, mode); }
    catch (err) {
      console.error(err);
      setStatus(err && err.message ? err.message : "変換中にエラーが発生しました。", true);
    } finally {
      button.disabled = files.length === 0;
      $("chooseFiles").disabled = false;
      $("convertButton").disabled = entries.length === 0;
      $("audioConvertButton").disabled = audioFiles.length === 0;
      $("videoConvertButton").disabled = videoFiles.length === 0;
    }
  }
  $("audioConvertButton").addEventListener("click", () => runMediaConversion($("audioConvertButton"), audioFiles, "audio-wav"));
  $("videoConvertButton").addEventListener("click", () => runMediaConversion($("videoConvertButton"), videoFiles, "video-mp3"));

  updateUI();
})();
