import { PAPER_PRESETS, PAPER_TYPES, mmToPx } from "./canvas-engine.js";
import { loadWorkList, deleteWork, renameWork, duplicateWork, estimateStorage, WORK_COUNT_WARNING } from "./storage.js";
import { confirmDialog, show, hide } from "./dialogs.js";
import { showGalleryScreen } from "./screens.js";

let onOpenWork = null;
let onCreateWork = null;
let objectUrls = [];

const grid = document.getElementById("gallery-grid");
const emptyMsg = document.getElementById("gallery-empty");
const storageHint = document.getElementById("storage-hint");
const btnNewWork = document.getElementById("btn-new-work");

const modal = document.getElementById("modal-new-work");
const presetList = document.getElementById("paper-preset-list");
const paperTypeList = document.getElementById("paper-type-list");
const chkCustom = document.getElementById("chk-custom-size");
const customInputs = document.getElementById("custom-size-inputs");
const inputWmm = document.getElementById("input-w-mm");
const inputHmm = document.getElementById("input-h-mm");
const inputTitle = document.getElementById("input-new-title");
const btnCancelNew = document.getElementById("btn-cancel-new");
const btnConfirmNew = document.getElementById("btn-confirm-new");

let selectedPresetId = "a4-h";
let selectedPaperType = "gayoshi";

export function initGallery({ onOpenWork: openCb, onCreateWork: createCb }) {
  onOpenWork = openCb;
  onCreateWork = createCb;

  buildPresetList();
  buildPaperTypeList();

  btnNewWork.addEventListener("click", () => {
    inputTitle.value = "";
    show(modal);
  });
  btnCancelNew.addEventListener("click", () => hide(modal));
  chkCustom.addEventListener("change", () => {
    customInputs.hidden = !chkCustom.checked;
  });
  btnConfirmNew.addEventListener("click", onConfirmNew);

  refreshGallery();
}

export async function showGallery() {
  showGalleryScreen();
  await refreshGallery();
}

function buildPresetList() {
  presetList.innerHTML = "";
  for (const preset of PAPER_PRESETS) {
    const btn = document.createElement("button");
    btn.className = "preset-card";
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(preset.id === selectedPresetId));
    const shape = document.createElement("div");
    shape.className = "preset-shape";
    const scale = 60 / Math.max(preset.w, preset.h);
    shape.style.width = `${Math.round(preset.w * scale)}px`;
    shape.style.height = `${Math.round(preset.h * scale)}px`;
    btn.appendChild(shape);
    btn.appendChild(document.createTextNode(preset.label));
    btn.addEventListener("click", () => {
      selectedPresetId = preset.id;
      chkCustom.checked = false;
      customInputs.hidden = true;
      [...presetList.children].forEach((c) => c.setAttribute("aria-pressed", String(c === btn)));
    });
    presetList.appendChild(btn);
  }
}

function buildPaperTypeList() {
  paperTypeList.innerHTML = "";
  for (const type of PAPER_TYPES) {
    const btn = document.createElement("button");
    btn.className = "preset-card";
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(type.id === selectedPaperType));
    btn.textContent = type.label;
    btn.addEventListener("click", () => {
      selectedPaperType = type.id;
      [...paperTypeList.children].forEach((c) => c.setAttribute("aria-pressed", String(c === btn)));
    });
    paperTypeList.appendChild(btn);
  }
}

function onConfirmNew() {
  let width;
  let height;
  if (chkCustom.checked) {
    width = mmToPx(Math.max(50, Math.min(600, Number(inputWmm.value) || 297)));
    height = mmToPx(Math.max(50, Math.min(600, Number(inputHmm.value) || 210)));
  } else {
    const preset = PAPER_PRESETS.find((p) => p.id === selectedPresetId) || PAPER_PRESETS[3];
    width = mmToPx(preset.w);
    height = mmToPx(preset.h);
  }
  const title = inputTitle.value.trim() || "むだい";
  hide(modal);
  onCreateWork?.({ width, height, paperType: selectedPaperType, title });
}

export async function refreshGallery() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];

  const list = await loadWorkList();
  grid.innerHTML = "";
  emptyMsg.hidden = list.length > 0;

  for (const work of list) {
    grid.appendChild(buildCard(work));
  }

  const est = await estimateStorage();
  let hint = "";
  if (list.length >= WORK_COUNT_WARNING) {
    hint = `さくひんが ${list.length}こ あります。いらないものを けしましょう。`;
  } else if (est && est.quota) {
    const pct = Math.round((est.usage / est.quota) * 100);
    hint = `たんまつの ようりょう を ${pct}% つかっています`;
  }
  storageHint.textContent = hint;
}

function buildCard(work) {
  const card = document.createElement("div");
  card.className = "work-card";
  card.setAttribute("role", "listitem");

  const img = document.createElement("img");
  if (work.thumb) {
    const url = URL.createObjectURL(work.thumb);
    objectUrls.push(url);
    img.src = url;
  }
  img.alt = `${work.title} のプレビュー`;
  img.addEventListener("click", () => onOpenWork?.(work.id));
  card.appendChild(img);

  const name = document.createElement("div");
  name.className = "work-name";
  name.textContent = work.title;
  name.addEventListener("click", () => onOpenWork?.(work.id));
  card.appendChild(name);

  const menuRow = document.createElement("div");
  menuRow.className = "work-menu-row";

  const renameBtn = document.createElement("button");
  renameBtn.textContent = "✎";
  renameBtn.setAttribute("aria-label", "名前をかえる");
  renameBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const next = prompt("あたらしい 名前", work.title);
    if (next && next.trim()) {
      await renameWork(work.id, next.trim().slice(0, 40));
      refreshGallery();
    }
  });

  const dupBtn = document.createElement("button");
  dupBtn.textContent = "⧉";
  dupBtn.setAttribute("aria-label", "コピーする");
  dupBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await duplicateWork(work.id);
    refreshGallery();
  });

  const delBtn = document.createElement("button");
  delBtn.textContent = "🗑";
  delBtn.setAttribute("aria-label", "けす");
  delBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog(`「${work.title}」を けしますか？\nもとに もどせません。`);
    if (ok) {
      await deleteWork(work.id);
      refreshGallery();
    }
  });

  menuRow.appendChild(renameBtn);
  menuRow.appendChild(dupBtn);
  menuRow.appendChild(delBtn);
  card.appendChild(menuRow);
  return card;
}
