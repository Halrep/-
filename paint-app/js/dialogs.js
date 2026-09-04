export function show(el) {
  el.hidden = false;
}

export function hide(el) {
  el.hidden = true;
}

export function confirmDialog(message, confirmLabel = "けす") {
  const overlay = document.getElementById("confirm-dialog");
  const msgEl = document.getElementById("confirm-message");
  const yesBtn = document.getElementById("btn-confirm-yes");
  const noBtn = document.getElementById("btn-confirm-no");
  msgEl.textContent = message;
  yesBtn.textContent = confirmLabel;
  show(overlay);
  return new Promise((resolve) => {
    const cleanup = (result) => {
      hide(overlay);
      yesBtn.removeEventListener("click", onYes);
      noBtn.removeEventListener("click", onNo);
      resolve(result);
    };
    const onYes = () => cleanup(true);
    const onNo = () => cleanup(false);
    yesBtn.addEventListener("click", onYes);
    noBtn.addEventListener("click", onNo);
  });
}

export function positionPopover(popoverEl, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const popRect = popoverEl.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - popRect.width / 2;
  left = Math.max(8, Math.min(window.innerWidth - popRect.width - 8, left));
  const top = rect.top - popRect.height - 12;
  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${Math.max(8, top)}px`;
  const arrow = popoverEl.querySelector(".popover-arrow");
  if (arrow) arrow.style.left = `${rect.left + rect.width / 2 - left - 8}px`;
}
