export function setupPanelMinimization() {
  const minimizedBar = document.getElementById("minimized-bar");

  document.querySelectorAll(".panel").forEach((panel) => {
    const header = panel.querySelector(".panel-header");
    const title = header?.querySelector("h2")?.textContent || "Untitled";
    const minimizeBtn = header?.querySelector("button:nth-child(1)");

    if (!minimizeBtn || !minimizedBar) return;

    minimizeBtn.addEventListener("click", () => {
      panel.classList.add("hidden");

      const existingTab = minimizedBar.querySelector(
        `.minimized-tab[data-panel="${panel.id}"]`
      );
      if (existingTab) return;

      const tab = document.createElement("div");
      tab.className = "minimized-tab";
      tab.dataset.panel = panel.id;
      tab.innerHTML = `
          ${title}
          <button class="close-btn">×</button>
        `;

      tab.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("close-btn")) return;
        panel.classList.remove("hidden");
        tab.remove();
      });

      tab.querySelector(".close-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        tab.remove();
      });

      minimizedBar.appendChild(tab);
    });
  });
}
