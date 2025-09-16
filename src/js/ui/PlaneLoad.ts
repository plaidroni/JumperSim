import { SimPlane, SimJumper } from "../classes/SimEntities";
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
    const baseInterval =
      sorted.length > 1
        ? Math.max(1, sorted[1].jumpTime - sorted[0].jumpTime)
        : 10;
    sorted.forEach((j, i) => (j.jumpTime = i * baseInterval));
  }

  swapSeats(aId: string, bId: string) {
    const a = this.jumpers.find((j) => j.id === aId);
    const b = this.jumpers.find((j) => j.id === bId);
    if (!a || !b || a.id === b.id) return;
    const sorted = [...this.jumpers].sort((x, y) => x.index - y.index);
    const getGroupByFormation = (pivot: SimJumper) => {
      if (!pivot.isInFormation || !(pivot as any).formation) return [pivot];
      const f = (pivot as any).formation;
      return sorted.filter((j) => (j as any).formation === f);
    };
    if (a.isInFormation || b.isInFormation) {
      const group = a.isInFormation ? getGroupByFormation(a) : getGroupByFormation(b);
      const remainder = sorted.filter((j) => !group.includes(j));
      const targetIdx = a.isInFormation ? b.index : a.index;
      const insertAt = Math.max(0, Math.min(targetIdx, remainder.length));
      remainder.splice(insertAt, 0, ...group);
      remainder.forEach((j, i) => (j.index = i));
    } else {
      const tmp = a.index;
      a.index = b.index;
      b.index = tmp;
    }
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
    if (j.isInFormation && (j as any).formation) {
      const f = (j as any).formation;
      const group = sorted.filter((x) => (x as any).formation === f);
      const firstIdx = sorted.findIndex((x) => group.includes(x));
      if (firstIdx <= 0) return;
      const before = sorted.slice(0, firstIdx - 1);
      const swapWith = sorted[firstIdx - 1];
      const after = sorted.slice(firstIdx + group.length);
      const rebuilt = [...before, ...group, swapWith, ...after];
      rebuilt.forEach((jj, idx) => (jj.index = idx));
    } else {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const tmp = prev.index;
      prev.index = cur.index;
      cur.index = tmp;
    }
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
    if (j.isInFormation && (j as any).formation) {
      const f = (j as any).formation;
      const group = sorted.filter((x) => (x as any).formation === f);
      const firstIdx = sorted.findIndex((x) => group.includes(x));
      const lastIdx = firstIdx + group.length - 1;
      if (lastIdx >= sorted.length - 1) return;
      const before = sorted.slice(0, firstIdx);
      const swapWith = sorted[lastIdx + 1];
      const after = sorted.slice(lastIdx + 2);
      const rebuilt = [...before, swapWith, ...group, ...after];
      rebuilt.forEach((jj, idx) => (jj.index = idx));
    } else {
      const next = sorted[i + 1];
      const cur = sorted[i];
      const tmp = next.index;
      next.index = cur.index;
      cur.index = tmp;
    }
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
    name.addEventListener("input", () => {
      (j as any).name = name.value;
      askForRefresh(
        () => {
          const plane: SimPlane = this.plane;
          plane.precalculate(300);
          this.jumpers.forEach((jj) => jj.precalculate(300));
        },
        false,
        "PlaneLoad-Details-Name"
      );
    });
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
      askForRefresh(
        () => {
          const plane: SimPlane = this.plane;
          plane.precalculate(300);
          this.jumpers.forEach((jj) => jj.precalculate(300));
        },
        false,
        "PlaneLoad-Details-Style"
      );
    });
    addRow("Flying Style", styleSel);

    const weight = document.createElement("input");
    weight.type = "number";
    weight.value = String((j as any).weight ?? 80);
    weight.addEventListener("input", () => {
      (j as any).weight = Number(weight.value);
      askForRefresh(
        () => {
          const plane: SimPlane = this.plane;
          plane.precalculate(300);
          this.jumpers.forEach((jj) => jj.precalculate(300));
        },
        false,
        "PlaneLoad-Details-Weight"
      );
    });
    addRow("Weight (kg)", weight);

    const extra = document.createElement("input");
    extra.type = "number";
    extra.value = String((j as any).extraWeight ?? 0);
    extra.addEventListener("input", () => {
      (j as any).extraWeight = Number(extra.value);
      askForRefresh(
        () => {
          const plane: SimPlane = this.plane;
          plane.precalculate(300);
          this.jumpers.forEach((jj) => jj.precalculate(300));
        },
        false,
        "PlaneLoad-Details-ExtraWeight"
      );
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
    suit.addEventListener("change", () => {
      (j as any).suitType = suit.value;
      askForRefresh(
        () => {
          const plane: SimPlane = this.plane;
          plane.precalculate(300);
          this.jumpers.forEach((jj) => jj.precalculate(300));
        },
        false,
        "PlaneLoad-Details-Suit"
      );
    });
    addRow("Suit", suit);

    const canopy = document.createElement("input");
    canopy.type = "number";
    canopy.value = String(j.canopySize ?? 190);
    canopy.addEventListener("input", () => {
      j.canopySize = Number(canopy.value);
      askForRefresh(
        () => {
          const plane: SimPlane = this.plane;
          plane.precalculate(300);
          this.jumpers.forEach((jj) => jj.precalculate(300));
        },
        false,
        "PlaneLoad-Details-Canopy"
      );
    });
    addRow("Canopy (sqft)", canopy);

    const deploy = document.createElement("input");
    deploy.type = "number";
    deploy.value = String(j.deployDelay ?? 7);
    deploy.addEventListener("input", () => {
      j.deployDelay = Number(deploy.value);
      askForRefresh(
        () => {
          const plane: SimPlane = this.plane;
          plane.precalculate(300);
          this.jumpers.forEach((jj) => jj.precalculate(300));
        },
        false,
        "PlaneLoad-Details-Deploy"
      );
    });
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
      name.addEventListener("input", () => {
        (j as any).name = name.value;
        askForRefresh(
          () => {
            const plane: SimPlane = this.plane;
            plane.precalculate(300);
            this.jumpers.forEach((jj) => jj.precalculate(300));
          },
          false,
          "PlaneLoad-Name"
        );
      });
      tdName.appendChild(name);
      // Capacity warning for excess jumpers
      const cap: number | undefined = (this.plane as any)?.capacity;
      if (cap && i + 1 > cap) {
        const warn = document.createElement("span");
        warn.textContent = " ⚠ over capacity";
        warn.style.color = "#ff9800";
        warn.title = `Plane capacity ${cap}. This jumper exceeds it by ${i + 1 - cap}.`;
        tdName.appendChild(warn);
      }
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
        askForRefresh(
          () => {
            const plane: SimPlane = this.plane;
            plane.precalculate(300);
            this.jumpers.forEach((jj) => jj.precalculate(300));
          },
          false,
          "PlaneLoad-Style"
        );
      });
      tdStyle.appendChild(styleSel);
      tr.appendChild(tdStyle);

      const tdW = document.createElement("td");
      const w = document.createElement("input");
      w.type = "number";
      w.style.width = "5em";
      w.value = String((j as any).weight ?? 80);
      w.addEventListener("input", () => {
        (j as any).weight = Number(w.value);
        askForRefresh(
          () => {
            const plane: SimPlane = this.plane;
            plane.precalculate(300);
            this.jumpers.forEach((jj) => jj.precalculate(300));
          },
          false,
          "PlaneLoad-Weight"
        );
      });
      tdW.appendChild(w);
      tr.appendChild(tdW);

      const tdC = document.createElement("td");
      const c = document.createElement("input");
      c.type = "number";
      c.style.width = "5em";
      c.value = String(j.canopySize ?? 190);
      c.addEventListener("input", () => {
        j.canopySize = Number(c.value);
        askForRefresh(
          () => {
            const plane: SimPlane = this.plane;
            plane.precalculate(300);
            this.jumpers.forEach((jj) => jj.precalculate(300));
          },
          false,
          "PlaneLoad-Canopy"
        );
      });
      tdC.appendChild(c);
      tr.appendChild(tdC);

      const tdD = document.createElement("td");
      const d = document.createElement("input");
      d.type = "number";
      d.style.width = "5em";
      d.value = String(j.deployDelay ?? 7);
      d.addEventListener("input", () => {
        j.deployDelay = Number(d.value);
        askForRefresh(
          () => {
            const plane: SimPlane = this.plane;
            plane.precalculate(300);
            this.jumpers.forEach((jj) => jj.precalculate(300));
          },
          false,
          "PlaneLoad-Deploy"
        );
      });
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
      const badge = document.createElement("span");
      const colors = ["#b06ab3", "gold", "#5669d8"];
      badge.style.display = "inline-block";
      badge.style.width = "16px";
      badge.style.height = "16px";
      badge.style.borderRadius = "50%";
      badge.style.background = fIdx < 0 ? "#777" : colors[fIdx % colors.length];
      tdF.appendChild(badge);
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
