// Tunable values for the weather visuals (specs/weather-clouds-visibility.md §5).

export const WEATHER_VISUALS = {
  /** Haze follows the reported visibility exactly at or below this (m)… */
  hazeFullBelowM: 8000,
  /** …and fades out by this (m): models report ~16–24 km on clear days. */
  hazeNoneAboveM: 24000,
  /** Haze thins above the mixed layer with this scale height (m). */
  hazeScaleHeightM: 1000,
  /** The mixed layer's top (boundary-layer height) is clamped to this range (m). */
  hazeMixMinM: 200,
  hazeMixMaxM: 3000,
  /** Sky pixels integrate haze out to this distance (m). */
  hazeSkyDistanceM: 60000,
  /** Haze colour at good visibility (the dark theme's fog) and at poor visibility. */
  hazeClearColor: 0x0a0a0a,
  // dark enough that rain still reads as darker on the near-black theme
  hazeGreyColor: 0x4f565e,
  /** Visibility (m) at which the haze is fully grey. */
  hazeGreyBelowM: 3000,
  /** Darkening: D = min(max, rain · intensity + overcast · smoothstep(0.6, 1, cover)). */
  darkenMax: 0.55,
  darkenRain: 0.45,
  darkenOvercast: 0.15,
  /** Rain makes the scene slightly cooler: multiply by (1 − r·R, 1 − r·G, 1). */
  rainTint: [0.08, 0.04, 0] as const,
  /** Changes in haze and darkening ease in over about this long (s). */
  easeS: 3,
};
