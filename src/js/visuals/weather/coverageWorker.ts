/// <reference lib="webworker" />
import { generateCoverageMap } from "./coverageNoise";

// Builds the coverage map off the main thread (a few hundred ms of noise).
self.onmessage = (e: MessageEvent<{ seed: number; id: number }>) => {
  const map = generateCoverageMap(e.data.seed);
  const transfer = [map.data.buffer, ...map.quantiles.map((q) => q.buffer)];
  (self as unknown as Worker).postMessage({ id: e.data.id, map }, transfer);
};
