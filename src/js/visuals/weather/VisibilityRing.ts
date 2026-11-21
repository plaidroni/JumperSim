import * as THREE from "three";
import { worldRoot } from "../../core/WorldScale";
import { getGroundHeight } from "../../terrain/GroundHeight";
import { M_PER_STATUTE_MILE } from "../../weather/WeatherState";
import { makeTextSprite } from "../../wind/WindTower";
import { LAYER_OVERLAY } from "../Layers";

/**
 * Visibility ring (specs/weather-clouds-visibility.md §5.6, optional, default off):
 * a ground circle with the reported visibility as its radius, labelled
 * "Visibility 6.2 sm". In 3D it is centred on what the camera looks at; in the
 * planner on the primary landing-area target.
 */
export class VisibilityRing {
  readonly object = new THREE.Group();
  private ring: THREE.LineLoop;
  private label: THREE.Sprite | null = null;
  private labelText = "";

  constructor() {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)));
    }
    this.ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.85, depthTest: false }),
    );
    this.ring.renderOrder = 6;
    this.ring.layers.set(LAYER_OVERLAY);
    this.object.add(this.ring);
    this.object.name = "Visibility ring";
    this.object.layers.set(LAYER_OVERLAY);
    this.object.visible = false;
    worldRoot.add(this.object);
  }

  update(show: boolean, visibilityM: number, centerM: THREE.Vector3 | null) {
    const on = show && !!centerM && Number.isFinite(visibilityM) && visibilityM > 0;
    this.object.visible = on;
    if (!on) return;
    const y = getGroundHeight(centerM!.x, centerM!.z);
    this.object.position.set(centerM!.x, (Math.abs(y) < 9000 ? y : 0) + 2, centerM!.z);
    this.ring.scale.setScalar(visibilityM);

    const smi = visibilityM / M_PER_STATUTE_MILE;
    const text = `Visibility ${smi < 10 ? smi.toFixed(1) : Math.round(smi)} sm`;
    if (text !== this.labelText) {
      this.labelText = text;
      if (this.label) {
        this.object.remove(this.label);
        this.label.material.map?.dispose();
        this.label.material.dispose();
      }
      this.label = makeTextSprite(text, "#9fd0ff");
      this.label.layers.set(LAYER_OVERLAY);
      this.label.center.set(0.5, -0.3);
      this.object.add(this.label);
    }
    this.label!.position.set(0, 0, -visibilityM); // on the ring's north side
  }
}
