import { PanelManager } from "../classes/PanelManager";
import { HeightAxis } from "./HeightAxis";

/**
 * This is the drawback of not using React.
 */
export function initializeMenu() {

  // TODO: File

  // TODO: Edit

  // TODO: Formations

  // TODO: Weather 

  // View
  setupViewMenu();

  // window
  setupPanelManager();

  // TODO: Help (menu)

  // contributors is a black swan
  // dropzone menu is handled in scripts

}

// worthless
function handleClick(name: string): void {
  console.log(`Clicked: ${name}`);
}

// garbage
function handleToggle(checkbox: HTMLInputElement, label: string): void {
  console.log(`${label} is now ${checkbox.checked ? "enabled" : "disabled"}`);
}

/**
 * Typically called under the event, tells the submenu to update based on state
 */
function updateWindowSubmenu(panels: PanelManager): void {
  // Get all panel states
  const panelStates = panels.getPanelStates();
  
  // Update checkboxes based on panel visibility
  panelStates.forEach(panel => {
    const menuItem = document.getElementById(`show-${panel.id}`);
    if (!menuItem) return;

    const checkbox = menuItem.querySelector('input[type="checkbox"]') as HTMLInputElement;
    if (checkbox) {
      checkbox.checked = panel.isVisible;
    }
  });
}

function setupPanelManager() {
  let panels: PanelManager = new PanelManager(document.querySelectorAll(".panel"));

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
  document.querySelectorAll<HTMLInputElement>('#window-submenu .dropdown-item')
    .forEach(menuItem => {
      // Skip non-panel menu items
      if (!menuItem.id.startsWith('show-')) return;

      // Handle checkbox changes
      const checkbox = menuItem.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (checkbox) {
        checkbox.addEventListener('change', (e) => {
          e.stopPropagation(); // Prevent menuItem click from firing
          const panelId = menuItem.id.replace('show-', '');
          if (checkbox.checked) {
            panels.getPanel(panelId)?.maximize();
          }
          else {
            panels.getPanel(panelId)?.close();
          }
          
        });
      }

      // Handle clicking the menu item itself
      menuItem.addEventListener('click', (e) => {
        // Don't handle if they clicked the checkbox directly
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        
        const panelId = menuItem.id.replace('show-', '');
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
  window.addEventListener('panelStateChanged', () => {
    updateWindowSubmenu(panels);
  });
}

function setupViewMenu() {
  document.getElementById('height-axis-toggle')?.addEventListener('click', () => {
    let axis = (window as any).heightAxis;
    axis.toggleVisible();
  });
}

// custom class to consolidate checkbox buttons
class MenuCheckbox extends HTMLElement {

  // this element ultimately serves as a way to see if something is enabled or not in a menu
  static observedAttributes = ["checked"];
  public label: HTMLSpanElement;
  public checkbox: HTMLInputElement;

  constructor() {
    super();
  }

  connectedCallback() {
    const shadow = this.attachShadow({ mode: "open" });

    // create the item, add a label and the checkbox, add event listeners?
    const container = document.createElement("div");
    container.setAttribute("class", "dropdown-item");
     

    const label = document.createElement("span");
    label.textContent = this.textContent;
    container.appendChild(label);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.hasAttribute("checked");
    container.appendChild(checkbox);

    shadow.appendChild(container);

    // todo: attach styling
  }

  // fires on removing/adding checked / observedAttributes
  attributeChangedCallback(name, oldValue, newValue) {

  }
}

customElements.define("menu-checkbox", MenuCheckbox);