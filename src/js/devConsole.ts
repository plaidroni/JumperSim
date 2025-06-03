const consoleEl = document.getElementById("devConsole");

(<any>window).devConsoleVars = {
  separation: 2,
  pullAltitude: 1000,
  planeSpeed: 5,
  bellySpeed: 55,
  freeflySpeed: 75,
  // deprecate
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
