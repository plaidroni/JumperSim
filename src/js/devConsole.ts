const consoleEl = document.getElementById("devConsole");
let isDragging = false;
let offsetX = 0;
let offsetY = 0;

consoleEl.addEventListener("mousedown", (e) => {
  if (e.target.tagName !== "INPUT") {
    isDragging = true;
    offsetX = e.clientX - consoleEl.offsetLeft;
    offsetY = e.clientY - consoleEl.offsetTop;
  }
});

document.addEventListener("mousemove", (e) => {
  if (isDragging) {
    consoleEl.style.left = `${e.clientX - offsetX}px`;
    consoleEl.style.top = `${e.clientY - offsetY}px`;
  }
});

document.addEventListener("mouseup", () => {
  isDragging = false;
});

(<any>window).devConsoleVars = {
  separation: 2,
  pullAltitude: 1000,
  planeSpeed: 5,
  bellySpeed: 55,
  freeflySpeed: 75,
  // deprecate
  winds: {
    12000: -5,
    9000: -3,
    6000: -2,
    3000: -1,
    ground: 0,
  },
};

function updateVarsFromUI() {
  (<any>window).devConsoleVars.separation = parseFloat(
    document.getElementById("separation").value
  );
  (<any>window).devConsoleVars.pullAltitude = parseFloat(
    document.getElementById("pullAltitude").value
  );
  (<any>window).devConsoleVars.planeSpeed = parseFloat(
    document.getElementById("planeSpeed").value
  );
  (<any>window).devConsoleVars.bellySpeed = parseFloat(
    document.getElementById("bellySpeed").value
  );
  (<any>window).devConsoleVars.freeflySpeed = parseFloat(
    document.getElementById("freeflySpeed").value
  );
}

document.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", updateVarsFromUI);
});
