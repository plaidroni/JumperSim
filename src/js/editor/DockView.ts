import {
  BOTTOM_LIMITS,
  DockLayout,
  FloatGroup,
  Group,
  MAX_SIDE_GROUPS,
  SIDE_LIMITS,
  TabLocation,
  ZoneId,
} from "./DockLayout";

/**
 * Renders a DockLayout into the page and turns pointer/keyboard input into layout
 * edits: tab strips, drag & drop, floating windows, splitters and context menus.
 * All edits go through `commit()`, which updates the model, re-renders and saves.
 */

export interface TabInfo {
  id: string;
  title: string;
  el: HTMLElement;
}

export interface DockViewHost {
  layout: DockLayout;
  /** Apply an edit to the layout, then re-render and persist. */
  commit(edit: (layout: DockLayout) => void): void;
  /** Persist without re-rendering (live resize/move already updated the DOM). */
  save(): void;
}

type DropTarget =
  | { kind: "insert"; loc: TabLocation; marker: DOMRect }
  | { kind: "split"; area: DOMRect }
  | { kind: "float"; x: number; y: number }
  | null;

type MenuItem = { label: string; action?: () => void; disabled?: boolean } | "sep";

const DRAG_THRESHOLD = 5;

export class DockView {
  private host: DockViewHost;
  private tabs: Map<string, TabInfo>;
  private editor: HTMLElement;
  private sideEl: HTMLElement;
  private bottomEl: HTMLElement;
  private floatLayer: HTMLElement;
  private viewport: HTMLElement;
  private store: HTMLElement;
  private visible = new Set<string>();
  private menuEl: HTMLElement | null = null;

  constructor(host: DockViewHost, tabs: Map<string, TabInfo>) {
    this.host = host;
    this.tabs = tabs;
    this.editor = byId("editor");
    this.sideEl = byId("dock-side");
    this.bottomEl = byId("dock-bottom");
    this.floatLayer = byId("float-layer");
    this.viewport = byId("viewport");
    this.store = byId("dock-tab-store");
    this.setupZoneSplitters();
    window.addEventListener("resize", () => this.applyZoneSizes());
    new ResizeObserver(() => this.layoutFloats()).observe(this.viewport);
    document.addEventListener("pointerdown", (e) => {
      if (this.menuEl && !this.menuEl.contains(e.target as Node)) this.closeMenu();
    });
  }

  // ================================================================== render

  render() {
    const s = this.host.layout.state;
    const scroll = this.captureScroll();
    this.closeMenu();

    this.editor.dataset.dockSide = s.dockSide;
    this.editor.classList.toggle("side-closed", !s.side.open);
    this.editor.classList.toggle("bottom-closed", !s.bottom.open);
    this.applyZoneSizes();

    // park every tab in the store, then hand them out to their groups
    this.tabs.forEach((t) => {
      t.el.hidden = true;
      this.store.appendChild(t.el);
    });

    this.sideEl.replaceChildren();
    s.side.groups.forEach((g, i) => {
      if (i > 0) this.sideEl.appendChild(this.makeGroupSplitter());
      const el = this.makeGroup(g, { kind: "zone", zone: "side", group: i });
      el.style.setProperty("--group-flex", String(g.split ?? 1 / s.side.groups.length));
      this.sideEl.appendChild(el);
    });

    this.bottomEl.replaceChildren();
    s.bottom.groups.slice(0, 1).forEach((g) =>
      this.bottomEl.appendChild(this.makeGroup(g, { kind: "zone", zone: "bottom", group: 0 })),
    );

    this.floatLayer.replaceChildren();
    s.floating.forEach((g, i) => this.floatLayer.appendChild(this.makeFloat(g, i)));
    this.layoutFloats();

    this.restoreScroll(scroll);
    this.updateOverflowButtons();
    this.emitVisibility();
  }

  /** Size the docks from the layout, clamped to the current window. */
  applyZoneSizes() {
    const s = this.host.layout.state;
    const side = clamp(s.side.size, SIDE_LIMITS.min, window.innerWidth * SIDE_LIMITS.maxFrac);
    const bottom = clamp(s.bottom.size, BOTTOM_LIMITS.min, window.innerHeight * BOTTOM_LIMITS.maxFrac);
    if (s.side.open) this.editor.style.setProperty("--side-w", `${side}px`);
    else this.editor.style.removeProperty("--side-w");
    if (s.bottom.open) this.editor.style.setProperty("--bottom-h", `${bottom}px`);
    else this.editor.style.removeProperty("--bottom-h");
  }

  private makeGroup(group: Group, loc: { kind: "zone"; zone: ZoneId; group: number } | { kind: "float"; float: number }) {
    const el = document.createElement("div");
    el.className = "dock-group";
    el.dataset.kind = loc.kind;
    if (loc.kind === "zone") {
      el.dataset.zone = loc.zone;
      el.dataset.group = String(loc.group);
    } else {
      el.dataset.float = String(loc.float);
    }

    // --- tab strip
    const strip = document.createElement("div");
    strip.className = "dock-tabstrip";
    const tabsEl = document.createElement("div");
    tabsEl.className = "dock-tabs";
    tabsEl.setAttribute("role", "tablist");
    tabsEl.setAttribute("aria-orientation", "horizontal");
    group.tabs.forEach((id) => {
      const info = this.tabs.get(id);
      if (info) tabsEl.appendChild(this.makeTabButton(info, id === group.active));
    });
    strip.appendChild(tabsEl);

    const actions = document.createElement("div");
    actions.className = "dock-strip-actions";
    actions.appendChild(
      this.stripButton("+", "Open a closed tab here", (e) => this.showAddMenu(e, loc, group)),
    );
    const overflow = this.stripButton("⌄", "All tabs in this group", (e) =>
      this.showMenuAt(e, group.tabs.map((id) => ({
        label: this.tabs.get(id)?.title ?? id,
        action: () => this.host.commit((l) => l.activate(id)),
      }))),
    );
    overflow.dataset.role = "overflow";
    overflow.hidden = true;
    actions.appendChild(overflow);
    if (loc.kind === "zone" && loc.group === 0) {
      const shortcut = loc.zone === "side" ? "Ctrl+B" : "Ctrl+J";
      const label = loc.zone === "side" ? "side dock" : "bottom panel";
      actions.appendChild(
        this.stripButton("✕", `Close the ${label} (${shortcut})`, () =>
          this.host.commit((l) => l.setZoneOpen(loc.zone, false)),
        ),
      );
    }
    if (loc.kind === "float") {
      actions.appendChild(
        this.stripButton("⧉", "Dock this window", () => this.host.commit((l) => l.dockFloat(loc.float))),
      );
      actions.appendChild(
        this.stripButton("×", "Close this window", () => this.host.commit((l) => l.closeFloat(loc.float))),
      );
    }
    strip.appendChild(actions);
    el.appendChild(strip);

    // --- body
    const body = document.createElement("div");
    body.className = "dock-group-body";
    body.setAttribute("role", "tabpanel");
    if (group.tabs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dock-empty";
      empty.textContent = "Drag a tab here, or use + to open one.";
      body.appendChild(empty);
    }
    group.tabs.forEach((id) => {
      const info = this.tabs.get(id);
      if (!info) return;
      info.el.hidden = id !== group.active;
      info.el.setAttribute("role", "tabpanel");
      info.el.setAttribute("aria-labelledby", `docktab-${id}`);
      body.appendChild(info.el);
    });
    if (group.active) body.dataset.active = group.active;
    el.appendChild(body);
    return el;
  }

  private makeTabButton(info: TabInfo, active: boolean) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dock-tab-button";
    b.id = `docktab-${info.id}`;
    b.dataset.tab = info.id;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(active));
    b.setAttribute("aria-controls", info.el.id);
    b.tabIndex = active ? 0 : -1;
    b.title = `${info.title} (drag to move, middle-click to close)`;
    const label = document.createElement("span");
    label.textContent = info.title;
    const close = document.createElement("span");
    close.className = "dock-tab-close";
    close.textContent = "×";
    close.setAttribute("aria-hidden", "true");
    close.title = `Close ${info.title}`;
    b.append(label, close);

    b.addEventListener("pointerdown", (e) => this.onTabPointerDown(e, info.id));
    b.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.host.commit((l) => l.close(info.id));
      }
    });
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showTabMenu(e, info.id);
    });
    b.addEventListener("keydown", (e) => this.onTabKey(e, info.id));
    return b;
  }

  private makeFloat(g: FloatGroup, index: number) {
    const win = document.createElement("div");
    win.className = "dock-float";
    win.dataset.float = String(index);
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-modal", "false");
    if (g.active) win.setAttribute("aria-labelledby", `docktab-${g.active}`);
    win.style.zIndex = String(10 + (g.z || 0));
    win.appendChild(this.makeGroup(g, { kind: "float", float: index }));
    for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
      const h = document.createElement("div");
      h.className = "dock-float-handle";
      h.dataset.edge = edge;
      h.addEventListener("pointerdown", (e) => this.onFloatResizeStart(e, index, edge));
      win.appendChild(h);
    }
    // move by dragging the empty part of the strip
    const strip = win.querySelector(".dock-tabstrip") as HTMLElement;
    strip.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".dock-tab-button") || t.closest(".dock-strip-btn")) return;
      this.onFloatMoveStart(e, index);
    });
    win.addEventListener("pointerdown", () => {
      // bring to front without a full re-render
      const s = this.host.layout.state;
      const top = s.floating.reduce((m, f) => Math.max(m, f.z || 0), 0);
      if ((g.z || 0) < top) {
        g.z = top + 1;
        win.style.zIndex = String(10 + g.z);
        this.host.save();
      }
    });
    return win;
  }

  /** Position floating windows from their saved fractions, kept inside the viewport. */
  layoutFloats() {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    this.floatLayer.querySelectorAll<HTMLElement>(".dock-float").forEach((win) => {
      const g = this.host.layout.state.floating[Number(win.dataset.float)];
      if (!g) return;
      const w = Math.min(g.w, vw);
      const h = Math.min(g.h, vh);
      const x = clamp(g.x * vw, 0, Math.max(0, vw - w));
      const y = clamp(g.y * vh, 0, Math.max(0, vh - h));
      Object.assign(win.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    });
  }

  private makeGroupSplitter() {
    const sp = document.createElement("div");
    sp.className = "dock-group-splitter";
    sp.setAttribute("role", "separator");
    sp.setAttribute("aria-orientation", "horizontal");
    sp.setAttribute("aria-label", "Resize tab groups");
    sp.tabIndex = 0;
    sp.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      sp.classList.add("is-dragging");
      const rect = this.sideEl.getBoundingClientRect();
      const groups = this.sideEl.querySelectorAll<HTMLElement>(":scope > .dock-group");
      const move = (ev: PointerEvent) => {
        const share = clamp((ev.clientY - rect.top) / rect.height, 0.15, 0.85);
        groups[0]?.style.setProperty("--group-flex", String(share));
        groups[1]?.style.setProperty("--group-flex", String(1 - share));
        this.host.layout.setSideSplit(share);
      };
      const up = () => {
        sp.classList.remove("is-dragging");
        sp.removeEventListener("pointermove", move);
        sp.removeEventListener("pointerup", up);
        this.host.save();
      };
      sp.addEventListener("pointermove", move);
      sp.addEventListener("pointerup", up);
    });
    sp.addEventListener("keydown", (e) => {
      const g = this.host.layout.state.side.groups;
      if (g.length !== 2) return;
      const step = e.key === "ArrowUp" ? -0.05 : e.key === "ArrowDown" ? 0.05 : 0;
      if (!step) return;
      e.preventDefault();
      this.host.commit((l) => l.setSideSplit((g[0].split ?? 0.5) + step));
      (this.sideEl.querySelector(".dock-group-splitter") as HTMLElement)?.focus();
    });
    return sp;
  }

  private stripButton(text: string, title: string, onClick: (e: MouseEvent) => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dock-strip-btn";
    b.textContent = text;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(e);
    });
    return b;
  }

  private updateOverflowButtons() {
    this.editor.querySelectorAll<HTMLElement>(".dock-tabstrip").forEach((strip) => {
      const tabsEl = strip.querySelector(".dock-tabs") as HTMLElement;
      const btn = strip.querySelector('[data-role="overflow"]') as HTMLElement | null;
      if (btn) btn.hidden = !(tabsEl.scrollWidth > tabsEl.clientWidth + 1);
      tabsEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  private captureScroll() {
    const out = new Map<string, number>();
    this.editor.querySelectorAll<HTMLElement>(".dock-group-body").forEach((b) => {
      if (b.dataset.active) out.set(b.dataset.active, b.scrollTop);
    });
    return out;
  }

  private restoreScroll(scroll: Map<string, number>) {
    this.editor.querySelectorAll<HTMLElement>(".dock-group-body").forEach((b) => {
      const top = b.dataset.active ? scroll.get(b.dataset.active) : undefined;
      if (top) b.scrollTop = top;
    });
  }

  private emitVisibility() {
    const now = new Set(this.host.layout.visibleTabs());
    now.forEach((t) => {
      if (!this.visible.has(t)) window.dispatchEvent(new CustomEvent("tab-shown", { detail: { tab: t } }));
    });
    this.visible.forEach((t) => {
      if (!now.has(t)) window.dispatchEvent(new CustomEvent("tab-hidden", { detail: { tab: t } }));
    });
    this.visible = now;
  }

  // ================================================================== tabs: click, keys, drag

  private onTabKey(e: KeyboardEvent, tab: string) {
    const list = (e.currentTarget as HTMLElement).parentElement!;
    const buttons = [...list.querySelectorAll<HTMLButtonElement>(".dock-tab-button")];
    const i = buttons.findIndex((b) => b.dataset.tab === tab);
    let next: HTMLButtonElement | undefined;
    if (e.key === "ArrowRight") next = buttons[(i + 1) % buttons.length];
    else if (e.key === "ArrowLeft") next = buttons[(i - 1 + buttons.length) % buttons.length];
    else if (e.key === "Home") next = buttons[0];
    else if (e.key === "End") next = buttons[buttons.length - 1];
    else if (e.key === "Delete") {
      e.preventDefault();
      this.host.commit((l) => l.close(tab));
      return;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.host.commit((l) => l.activate(tab));
      return;
    }
    if (next) {
      e.preventDefault();
      const id = next.dataset.tab!;
      this.host.commit((l) => l.activate(id));
      document.getElementById(`docktab-${id}`)?.focus();
    }
  }

  private onTabPointerDown(e: PointerEvent, tab: string) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".dock-tab-close")) {
      e.preventDefault();
      e.stopPropagation();
      this.host.commit((l) => l.close(tab));
      return;
    }
    e.stopPropagation(); // don't start a floating-window move
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let drop: DropTarget = null;
    const marker = document.createElement("div");
    marker.className = "dock-drop-marker";
    const area = document.createElement("div");
    area.className = "dock-drop-area";

    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("keydown", key, true);
      ghost?.remove();
      marker.remove();
      area.remove();
      document.body.classList.remove("dock-dragging");
    };
    const move = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        ghost = document.createElement("div");
        ghost.className = "dock-drag-ghost";
        ghost.textContent = this.tabs.get(tab)?.title ?? tab;
        document.body.append(ghost);
        document.body.classList.add("dock-dragging");
      }
      ghost!.style.left = `${ev.clientX + 12}px`;
      ghost!.style.top = `${ev.clientY + 8}px`;
      drop = this.findDropTarget(ev.clientX, ev.clientY, tab);
      marker.remove();
      area.remove();
      if (drop?.kind === "insert") {
        Object.assign(marker.style, {
          left: `${drop.marker.left - 1}px`,
          top: `${drop.marker.top}px`,
          height: `${drop.marker.height}px`,
        });
        document.body.appendChild(marker);
      } else if (drop?.kind === "split") {
        placeRect(area, drop.area);
        document.body.appendChild(area);
      } else if (drop?.kind === "float") {
        placeRect(area, new DOMRect(drop.x - 20, drop.y - 14, 320, 240));
        document.body.appendChild(area);
      }
    };
    const up = () => {
      cleanup();
      if (!dragging) {
        this.host.commit((l) => l.activate(tab));
        document.getElementById(`docktab-${tab}`)?.focus();
        return;
      }
      this.applyDrop(tab, drop);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        dragging = false;
        drop = null;
        cleanup();
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("keydown", key, true);
  }

  private findDropTarget(x: number, y: number, tab: string): DropTarget {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;
    const s = this.host.layout.state;

    const strip = el.closest(".dock-tabstrip") as HTMLElement | null;
    const groupEl = el.closest(".dock-group") as HTMLElement | null;
    if (strip && groupEl) {
      const loc = this.groupLoc(groupEl);
      const buttons = [...strip.querySelectorAll<HTMLElement>(".dock-tab-button")];
      let index = buttons.length;
      for (let i = 0; i < buttons.length; i++) {
        const r = buttons[i].getBoundingClientRect();
        if (x < r.left + r.width / 2) {
          index = i;
          break;
        }
      }
      const tabsRect = (strip.querySelector(".dock-tabs") as HTMLElement).getBoundingClientRect();
      const markerX =
        index < buttons.length
          ? buttons[index].getBoundingClientRect().left
          : buttons.length
            ? buttons[buttons.length - 1].getBoundingClientRect().right
            : tabsRect.left + 4;
      const sr = strip.getBoundingClientRect();
      return { kind: "insert", loc: { ...loc, index } as TabLocation, marker: new DOMRect(markerX, sr.top, 2, sr.height) };
    }

    if (groupEl) {
      const loc = this.groupLoc(groupEl);
      const r = groupEl.getBoundingClientRect();
      const lowerHalf = y > r.top + r.height / 2;
      if (loc.kind === "zone" && loc.zone === "side" && s.side.groups.length < MAX_SIDE_GROUPS && lowerHalf) {
        const only = s.side.groups[0];
        if (!(only.tabs.length === 1 && only.tabs[0] === tab)) {
          return { kind: "split", area: new DOMRect(r.left, r.top + r.height / 2, r.width, r.height / 2) };
        }
      }
      // anywhere else on a group: add to the end of it
      const group = loc.kind === "zone" ? s[loc.zone].groups[loc.group] : s.floating[loc.float];
      const sr = (groupEl.querySelector(".dock-tabstrip") as HTMLElement).getBoundingClientRect();
      const last = groupEl.querySelector(".dock-tab-button:last-of-type") as HTMLElement | null;
      const mx = last ? last.getBoundingClientRect().right : sr.left + 4;
      return {
        kind: "insert",
        loc: { ...loc, index: group?.tabs.length ?? 0 } as TabLocation,
        marker: new DOMRect(mx, sr.top, 2, sr.height),
      };
    }

    const vr = this.viewport.getBoundingClientRect();
    if (x >= vr.left && x <= vr.right && y >= vr.top && y <= vr.bottom) {
      return { kind: "float", x, y };
    }
    return null;
  }

  private groupLoc(groupEl: HTMLElement): { kind: "zone"; zone: ZoneId; group: number } | { kind: "float"; float: number } {
    return groupEl.dataset.kind === "float"
      ? { kind: "float", float: Number(groupEl.dataset.float) }
      : { kind: "zone", zone: groupEl.dataset.zone as ZoneId, group: Number(groupEl.dataset.group) };
  }

  private applyDrop(tab: string, drop: DropTarget) {
    if (!drop) return;
    if (drop.kind === "insert") this.host.commit((l) => l.insert(tab, drop.loc));
    else if (drop.kind === "split") this.host.commit((l) => l.splitSide(tab));
    else if (drop.kind === "float") {
      const vr = this.viewport.getBoundingClientRect();
      const w = 320;
      const h = 260;
      this.host.commit((l) =>
        l.float(tab, {
          x: (drop.x - vr.left - 20) / vr.width,
          y: (drop.y - vr.top - 14) / vr.height,
          w,
          h,
        }),
      );
    }
  }

  // ================================================================== floating: move / resize

  private onFloatMoveStart(e: PointerEvent, index: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    const win = this.floatLayer.querySelector<HTMLElement>(`.dock-float[data-float="${index}"]`);
    if (!win) return;
    const vr = this.viewport.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, left: win.offsetLeft, top: win.offsetTop };
    const move = (ev: PointerEvent) => {
      const left = clamp(start.left + ev.clientX - start.x, 0, Math.max(0, vr.width - win.offsetWidth));
      const top = clamp(start.top + ev.clientY - start.y, 0, Math.max(0, vr.height - win.offsetHeight));
      win.style.left = `${left}px`;
      win.style.top = `${top}px`;
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      this.host.layout.setFloatRect(index, {
        x: win.offsetLeft / vr.width,
        y: win.offsetTop / vr.height,
      });
      this.host.save();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  private onFloatResizeStart(e: PointerEvent, index: number, edge: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const win = this.floatLayer.querySelector<HTMLElement>(`.dock-float[data-float="${index}"]`);
    if (!win) return;
    const vr = this.viewport.getBoundingClientRect();
    const s = { x: e.clientX, y: e.clientY, l: win.offsetLeft, t: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight };
    const MIN_W = 220;
    const MIN_H = 140;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - s.x;
      const dy = ev.clientY - s.y;
      let { l, t, w, h } = s;
      if (edge.includes("e")) w = clamp(s.w + dx, MIN_W, vr.width - s.l);
      if (edge.includes("s")) h = clamp(s.h + dy, MIN_H, vr.height - s.t);
      if (edge.includes("w")) {
        const nl = clamp(s.l + dx, 0, s.l + s.w - MIN_W);
        w = s.w + (s.l - nl);
        l = nl;
      }
      if (edge.includes("n")) {
        const nt = clamp(s.t + dy, 0, s.t + s.h - MIN_H);
        h = s.h + (s.t - nt);
        t = nt;
      }
      Object.assign(win.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` });
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      this.host.layout.setFloatRect(index, {
        x: win.offsetLeft / vr.width,
        y: win.offsetTop / vr.height,
        w: win.offsetWidth,
        h: win.offsetHeight,
      });
      this.host.save();
      this.updateOverflowButtons();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // ================================================================== zone splitters

  private setupZoneSplitters() {
    const sideSp = byId("splitter-side");
    const bottomSp = byId("splitter-bottom");

    const drag = (sp: HTMLElement, zone: ZoneId) => (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sp.setPointerCapture(e.pointerId);
      sp.classList.add("is-dragging");
      const s = this.host.layout.state;
      const start = { x: e.clientX, y: e.clientY, size: zone === "side" ? this.sideEl.offsetWidth : this.bottomEl.offsetHeight };
      const move = (ev: PointerEvent) => {
        let size: number;
        if (zone === "side") {
          const dx = ev.clientX - start.x;
          size = start.size + (s.dockSide === "right" ? -dx : dx);
          size = clamp(size, SIDE_LIMITS.min, window.innerWidth * SIDE_LIMITS.maxFrac);
        } else {
          size = clamp(start.size - (ev.clientY - start.y), BOTTOM_LIMITS.min, window.innerHeight * BOTTOM_LIMITS.maxFrac);
        }
        this.host.layout.setZoneSize(zone, size);
        requestAnimationFrame(() => this.applyZoneSizes());
      };
      const up = () => {
        sp.classList.remove("is-dragging");
        sp.removeEventListener("pointermove", move);
        sp.removeEventListener("pointerup", up);
        this.host.save();
        this.updateOverflowButtons();
      };
      sp.addEventListener("pointermove", move);
      sp.addEventListener("pointerup", up);
    };
    sideSp.addEventListener("pointerdown", drag(sideSp, "side"));
    bottomSp.addEventListener("pointerdown", drag(bottomSp, "bottom"));

    sideSp.addEventListener("dblclick", () => this.host.commit((l) => l.setZoneSize("side", SIDE_LIMITS.def)));
    bottomSp.addEventListener("dblclick", () => this.host.commit((l) => l.setZoneSize("bottom", BOTTOM_LIMITS.def)));

    sideSp.addEventListener("keydown", (e) => {
      const s = this.host.layout.state;
      const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (!dir) return;
      e.preventDefault();
      const grow = s.dockSide === "right" ? -dir : dir;
      this.host.layout.setZoneSize(
        "side",
        clamp(this.sideEl.offsetWidth + grow * 16, SIDE_LIMITS.min, window.innerWidth * SIDE_LIMITS.maxFrac),
      );
      this.applyZoneSizes();
      this.host.save();
    });
    bottomSp.addEventListener("keydown", (e) => {
      const dir = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      this.host.layout.setZoneSize(
        "bottom",
        clamp(this.bottomEl.offsetHeight + dir * 16, BOTTOM_LIMITS.min, window.innerHeight * BOTTOM_LIMITS.maxFrac),
      );
      this.applyZoneSizes();
      this.host.save();
    });
  }

  // ================================================================== menus

  private showTabMenu(e: MouseEvent, tab: string) {
    const l = this.host.layout;
    const loc = l.find(tab);
    if (!loc) return;
    const s = l.state;
    const inSide = loc.kind === "zone" && loc.zone === "side";
    const inBottom = loc.kind === "zone" && loc.zone === "bottom";
    const vr = this.viewport.getBoundingClientRect();
    this.showMenuAt(e, [
      { label: "Close", action: () => this.host.commit((x) => x.close(tab)) },
      { label: "Close Others", action: () => this.host.commit((x) => x.closeOthers(tab)), disabled: l.groupAt(loc).tabs.length < 2 },
      "sep",
      {
        label: "Float",
        disabled: loc.kind === "float" && l.groupAt(loc).tabs.length === 1,
        action: () =>
          this.host.commit((x) => x.float(tab, { x: 0.5 - 160 / vr.width, y: 0.15, w: 320, h: 260 })),
      },
      { label: "Move to Side Dock", disabled: inSide, action: () => this.host.commit((x) => x.moveToZone(tab, "side")) },
      { label: "Move to Bottom Panel", disabled: inBottom, action: () => this.host.commit((x) => x.moveToZone(tab, "bottom")) },
      {
        label: "Split Down",
        disabled: !inSide || s.side.groups.length >= MAX_SIDE_GROUPS || l.groupAt(loc).tabs.length < 2,
        action: () => this.host.commit((x) => x.splitSide(tab)),
      },
    ]);
  }

  private showAddMenu(
    e: MouseEvent,
    loc: { kind: "zone"; zone: ZoneId; group: number } | { kind: "float"; float: number },
    group: Group,
  ) {
    const closed = this.host.layout.state.closed;
    const items: MenuItem[] = closed.length
      ? closed.map((id) => ({
          label: this.tabs.get(id)?.title ?? id,
          action: () => this.host.commit((l) => l.insert(id, { ...loc, index: group.tabs.length } as TabLocation)),
        }))
      : [{ label: "All tabs are open", disabled: true }];
    this.showMenuAt(e, items);
  }

  showMenuAt(e: MouseEvent, items: MenuItem[]) {
    this.closeMenu();
    const menu = document.createElement("div");
    menu.className = "dock-menu";
    menu.setAttribute("role", "menu");
    items.forEach((it) => {
      if (it === "sep") {
        menu.appendChild(document.createElement("hr"));
        return;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = it.label;
      b.disabled = !!it.disabled;
      b.addEventListener("click", () => {
        this.closeMenu();
        it.action?.();
      });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - r.width - 4)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - r.height - 4)}px`;
    menu.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.closeMenu();
    });
    (menu.querySelector("button:not(:disabled)") as HTMLElement | null)?.focus();
    this.menuEl = menu;
  }

  closeMenu() {
    this.menuEl?.remove();
    this.menuEl = null;
  }
}

// ---------------------------------------------------------------------- helpers

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`DockView: #${id} is missing from index.html`);
  return el;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

function placeRect(el: HTMLElement, r: DOMRect) {
  Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
}
