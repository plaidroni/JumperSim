// App entry point. On touch-only devices (phones, tablets) JumperSim shows the
// mobile blocker instead, and none of the sim (three.js, aircraft models, terrain,
// weather) is downloaded. Keep this query in sync with src/css/mobile-blocker.css.
const MOBILE_QUERY = "(hover: none) and (pointer: coarse)";

if (window.matchMedia(MOBILE_QUERY).matches) {
  setUpMobileBlocker();
} else {
  // Same modules, same order as the original <script type="module"> tags.
  await import("./GlobalVars");
  await import("./DevConsole");
  await import("./TimeScrubber");
  await import("./Scripts");
  await import("../apidata/OpenMateo");
  await import("./LocationSelect");
  await import("./Menubar");
  await import("./ui/PlaneSettings");
}

function setUpMobileBlocker() {
  const url = window.location.origin + window.location.pathname;
  const urlEl = document.getElementById("mobile-blocker-url");
  if (urlEl) urlEl.textContent = url;

  const button = document.getElementById(
    "mobile-blocker-copy",
  ) as HTMLButtonElement | null;
  if (!button) return;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = "Link copied";
    } catch {
      button.textContent = "Copy failed";
    }
    window.setTimeout(() => (button.textContent = "Copy link"), 2000);
  });
}

export {};
