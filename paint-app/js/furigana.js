const KEY = "sketchnote_furigana";

function readPref() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch (e) {
    return false;
  }
}

function writePref(on) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch (e) {
    /* ストレージが使えない場合は保存しないだけで動作は続ける */
  }
}

export function initFurigana(toggleBtn) {
  const on = readPref();
  document.body.classList.toggle("furigana-on", on);
  toggleBtn.setAttribute("aria-pressed", String(on));
  toggleBtn.addEventListener("click", () => {
    const next = !document.body.classList.contains("furigana-on");
    document.body.classList.toggle("furigana-on", next);
    toggleBtn.setAttribute("aria-pressed", String(next));
    writePref(next);
  });
}
