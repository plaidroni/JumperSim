
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
    let files = Array.from(input.files);
    console.log(files);
  };
  input.click();
}

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
