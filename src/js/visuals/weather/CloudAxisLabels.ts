import * as THREE from "three";
import { CLOUD_TYPE_LABEL, coverLabel } from "../../weather/CloudLayers";
import { weatherDisplay } from "../../weather/WeatherDisplay";
import { weatherService } from "../../weather/WeatherService";
import { M_TO_FT } from "../../weather/WeatherState";
import { makeTextSprite } from "../../wind/WindTower";

/**
 * Cloud layers on the height axis (specs/weather-clouds-visibility.md §5.2): a bar
 * beside the tower from each drawn layer's base to its top, labelled at the base,
 * e.g. "BKN Cu 4,200 ft". Lives on the height axis, so it is an overlay (readable
 * above the clouds) and follows the layer toggles.
 */
export class CloudAxisLabels {
  readonly object = new THREE.Group();
  private disposables: Array<{ dispose(): void }> = [];
  private x: number;
  private onWeather = () => this.rebuild();
  private offDisplay: () => void;

  constructor(towerX: number) {
    this.x = towerX;
    this.object.name = "CloudAxisLabels";
    window.addEventListener("weather-updated", this.onWeather);
    this.offDisplay = weatherDisplay.onChange(() => this.rebuild());
    this.rebuild();
  }

  dispose() {
    window.removeEventListener("weather-updated", this.onWeather);
    this.offDisplay();
    this.clear();
  }

  rebuild() {
    this.clear();
    const st = weatherService.get();
    const d = weatherDisplay.get();
    if (!st || !d.clouds) return;
    for (const l of st.clouds.layers) {
      if (!d.layers[l.band]) continue;
      const mat = new THREE.LineBasicMaterial({ color: 0xcfd6dd, transparent: true, opacity: 0.7, depthTest: false });
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(this.x - 90, l.baseAglM, 0),
        new THREE.Vector3(this.x - 90, l.topAglM, 0),
      ]);
      const bar = new THREE.Line(geo, mat);
      bar.renderOrder = 3;
      this.disposables.push(mat, geo);
      this.object.add(bar);

      const ft = (Math.round((l.baseAglM * M_TO_FT) / 100) * 100).toLocaleString();
      const sprite = makeTextSprite(`${coverLabel(l.coverPct)} ${CLOUD_TYPE_LABEL[l.type].abbr} ${ft} ft`, "#cfd6dd");
      sprite.position.set(this.x - 90, l.baseAglM, 0);
      sprite.center.set(1.06, 0.5); // to the left of the bar
      this.disposables.push(sprite.material, sprite.material.map!);
      this.object.add(sprite);
    }
  }

  private clear() {
    for (const c of [...this.object.children]) this.object.remove(c);
    this.disposables.forEach((x) => x.dispose());
    this.disposables = [];
  }
}
