import { initFurigana } from "./furigana.js";
import { initGallery, showGallery } from "./gallery.js";
import { initEditor, openWork, openNewWork } from "./editor.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initFurigana(document.getElementById("btn-furigana"));
  initEditor();
  initGallery({ onOpenWork: openWork, onCreateWork: openNewWork });
  showGallery();
});
