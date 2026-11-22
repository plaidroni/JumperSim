import { importJumpText, pickAndImportJump } from "./formations/ImportJump";

function handleClick(name: string): void {
  console.log(`Clicked: ${name}`);
}

function handleToggle(checkbox: HTMLInputElement, label: string): void {
  console.log(`${label} is now ${checkbox.checked ? "enabled" : "disabled"}`);
}

// Formations → Import Formation → From .jump (specs/formation-jumps.md P7)
function handleFileSelect(): void {
  pickAndImportJump();
}

// Drop a .jump on the Plane Settings tab to import it
function setupJumpDrop() {
  const tab = document.getElementById("plane-panel");
  if (!tab) return;
  tab.addEventListener("dragover", (e) => {
    if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) {
      e.preventDefault();
      tab.classList.add("is-drop-target");
    }
  });
  tab.addEventListener("dragleave", () => tab.classList.remove("is-drop-target"));
  tab.addEventListener("drop", async (e) => {
    tab.classList.remove("is-drop-target");
    const file = e.dataTransfer?.files?.[0];
    if (!file || !/.jump$/i.test(file.name)) return;
    e.preventDefault();
    e.stopPropagation();
    importJumpText(await file.text(), file.name);
  });
}
if (typeof document !== "undefined") setupJumpDrop();

// function to handle opening Skydive Designer link
function handleOpenSkydiveDesignerLink(): void {}

export function addTooltipToggle(tooltip): void {

  const showTooltip = document.getElementById('show-tooltip');
  if (!showTooltip) return;

  const checkbox = showTooltip.querySelector(
        'input[type="checkbox"]'
      ) as HTMLInputElement;
  if (!checkbox) return;
    
  function toggleTooltip(): void {
    
  }

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
      } 
      else {
        tooltip.show = checkbox.checked = true;
      }
  });
}

// Window menu, dock side and panel tabs are handled by src/js/editor/Dock.ts

// expose the handleFileSelect function globally
(window as any).handleFileSelect = handleFileSelect;
