import { DockLayout, DockSide, ZoneId, defaultLayout } from "./DockLayout";
import { DockView, DockViewHost, TabInfo } from "./DockView";

/**
 * Editor dock: side dock (left/right), bottom panel, floating windows.
 * Public API is `window.dock` (see specs/editor-layout.md §5.4).
 */

const STORAGE_KEY = "jumpersim.layout.v2";
const NARROW_PX = 1100;
// element ids the old floating-window code used as localStorage keys
const LEGACY_KEYS = [
  "location-panel",
  "jump-settings-panel",
  "weatherdata-panel",
  "objects-panel",
  "following-panel",
  "speed-panel",
  "playback-panel",
  "plane-panel",
];

export class Dock implements DockViewHost {
  layout: DockLayout;
  private view: DockView;
  private tabs = new Map<string, TabInfo>();
  private saveTimer: number | null = null;

  constructor() {
    document.querySelectorAll<HTMLElement>(".dock-tab").forEach((el) => {
      const id = el.dataset.tabId!;
      this.tabs.set(id, { id, title: el.dataset.tabTitle || id, el });
    });
    this.layout = DockLayout.fromJSON(readSaved(), [...this.tabs.keys()], window.innerWidth < NARROW_PX);
    LEGACY_KEYS.forEach((k) => safeRemove(k));
    this.view = new DockView(this, this.tabs);
    this.view.render();
    this.setupMenus();
    this.setupShortcuts();
  }

  // ------------------------------------------------------------------ host

  commit(edit: (layout: DockLayout) => void) {
    edit(this.layout);
    this.view.render();
    this.syncMenus();
    this.save();
  }

  save() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.layout.toJSON()));
      } catch {
        /* storage unavailable: layout just won't persist */
      }
    }, 150);
  }

  // ------------------------------------------------------------------ API

  open(tab: string) {
    this.commit((l) => l.open(tab));
  }

  close(tab: string) {
    this.commit((l) => l.close(tab));
  }

  /** Open, activate and reveal a tab (reopening its dock if needed). */
  focus(tab: string) {
    this.commit((l) => {
      l.open(tab);
      const loc = l.find(tab);
      if (loc?.kind === "zone") l.setZoneOpen(loc.zone, true);
    });
    const el = this.tabs.get(tab)?.el;
    el?.closest(".dock-group-body")?.scrollTo({ top: 0 });
    document.getElementById(`docktab-${tab}`)?.focus({ preventScroll: true });
  }

  float(tab: string, rect = { x: 0.3, y: 0.15, w: 320, h: 260 }) {
    this.commit((l) => l.float(tab, rect));
  }

  dock(tab: string, zone?: ZoneId) {
    this.commit((l) => (zone ? l.moveToZone(tab, zone) : l.open(tab)));
  }

  setSide(side: DockSide) {
    this.commit((l) => l.setSide(side));
  }

  toggleZone(zone: ZoneId, open?: boolean) {
    this.commit((l) => l.setZoneOpen(zone, open ?? !l.state[zone].open));
  }

  reset() {
    safeRemove(STORAGE_KEY);
    this.layout = new DockLayout(defaultLayout(window.innerWidth < NARROW_PX));
    this.commit(() => {});
  }

  isVisible(tab: string) {
    return this.layout.visibleTabs().includes(tab);
  }

  // ------------------------------------------------------------------ menus

  private setupMenus() {
    const menu = document.getElementById("window-menu");
    if (menu) {
      menu.replaceChildren();
      this.tabs.forEach((info, id) => {
        menu.appendChild(
          menuItem(`show-${id}`, info.title, () => {
            this.commit((l) => (l.isOpen(id) ? l.close(id) : l.open(id)));
          }),
        );
      });
      menu.appendChild(document.createElement("hr"));
      menu.appendChild(menuItem("toggle-side-dock", "Side Dock", () => this.toggleZone("side"), "Ctrl+B"));
      menu.appendChild(menuItem("toggle-bottom-panel", "Bottom Panel", () => this.toggleZone("bottom"), "Ctrl+J"));
      menu.appendChild(document.createElement("hr"));
      const reset = menuItem("reset-layout", "Reset Layout", () => this.reset());
      reset.querySelector("input")?.remove();
      menu.appendChild(reset);
    }
    document.querySelectorAll<HTMLElement>("[data-dock-side]").forEach((item) => {
      if (item.id !== "dock-side-left" && item.id !== "dock-side-right") return;
      item.addEventListener("click", (e) => {
        e.preventDefault();
        this.setSide(item.dataset.dockSide as DockSide);
      });
    });
    this.syncMenus();
  }

  private syncMenus() {
    const s = this.layout.state;
    this.tabs.forEach((_, id) => setChecked(`show-${id}`, this.layout.isOpen(id)));
    setChecked("toggle-side-dock", s.side.open);
    setChecked("toggle-bottom-panel", s.bottom.open);
    setChecked("dock-side-left", s.dockSide === "left");
    setChecked("dock-side-right", s.dockSide === "right");
  }

  private setupShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        this.toggleZone("side");
      } else if (k === "j") {
        e.preventDefault();
        this.toggleZone("bottom");
      }
    });
  }
}

let instance: Dock | null = null;

/** Build the dock from the `.dock-tab` sections in index.html (once). */
export function initializeDock(): Dock {
  if (!instance) {
    instance = new Dock();
    (window as any).dock = instance;
  }
  return instance;
}

// ---------------------------------------------------------------------- helpers

function readSaved(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function menuItem(id: string, label: string, onClick: () => void, hint?: string) {
  const item = document.createElement("div");
  item.className = "dropdown-item";
  item.id = id;
  item.setAttribute("role", "menuitemcheckbox");
  const span = document.createElement("span");
  span.textContent = hint ? `${label}  (${hint})` : label;
  const box = document.createElement("input");
  box.type = "checkbox";
  box.tabIndex = -1;
  item.append(span, box);
  item.addEventListener("click", (e) => {
    e.preventDefault(); // the dock decides the checkbox state
    onClick();
  });
  return item;
}

function setChecked(id: string, checked: boolean) {
  const item = document.getElementById(id);
  const box = item?.querySelector("input[type=checkbox]") as HTMLInputElement | null;
  if (box) box.checked = checked;
  item?.setAttribute("aria-checked", String(checked));
}
