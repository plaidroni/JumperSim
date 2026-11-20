import { deriveCloudLayers } from "./CloudLayers";
import { precipIntensity, precipKind } from "./Precipitation";
import type { WeatherState } from "./WeatherState";

/** Fill in the derived fields (precipitation kind/intensity, cloud layers, ceiling). */
export function deriveWeather(state: WeatherState): WeatherState {
  const p = state.precip;
  p.kind = precipKind(state.surface.weatherCode, p);
  p.intensity = precipIntensity(p.kind, p.mmPerH, p.snowCmPerH);
  const { layers, ceilingAglM } = deriveCloudLayers(state, p.kind);
  state.clouds.layers = layers;
  state.clouds.ceilingAglM = ceilingAglM;
  return state;
}
