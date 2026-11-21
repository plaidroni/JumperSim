import * as THREE from "three";
import { worldRoot } from "../../core/WorldScale";
import { LAYER_OVERLAY } from "../Layers";
import { COVERAGE_GLSL } from "./cloudShaders";
import { CloudVolume, MAX_LAYERS } from "./CloudVolume";

/**
 * Optional "Clouds" layer for the planner's top-down view
 * (specs/weather-clouds-visibility.md §5.7): each cloud layer's coverage as a
 * translucent white raster at its base, drifting on the sim clock exactly like the
 * 3D clouds (same coverage function and offsets). Layers that set the ceiling are
 * more opaque. Off by default; the planner otherwise shows a clear map.
 */

const SIZE_M = 30000;

const VERT = /* glsl */ `
uniform vec2 uOffsetM;          // the sheet's x/z position (m)
varying vec2 vXZ;               // world x/z (m) for the coverage lookup
void main() {
  vXZ = position.xz + uOffsetM;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
${COVERAGE_GLSL}
uniform int uIndex;
uniform float uOpacity;
varying vec2 vXZ;
void main() {
  float c = coverageAt(uIndex, vXZ);
  if (c < 0.02) discard;
  gl_FragColor = vec4(vec3(0.93, 0.95, 0.98), c * uOpacity);
}`;

const OPACITY = { fog: 0.35, low: 0.4, mid: 0.3, high: 0.18 } as const;

export class PlannerClouds {
  private meshes: THREE.Mesh[] = [];

  constructor(clouds: CloudVolume) {
    const geo = new THREE.PlaneGeometry(SIZE_M, SIZE_M, 1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_LAYERS; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        defines: { MAX_LAYERS },
        uniforms: {
          uCoverage: { value: null },
          uLayerA: { value: clouds.a },
          uLayerB: { value: clouds.b },
          uLayerC: { value: clouds.c },
          uLayerD: { value: clouds.d },
          uLayerCount: { value: 0 },
          uIndex: { value: i },
          uOpacity: { value: 0.3 },
          uOffsetM: { value: new THREE.Vector2() },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `Planner clouds ${i}`;
      mesh.renderOrder = 30; // above the ground overlays, below the planner's handles
      mesh.frustumCulled = false;
      mesh.layers.set(LAYER_OVERLAY);
      mesh.visible = false;
      worldRoot.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** Show while the planner is open with the setting on; follow the planner's view. */
  update(clouds: CloudVolume, show: boolean, centerM: THREE.Vector3 | null) {
    this.meshes.forEach((m, i) => {
      const on = show && clouds.active && i < clouds.count && !!clouds.coverage;
      m.visible = on;
      if (!on) return;
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uCoverage.value = clouds.coverage!.texture;
      u.uLayerCount.value = clouds.count;
      const band = clouds.bands[i];
      const ceiling = (band === "low" || band === "fog") && clouds.covers[i] >= 0.625; // ≥ 5 oktas
      u.uOpacity.value = ceiling ? 0.55 : OPACITY[band];
      // keep the 30 km sheet centred under the view
      const cx = centerM ? Math.round(centerM.x / 1000) * 1000 : 0;
      const cz = centerM ? Math.round(centerM.z / 1000) * 1000 : 0;
      m.position.set(cx, clouds.a[i].x, cz);
      u.uOffsetM.value.set(cx, cz);
    });
  }
}
