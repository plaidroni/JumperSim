import { getCookie, setCookie } from "../utils";

interface PanelState {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface PanelOptions {
  startMinimized?: boolean;
}

export class Panel {
  private element: HTMLElement;
  private header: HTMLElement | null;
  private minimizedBar: HTMLElement | null;
  private isDragging: boolean = false;
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  private options: PanelOptions;

  constructor(element: HTMLElement, options: PanelOptions = {}) {
    this.element = element;
    this.header = element.querySelector(".panel-header");
    this.minimizedBar = document.getElementById("minimized-bar");
    this.options = options;
    this.initialize();
  }

  private initialize(): void {
    this.restoreState();
    this.setupDragging();
    this.setupMinimization();
    
    // Hide content initially except for playback panel
    if (this.element.id !== "playback") {
      const content = this.element.querySelector(".panel-content") as HTMLElement;
      if (content) {
        content.style.display = "none";
      }
    }

    // Handle startup minimization
    if (this.options.startMinimized) {
      const title = this.header?.querySelector("h2")?.textContent || "Untitled";
      this.minimize(title);
    }
  }

  private setupDragging(): void {
    if (!this.header) return;

    this.header.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.dragOffset = {
        x: e.clientX - this.element.offsetLeft,
        y: e.clientY - this.element.offsetTop
      };
      this.element.style.zIndex = "9999";
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (this.isDragging) {
        this.element.style.position = "absolute";
        this.element.style.left = `${e.clientX - this.dragOffset.x}px`;
        this.element.style.top = `${e.clientY - this.dragOffset.y}px`;
      }
    });

    document.addEventListener("mouseup", () => {
      if (this.isDragging) {
        this.isDragging = false;
        document.body.style.userSelect = "";
        this.saveState();
      }
    });
  }

  private setupMinimization(): void {
    if (!this.header || !this.minimizedBar) return;

    const minimizeBtn = this.header.querySelector("button:nth-child(1)");
    const title = this.header.querySelector("h2")?.textContent || "Untitled";

    if (!minimizeBtn) return;

    minimizeBtn.addEventListener("click", () => {
      this.minimize(title);
    });
  }

  private minimize(title: string): void {
    if (!this.minimizedBar) return;

    this.element.classList.add("hidden");

    const existingTab = this.minimizedBar.querySelector(
      `.minimized-tab[data-panel="${this.element.id}"]`
    );
    if (existingTab) return;

    const tab = document.createElement("div");
    tab.className = "minimized-tab";
    tab.dataset.panel = this.element.id;
    tab.innerHTML = `
      ${title}
      <button class="close-btn">×</button>
    `;

    tab.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("close-btn")) return;
      this.maximize();
      tab.remove();
    });

    tab.querySelector(".close-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      tab.remove();
    });

    this.minimizedBar.appendChild(tab);
  }

  private maximize(): void {
    this.element.classList.remove("hidden");
  }

  private saveState(): void {
    const left = parseInt(this.element.style.left || "0", 10);
    const top = parseInt(this.element.style.top || "0", 10);
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;

    setCookie(`panel-${this.element.id}-position`, `${left},${top}`);
    setCookie(`panel-${this.element.id}-size`, `${width},${height}`);
  }

  private restoreState(): void {
    const pos = getCookie(`panel-${this.element.id}-position`);
    const size = getCookie(`panel-${this.element.id}-size`);

    if (pos) {
      const [left, top] = pos.split(",");
      this.element.style.position = "absolute";
      this.element.style.left = `${left}px`;
      this.element.style.top = `${top}px`;
    }

    if (size) {
      const [width, height] = size.split(",");
      this.element.style.width = `${width}px`;
      this.element.style.height = `${height}px`;
    }
  }

  public center(): void {
    const panelWidth = this.element.offsetWidth;
    const panelHeight = this.element.offsetHeight;

    const centerX = (window.innerWidth - panelWidth) / 2;
    const centerY = (window.innerHeight - panelHeight) / 2;

    this.element.style.position = "absolute";
    this.element.style.left = `${centerX}px`;
    this.element.style.top = `${centerY}px`;
  }

  static initialize(defaultOptions: PanelOptions = {}): void {
    document.querySelectorAll<HTMLElement>(".panel").forEach(panel => {
    
      if (panel.id === "info-tooltip") {
        return;
      }

      // Allow for panel-specific options based on ID or class
      const options = {
        ...defaultOptions,
        // You can add panel-specific options here based on panel.id or panel.classList
        startMinimized: defaultOptions.startMinimized || panel.id !== "playback-panel" // Example: keep playback panel visible
      };
      new Panel(panel, options);
    });
  }

  static reCenterAllWindows(): void {
    document.querySelectorAll<HTMLElement>(".panel").forEach(panel => {
      const panelInstance = new Panel(panel);
      panelInstance.center();
    });
  }
}
