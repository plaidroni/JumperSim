import { SimPlane, SimJumper } from "../classes/SimEntities";
import { Formation } from "../classes/Formations";
import { notificationManager } from "../classes/NotificationManager";
import { askForRefresh } from "../core/data/SimulationVariables";

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

  constructor(plane: SimPlane, layout?: PlaneLayout) {
    this.plane = plane;
    this.layout = layout || TwinOtterLayout;
    this.refreshJumpers();
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

    // Assign group-based jump times (same time for all in a group)
    let tIndex = 0;
    groups.forEach((g) => {
      const t = tIndex * baseInterval;
      g.forEach((j) => (j.jumpTime = t));
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
    askForRefresh(
      () => {
        // recompute using current global references
        const w: any = window as any;
        const plane: SimPlane = this.plane;
        const js: SimJumper[] = Array.isArray(w.simJumpers)
          ? (w.simJumpers as SimJumper[])
          : plane.jumpers;
        plane.precalculate(300);
        js.forEach((j) => j.precalculate(300));
      },
      false,
      "PlaneLoad"
    );
  }

  setIndex(j: SimJumper, idx: number) {
    j.index = idx;
    this.normalizeJumpTimes();
    this.render();
    askForRefresh(
      () => {
        const w: any = window as any;
        const plane: SimPlane = this.plane;
        const js: SimJumper[] = Array.isArray(w.simJumpers)
          ? (w.simJumpers as SimJumper[])
          : plane.jumpers;
        plane.precalculate(300);
        js.forEach((j) => j.precalculate(300));
      },
      false,
      "PlaneLoad"
    );
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
    askForRefresh(
      () => {
        const w: any = window as any;
        const plane: SimPlane = this.plane;
        const js: SimJumper[] = Array.isArray(w.simJumpers)
          ? (w.simJumpers as SimJumper[])
          : plane.jumpers;
        plane.precalculate(300);
        js.forEach((j) => j.precalculate(300));
      },
      false,
      "PlaneLoad"
    );
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
    askForRefresh(
      () => {
        const w: any = window as any;
        const plane: SimPlane = this.plane;
        const js: SimJumper[] = Array.isArray(w.simJumpers)
          ? (w.simJumpers as SimJumper[])
          : plane.jumpers;
        plane.precalculate(300);
        js.forEach((j) => j.precalculate(300));
      },
      false,
      "PlaneLoad"
    );
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

    const styleSel = document.createElement("select");
    ["belly", "freefly", "headdown", "sitfly", "tracking", "wingsuit"].forEach(
      (opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if ((j as any).flyingStyle === opt) o.selected = true;
        styleSel.appendChild(o);
      }
    );
    styleSel.addEventListener("change", () => {
      (j as any).flyingStyle = styleSel.value;
      j.calculateSurfaceArea();
    });
    addRow("Flying Style", styleSel);

    const weight = document.createElement("input");
    weight.type = "number";
    weight.value = String((j as any).weight ?? 80);
    weight.addEventListener(
      "input",
      () => ((j as any).weight = Number(weight.value))
    );
    addRow("Weight (kg)", weight);

    const extra = document.createElement("input");
    extra.type = "number";
    extra.value = String((j as any).extraWeight ?? 0);
    extra.addEventListener(
      "input",
      () => ((j as any).extraWeight = Number(extra.value))
    );
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
      () => (j.canopySize = Number(canopy.value))
    );
    addRow("Canopy (sqft)", canopy);

    const deploy = document.createElement("input");
    deploy.type = "number";
    deploy.value = String(j.deployDelay ?? 7);
    deploy.addEventListener(
      "input",
      () => (j.deployDelay = Number(deploy.value))
    );
    addRow("Deploy Delay (s)", deploy);

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
    toolbar.style.display = "flex";
    toolbar.style.gap = "8px";
    toolbar.style.alignItems = "center";
    toolbar.style.margin = "4px 0 8px";

    const importBtn = document.createElement("button");
    importBtn.textContent = "Import Formation (.jump)";
    importBtn.addEventListener("click", () => this.openFormationImport());

    const formSel = document.createElement("select");
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

    // Jump interval editor
    const intervalWrap = document.createElement("div");
    intervalWrap.style.display = "inline-flex";
    intervalWrap.style.alignItems = "center";
    intervalWrap.style.gap = "4px";
    const intervalLabel = document.createElement("label");
    intervalLabel.textContent = "Interval (s)";
    const intervalInput = document.createElement("input");
    intervalInput.type = "number";
    intervalInput.min = "0";
    intervalInput.step = "0.5";
    intervalInput.style.width = "6em";
    intervalInput.value = String(this.jumpIntervalSeconds);
    intervalInput.addEventListener("change", () => {
      const v = Number(intervalInput.value);
      this.jumpIntervalSeconds = isFinite(v)
        ? Math.max(0, v)
        : this.jumpIntervalSeconds;
      this.normalizeJumpTimes();
      // prompt recalc
      askForRefresh(
        () => {
          const w: any = window as any;
          const plane: SimPlane = this.plane;
          const js: SimJumper[] = Array.isArray(w.simJumpers)
            ? (w.simJumpers as SimJumper[])
            : plane.jumpers;
          plane.precalculate(300);
          js.forEach((j) => j.precalculate(300));
        },
        false,
        "PlaneLoad"
      );
      this.render();
    });
    intervalWrap.appendChild(intervalLabel);
    intervalWrap.appendChild(intervalInput);

    toolbar.appendChild(importBtn);
    toolbar.appendChild(formSel);
    toolbar.appendChild(intervalWrap);
    wrap.appendChild(toolbar);
    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
      <th style="text-align:left">#</th>
      <th style="text-align:left">Name</th>
      <th style="text-align:left">Style</th>
      <th style="text-align:left">Wt (kg)</th>
      <th style="text-align:left">Canopy</th>
      <th style="text-align:left">Deploy(s)</th>
      <th style="text-align:left">Linked</th>
      <th style="text-align:left">Formation</th>
      <th style="text-align:left">Jumped</th>
    </tr>`;
    const tbody = document.createElement("tbody");

    // Ensure no duplicate indices; then render
    this.reindexSequential();
    const list = [...this.jumpers].sort((a, b) => a.index - b.index);
    list.forEach((j, i) => {
      const tr = document.createElement("tr");
      tr.draggable = false;
      tr.dataset.id = j.id;
      tr.style.borderBottom = "1px solid #444";

      // Up/Down controls + index display (1-based)
      const tdIdx = document.createElement("td");
      tdIdx.style.display = "flex";
      tdIdx.style.alignItems = "center";
      tdIdx.style.gap = "4px";

      const upBtn = document.createElement("button");
      upBtn.textContent = "▲";
      upBtn.title = "Move up";
      upBtn.style.padding = "0 4px";
      upBtn.disabled = i === 0;
      upBtn.addEventListener("click", () => this.moveUp(j));

      const downBtn = document.createElement("button");
      downBtn.textContent = "▼";
      downBtn.title = "Move down";
      downBtn.style.padding = "0 4px";
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
      name.value = (j as any).name || "";
      name.addEventListener("input", () => ((j as any).name = name.value));
      tdName.appendChild(name);
      tr.appendChild(tdName);

      const tdStyle = document.createElement("td");
      const styleSel = document.createElement("select");
      [
        "belly",
        "freefly",
        "headdown",
        "sitfly",
        "tracking",
        "wingsuit",
      ].forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if ((j as any).flyingStyle === opt) o.selected = true;
        styleSel.appendChild(o);
      });
      styleSel.addEventListener("change", () => {
        (j as any).flyingStyle = styleSel.value;
        j.calculateSurfaceArea();
      });
      tdStyle.appendChild(styleSel);
      tr.appendChild(tdStyle);

      const tdW = document.createElement("td");
      const w = document.createElement("input");
      w.type = "number";
      w.style.width = "5em";
      w.value = String((j as any).weight ?? 80);
      w.addEventListener("input", () => ((j as any).weight = Number(w.value)));
      tdW.appendChild(w);
      tr.appendChild(tdW);

      const tdC = document.createElement("td");
      const c = document.createElement("input");
      c.type = "number";
      c.style.width = "5em";
      c.value = String(j.canopySize ?? 190);
      c.addEventListener("input", () => (j.canopySize = Number(c.value)));
      tdC.appendChild(c);
      tr.appendChild(tdC);

      const tdD = document.createElement("td");
      const d = document.createElement("input");
      d.type = "number";
      d.style.width = "5em";
      d.value = String(j.deployDelay ?? 7);
      d.addEventListener("input", () => (j.deployDelay = Number(d.value)));
      tdD.appendChild(d);
      tr.appendChild(tdD);

      // Linked toggle
      const tdLinked = document.createElement("td");
      const linked = document.createElement("button");
      const setLinkedStyle = () => {
        linked.textContent = j.linked ? "Linked" : "Solo";
        linked.style.background = j.linked ? "#2d7" : "#333";
      };
      setLinkedStyle();
      linked.addEventListener("click", () => {
        j.linked = !j.linked;
        setLinkedStyle();
        askForRefresh(
          () => {
            const w: any = window as any;
            const plane: SimPlane = this.plane;
            const js: SimJumper[] = Array.isArray(w.simJumpers)
              ? (w.simJumpers as SimJumper[])
              : plane.jumpers;
            plane.precalculate(300);
            js.forEach((j) => j.precalculate(300));
          },
          false,
          "PlaneLoad"
        );
      });
      tdLinked.appendChild(linked);
      tr.appendChild(tdLinked);

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
        this.render();
      });
      tdF.appendChild(badgeBtn);
      tdF.appendChild(formSelect);
      tdF.appendChild(slotSelect);
      tr.appendChild(tdF);

      const tdJ = document.createElement("td");
      tdJ.dataset.role = "jumped-cell";
      const jumped = this.hasJumperExited(j);
      tdJ.textContent = jumped ? "Jumped" : "In Plane";
      tr.appendChild(tdJ);

      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // Import a .jump formation file and attach to plane
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
    this.render();
  }

  // Determine exit state via kinematics: if jumper has separated from plane by threshold
  private hasJumperExited(j: SimJumper): boolean {
    const t = this.getSimulationTime();
    const js = j.track.getInterpolatedSample(t);
    const ps = this.plane.track.getInterpolatedSample(t);
    if (!js || !ps) return t >= j.jumpTime; // fallback
    const dist = js.position.distanceTo(ps.position);
    // consider exited if > 2 meters away from plane position
    return dist > 2;
  }

  private renderTabs(container: HTMLElement) {
    // Single tab header (Organizer)
    const tabs = document.createElement("div");
    tabs.style.display = "flex";
    tabs.style.gap = "8px";
    tabs.style.marginBottom = "8px";
    const org = document.createElement("span");
    org.textContent = "Organizer";
    org.style.background = "#555";
    org.style.padding = "4px 8px";
    org.style.borderRadius = "4px";
    tabs.appendChild(org);
    container.appendChild(tabs);
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

    this.renderTabs(container);

    const content = document.createElement("div");
    content.style.display = "grid";
    content.style.gridTemplateColumns = "1fr";
    content.style.gap = "12px";

    content.appendChild(this.buildOrganizer());

    container.appendChild(content);

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

  // Called each render loop to update dynamic cells (ex: "jumped?")
  public updateRuntime() {
    // refresh jumper list in case runtime mutated it
    this.refreshJumpers();
    const panel = document.querySelector(
      "#plane-panel .plane-load-editor"
    ) as HTMLElement | null;
    if (!panel) return;
    const rows = panel.querySelectorAll("table tbody tr");
    const list = [...this.jumpers].sort((a, b) => a.index - b.index);
    rows.forEach((row, i) => {
      const j = list[i];
      if (!j) return;
      const cell = row.querySelector(
        'td[data-role="jumped-cell"]'
      ) as HTMLElement | null;
      if (!cell) return;
      const jumped = this.hasJumperExited(j);
      cell.textContent = jumped ? "Jumped" : "In Plane";
    });
  }
}
