const galleryEl = document.getElementById("screen-gallery");
const editorEl = document.getElementById("screen-editor");

export function showGalleryScreen() {
  galleryEl.hidden = false;
  editorEl.hidden = true;
}

export function showEditorScreen() {
  galleryEl.hidden = true;
  editorEl.hidden = false;
}
