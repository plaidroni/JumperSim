/**
 * Dock layout model (no DOM). Holds which tabs live where: the side dock (up to two
 * stacked groups), the bottom panel (one group), floating windows, and closed tabs.
 * DockView renders it; Dock persists it. Spec: specs/editor-layout.md §4–5.
 */

export type ZoneId = "side" | "bottom";
export type DockSide = "left" | "right";

export interface Group {
  tabs: string[];
  active: string | null;
  /** Share of the side dock height (side groups only). */
  split?: number;
}

export interface FloatGroup extends Group {
  /** Position as a fraction of the viewport, size in px. */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface Zone {
  size: number;
  open: boolean;
  groups: Group[];
}

export interface LayoutState {
  version: 2;
  dockSide: DockSide;
  side: Zone;
  bottom: Zone;
  floating: FloatGroup[];
  closed: string[];
  lastDocked: Record<string, ZoneId>;
}

export type TabLocation =
  | { kind: "zone"; zone: ZoneId; group: number; index: number }
  | { kind: "float"; float: number; index: number };

export const SIDE_LIMITS = { min: 240, maxFrac: 0.5, def: 340 };
export const BOTTOM_LIMITS = { min: 120, maxFrac: 0.6, def: 220 };
export const MAX_SIDE_GROUPS = 2;

/** Where each known tab goes by default. */
export const DEFAULT_SLOTS: Record<string, { zone: ZoneId; group: number }> = {
  location: { zone: "side", group: 0 },
  dropzone: { zone: "side", group: 0 },
  "jump-settings": { zone: "side", group: 0 },
  weatherdata: { zone: "side", group: 1 },
  objects: { zone: "side", group: 1 },
  following: { zone: "side", group: 1 },
  plane: { zone: "bottom", group: 0 },
};

export function defaultLayout(narrow = false): LayoutState {
  return {
    version: 2,
    dockSide: "right",
    side: {
      size: SIDE_LIMITS.def,
      open: !narrow,
      groups: [
        { tabs: ["location", "dropzone", "jump-settings"], active: "location", split: 0.55 },
        { tabs: ["weatherdata", "objects", "following"], active: "weatherdata", split: 0.45 },
      ],
    },
    bottom: {
      size: BOTTOM_LIMITS.def,
      open: true,
      groups: [{ tabs: ["plane"], active: "plane" }],
    },
    floating: [],
    closed: [],
    lastDocked: {},
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class DockLayout {
  state: LayoutState;

  constructor(state: LayoutState) {
    this.state = clone(state);
  }

  // ------------------------------------------------------------------ queries

  find(tab: string): TabLocation | null {
    for (const zone of ["side", "bottom"] as ZoneId[]) {
      const groups = this.state[zone].groups;
      for (let g = 0; g < groups.length; g++) {
        const i = groups[g].tabs.indexOf(tab);
        if (i >= 0) return { kind: "zone", zone, group: g, index: i };
      }
    }
    for (let f = 0; f < this.state.floating.length; f++) {
      const i = this.state.floating[f].tabs.indexOf(tab);
      if (i >= 0) return { kind: "float", float: f, index: i };
    }
    return null;
  }

  isOpen(tab: string): boolean {
    return this.find(tab) !== null;
  }

  groupAt(loc: TabLocation): Group {
    return loc.kind === "zone"
      ? this.state[loc.zone].groups[loc.group]
      : this.state.floating[loc.float];
  }

  /** Tabs currently on screen (active in a visible group). */
  visibleTabs(): string[] {
    const out: string[] = [];
    for (const zone of ["side", "bottom"] as ZoneId[]) {
      if (!this.state[zone].open) continue;
      this.state[zone].groups.forEach((g) => g.active && out.push(g.active));
    }
    this.state.floating.forEach((g) => g.active && out.push(g.active));
    return out;
  }

  // ------------------------------------------------------------------ edits

  /** Take a tab out of wherever it is (empty groups/floats are removed). */
  private detach(tab: string): TabLocation | null {
    const loc = this.find(tab);
    if (!loc) {
      this.state.closed = this.state.closed.filter((t) => t !== tab);
      return null;
    }
    const group = this.groupAt(loc);
    group.tabs.splice(loc.index, 1);
    if (group.active === tab) {
      group.active = group.tabs[Math.min(loc.index, group.tabs.length - 1)] ?? null;
    }
    if (loc.kind === "zone") this.state.lastDocked[tab] = loc.zone;
    if (group.tabs.length === 0) {
      if (loc.kind === "float") this.state.floating.splice(loc.float, 1);
      else if (loc.zone === "side" && this.state.side.groups.length > 1) {
        this.state.side.groups.splice(loc.group, 1);
        this.state.side.groups.forEach((g) => (g.split = 1 / this.state.side.groups.length));
      }
    }
    return loc;
  }

  /** Put a tab at a location (zone group or floating group), making it active. */
  insert(tab: string, target: TabLocation) {
    // detaching may shift group/float indices: resolve the target group first
    const targetGroup =
      target.kind === "zone"
        ? this.ensureZoneGroup(target.zone, target.group)
        : this.state.floating[target.float];
    const before = this.find(tab);
    if (before && this.groupAt(before) === targetGroup && targetGroup.tabs.length === 1) {
      // dropped back onto its own single-tab group: nothing moves
      targetGroup.active = tab;
      return;
    }
    if (before && this.groupAt(before) === targetGroup && before.index < target.index) {
      target = { ...target, index: target.index - 1 };
    }
    this.detach(tab);
    if (!targetGroup) return;
    const index = Math.max(0, Math.min(target.index, targetGroup.tabs.length));
    targetGroup.tabs.splice(index, 0, tab);
    targetGroup.active = tab;
    if (target.kind === "zone") {
      this.state[target.zone].open = true;
      this.state.lastDocked[tab] = target.zone;
    }
    this.bringToFront(targetGroup);
  }

  private ensureZoneGroup(zone: ZoneId, group: number): Group {
    const groups = this.state[zone].groups;
    if (groups[group]) return groups[group];
    const g: Group = { tabs: [], active: null, split: 0.5 };
    if (zone === "bottom" || groups.length >= MAX_SIDE_GROUPS) {
      return groups[groups.length - 1] ?? (groups.push(g), g);
    }
    groups.push(g);
    groups.forEach((x) => (x.split = 1 / groups.length));
    return g;
  }

  activate(tab: string) {
    const loc = this.find(tab);
    if (!loc) return;
    this.groupAt(loc).active = tab;
    if (loc.kind === "zone") this.state[loc.zone].open = true;
    else this.bringToFront(this.state.floating[loc.float]);
  }

  /** Show a tab: activate it if open, otherwise put it back where it last was. */
  open(tab: string) {
    if (this.isOpen(tab)) return this.activate(tab);
    this.state.closed = this.state.closed.filter((t) => t !== tab);
    const zone = this.state.lastDocked[tab] ?? DEFAULT_SLOTS[tab]?.zone ?? "side";
    const slot = DEFAULT_SLOTS[tab];
    const groups = this.state[zone].groups;
    const group =
      slot && slot.zone === zone ? Math.min(slot.group, Math.max(0, groups.length - 1)) : 0;
    this.insert(tab, {
      kind: "zone",
      zone,
      group,
      index: groups[group]?.tabs.length ?? 0,
    });
  }

  close(tab: string) {
    if (!this.isOpen(tab)) return;
    this.detach(tab);
    if (!this.state.closed.includes(tab)) this.state.closed.push(tab);
  }

  closeOthers(tab: string) {
    const loc = this.find(tab);
    if (!loc) return;
    [...this.groupAt(loc).tabs].filter((t) => t !== tab).forEach((t) => this.close(t));
  }

  /** Pop a tab out into a new floating window. */
  float(tab: string, rect: { x: number; y: number; w: number; h: number }) {
    this.detach(tab);
    const g: FloatGroup = {
      tabs: [tab],
      active: tab,
      x: clamp01(rect.x),
      y: clamp01(rect.y),
      w: Math.max(220, rect.w),
      h: Math.max(140, rect.h),
      z: this.topZ() + 1,
    };
    this.state.floating.push(g);
  }

  /** Send a floating window's tabs back to their last docked zone. */
  dockFloat(index: number) {
    const g = this.state.floating[index];
    if (!g) return;
    [...g.tabs].forEach((tab) => {
      const zone = this.state.lastDocked[tab] ?? DEFAULT_SLOTS[tab]?.zone ?? "side";
      const groups = this.state[zone].groups;
      const gi = Math.max(0, groups.length - 1);
      this.insert(tab, { kind: "zone", zone, group: gi, index: groups[gi]?.tabs.length ?? 0 });
    });
  }

  closeFloat(index: number) {
    const g = this.state.floating[index];
    if (!g) return;
    [...g.tabs].forEach((t) => this.close(t));
  }

  /** Move a tab into a new second group under the side dock's only group. */
  splitSide(tab: string) {
    if (this.state.side.groups.length >= MAX_SIDE_GROUPS) {
      return this.insert(tab, { kind: "zone", zone: "side", group: 1, index: 0 });
    }
    this.detach(tab);
    const groups = this.state.side.groups;
    if (groups.length === 0) groups.push({ tabs: [], active: null, split: 1 });
    groups.push({ tabs: [tab], active: tab, split: 0.5 });
    groups[0].split = 0.5;
    this.state.side.open = true;
    this.state.lastDocked[tab] = "side";
  }

  moveToZone(tab: string, zone: ZoneId) {
    const groups = this.state[zone].groups;
    const gi = Math.max(0, groups.length - 1);
    this.insert(tab, { kind: "zone", zone, group: gi, index: groups[gi]?.tabs.length ?? 0 });
  }

  setSide(side: DockSide) {
    this.state.dockSide = side;
  }

  setZoneOpen(zone: ZoneId, open: boolean) {
    this.state[zone].open = open;
  }

  setZoneSize(zone: ZoneId, size: number) {
    this.state[zone].size = Math.round(size);
  }

  setSideSplit(firstShare: number) {
    const g = this.state.side.groups;
    if (g.length !== 2) return;
    const a = Math.min(0.85, Math.max(0.15, firstShare));
    g[0].split = a;
    g[1].split = 1 - a;
  }

  setFloatRect(index: number, rect: Partial<Pick<FloatGroup, "x" | "y" | "w" | "h">>) {
    const g = this.state.floating[index];
    if (!g) return;
    Object.assign(g, rect);
  }

  bringToFront(group: Group) {
    const f = group as FloatGroup;
    if (this.state.floating.includes(f)) f.z = this.topZ() + 1;
  }

  private topZ() {
    return this.state.floating.reduce((m, g) => Math.max(m, g.z || 0), 0);
  }

  // ------------------------------------------------------------------ persistence

  toJSON(): LayoutState {
    return clone(this.state);
  }

  /**
   * Load saved state, keeping it consistent with the tabs that actually exist:
   * unknown tabs are dropped, new tabs go to their default slot.
   */
  static fromJSON(raw: unknown, knownTabs: string[], narrow = false): DockLayout {
    const def = defaultLayout(narrow);
    let s: LayoutState;
    try {
      s = raw && (raw as any).version === 2 ? (clone(raw) as LayoutState) : def;
      if (!s.side?.groups || !s.bottom?.groups || !Array.isArray(s.floating)) s = def;
    } catch {
      s = def;
    }
    s.dockSide = s.dockSide === "left" ? "left" : "right";
    s.closed = Array.isArray(s.closed) ? s.closed : [];
    s.lastDocked = s.lastDocked && typeof s.lastDocked === "object" ? s.lastDocked : {};
    s.side.size = finiteOr(s.side.size, SIDE_LIMITS.def);
    s.bottom.size = finiteOr(s.bottom.size, BOTTOM_LIMITS.def);
    s.side.open = s.side.open !== false;
    s.bottom.open = s.bottom.open !== false;

    const known = new Set(knownTabs);
    const seen = new Set<string>();
    const cleanGroup = (g: Group) => {
      g.tabs = (g.tabs || []).filter((t) => known.has(t) && !seen.has(t) && (seen.add(t), true));
      if (!g.active || !g.tabs.includes(g.active)) g.active = g.tabs[0] ?? null;
    };
    s.side.groups = s.side.groups.slice(0, MAX_SIDE_GROUPS);
    s.bottom.groups = s.bottom.groups.slice(0, 1);
    [...s.side.groups, ...s.bottom.groups].forEach(cleanGroup);
    s.floating.forEach(cleanGroup);
    s.floating = s.floating.filter((f) => f.tabs.length > 0);
    s.floating.forEach((f) => {
      f.x = clamp01(finiteOr(f.x, 0.1));
      f.y = clamp01(finiteOr(f.y, 0.1));
      f.w = Math.max(220, finiteOr(f.w, 320));
      f.h = Math.max(140, finiteOr(f.h, 240));
      f.z = finiteOr(f.z, 1);
    });
    if (s.side.groups.length > 1) s.side.groups = s.side.groups.filter((g) => g.tabs.length > 0);
    if (s.side.groups.length === 0) s.side.groups = [{ tabs: [], active: null, split: 1 }];
    if (s.bottom.groups.length === 0) s.bottom.groups = [{ tabs: [], active: null }];
    s.closed = s.closed.filter((t) => known.has(t) && !seen.has(t));
    s.closed.forEach((t) => seen.add(t));

    const layout = new DockLayout(s);
    // tabs that exist but aren't placed anywhere go to their default slot
    knownTabs.filter((t) => !seen.has(t)).forEach((t) => layout.open(t));
    return layout;
  }
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function finiteOr(v: unknown, fallback: number) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
