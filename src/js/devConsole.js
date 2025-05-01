// Make draggable
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

// Global values for integration
window.devConsoleVars = {
  separation: 2,
  pullAltitude: 1000,
  planeSpeed: 5,
  bellySpeed: 55,
  freeflySpeed: 75,
  winds: {
    12000: -5,
    9000: -3,
    6000: -2,
    3000: -1,
    ground: 0,
  },
};

function updateVarsFromUI() {
  window.devConsoleVars.separation = parseFloat(
    document.getElementById("separation").value
  );
  window.devConsoleVars.pullAltitude = parseFloat(
    document.getElementById("pullAltitude").value
  );
  window.devConsoleVars.planeSpeed = parseFloat(
    document.getElementById("planeSpeed").value
  );
  window.devConsoleVars.bellySpeed = parseFloat(
    document.getElementById("bellySpeed").value
  );
  window.devConsoleVars.freeflySpeed = parseFloat(
    document.getElementById("freeflySpeed").value
  );
  window.devConsoleVars.winds[12000] = parseFloat(
    document.getElementById("wind12000").value
  );
  window.devConsoleVars.winds[9000] = parseFloat(
    document.getElementById("wind9000").value
  );
  window.devConsoleVars.winds[6000] = parseFloat(
    document.getElementById("wind6000").value
  );
  window.devConsoleVars.winds[3000] = parseFloat(
    document.getElementById("wind3000").value
  );
  window.devConsoleVars.winds.ground = parseFloat(
    document.getElementById("windGround").value
  );
}

// scrubber interactions
window.rewindButton.addEventListener("click", () =>
  window.updateScrubber(window.currentTime - 1)
);
window.forwardButton.addEventListener("click", () =>
  window.updateScrubber(window.currentTime + 1)
);
window.startButton.addEventListener("click", () => window.updateScrubber(0));
window.endButton.addEventListener("click", () =>
  window.updateScrubber(window.maxTime)
);
window.scrubber.addEventListener("input", (e) =>
  window.updateScrubber(parseFloat(e.target.value))
);

document.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", updateVarsFromUI);
});
