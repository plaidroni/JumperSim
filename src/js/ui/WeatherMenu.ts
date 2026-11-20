import { WeatherDisplaySettings, weatherDisplay } from "../weather/WeatherDisplay";
import { weatherService } from "../weather/WeatherService";

/**
 * The menubar's Weather menu: the same display toggles as the Weather tab, plus
 * refresh, hold and a shortcut to the panel (specs/weather-clouds-visibility.md §7).
 */
export function initializeWeatherMenu() {
  const menu = document.getElementById("weather-menu");
  if (!menu) return;

  const toggles = [...menu.querySelectorAll<HTMLElement>("[data-weather-set]")];
  const box = (item: HTMLElement | null) => item?.querySelector("input[type=checkbox]") as HTMLInputElement | null;

  toggles.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault(); // the store decides the checkbox state
      const key = item.dataset.weatherSet as keyof WeatherDisplaySettings;
      const current = weatherDisplay.get()[key];
      weatherDisplay.set({ [key]: !current } as any);
    });
  });

  const hold = document.getElementById("weather-hold");
  hold?.addEventListener("click", (e) => {
    e.preventDefault();
    weatherService.setHold(!weatherService.held);
  });
  document.getElementById("weather-refresh")?.addEventListener("click", () => weatherService.refresh("manual"));
  document.getElementById("weather-open")?.addEventListener("click", () => (window as any).dock?.focus?.("weatherdata"));

  function sync(d: WeatherDisplaySettings = weatherDisplay.get()) {
    toggles.forEach((item) => {
      const on = (d as any)[item.dataset.weatherSet!] === true;
      const b = box(item);
      if (b) b.checked = on;
      item.setAttribute("aria-checked", String(on));
    });
    const hb = box(hold);
    if (hb) hb.checked = weatherService.held;
    hold?.setAttribute("aria-checked", String(weatherService.held));
  }
  weatherDisplay.onChange(sync);
  weatherService.onChange(() => sync());
  sync();
}
