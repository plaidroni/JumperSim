function setCookie(name: string, value: string, days = 7) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; expires=${expires}; path=/`;
}

function getCookie(name: string): string | null {
  return document.cookie.split("; ").find((row) => row.startsWith(name + "="))
    ? decodeURIComponent(
        document.cookie
          .split("; ")
          .find((row) => row.startsWith(name + "="))!
          .split("=")[1]
      )
    : null;
}

function restorePanelState(panel: HTMLElement) {
  const id = panel.id;

  const pos = getCookie(`panel-${id}-position`);
  const size = getCookie(`panel-${id}-size`);

  if (pos) {
    const [left, top] = pos.split(",");
    panel.style.position = "absolute";
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  if (size) {
    const [width, height] = size.split(",");
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
  }
}

function makePanelDraggable(panel: HTMLElement) {
  const header = panel.querySelector(".panel-header") as HTMLElement;
  if (!header) return;
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  header.addEventListener("mousedown", (e) => {
    isDragging = true;
    offsetX = e.clientX - panel.offsetLeft;
    offsetY = e.clientY - panel.offsetTop;
    panel.style.zIndex = "9999";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (isDragging) {
      panel.style.position = "absolute";
      panel.style.left = `${e.clientX - offsetX}px`;
      panel.style.top = `${e.clientY - offsetY}px`;
    }
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = "";

      const id = panel.id;
      const left = parseInt(panel.style.left || "0", 10);
      const top = parseInt(panel.style.top || "0", 10);
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;

      setCookie(`panel-${id}-position`, `${left},${top}`);
      setCookie(`panel-${id}-size`, `${width},${height}`);
    }
  });
}

// Initialize
document.querySelectorAll<HTMLElement>(".panel").forEach((panel) => {
  restorePanelState(panel);
  makePanelDraggable(panel);
});
