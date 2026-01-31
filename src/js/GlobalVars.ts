import * as THREE from "three";

(<any>(<any>window)).simScale = 1; // real-world scale

// To Cole: use (<any>window).weatherSnapshotLog[0]
// to get the current weather data

function calculatePositions(lengthOfSimulation: number) {
  const kstepone = 0;
  const ksteptwo = 0;
  const kstepthree = 0;
  // return array of jumpers' position vectors across time
  /**
   * Array of Jumper's Positions <x,y,z,t>
   */
  return Array<Array<THREE.Vector4>>;
}

export class GlobalWindVars {
  twelveWinds: THREE.Vector3;
  nineWinds: THREE.Vector3;
  sixWinds: THREE.Vector3;
  threeWinds: THREE.Vector3;
  /**
   *
   * @param {ThreeJS.Vector3(x,x,x)} upperWinds
   * @param {ThreeJS.Vector3(x,x,x)} lowerWinds
   */
  constructor(twelveWinds, nineWinds, sixWinds, threeWinds) {
    this.twelveWinds = twelveWinds;
    this.nineWinds = nineWinds;
    this.sixWinds = sixWinds;
    this.threeWinds = threeWinds;
  }
}
