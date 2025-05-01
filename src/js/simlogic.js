class GlobalWindVars {
  /**
   *
   * @param {ThreeJS.Vector3(x,x,x)} upperWinds
   * @param {ThreeJS.Vector3(x,x,x)} lowerWinds
   */
  constructor(upperWinds, lowerWinds) {
    this.upperWind = upperWinds;
    this.lowerWind = lowerWinds;
  }
}

class Plane {
  constructor(
    position,
    speedKnots = 90,
    direction = new THREE.Vector3(1, 0, 0),
    jumpersLeft = 10
  ) {
    this.position = position.clone();
    this.direction = direction.normalize();
    this.speed = speedKnots * 0.51444; // knots to m/s
    this.vector = this.direction.clone().multiplyScalar(this.speed);
    this.jumpersLeft = jumpersLeft;
    this.lastJumpTime = 0;
    this.timeBetweenJumpers = this.calculateJumpInterval();
  }

  calculateJumpInterval(upperWindSpeed = 60) {
    // Spacing for clean air; assume e.g., 2 seconds per 10 knots
    return (60 / upperWindSpeed) * 2.0;
  }

  update(deltaTime) {
    this.position.add(this.vector.clone().multiplyScalar(deltaTime));
  }

  canDropJumper(currentTime) {
    return (
      this.jumpersLeft > 0 &&
      currentTime - this.lastJumpTime > this.timeBetweenJumpers
    );
  }

  dropJumper(currentTime) {
    if (this.canDropJumper(currentTime)) {
      this.jumpersLeft--;
      this.lastJumpTime = currentTime;
      return new Jumper(this.position.clone());
    }
    return null;
  }
}

class Jumper {
  constructor(position, canopySize = 190) {
    this.position = position.clone();
    this.velocity = new THREE.Vector3(0, -55, 0); // approximate freefall velocity
    this.canopySize = canopySize;
    this.hasDeployedCanopy = false;
  }

  update(deltaTime, windVars, altitude) {
    if (!this.hasDeployedCanopy && this.position.y <= altitude) {
      this.hasDeployedCanopy = true;
      // Adjust for canopy descent speed
      this.velocity.set(0, -5, 0); // canopy descent
    }

    const wind = this.hasDeployedCanopy
      ? windVars.lowerWind
      : windVars.upperWind;
    this.velocity.add(wind.clone().multiplyScalar(deltaTime));
    this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
  }
  startTrack() {}
}
