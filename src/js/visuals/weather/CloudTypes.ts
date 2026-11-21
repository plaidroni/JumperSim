import type { CloudBand, CloudType } from "../../weather/WeatherState";
import { CHANNEL } from "./coverageNoise";

/**
 * How each cloud type looks (specs/weather-clouds-visibility.md §5.2 table).
 * profile: vertical density shape in the raymarch shader
 *   0 fog (thins upward) · 1 flat sheet · 2 rounded top · 3 cumulus · 4 cumulonimbus · 5 thin veil
 */
export interface CloudLook {
  density: number;
  /** Feature size of the 3D shape noise (m). */
  shapeScaleM: number;
  /** Stretch along the drift direction (cirrus streaks). */
  stretch: number;
  profile: number;
  /** Cloud shadow strength per km of thickness (§5.5); fixed for thin types. */
  shadow: number;
}

export const CLOUD_LOOKS: Record<CloudType, CloudLook> = {
  fog: { density: 0.6, shapeScaleM: 400, stretch: 1, profile: 0, shadow: 0 },
  stratus: { density: 0.5, shapeScaleM: 1500, stretch: 1, profile: 1, shadow: 0.5 },
  stratocumulus: { density: 0.6, shapeScaleM: 1200, stretch: 1, profile: 2, shadow: 0.5 },
  cumulus: { density: 0.9, shapeScaleM: 800, stretch: 1, profile: 3, shadow: 0.5 },
  cumulonimbus: { density: 1.0, shapeScaleM: 1500, stretch: 1, profile: 4, shadow: 0.5 },
  altocumulus: { density: 0.5, shapeScaleM: 300, stretch: 1, profile: 2, shadow: 0.5 },
  altostratus: { density: 0.4, shapeScaleM: 3000, stretch: 1, profile: 1, shadow: 0.5 },
  nimbostratus: { density: 0.9, shapeScaleM: 3000, stretch: 1, profile: 1, shadow: 0.5 },
  cirrus: { density: 0.15, shapeScaleM: 2000, stretch: 4, profile: 5, shadow: 0.15 },
  cirrostratus: { density: 0.1, shapeScaleM: 3000, stretch: 1.5, profile: 5, shadow: 0.15 },
};

/** Which coverage-map channel and tile size (m) each band uses. */
export const BAND_PATTERN: Record<CloudBand, { channel: number; tileM: number }> = {
  fog: { channel: CHANNEL.fog, tileM: 12000 },
  low: { channel: CHANNEL.low, tileM: 24000 },
  mid: { channel: CHANNEL.mid, tileM: 48000 },
  high: { channel: CHANNEL.high, tileM: 96000 },
};
