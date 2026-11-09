import { SimPlane, SimJumper } from "../classes/SimEntities";
import { Formation } from "../classes/Formations";
import { notificationManager } from "../classes/NotificationManager";
import { requestRecalculation } from "../core/data/SimulationVariables";
import { hasJumperExited, jumperStatus } from "../panels/jumperStatus";
import {
  BODY_POSITIONS,
  BODY_POSITION_ORDER,
  MS_TO_MPH,
  TRACK_START_FT,
  normalizeBodyPosition,
} from "../physics/BodyPositions";
import {
  FORMATION_SHAPES,
  FORMATION_SHAPE_ORDER,
  FormationShapeId,
  getFormationShape,
} from "../physics/FormationShapes";
import {
  buildsRounds,
  flockMembers,
  flockPlanFor,
  flockSettingsOf,
  isWingsuiter,
  orderBySlot,
  roundMembers,
  roundSettingsOf,
} from "../physics/FormationFlight";
import {
  FLOCK_EXIT_GAP_S,
  FLOCK_LAYOUTS,
  FLOCK_LAYOUT_ORDER,
  flockSlotLabel,
} from "../physics/FlockShapes";
import { MIN_DEPLOY_SEPARATION_M } from "../physics/FormationShapes";
import { defaultFreefallPattern, getDropzonePlan, onPlanChanged } from "../dropzone/DropzonePlan";
import {
  DEFAULT_PULL_FT,
  canopyPerformance,
  exitWeightKg,
} from "../physics/Canopy";

const M_TO_FT = 3.28084;
const WL_HINT =
  "Wing loading (lb/ft²): exit weight (body + extra + gear) ÷ canopy area. Higher = faster canopy.";

export type PlaneLayout = {
  // rows, each element is number of seats in that row, left-to-right; -1 can represent aisle or door spacing, but we will simplify
  rows: number[];
};

// Predefined layout for Twin Otter: two single-seat rows (9 and 11 seats), then 2 tail seats
const TwinOtterLayout: PlaneLayout = {
  // We'll render as: first column 9, second column 11, and a final row of 2 seats.
  // To keep simple in UI, we project into visual rows later.
  rows: [],
};

export class PlaneLoad {
  plane: SimPlane;
  jumpers: SimJumper[] = [];
  selectedId: string | null = null;
  view: "organizer" = "organizer";
  layout: PlaneLayout;
  private selectedFormationIdx: number = 0;
  // User-configurable interval (seconds) between exits for sequential groups
  private jumpIntervalSeconds: number = 10;
  /** Edits made in the panel that haven't been applied to the sim yet. */
  private dirty = false;

  /** Note that the panel has changes the sim hasn't picked up (Save applies them). */
  markDirty() {
    this.dirty = true;
    this.updateSaveState();
  }

  /** Apply the panel's changes: recalculate the sim, then redraw the panel. */
  save() {
    this.jumpers.forEach((j) => j.calculateSurfaceArea());
    this.normalizeJumpTimes();
    requestRecalculation();
    queueMicrotask(() => {
      this.dirty = false;
      this.render();
    });
  }

  private updateSaveState() {
    const panel = document.querySelector("#plane-panel .plane-load-editor");
    const btn = panel?.querySelector("#plane-load-save") as HTMLButtonElement | null;
    const note = panel?.querySelector("#plane-load-dirty") as HTMLElement | null;
    if (btn) btn.classList.toggle("is-dirty", this.dirty);
    if (note) note.textContent = this.dirty ? "Unsaved changes" : "Up to date";
    if (note) note.classList.toggle("is-dirty", this.dirty);
  }

  constructor(plane: SimPlane, layout?: PlaneLayout) {
    this.plane = plane;
    this.layout = layout || TwinOtterLayout;
    this.refreshJumpers();
    // pattern names / defaults show in the Pattern column
    onPlanChanged((_p, live) => {
      if (live) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae.closest?.("#plane-panel") && /INPUT|SELECT/.test(ae.tagName)) return;
      queueMicrotask(() => this.render());
    });
  }

  refreshJumpers() {
    const w: any = window as any;
    if (Array.isArray(w.simJumpers)) this.jumpers = w.simJumpers as SimJumper[];
    else
      this.jumpers =
        this.plane.formations?.flatMap((f: any) => f.getAllJumpers?.() || []) ||
        [];
  }

  getSimulationTime(): number {
    const w: any = window as any;
    if (typeof w.simulationTime === "number") return w.simulationTime;
    if (typeof w.currentTime === "number") return w.currentTime;
    return 0;
  }

  normalizeJumpTimes() {
    const sorted = [...this.jumpers].sort((a, b) => a.index - b.index);
    const baseInterval = Math.max(0, this.jumpIntervalSeconds);

    // Identify linked formation members
    const linkedSet = new Set(sorted.filter((j) => j.linked).map((j) => j.id));
    if (linkedSet.size === 0) {
      // No linked group, assign simple sequential times
      sorted.forEach((j, i) => (j.jumpTime = i * baseInterval));
      return;
    }

    // Determine earliest position of any linked jumper in the ordered list
    const firstLinkedIdx = sorted.findIndex((j) => linkedSet.has(j.id));

    // Partition non-linked before/after the first linked position
    const before: SimJumper[] = [];
    const linkedGroup: SimJumper[] = [];
    const after: SimJumper[] = [];
    sorted.forEach((j, i) => {
      const isLinked = linkedSet.has(j.id);
      if (isLinked) linkedGroup.push(j);
      else if (i < firstLinkedIdx) before.push(j);
      else after.push(j);
    });

    // Build groups preserving relative placement: before (each solo), linked group, after (each solo)
    type Group = SimJumper[];
    const groups: Group[] = [];
    before.forEach((j) => groups.push([j]));
    if (linkedGroup.length) groups.push(linkedGroup);
    after.forEach((j) => groups.push([j]));

    // Assign group-based jump times: belly, freefly and tracking members leave
    // together; linked wingsuiters follow one second apart, base (slot 1) first.
    let tIndex = 0;
    groups.forEach((g) => {
      const t = tIndex * baseInterval;
      const suits = orderBySlot(g.filter((j) => g.length > 1 && isWingsuiter(j)));
      g.forEach((j) => {
        const k = suits.indexOf(j);
        j.jumpTime = k >= 0 ? t + k * FLOCK_EXIT_GAP_S : t;
      });
      tIndex += 1;
    });
  }

  swapSeats(aId: string, bId: string) {
    const a = this.jumpers.find((j) => j.id === aId);
    const b = this.jumpers.find((j) => j.id === bId);
    if (!a || !b || a.id === b.id) return;
    const tmp = a.index;
    a.index = b.index;
    b.index = tmp;
    this.normalizeJumpTimes();
    this.render();
    // notify to recalc from organizer changes
    this.markDirty();
  }

  setIndex(j: SimJumper, idx: number) {
    j.index = idx;
    this.normalizeJumpTimes();
    this.render();
    this.markDirty();
  }

  // Removed seat map & load visuals until app is ready.

  // Ensure indices are unique and sequential (0..n-1)
  private reindexSequential() {
    const sorted = [...this.jumpers].sort((a, b) => a.index - b.index);
    sorted.forEach((j, i) => (j.index = i));
  }

  private moveUp(j: SimJumper) {
    const sorted = [...this.jumpers].sort((a, b) => a.index - b.index);
    const i = sorted.findIndex((x) => x.id === j.id);
    if (i <= 0) return;
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const tmp = prev.index;
    prev.index = cur.index;
    cur.index = tmp;
    this.reindexSequential();
    this.normalizeJumpTimes();
    this.render();
    this.markDirty();
  }

  private moveDown(j: SimJumper) {
    const sorted = [...this.jumpers].sort((a, b) => a.index - b.index);
    const i = sorted.findIndex((x) => x.id === j.id);
    if (i < 0 || i >= sorted.length - 1) return;
    const next = sorted[i + 1];
    const cur = sorted[i];
    const tmp = next.index;
    next.index = cur.index;
    cur.index = tmp;
    this.reindexSequential();
    this.normalizeJumpTimes();
    this.render();
    this.markDirty();
  }

  private buildForm(): HTMLElement {
    const box = document.createElement("div");
    box.style.border = "1px solid #555";
    box.style.padding = "10px";
    box.style.borderRadius = "6px";

    const h = document.createElement("h3");
    h.textContent = this.view === "organizer" ? "Organizer" : "Jumper Details";
    box.appendChild(h);

    if (this.view === "organizer") {
      box.appendChild(this.buildOrganizer());
      return box;
    }

    const j =
      this.jumpers.find((x) => x.id === this.selectedId) ||
      [...this.jumpers].sort((a, b) => a.index - b.index)[0];
    if (!j) {
      const p = document.createElement("p");
      p.textContent = "No jumper selected.";
      box.appendChild(p);
      return box;
    }

    const form = document.createElement("div");
    form.style.display = "grid";
    form.style.gridTemplateColumns = "auto 1fr";
    form.style.gap = "6px 10px";

    const addRow = (label: string, input: HTMLElement) => {
      const l = document.createElement("label");
      l.textContent = label;
      form.appendChild(l);
      form.appendChild(input);
    };

    const name = document.createElement("input");
    name.type = "text";
    name.value = (j as any).name || "";
    name.addEventListener("input", () => ((j as any).name = name.value));
    addRow("Name", name);

    const styleSel = this.buildPositionSelect(j);
    addRow("Body Position", styleSel);

    const weight = document.createElement("input");
    weight.type = "number";
    weight.value = String((j as any).weight ?? 80);
    weight.addEventListener("input", () => {
      const v = Number(weight.value);
      if (Number.isFinite(v) && v > 0) (j as any).weight = v;
      this.markDirty();
    });
    addRow("Weight (kg)", weight);

    const extra = document.createElement("input");
    extra.type = "number";
    extra.value = String((j as any).extraWeight ?? 0);
    extra.addEventListener("input", () => {
      const v = Number(extra.value);
      if (Number.isFinite(v) && v >= 0) (j as any).extraWeight = v;
      this.markDirty();
    });
    addRow("Extra Weight (kg)", extra);

    const suit = document.createElement("select");
    ["normal", "baggy", "skintight"].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      if ((j as any).suitType === opt) o.selected = true;
      suit.appendChild(o);
    });
    suit.addEventListener("change", () => ((j as any).suitType = suit.value));
    addRow("Suit", suit);

    const canopy = document.createElement("input");
    canopy.type = "number";
    canopy.value = String(j.canopySize ?? 190);
    canopy.addEventListener(
      "input",
      () => {
        const v = Number(canopy.value);
        if (Number.isFinite(v) && v > 0) j.canopySize = v;
        this.markDirty();
      }
    );
    addRow("Canopy (sqft)", canopy);

    const pull = document.createElement("input");
    pull.type = "number";
    pull.step = "100";
    pull.value = String(j.pullAltitudeFt ?? DEFAULT_PULL_FT);
    pull.addEventListener("input", () => {
      const v = Number(pull.value);
      if (Number.isFinite(v) && v > 0) j.pullAltitudeFt = v;
      this.markDirty();
    });
    addRow("Pull Altitude (ft)", pull);

    const indexInput = document.createElement("input");
    indexInput.type = "number";
    indexInput.value = String(j.index);
    indexInput.addEventListener("input", () =>
      this.setIndex(j, Number(indexInput.value))
    );
    addRow("Load Order", indexInput);

    const apply = document.createElement("button");
    apply.textContent = "Apply";
    apply.addEventListener("click", () => this.render());

    const controls = document.createElement("div");
    controls.style.gridColumn = "1 / span 2";
    controls.style.marginTop = "8px";
    controls.appendChild(apply);

    box.appendChild(form);
    box.appendChild(controls);
    return box;
  }

  private buildOrganizer(): HTMLElement {
    const wrap = document.createElement("div");
    // Formation toolbar: import + selector
    const toolbar = document.createElement("div");
    toolbar.className = "ps-toolbar";

    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "ps-button";
    importBtn.textContent = "Import .jump";
    importBtn.title = "Import a formation from a .jump file";
    importBtn.addEventListener("click", () => this.openFormationImport());

    const formSel = document.createElement("select");
    formSel.className = "ps-select";
    const formations = this.plane.formations || [];
    if (formations.length === 0) {
      const opt = document.createElement("option");
      opt.value = "-1";
      opt.textContent = "No formations";
      formSel.appendChild(opt);
      formSel.disabled = true;
    } else {
      formations.forEach((f, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = f.title || `Formation ${i + 1}`;
        if (i === this.selectedFormationIdx) opt.selected = true;
        formSel.appendChild(opt);
      });
    }
    formSel.addEventListener("change", () => {
      this.selectedFormationIdx = Math.max(0, Number(formSel.value) || 0);
      this.render();
    });

    // Exit interval editor
    const intervalWrap = document.createElement("label");
    intervalWrap.className = "ps-field";
    intervalWrap.title = "Seconds between exits (linked groups exit together)";
    const intervalLabel = document.createElement("span");
    intervalLabel.className = "ps-label";
    intervalLabel.textContent = "Exit interval";
    const intervalInput = document.createElement("input");
    intervalInput.type = "number";
    intervalInput.className = "ps-input ps-input-narrow";
    intervalInput.min = "0";
    intervalInput.step = "0.5";
    intervalInput.value = String(this.jumpIntervalSeconds);
    intervalInput.addEventListener("change", () => {
      const v = Number(intervalInput.value);
      this.jumpIntervalSeconds = isFinite(v)
        ? Math.max(0, v)
        : this.jumpIntervalSeconds;
      this.normalizeJumpTimes();
      // prompt recalc
      this.markDirty();
      this.render();
    });
    const intervalUnit = document.createElement("span");
    intervalUnit.className = "ps-unit";
    intervalUnit.textContent = "s";
    intervalWrap.appendChild(intervalLabel);
    intervalWrap.appendChild(intervalInput);
    intervalWrap.appendChild(intervalUnit);

    const formWrap = document.createElement("label");
    formWrap.className = "ps-field";
    const formLabel = document.createElement("span");
    formLabel.className = "ps-label";
    formLabel.textContent = "Formation";
    formWrap.appendChild(formLabel);
    formWrap.appendChild(formSel);

    // Save applies all panel edits to the sim
    const saveWrap = document.createElement("div");
    saveWrap.className = "plane-load-save-wrap";
    const dirtyNote = document.createElement("span");
    dirtyNote.id = "plane-load-dirty";
    dirtyNote.className = "plane-load-dirty";
    const saveBtn = document.createElement("button");
    saveBtn.id = "plane-load-save";
    saveBtn.className = "plane-load-save";
    saveBtn.textContent = "Save";
    saveBtn.title = "Apply these settings and recalculate the jump";
    saveBtn.addEventListener("click", () => this.save());
    saveWrap.appendChild(dirtyNote);
    saveWrap.appendChild(saveBtn);

    // What linked groups fly between exit and breakoff
    const shapeWrap = document.createElement("label");
    shapeWrap.className = "ps-field";
    const shapeLabel = document.createElement("span");
    shapeLabel.className = "ps-label";
    shapeLabel.textContent = "Linked groups";
    const shapeSel = document.createElement("select");
    shapeSel.className = "ps-select";
    const currentShape = getFormationShape(this.plane.linkedFormation);
    FORMATION_SHAPE_ORDER.forEach((id) => {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = FORMATION_SHAPES[id].label;
      o.title = FORMATION_SHAPES[id].description;
      if (id === currentShape.id) o.selected = true;
      shapeSel.appendChild(o);
    });
    shapeWrap.title = currentShape.description;
    shapeSel.addEventListener("change", () => {
      this.plane.linkedFormation = shapeSel.value as FormationShapeId;
      shapeWrap.title = getFormationShape(shapeSel.value).description;
      this.markDirty();
    });
    shapeWrap.appendChild(shapeLabel);
    shapeWrap.appendChild(shapeSel);
    const gear = document.createElement("button");
    gear.type = "button";
    gear.className = "ps-btn ps-gear";
    gear.textContent = "⚙";
    gear.title = "Round, wingsuit flock and separation settings";
    gear.addEventListener("click", (e) => {
      e.preventDefault();
      this.openFormationSettings(gear);
    });
    shapeWrap.appendChild(gear);

    toolbar.appendChild(intervalWrap);
    toolbar.appendChild(shapeWrap);
    toolbar.appendChild(formWrap);
    toolbar.appendChild(importBtn);
    toolbar.appendChild(saveWrap);
    wrap.appendChild(toolbar);
    const table = document.createElement("table");
    table.className = "ps-table";
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
      <th style="text-align:left">#</th>
      <th style="text-align:left">Name</th>
      <th style="text-align:left" title="Freefall body position (sets the drag area)">Position</th>
      <th style="text-align:left" title="Break off at ${TRACK_START_FT.toLocaleString()} ft and track away">Track</th>
      <th style="text-align:left">Wt (kg)</th>
      <th style="text-align:left" title="Canopy size (sq ft)">Canopy</th>
      <th style="text-align:right" title="${WL_HINT}">WL</th>
      <th style="text-align:left" title="Height above the dropzone where the pilot chute is thrown">Pull (ft)</th>
      <th style="text-align:left">Linked</th>
      <th style="text-align:left" title="Round slot, wingsuit flock slot, or lane on a freefall pattern">Slot</th>
      <th style="text-align:left" title="Freefall pattern flown by tracking jumpers and wingsuiters (Dropzone Planner)">Pattern</th>
      <th style="text-align:left">Formation</th>
      <th style="text-align:left">Status</th>
      <th style="text-align:right" title="Height above the dropzone">Alt (ft)</th>
      <th style="text-align:right">Fall (mph)</th>
    </tr>`;
    const tbody = document.createElement("tbody");

    // Ensure no duplicate indices; then render
    this.reindexSequential();
    const list = [...this.jumpers].sort((a, b) => a.index - b.index);
    list.forEach((j, i) => {
      const tr = document.createElement("tr");
      tr.draggable = false;
      tr.dataset.id = j.id;

      // Up/Down controls + index display (1-based)
      const tdIdx = document.createElement("td");
      tdIdx.className = "ps-order";

      const upBtn = document.createElement("button");
      upBtn.textContent = "▲";
      upBtn.title = "Move up";
      upBtn.className = "ps-mini";
      upBtn.disabled = i === 0;
      upBtn.addEventListener("click", () => this.moveUp(j));

      const downBtn = document.createElement("button");
      downBtn.textContent = "▼";
      downBtn.title = "Move down";
      downBtn.className = "ps-mini";
      downBtn.disabled = i === list.length - 1;
      downBtn.addEventListener("click", () => this.moveDown(j));

      const idxLabel = document.createElement("span");
      idxLabel.textContent = String(i + 1);
      idxLabel.style.minWidth = "1.5em";
      idxLabel.style.textAlign = "right";

      tdIdx.appendChild(upBtn);
      tdIdx.appendChild(downBtn);
      tdIdx.appendChild(idxLabel);
      tr.appendChild(tdIdx);

      const tdName = document.createElement("td");
      const name = document.createElement("input");
      name.type = "text";
      name.className = "ps-input";
      name.placeholder = `Jumper ${i + 1}`;
      name.value = (j as any).name || "";
      name.addEventListener("input", () => ((j as any).name = name.value));
      tdName.appendChild(name);
      tr.appendChild(tdName);

      const tdStyle = document.createElement("td");
      const tdTrack = document.createElement("td");
      const track = document.createElement("input");
      track.type = "checkbox";
      const syncTrack = () => {
        const canTrack = BODY_POSITIONS[normalizeBodyPosition(j.flyingStyle)].canTrack;
        track.checked = canTrack && j.tracking;
        track.disabled = !canTrack;
        track.title = canTrack
          ? `Break off at ${TRACK_START_FT.toLocaleString()} ft (rounds: their breakoff altitude) and track away`
          : "Tracks the whole jump";
        if (!canTrack) track.checked = true;
      };
      syncTrack();
      track.addEventListener("change", () => {
        j.tracking = track.checked;
        this.markDirty();
      });
      tdStyle.appendChild(this.buildPositionSelect(j, syncTrack));
      tdTrack.appendChild(track);
      tr.appendChild(tdStyle);
      tr.appendChild(tdTrack);

      const tdW = document.createElement("td");
      const w = document.createElement("input");
      w.type = "number";
      w.className = "ps-input ps-input-narrow";
      w.value = String((j as any).weight ?? 80);
      w.addEventListener("input", () => {
        const v = Number(w.value);
        if (Number.isFinite(v) && v > 0) (j as any).weight = v;
        this.updateRow(tr, j);
        this.markDirty();
      });
      tdW.appendChild(w);
      tr.appendChild(tdW);

      const tdC = document.createElement("td");
      const c = document.createElement("input");
      c.type = "number";
      c.className = "ps-input ps-input-narrow";
      c.value = String(j.canopySize ?? 190);
      c.title = "Canopy size (sq ft)";
      c.addEventListener("input", () => {
        const v = Number(c.value);
        if (Number.isFinite(v) && v > 0) j.canopySize = v;
        this.updateRow(tr, j);
        this.markDirty();
      });
      tdC.appendChild(c);
      tr.appendChild(tdC);

      const tdWL = document.createElement("td");
      tdWL.dataset.role = "wl-cell";
      tdWL.style.textAlign = "right";
      tr.appendChild(tdWL);

      const tdD = document.createElement("td");
      const d = document.createElement("input");
      d.type = "number";
      d.step = "100";
      d.className = "ps-input ps-input-narrow";
      d.value = String(j.pullAltitudeFt ?? DEFAULT_PULL_FT);
      d.title = "Pull altitude (ft above the dropzone)";
      d.addEventListener("input", () => {
        const v = Number(d.value);
        if (Number.isFinite(v) && v > 0) j.pullAltitudeFt = v;
        this.markDirty();
      });
      tdD.appendChild(d);
      tr.appendChild(tdD);

      // Linked toggle
      const tdLinked = document.createElement("td");
      const linked = document.createElement("button");
      const setLinkedStyle = () => {
        linked.textContent = j.linked ? "Linked" : "Solo";
        linked.className = j.linked ? "ps-chip is-on" : "ps-chip";
      };
      setLinkedStyle();
      linked.addEventListener("click", () => {
        j.linked = !j.linked;
        setLinkedStyle();
        this.normalizeJumpTimes();
        this.markDirty();
        queueMicrotask(() => this.render());
      });
      tdLinked.appendChild(linked);
      tr.appendChild(tdLinked);

      const tdSlot = document.createElement("td");
      tdSlot.appendChild(this.buildSlotCell(j));
      tr.appendChild(tdSlot);
      const tdPat = document.createElement("td");
      tdPat.appendChild(this.buildPatternCell(j));
      tr.appendChild(tdPat);

      const tdF = document.createElement("td");
      const fIdx =
        this.plane.formations?.findIndex((f: any) =>
          f.getAllJumpers?.().includes(j)
        ) ?? -1;
      const colors = ["#b06ab3", "gold", "#5669d8", "#4db6ac", "#ff7043"];
      const badgeBtn = document.createElement("button");
      badgeBtn.title =
        fIdx >= 0
          ? `Click to remove from formation ${
              this.plane.formations?.[fIdx]?.title || fIdx + 1
            }`
          : formations.length > 0
          ? `Click to add to formation ${
              formations[this.selectedFormationIdx]?.title ||
              this.selectedFormationIdx + 1
            }`
          : "No formations available";
      badgeBtn.style.display = "inline-block";
      badgeBtn.style.width = "18px";
      badgeBtn.style.height = "18px";
      badgeBtn.style.borderRadius = "50%";
      badgeBtn.style.border = "1px solid #444";
      badgeBtn.style.cursor = formations.length ? "pointer" : "not-allowed";
      const color = fIdx < 0 ? "#777" : colors[fIdx % colors.length];
      badgeBtn.style.background = color;
      // Inline dropdown for formation selection
      const formSelect = document.createElement("select");
      formSelect.style.marginLeft = "6px";
      formSelect.style.display = "none";
      // Options: None + each formation
      const optNone = document.createElement("option");
      optNone.value = "-1";
      optNone.textContent = "None";
      formSelect.appendChild(optNone);
      formations.forEach((f, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = f.title || `Formation ${i + 1}`;
        formSelect.appendChild(opt);
      });
      formSelect.value = String(fIdx);

      badgeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!formations.length) return;
        // Toggle dropdown visibility
        formSelect.style.display =
          formSelect.style.display === "none" ? "inline-block" : "none";
      });
      // Optional slot selector (appears when a formation is chosen)
      const slotSelect = document.createElement("select");
      slotSelect.style.marginLeft = "4px";
      slotSelect.style.display = "none";
      const rebuildSlots = (fIndex: number) => {
        slotSelect.innerHTML = "";
        if (fIndex < 0 || fIndex >= formations.length) {
          slotSelect.style.display = "none";
          return;
        }
        const f = formations[fIndex];
        const slots = (f as any).points?.[0]?.slots || [];
        for (let s = 0; s < slots.length; s++) {
          const opt = document.createElement("option");
          opt.value = String(s);
          opt.textContent = `Slot ${s + 1}`;
          slotSelect.appendChild(opt);
        }
        slotSelect.style.display = slots.length ? "inline-block" : "none";
      };
      formSelect.addEventListener("change", () => {
        const idx = Number(formSelect.value);
        this.assignJumperToFormation(j, idx);
        rebuildSlots(idx);
      });
      slotSelect.addEventListener("change", () => {
        const fIdx2 = Number(formSelect.value);
        const sIdx = Number(slotSelect.value);
        const f = (this.plane.formations || [])[fIdx2];
        if (!f) return;
        (f as any).assignExistingJumperToSlot?.(j, sIdx);
        // After slot change, keep group timing and regroup UI
        this.normalizeJumpTimes();
        this.markDirty();
        this.render();
      });
      tdF.appendChild(badgeBtn);
      tdF.appendChild(formSelect);
      tdF.appendChild(slotSelect);
      tr.appendChild(tdF);

      const tdStatus = document.createElement("td");
      tdStatus.dataset.role = "status-cell";
      const tdAlt = document.createElement("td");
      tdAlt.dataset.role = "alt-cell";
      tdAlt.style.textAlign = "right";
      const tdFall = document.createElement("td");
      tdFall.dataset.role = "fall-cell";
      tdFall.style.textAlign = "right";
      tr.appendChild(tdStatus);
      tr.appendChild(tdAlt);
      tr.appendChild(tdFall);
      this.updateRow(tr, j);

      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // Import a .jump formation file and attach to plane
  /** Round slot / flock slot / lane picker for one jumper (§9 of the planner spec). */
  private buildSlotCell(j: SimJumper): HTMLElement {
    const none = () => {
      const s = document.createElement("span");
      s.className = "plane-load-muted";
      s.textContent = "–";
      return s;
    };
    const sel = document.createElement("select");
    sel.className = "ps-select ps-select-narrow";
    const pos = normalizeBodyPosition(j.flyingStyle);
    const swapInto = (members: SimJumper[], slot: number) => {
      const ordered = orderBySlot(members);
      const mine = ordered.indexOf(j) + 1;
      // freeze everyone's current slot, then swap the two
      ordered.forEach((m, k) => ((m as any).formationSlot = k + 1));
      const other = ordered[slot - 1];
      if (other && other !== j) (other as any).formationSlot = mine;
      (j as any).formationSlot = slot;
      this.normalizeJumpTimes();
      this.markDirty();
      this.render();
    };
    if (j.linked && buildsRounds(j) && getFormationShape(this.plane.linkedFormation).id !== "none") {
      const members = roundMembers(j, this.plane);
      if (members.length < 2) return none();
      const mine = members.indexOf(j) + 1;
      members.forEach((_, k) => {
        const o = document.createElement("option");
        o.value = String(k + 1);
        o.textContent = `${k + 1}`;
        o.selected = k + 1 === mine;
        sel.appendChild(o);
      });
      sel.title = "Slot on the ring (1 is on the jumprun side, then clockwise). Picking a taken slot swaps.";
      sel.addEventListener("change", () => swapInto(members, Number(sel.value)));
      return sel;
    }
    if (j.linked && pos === "wingsuit") {
      const members = flockMembers(j, this.plane);
      if (members.length < 2) return none();
      const settings = flockSettingsOf(this.plane);
      const mine = members.indexOf(j);
      members.forEach((_, k) => {
        const o = document.createElement("option");
        o.value = String(k + 1);
        o.textContent = `${k + 1} · ${flockSlotLabel(settings, k)}`;
        o.selected = k === mine;
        sel.appendChild(o);
      });
      sel.title = "Flock slot: 1 is the base (flies the pattern); picking a taken slot swaps. Wingsuits exit 1 s apart in slot order.";
      sel.addEventListener("change", () => swapInto(members, Number(sel.value)));
      return sel;
    }
    if (pos === "wingsuit" || pos === "tracking") {
      const auto = j.freefallRoute ? j.freefallRoute.lane : null;
      const fmt = (n: number) => `Lane ${n > 0 ? "+" : ""}${n}`;
      const o = document.createElement("option");
      o.value = "";
      o.textContent = auto === null ? "Auto" : `Auto (${fmt(auto)})`;
      sel.appendChild(o);
      for (const n of [0, 1, -1, 2, -2, 3, -3]) {
        const oo = document.createElement("option");
        oo.value = String(n);
        oo.textContent = fmt(n);
        sel.appendChild(oo);
      }
      const cur = (j as any).laneIndex;
      sel.value = Number.isInteger(cur) ? String(cur) : "";
      sel.title = "Parallel lane on the freefall pattern (+ = right of the direction of flight)";
      sel.addEventListener("change", () => {
        (j as any).laneIndex = sel.value === "" ? undefined : Number(sel.value);
        this.markDirty();
      });
      return sel;
    }
    return none();
  }

  /** Freefall pattern picker for tracking jumpers and wingsuiters. */
  private buildPatternCell(j: SimJumper): HTMLElement {
    const pos = normalizeBodyPosition(j.flyingStyle);
    if (pos !== "wingsuit" && pos !== "tracking") {
      const s = document.createElement("span");
      s.className = "plane-load-muted";
      s.textContent = "–";
      return s;
    }
    const follower = (() => {
      const f = flockPlanFor(j, this.plane);
      return f && f.slotIndex > 0;
    })();
    if (follower) {
      const s = document.createElement("span");
      s.className = "plane-load-muted";
      s.textContent = "Follows base";
      s.title = "Flock followers hold their slot off the base, who flies the pattern";
      return s;
    }
    const plan = getDropzonePlan();
    const ofKind = plan.freefallPatterns.filter((f) => f.kind === pos);
    const def = defaultFreefallPattern(pos, plan);
    const sel = document.createElement("select");
    sel.className = "ps-select";
    const add = (v: string, t: string) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = t;
      sel.appendChild(o);
    };
    add("", def ? `Default (${def.name})` : "Default (none drawn)");
    add("none", "None");
    ofKind.forEach((f) => add(f.id, f.name));
    sel.value = (j as any).freefallPatternId ?? "";
    sel.title = "Draw patterns in the Dropzone Planner (P)";
    sel.addEventListener("change", () => {
      (j as any).freefallPatternId = sel.value || undefined;
      this.markDirty();
    });
    return sel;
  }

  /** ⚙ popover next to the Linked groups select: round and wingsuit flock settings. */
  private openFormationSettings(anchor: HTMLElement) {
    document.querySelector(".ps-popover")?.remove();
    const plane: any = this.plane;
    const round = roundSettingsOf(this.plane);
    const flock = flockSettingsOf(this.plane);
    const pop = document.createElement("div");
    pop.className = "ps-popover";
    pop.innerHTML = `
      <h4>Round</h4>
      <label title="Distance from the round's centre to every slot">Slot radius (m)<input type="text" data-r="slotRadiusM" value="${round.slotRadiusM}" placeholder="auto"></label>
      <label>Breakoff altitude (ft)<input type="number" step="100" data-r="breakoffFt" value="${round.breakoffFt}"></label>
      <label title="How far from the breakoff centre each member tracks before waving off">Breakoff distance (m)<input type="text" data-r="breakoffDistanceM" value="${round.breakoffDistanceM}" placeholder="auto"></label>
      <h4>Wingsuit flock</h4>
      <label>Layout<select data-f="layout">${FLOCK_LAYOUT_ORDER.map((id) => `<option value="${id}"${id === flock.layout ? " selected" : ""}>${FLOCK_LAYOUTS[id].label}</option>`).join("")}</select></label>
      <label>Spacing (m)<input type="number" step="1" min="2" data-f="spacingM" value="${flock.spacingM}"></label>
      <label title="Each row flies this much lower than the one ahead">Stack (m)<input type="number" step="1" min="0" data-f="stackM" value="${flock.stackM}"></label>
      <label>Flock breakoff (ft)<input type="number" step="100" data-f="breakoffFt" value="${flock.breakoffFt}"></label>
      <h4>Separation</h4>
      <label title="Warn when two jumpers are closer than this at pull">Min at pull (m)<input type="number" step="10" min="0" data-sep value="${plane.minDeploySeparationM ?? MIN_DEPLOY_SEPARATION_M}"></label>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left))}px`;
    pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 6)}px`;
    pop.querySelectorAll<HTMLInputElement>("[data-r]").forEach((el) =>
      el.addEventListener("change", () => {
        const k = el.dataset.r!;
        const raw = el.value.trim().toLowerCase();
        const v = raw === "" || raw === "auto" ? "auto" : Number(raw);
        if (v !== "auto" && (!Number.isFinite(v) || v <= 0)) return;
        plane.roundSettings = { ...roundSettingsOf(this.plane), [k]: k === "breakoffFt" ? Number(raw) || 4500 : v };
        this.markDirty();
      }),
    );
    pop.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]").forEach((el) =>
      el.addEventListener("change", () => {
        const k = el.dataset.f!;
        const v = k === "layout" ? el.value : Number(el.value);
        if (typeof v === "number" && !Number.isFinite(v)) return;
        plane.flockSettings = { ...flockSettingsOf(this.plane), [k]: v };
        this.markDirty();
      }),
    );
    pop.querySelector<HTMLInputElement>("[data-sep]")?.addEventListener("change", (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v) && v >= 0) plane.minDeploySeparationM = v;
      this.markDirty();
    });
    const close = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node) && e.target !== anchor) {
        pop.remove();
        document.removeEventListener("mousedown", close, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", close, true), 0);
  }

  private openFormationImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".jump,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const formation = new Formation(data);
        // Create formation jumpers for this plane
        formation.createJumpersForPlane(this.plane, data.jumpers || []);
        this.plane.addFormation(formation as any);
        notificationManager.success(
          `Imported formation: ${formation.title || file.name}`
        );
        this.selectedFormationIdx = Math.max(
          0,
          (this.plane.formations?.length || 1) - 1
        );
        this.render();
      } catch (e) {
        console.error("Failed to import .jump file", e);
        notificationManager.error("Failed to import formation (.jump)");
      }
    };
    input.click();
  }

  private assignJumperToFormation(j: SimJumper, formationIndex: number) {
    const formations = this.plane.formations || [];
    // Remove jumper from any current formation first
    formations.forEach((f: any) => {
      f.jumpers = (f.getAllJumpers?.() || []).filter(
        (x: SimJumper) => x.id !== j.id
      );
    });
    if (formationIndex >= 0 && formationIndex < formations.length) {
      const target = formations[formationIndex];
      target.jumpers.push(j);
      j.isInFormation = true;
      j.linked = true;
    } else {
      j.isInFormation = false;
    }

    // Resort: formation members first, maintain stable order
    const formSet = new Set<string>(
      (this.plane.formations || [])
        .flatMap((f: any) => f.getAllJumpers?.() || [])
        .map((x: SimJumper) => x.id)
    );
    const ordered = [
      ...this.jumpers.filter((x) => formSet.has(x.id)),
      ...this.jumpers.filter((x) => !formSet.has(x.id)),
    ];
    ordered.forEach((x, i) => (x.index = i));
    this.jumpers = ordered;
    this.normalizeJumpTimes();
    this.markDirty();
    this.render();
  }

  // Exit state via kinematics (shared with Scene Objects)
  private hasJumperExited(j: SimJumper): boolean {
    return hasJumperExited(j, this.plane, this.getSimulationTime());
  }

  render() {
    this.refreshJumpers();
    // group formations first, then others.

    // we should refactor this later to include proper load order:
    // First to board: High pullers/Canopy Relative Work
    // Wingsuits
    // Tracking dives 2
    // Tandems
    // Skydiver Training Program Students
    // Freefly groups, smallest to largest.
    // Belly-fly groups, smallest to largest.
    // Tracking/tracing/horizontal dives (Tracking and other horizontal skydives are approved and placed in the loading order on a case-by-case basis after approval from one of our S&TAs, load organizers, or drop zone manager.)
    // Last to board, first to exit: Any lower-altitude individuals or groups.
    const formSet = new Set<string>();
    (this.plane.formations || []).forEach((f: any) => {
      (f?.getAllJumpers?.() || []).forEach((j: SimJumper) => formSet.add(j.id));
    });
    this.jumpers = [
      ...this.jumpers.filter((j) => formSet.has(j.id)),
      ...this.jumpers.filter((j) => !formSet.has(j.id)),
    ];
    const panel = document.querySelector("#plane-panel .plane-load-editor");
    if (!panel) return;
    const container = panel as HTMLElement;
    container.innerHTML = "";

    container.appendChild(this.buildOrganizer());
    this.updateSaveState();
    this.updatePlaneSummary();

    this.attachTicker();
  }

  private attachTicker() {
    const w: any = window as any;
    // No seat visuals to tick right now; keep placeholder for future
    const key = `__planeSeatTicker_${this.plane.id}`;
    if (w[key]) return;
    // ticker disabled; using per-frame updates from Scripts
    w[key] = true;
  }

  // Called each render loop: keep the live columns in step with the scene
  public updateRuntime() {
    this.refreshJumpers();
    const panel = document.querySelector(
      "#plane-panel .plane-load-editor"
    ) as HTMLElement | null;
    if (!panel || panel.offsetParent === null) return; // hidden: nothing to update
    this.updatePlaneSummary();
    const byId = new Map(this.jumpers.map((j) => [j.id, j]));
    panel.querySelectorAll<HTMLTableRowElement>("table tbody tr").forEach((row) => {
      const j = byId.get(row.dataset.id || "");
      if (j) this.updateRow(row, j);
    });
  }

  /** Fill a row's Status / Alt / Fall cells from the jumper's track at the current time. */
  private updateRow(row: HTMLElement, j: SimJumper) {
    const t = this.getSimulationTime();
    const sample = j.track.getInterpolatedSample(t);
    const set = (role: string, text: string) => {
      const cell = row.querySelector(`td[data-role="${role}"]`) as HTMLElement | null;
      if (cell && cell.textContent !== text) cell.textContent = text;
    };
    set("status-cell", this.statusFor(j, t));
    const perf = canopyPerformance(exitWeightKg(j.weight, j.extraWeight), j.canopySize);
    set("wl-cell", perf.wingLoading.toFixed(2));
    const wlCell = row.querySelector('td[data-role="wl-cell"]') as HTMLElement | null;
    const wlTitle =
      `${WL_HINT}\nCanopy: ${Math.round(perf.horizontalMs * MS_TO_MPH)} mph forward, ` +
      `${Math.round(perf.verticalMs * MS_TO_MPH)} mph down (glide ${perf.glideRatio}:1)`;
    if (wlCell && wlCell.title !== wlTitle) wlCell.title = wlTitle;
    if (!sample) {
      set("alt-cell", "–");
      set("fall-cell", "–");
      return;
    }
    set("alt-cell", Math.round(sample.position.y * M_TO_FT).toLocaleString());
    const falling = this.hasJumperExited(j) && !(j.landTime !== null && t >= j.landTime);
    set("fall-cell", falling ? String(Math.round(Math.max(0, -sample.velocity.y) * MS_TO_MPH)) : "–");
  }

  private statusFor(j: SimJumper, t: number): string {
    return jumperStatus(j, this.plane, t);
  }

  /** Scroll to a jumper's row and flash it. */
  highlightJumper(id: string) {
    const row = document.querySelector(
      `#plane-panel .plane-load-editor tr[data-id="${id}"]`
    ) as HTMLElement | null;
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    row.classList.add("is-highlighted");
    window.setTimeout(() => row.classList.remove("is-highlighted"), 1600);
  }

  /** Fill the "Plane Summary" block from the plane the sim is actually flying. */
  private updatePlaneSummary() {
    const set = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== text) el.textContent = text;
    };
    set("load-size", String(this.jumpers.length));
    // plane.speed is m/s (times simScale)
    const scale = (window as any).simScale || 1;
    set("plane-speed", String(Math.round(this.plane.speed / scale / 0.51444)));
    const d = this.plane.direction;
    if (Math.hypot(d.x, d.z) < 1e-6) {
      set("plane-direction", "N/A");
    } else {
      // world: +X = east, -Z = north
      const heading = (Math.round((Math.atan2(d.x, -d.z) * 180) / Math.PI) + 360) % 360;
      set("plane-direction", `${String(heading).padStart(3, "0")}°`);
    }
  }

  /** Body position dropdown for a jumper. */
  private buildPositionSelect(j: SimJumper, onChange?: () => void): HTMLSelectElement {
    const sel = document.createElement("select");
    sel.className = "ps-select";
    const current = normalizeBodyPosition(j.flyingStyle);
    BODY_POSITION_ORDER.forEach((pos) => {
      const o = document.createElement("option");
      const spec = BODY_POSITIONS[pos];
      o.value = pos;
      o.textContent = spec.label;
      o.title = `~${spec.refFallRateMph} mph fall rate (80 kg)`;
      if (pos === current) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => {
      j.setBodyPosition(sel.value);
      onChange?.();
      this.normalizeJumpTimes();
      this.markDirty();
      queueMicrotask(() => this.render()); // slot / pattern cells depend on the position
    });
    return sel;
  }
}
