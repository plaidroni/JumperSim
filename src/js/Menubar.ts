import { PanelManager } from "./classes/PanelManager";

function handleClick(name: string): void {
  console.log(`Clicked: ${name}`);
}

function handleToggle(checkbox: HTMLInputElement, label: string): void {
  console.log(`${label} is now ${checkbox.checked ? "enabled" : "disabled"}`);
}

// function to handle file selection
function handleFileSelect(): void {}

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

  // Set up panel visibility toggles for checkboxes and menu items
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
