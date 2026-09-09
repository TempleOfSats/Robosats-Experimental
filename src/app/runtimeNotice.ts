// Each runtime owns its notice, even when two owners report identical messages.
export function reportRuntimeUnavailable(message: string): () => void {
  const notice = document.getElementById("app-runtime-notice");
  const copy = notice?.querySelector(".app-runtime-notice-copy");
  if (!notice || !copy) return () => {};
  const failure = document.createElement("span");
  failure.textContent = `${message} `;
  copy.appendChild(failure);
  notice.hidden = false;
  return () => {
    failure.remove();
    notice.hidden = copy.childElementCount === 0;
  };
}
