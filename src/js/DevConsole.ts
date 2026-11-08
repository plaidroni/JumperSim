const consoleEl = document.getElementById("devConsole");

(<any>window).devConsoleVars = {
  separation: 2,
  pullAltitude: 1000,
  planeSpeed: 5,
  // jumper fall rates come from their body position (physics/BodyPositions.ts)
};

function updateVarsFromUI() {
  // read each setting only if its input is on the page (some panels are disabled)
  const read = (id: string, key: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    const v = el ? parseFloat(el.value) : NaN;
    if (Number.isFinite(v)) (<any>window).devConsoleVars[key] = v;
  };
  read("separation", "separation");
  read("pullAltitude", "pullAltitude");
  read("planeSpeed", "planeSpeed");
}

document.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", updateVarsFromUI);
});
