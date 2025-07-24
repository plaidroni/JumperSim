function handleClick(name) {
  console.log(`Clicked: ${name}`);
}

function handleToggle(checkbox, label) {
  console.log(`${label} is now ${checkbox.checked ? "enabled" : "disabled"}`);
}


// initialize menu stuff
import { reCenterAllWindows } from "./panels";

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById("recenter-windows")?.addEventListener("click", () => { 
    reCenterAllWindows();
  });
})

