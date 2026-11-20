/** WMO weather codes as Open-Meteo uses them (specs/weather-clouds-visibility.md App. C). */

const CODES: Record<number, [icon: string, text: string]> = {
  0: ["☀️", "Clear"],
  1: ["🌤️", "Mainly clear"],
  2: ["⛅", "Partly cloudy"],
  3: ["☁️", "Overcast"],
  45: ["🌫️", "Fog"],
  48: ["🌫️", "Rime fog"],
  51: ["🌦️", "Light drizzle"],
  53: ["🌦️", "Drizzle"],
  55: ["🌧️", "Dense drizzle"],
  56: ["🌧️", "Light freezing drizzle"],
  57: ["🌧️", "Freezing drizzle"],
  61: ["🌧️", "Light rain"],
  63: ["🌧️", "Rain"],
  65: ["🌧️", "Heavy rain"],
  66: ["🌧️", "Light freezing rain"],
  67: ["🌧️", "Freezing rain"],
  71: ["🌨️", "Light snow"],
  73: ["🌨️", "Snow"],
  75: ["❄️", "Heavy snow"],
  77: ["🌨️", "Snow grains"],
  80: ["🌦️", "Light rain showers"],
  81: ["🌧️", "Rain showers"],
  82: ["⛈️", "Violent rain showers"],
  85: ["🌨️", "Snow showers"],
  86: ["❄️", "Heavy snow showers"],
  95: ["⛈️", "Thunderstorm"],
  96: ["⛈️", "Thunderstorm with hail"],
  99: ["⛈️", "Thunderstorm with heavy hail"],
};

const NIGHT: Record<number, string> = { 0: "🌙", 1: "🌙", 2: "☁️" };

export function weatherCodeInfo(code: number, isDay = true): { icon: string; text: string } {
  const c = Math.round(code);
  const hit = CODES[c] ?? (c >= 95 && c <= 99 ? CODES[95] : undefined);
  if (!hit) return { icon: "·", text: Number.isFinite(c) ? `Code ${c}` : "Unknown" };
  return { icon: !isDay && NIGHT[c] ? NIGHT[c] : hit[0], text: hit[1] };
}
