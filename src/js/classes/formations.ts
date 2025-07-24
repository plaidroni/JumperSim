import { createDefaultSimJumpers, SimJumper, SimPlane } from "./simEntities";

/**refer to .jump files for metrics */
export type FormationSlot = {
  stance: string;
  info: any;
  angleDeg: number;
  /* X,Y in meters */
  origin: [number, number];
};

export type FormationPoint = {
  inter: boolean;
  slots: FormationSlot[];
};

export type FormationJumper = {
  selected: boolean;
  planeSlot: any;
  person: any;
  color: string;
};

export type FormationPage = {
  point: number;
  singleLineLabel: boolean;
  title: string;
  slotColours: string;
  labels: number;
};

export type FormationExportInfo = {
  title: string;
  showSlotting: boolean;
  pages: FormationPage[];
};

/**directly pulled from .jump file in skydive designer */
export type FormationData = {
  title: string;
  docVersion: number;
  whiteBackpacks: boolean;
  people: any[];
  points: FormationPoint[];
  tunnelFt: number;
  jumpers: FormationJumper[];
  planes: any[];
  exportInfo: FormationExportInfo;
};

export class Formation {
  public jumpers: SimJumper[] = [];
  public points: FormationPoint[] = [];
  public currentPointIndex: number = 0;
  public pointInterval: number = 1; // seconds between points
  public startTime: number = 0; // when formation flying begins
  public endTime: number = 60; // when formation flying ends
  public title: string = "";
  public isActive: boolean = false;

  constructor(data: FormationData) {
    this.jumpers = createDefaultSimJumpers(data.jumpers.length, data.planes[0]);
    this.points = data.points;
    this.title = data.title;
  }

  private createJumpersFromData(
    formationData: FormationData,
    plane: SimPlane
  ): void {
    const jumperConfigs = formationData.jumpers;
    const firstPoint = this.points[0];

    if (!firstPoint || !firstPoint.slots) {
      console.warn("No valid formation points found, cannot create formation!");
      return;
    }

    for (let i = 0; i < jumperConfigs.length; i++) {
      const jumperConfig = jumperConfigs[i];
      const slot = firstPoint.slots[i];

      if (!slot) continue;

      const jumper = new SimJumper(i, plane, 0, 7, 190);

      jumper.mesh.material.color.set(jumperConfig.color);
      //calculate the offset based on slot position and position in formation
      jumper.formationOffset = this.calculateSlotOffset(slot, firstPoint.slots);
      jumper.isInFormation = true;

      this.jumpers.push(jumper);
    }
  }

  // We love claude for handling JSON stuff <3
  private calculateSlotOffset(slot: any, allSlots: any[]): THREE.Vector3 {
    const center2D = allSlots.reduce(
      (acc, s) => {
        acc.x += s.origin[0];
        acc.y += s.origin[1];
        return acc;
      },
      { x: 0, y: 0 }
    );
    center2D.x /= allSlots.length;
    center2D.y /= allSlots.length;

    const offsetX = (slot.origin[0] - center2D.x) * this.SCALE_FACTOR;
    const offsetZ = (slot.origin[1] - center2D.y) * this.SCALE_FACTOR;

    // create 3D offset and apply quaterniononon rotation
    const offset = new THREE.Vector3(offsetX, 0, offsetZ);
    const angleRad = THREE.MathUtils.degToRad(slot.angleDeg);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleRad);

    return offset;
  }

  private calculateFormationTiming(): void {
    if (this.points.length > 1) {
      // estimate time needed based on number of points
      this.pointInterval = Math.max(5, 60 / this.points.length); // At least 5 seconds per point
      this.endTime = this.startTime + this.points.length * this.pointInterval;
    }
  }

  /**
   * updates formation to a specific point in the sequence
   */
  public transitionToPoint(
    pointIndex: number,
    transitionTime: number = 0
  ): void {
    if (pointIndex < 0 || pointIndex >= this.points.length) {
      console.warn(`Invalid point index: ${pointIndex}`);
      return;
    }

    const targetPoint = this.points[pointIndex];
    this.currentPointIndex = pointIndex;

    // update each jumper's formation offset for the new point
    targetPoint.slots.forEach((slot, jumperIndex) => {
      const jumper = this.jumpers[jumperIndex];
      if (jumper) {
        const newOffset = this.calculateSlotOffset(slot, targetPoint.slots);

        if (transitionTime > 0) {
          // Smooth transition to new position (could be enhanced with animation)
          jumper.formationOffset.lerp(newOffset, 0.1);
        } else {
          jumper.formationOffset.copy(newOffset);
        }
      }
    });
  }

  /**
   * updates formation based on simulation time
   */
  public update(simulationTime: number): void {
    if (
      !this.isActive ||
      simulationTime < this.startTime ||
      simulationTime > this.endTime
    ) {
      return;
    }

    // calculate which point we should be at based on time
    const timeInFormation = simulationTime - this.startTime;
    const targetPointIndex = Math.floor(timeInFormation / this.pointInterval);

    if (
      targetPointIndex !== this.currentPointIndex &&
      targetPointIndex < this.points.length
    ) {
      this.transitionToPoint(targetPointIndex, this.pointInterval * 0.1);
    }
  }

  /**
   * starts the formation sequence
   */
  public startFormation(startTime: number = 0): void {
    this.startTime = startTime;
    this.isActive = true;
    this.currentPointIndex = 0;

    // initialize all jumpers to first point
    if (this.points.length > 0) {
      this.transitionToPoint(0);
    }
  }

  public stopFormation(): void {
    this.isActive = false;

    // reset all jumpers' formation status
    this.jumpers.forEach((jumper) => {
      jumper.isInFormation = false;
      jumper.formationOffset.set(0, 0, 0);
    });
  }

  /**
   * precalculates all jumper trajectories
   */
  public precalculateFormation(duration: number, step: number = 0.01): void {
    console.log(`Precalculating formation: ${this.title}`);

    this.jumpers.forEach((jumper, index) => {
      console.log(`Precalculating jumper ${index + 1}/${this.jumpers.length}`);
      jumper.precalculate(duration, step);
    });
  }

  // retrieves the current formation point
  public getCurrentPoint(): FormationPoint | null {
    return this.points[this.currentPointIndex] || null;
  }

  /**
   * gets formation progress as percentage
   */
  public getProgress(simulationTime: number): number {
    if (!this.isActive || simulationTime < this.startTime) return 0;
    if (simulationTime > this.endTime) return 1;

    return (simulationTime - this.startTime) / (this.endTime - this.startTime);
  }

  /**
   * gets jumper by index
   */
  public getJumper(index: number): SimJumper | null {
    return this.jumpers[index] || null;
  }

  /**
   * gets all jumpers in formation
   */
  public getAllJumpers(): SimJumper[] {
    return [...this.jumpers];
  }
}
