import { PanelManager } from "./classes/PanelManager";
import { Formation } from "./classes/Formations";
import {
  SimJumper,
  SimPlane,
  createDefaultSimJumpers,
} from "./classes/SimEntities";
import { askForRefresh } from "./core/data/SimulationVariables";

function handleClick(name: string): void {
  console.log(`Clicked: ${name}`);
}

function handleToggle(checkbox: HTMLInputElement, label: string): void {
  console.log(`${label} is now ${checkbox.checked ? "enabled" : "disabled"}`);
}

// function to handle file selection
function handleFileSelect(): void {
  let input = document.createElement("input");
  input.type = "file";
  input.onchange = (_) => {
    const files = input.files ? Array.from(input.files) : [];
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const formation = new Formation(data);
        const w: any = window as any;
        const simPlane: SimPlane = w.simPlane;
        if (!simPlane) throw new Error("Plane not initialized");
        formation.createJumpersForPlane(
          simPlane,
          (data as any).jumpers || [],
          (data as any).people || []
        );
        simPlane.addFormation(formation);

        // Rebuild jumper list: all formation jumpers + any existing solos
        const formations = simPlane.formations;
        const currentJumpers: SimJumper[] = (w.simJumpers || []) as SimJumper[];
        const existingSolos = currentJumpers.filter(
          (j) => !(j as any).isInFormation
        );
        let all: SimJumper[] = formations.flatMap((f: any) =>
          f.getAllJumpers()
        );
        all = (w.groupAndReindexJumpers as Function)(simPlane, [
          ...all,
          ...existingSolos,
        ]);
        w.simJumpers = all;
        simPlane.jumpers = all;
        (simPlane as any).planeLoad?.render?.();

        // Prompt to assign solos and refresh
        const notificationManager = (window as any).notificationManager;
        notificationManager?.success?.("Formation imported.", {
          duration: 0,
          actions: [
            {
              label: "Assign solos to formation?",
              callback: () => {
                const f = formation;
                const firstPointSize =
                  f.getCurrentPoint()?.slots?.length ||
                  f.getAllJumpers().length;
                const missing = Math.max(
                  0,
                  firstPointSize - f.getAllJumpers().length
                );
                if (missing > 0) {
                  const pool = all.filter((j) => !(j as any).isInFormation);
                  const take = pool.splice(0, missing);
                  take.forEach((j, i) => {
                    (j as any).isInFormation = true;
                    (j as any).linked = true;
                    (j as any).formation = f as any;
                    j.index = f.getAllJumpers().length + i;
                  });
                  const otherF = formations
                    .filter((ff) => ff !== f)
                    .flatMap((ff) => ff.getAllJumpers());
                  const regrouped = (w.groupAndReindexJumpers as Function)(
                    simPlane,
                    [...f.getAllJumpers(), ...take, ...otherF, ...pool]
                  );
                  w.simJumpers = regrouped;
                  simPlane.jumpers = regrouped;
                  (simPlane as any).planeLoad?.render?.();
                }
                askForRefresh(
                  () => {
                    simPlane.precalculate(300);
                    (w.simJumpers as SimJumper[]).forEach((j) =>
                      j.precalculate(300)
                    );
                  },
                  false,
                  "Menu-FormationAssign"
                );
              },
              primary: true,
            },
            {
              label: "Refresh now",
              callback: () => {
                askForRefresh(
                  () => {
                    simPlane.precalculate(300);
                    (w.simJumpers as SimJumper[]).forEach((j) =>
                      j.precalculate(300)
                    );
                  },
                  true,
                  "Menu-FormationImport"
                );
              },
            },
          ],
        });
      } catch (e) {
        console.error("Failed to import .jump:", e);
        (window as any).notificationManager?.error?.("Invalid .jump file.");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// function to handle opening Skydive Designer link
function handleOpenSkydiveDesignerLink(): void {}

export function addTooltipToggle(tooltip): void {
  const showTooltip = document.getElementById("show-tooltip");
  if (!showTooltip) return;

  const checkbox = showTooltip.querySelector(
    'input[type="checkbox"]'
  ) as HTMLInputElement;
  if (!checkbox) return;

  function toggleTooltip(): void {}

  checkbox.addEventListener("change", (e) => {
    e.stopPropagation(); // Prevent menuItem click from firing

    tooltip.show = checkbox.checked;
  });

  // Handle clicking the menu item itself
  showTooltip.addEventListener("click", (e) => {
    // Don't handle if they clicked the checkbox directly
    if ((e.target as HTMLElement).tagName === "INPUT") return;

    if (checkbox.checked) {
      tooltip.show = checkbox.checked = false;
    } else {
      tooltip.show = checkbox.checked = true;
    }
  });
}

function updateWindowSubmenu(panels: PanelManager): void {
  // Get all panel states
  const panelStates = panels.getPanelStates();

  // Update checkboxes based on panel visibility
  panelStates.forEach((panel) => {
    const menuItem = document.getElementById(`show-${panel.id}`);
    if (!menuItem) return;

    const checkbox = menuItem.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    if (checkbox) {
      checkbox.checked = panel.isVisible;
    }
  });
}

export function initializePanelManager() {
  let panels: PanelManager = new PanelManager(
    document.querySelectorAll(".panel")
  );

  // Set up window menu actions
  document.getElementById("recenter-windows")?.addEventListener("click", () => {
    panels.reCenterAllPanels();
  });

  document.getElementById("minimize-windows")?.addEventListener("click", () => {
    panels.minimizeAllPanels();
  });

  document.getElementById("restore-windows")?.addEventListener("click", () => {
    panels.restoreAllPanels();
  });

  // Set up panel visibility toggles for checkboxes and menu items in window tab
  document
    .querySelectorAll<HTMLInputElement>("#window-submenu .dropdown-item")
    .forEach((menuItem) => {
      // Skip non-panel menu items
      if (!menuItem.id.startsWith("show-")) return;

      // Handle checkbox changes
      const checkbox = menuItem.querySelector(
        'input[type="checkbox"]'
      ) as HTMLInputElement;
      if (checkbox) {
        checkbox.addEventListener("change", (e) => {
          e.stopPropagation(); // Prevent menuItem click from firing
          const panelId = menuItem.id.replace("show-", "");
          if (checkbox.checked) {
            panels.getPanel(panelId)?.maximize();
          } else {
            panels.getPanel(panelId)?.close();
          }
        });
      }

      // Handle clicking the menu item itself
      menuItem.addEventListener("click", (e) => {
        // Don't handle if they clicked the checkbox directly
        if ((e.target as HTMLElement).tagName === "INPUT") return;

        const panelId = menuItem.id.replace("show-", "");
        const panel = panels.getPanel(panelId);
        if (panel) {
          // If panel exists, maximize it
          panel.maximize();
          panel.center();
          panel.saveState();
        }
      });
    });

  // Initial window menu setup
  updateWindowSubmenu(panels);

  // Listen for panel state changes
  window.addEventListener("panelStateChanged", () => {
    updateWindowSubmenu(panels);
  });
}

// expose the handleFileSelect function globally
(window as any).handleFileSelect = handleFileSelect;
