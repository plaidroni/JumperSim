window.simScale = 0.1; // 10x smaller units

export class GlobalWindVars {
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
