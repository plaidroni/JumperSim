import { get } from "http";
import { getCookie, setCookie } from "../Utils";
import { PanelManager } from "./PanelManager";

interface PanelState {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface PanelOptions {
  startMinimized?: boolean;
}

export enum PanelVisibility {
  ACTIVE = "active",
  MINIMIZED = "minimized",
  CLOSED = "closed",
}

const minimizedBar = document.getElementById("minimized-bar");

/**
 * the DOM Node API may have been *more* useful for saving / removing the panels and tabs.
 * -Alex
 */

/**
 * Functionality to interact with data panels and handle minimizing, closing, and opening
 * the subwindows, along with saving/reading state.
 */
export class Panel {
  private panelElement: HTMLElement;
  private tabElement: HTMLElement | null;

  private header: HTMLElement | null;
  private title: string | null | undefined;
  private id: string;
  private isDragging: boolean = false;
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  private visibility: PanelVisibility;

  constructor(element: HTMLElement, options: PanelOptions = {}) {
    if (!element) return;

    this.panelElement = element;
    this.id = this.panelElement.id.replace("-panel", "");
    this.header = element?.querySelector(".panel-header");
    this.title = this.header?.querySelector("h2")?.textContent;

    // Register with PanelManager
    this.setupDragging();
    this.setupMinimization();

    this.initialize(options);
  }

  // this method should be deprecated and moved into the constructor
  private initialize(options: PanelOptions): void {
    this.restoreState();

    // if visibility wasn't set, i.e. no cookie, just minimize it
    if (!this.visibility) {
      this.minimize();
    }
  }

  private setupDragging(): void {
    if (!this.header) return;

    this.header.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.dragOffset = {
        x: e.clientX - this.panelElement.offsetLeft,
        y: e.clientY - this.panelElement.offsetTop,
      };
      this.panelElement.style.zIndex = "9999";
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (this.isDragging) {
        this.panelElement.style.position = "absolute";
        this.panelElement.style.left = `${e.clientX - this.dragOffset.x}px`;
        this.panelElement.style.top = `${e.clientY - this.dragOffset.y}px`;
        const newTop = Math.max(e.clientY - this.dragOffset.y, 30);
        this.panelElement.style.top = `${newTop}px`;
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
    if (!this.header) return;

    const minimizeBtn = this.header.querySelector("button:nth-child(1)");
    const closeBtn = this.header.querySelector("button:nth-child(2)");
    const title = this.header.querySelector("h2")?.textContent || "Untitled";

    if (!minimizeBtn) return;

    minimizeBtn.addEventListener("click", () => {
      this.minimize();
    });

    closeBtn?.addEventListener("click", () => {
      this.close();
    });

    // create a tab element for this panel
    const tab = document.createElement("div");
    const tabTitle = document.createTextNode(`${this.title}`);
    const tabClose = document.createElement("button", {});
    tabClose.textContent = "×";
    tab.append(tabTitle, tabClose);
    minimizedBar?.append(tab);

    tab.className = "minimized-tab";
    tabClose.className = "close-btn";

    tab.dataset.panel = this.panelElement.id;
    tab.style.display = "none";

    tab.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("close-btn")) return;
      this.maximize();
      tab.style.display = "none";
      this.saveState();
    });

    tab
      .querySelector("minimized-tab button")
      ?.addEventListener("click", (e) => {
        e.stopPropagation();
        tab.style.display = "none";
        this.saveState();
      });

    this.tabElement = tab;
  }

  // visibility setters
  /**
   * Hide the panel, show the tab.
   * @returns
   */
  public minimize(): void {
    if (this.visibility == PanelVisibility.MINIMIZED) return;
    this.visibility = PanelVisibility.MINIMIZED;
    this.panelElement.style.visibility = "hidden";
    this.tabElement?.style.removeProperty("display");

    // for all of these, probably better to auto-save on panel state change event or on timeout loop
    this.saveState();

    // TODO
    window.dispatchEvent(new CustomEvent("panelStateChanged"));
  }

  /**
   * Show the panel, hide the tab.
   * @returns
   */
  public maximize(): void {
    if (this.visibility == PanelVisibility.ACTIVE) return;
    this.visibility = PanelVisibility.ACTIVE;
    this.panelElement.style.visibility = "visible";
    this.tabElement?.style.setProperty("display", "none");
    this.saveState();

    window.dispatchEvent(new CustomEvent("panelStateChanged"));
  }

  /**
   * Hide the panel and its tab on the page.
   * @returns
   */
  public close(): void {
    if (this.visibility == PanelVisibility.CLOSED) return;

    this.visibility = PanelVisibility.CLOSED;
    this.panelElement.style.visibility = "hidden";
    this.tabElement?.style.setProperty("display", "none");
    this.saveState();

    window.dispatchEvent(new CustomEvent("panelStateChanged"));
  }

  /**
   * @returns True if this panel is active or minimized, false if this is closed.
   */
  public isVisible(): boolean {
    return this.visibility != PanelVisibility.CLOSED;
  }

  /**
   * @returns The window title, or "Untitled" if this is somehow unnamed
   */
  public getTitle(): string {
    return this.title || "Untitled";
  }

  /**
   * @returns The ID of the panel element.
   */
  public getId(): string {
    return this.id;
  }

  public isMinimizedState(): boolean {
    return this.visibility == PanelVisibility.MINIMIZED;
  }

  public saveState(): void {
    const left = parseInt(this.panelElement.style.left || "0", 10);
    const top = parseInt(this.panelElement.style.top || "0", 10);
    const width = this.panelElement.offsetWidth;
    const height = this.panelElement.offsetHeight;

    // setCookie(`panel-${this.panelElement.id}-position`, `${left},${top}`);
    // setCookie(`panel-${this.panelElement.id}-size`, `${width},${height}`);
    // setCookie(`panel-${this.panelElement.id}-vis`, `${this.visibility}`);

    let toSave = {
      pos: `${left},${top}`,
      size: `${width},${height}`,
      vis: `${this.visibility}`,
    };

    localStorage.setItem(this.panelElement.id, JSON.stringify(toSave));
  }

  // this may be more efficient to move into PanelManager, and initialize it in the constructor
  public restoreState(): void {
    // const pos = getCookie(`panel-${this.panelElement.id}-position`);
    // const size = getCookie(`panel-${this.panelElement.id}-size`);
    // const vis: PanelVisibility | string | null = getCookie(`panel-${this.panelElement.id}-vis`);

    let stored = localStorage.getItem(this.panelElement.id);
    let toRead: JSON | null = JSON.parse(stored ? stored : "{}");

    if (!toRead) return;

    if (toRead["pos"]) {
      const [left, top] = toRead["pos"].split(",");
      this.panelElement.style.position = "absolute";
      this.panelElement.style.left = `${left}px`;
      this.panelElement.style.top = `${top}px`;
    }

    if (toRead["size"]) {
      const [width, height] = toRead["size"].split(",");
      this.panelElement.style.width = `${width}px`;
      this.panelElement.style.height = `${height}px`;
    }

    if (toRead["vis"]) {
      switch (toRead["vis"]) {
        case PanelVisibility.ACTIVE:
          this.maximize();
          break;
        case PanelVisibility.CLOSED:
          this.close();
          break;
        case PanelVisibility.MINIMIZED:
          this.minimize();
          break;
        default:
          break;
      }
    }
  }

  /**
   * Center a panels's position in the window.
   */
  public center(): void {
    const panelWidth = this.panelElement.offsetWidth;
    const panelHeight = this.panelElement.offsetHeight;

    const centerX = (window.innerWidth - panelWidth) / 2;
    const centerY = (window.innerHeight - panelHeight) / 2;

    this.panelElement.style.position = "absolute";
    this.panelElement.style.left = `${centerX}px`;
    this.panelElement.style.top = `${centerY}px`;
  }
}
