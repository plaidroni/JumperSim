// App entry point. On touch-only devices (phones, tablets) JumperSim shows the
// mobile blocker instead, and none of the sim (three.js, aircraft models, terrain,
// weather) is downloaded. Keep this query in sync with src/css/mobile-blocker.css.
//
// any-hover / any-pointer look at every input device, not just the primary one, so
// touchscreen laptops with a trackpad or mouse are never treated as mobile.
const MOBILE_QUERY = "(any-hover: none) and (any-pointer: coarse)";
const ALLOW_MOBILE_KEY = "jumpersim.allowMobile";

const allowMobile = document.documentElement.classList.contains("allow-mobile");

if (window.matchMedia(MOBILE_QUERY).matches && !allowMobile) {
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

  // escape hatch for devices that misreport their inputs
  document
    .getElementById("mobile-blocker-continue")
    ?.addEventListener("click", () => {
      try {
        localStorage.setItem(ALLOW_MOBILE_KEY, "1");
      } catch {
        /* storage unavailable; the reload below still shows the app once */
      }
      document.documentElement.classList.add("allow-mobile");
      window.location.reload();
    });
}

export {};
