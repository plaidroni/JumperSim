import * as THREE from "three";
import { SimPlane, SimJumper } from "./simEntities";
import {
  createDynamicTrajectoryLine,
  updateTrajectoryLines,
} from "../ui/TrajectoryLines";

/**
 * Perris separation table based on ground speed (kts)
 * Returns the required separation time in seconds
 * Capped at 15 seconds maximum for the game
 */
const SEPARATION_TABLE = [
  { speed: 100, separation: 6 },
  { speed: 95, separation: 7 },
  { speed: 90, separation: 7 },
  { speed: 85, separation: 7 },
  { speed: 80, separation: 8 },
  { speed: 75, separation: 8 },
  { speed: 70, separation: 9 },
  { speed: 65, separation: 10 },
  { speed: 60, separation: 10 },
  { speed: 55, separation: 11 },
  { speed: 50, separation: 12 },
  { speed: 45, separation: 14 },
  { speed: 40, separation: 15 },
];

const KNOTS_TO_MS = 0.51444;

/**
 * Get required separation based on ground speed
 */
function normalizeGroundSpeed(groundSpeedKnots: number): number {
  if (groundSpeedKnots >= 100) return 100;
  if (groundSpeedKnots <= 5) return 5;
  return Math.floor(groundSpeedKnots / 5) * 5;
}

/**
 * Get required separation based on ground speed
 */
function getRequiredSeparation(groundSpeedKnots: number): number {
  const normalized = normalizeGroundSpeed(groundSpeedKnots);
  const entry = SEPARATION_TABLE.find((row) => row.speed === normalized);
  return entry ? entry.separation : 119;
}

/**
 * Highlight the appropriate row in the separation table
 */
function highlightTableRow(groundSpeedKnots: number): void {
  const tableBody = document.getElementById("separation-table-body");
  if (!tableBody) return;
  const normalized = normalizeGroundSpeed(groundSpeedKnots);
  const rows = tableBody.querySelectorAll("tr");
  rows.forEach((row, index) => {
    row.classList.remove("highlight", "active-separation");
    const entry = SEPARATION_TABLE[index];
    if (entry && entry.speed === normalized) {
      row.classList.add("highlight", "active-separation");
    }
  });
}

export enum GameState {
  NOT_STARTED = "not_started",
  WATCHING_FIRST_JUMPER = "watching_first_jumper",
  COUNTING = "counting",
  PLAYER_JUMPED = "player_jumped",
  SHOWING_RESULTS = "showing_results",
  ROUND_COMPLETE = "round_complete",
  GAME_COMPLETE = "game_complete",
}

export class SeparationGame {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private plane: SimPlane;

  private state: GameState = GameState.NOT_STARTED;
  private currentRound: number = 0;
  private wins: number = 0;
  private losses: number = 0;

  // Round-specific data
  private groundSpeed: number = 0;
  private requiredSeparation: number = 0;
  private firstJumperExitTime: number = 0;
  private playerJumpTime: number = 0;
  private roundStartTime: number = 0;
  private airSpeedKnots: number = 0;
  private headwindKnots: number = 0;

  // Jumpers for the round
  private firstJumper: SimJumper | null = null;
  private playerJumper: SimJumper | null = null;
  private trajectoryLines: THREE.Line[] = [];

  // Camera tracking
  private originalCameraPosition: THREE.Vector3 = new THREE.Vector3();
  private originalCameraTarget: THREE.Vector3 = new THREE.Vector3();
  private cameraFollowTarget: THREE.Object3D | null = null;

  // Animation
  private animationId: number | null = null;
  private gameTime: number = 0;
  private streak: number = 0;
  private streakWinPending: boolean = false;
  private isTimerRunning: boolean = false;

  // Game container references
  private gameContainer: HTMLElement;
  private game3DView: HTMLElement;

  // Bonus game flag
  private isBonusRound: boolean = false;

  // Camera mode
  private cameraMode: "door" | "side" = "side";

  // Fixed spectator camera anchors (world space)
  private spectatorDoorPos: THREE.Vector3 = new THREE.Vector3();
  private spectatorWidePos: THREE.Vector3 = new THREE.Vector3();
  private spectatorLookAt: THREE.Vector3 = new THREE.Vector3();

  // Camera offset from plane (stays relative to plane, looks at jumper)
  private cameraOffsetFromPlane: THREE.Vector3 = new THREE.Vector3(40, 15, 40);

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.gameContainer.classList.contains("active")) return;

    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      this.handlePrimaryAction();
    }

    if (event.code === "KeyV") {
      event.preventDefault();
      this.toggleCameraMode();
    }
  };

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    plane: SimPlane,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.plane = plane;

    this.gameContainer = document.getElementById("separation-game-container")!;
    this.game3DView = document.getElementById("game-3d-view")!;

    this.setupEventListeners();
    document.addEventListener("keydown", this.onKeyDown);
  }

  /**
   * Setup all event listeners for the game UI
   */
  private setupEventListeners(): void {
    // Jump button (primary action)
    const jumpButton = document.getElementById("jump-now-button");
    jumpButton?.addEventListener("click", () => this.handlePrimaryAction());

    // Next round button
    const nextRoundButton = document.getElementById("next-round-button");
    nextRoundButton?.addEventListener("click", () =>
      this.handlePrimaryAction(),
    );

    // View separation button
    const viewSeparationButton = document.getElementById("view-replay-button");
    viewSeparationButton?.addEventListener("click", () =>
      this.viewSeparation(),
    );
  }

  /**
   * Primary action handler (single-button control)
   */
  private handlePrimaryAction(): void {
    if (this.state === GameState.COUNTING) {
      this.handlePlayerJump();
      return;
    }

    if (this.state === GameState.SHOWING_RESULTS) {
      this.startNextRound();
      return;
    }
  }

  private restartGame(): void {
    this.exitGame();
    this.startGame();
  }

  private getPlaneAirspeedKnots(): number {
    const scale = (window as any).simScale || 1;
    return this.plane.speed / (KNOTS_TO_MS * scale);
  }

  private setCameraMode(mode: "door" | "side"): void {
    this.cameraMode = mode;
  }

  private toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === "door" ? "side" : "door";
    const statusElement = document.getElementById("game-view-status");
    if (statusElement) {
      const viewLabel =
        this.cameraMode === "door" ? "Door View" : "Wide Aligned View";
      if (this.state === GameState.WATCHING_FIRST_JUMPER) {
        statusElement.textContent = `Watch for the first jumper to exit... (${viewLabel})`;
      }
    }
  }

  private getActiveCamera(): THREE.Camera {
    return this.camera;
  }

  private getPlaneBasis(planeSample: any): {
    forward: THREE.Vector3;
    right: THREE.Vector3;
    up: THREE.Vector3;
  } {
    const up = new THREE.Vector3(0, 1, 0);
    const forward = planeSample?.velocity
      ? planeSample.velocity.clone().normalize()
      : this.plane.direction.clone().normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    return { forward, right, up };
  }

  /**
   * Start the separation game
   */
  public startGame(): void {
    console.log("Starting Separation Timing Challenge");

    // Reset game state
    this.currentRound = 0;
    this.wins = 0;
    this.losses = 0;
    this.isBonusRound = false;
    this.cameraMode = "door";
    this.streak = 0;

    const bonusIndicator = document.getElementById("bonus-indicator");
    if (bonusIndicator) bonusIndicator.style.display = "none";

    // Show game container
    this.gameContainer.classList.add("active");
    document.body.classList.add("separation-game-active");

    // Save original camera state
    this.originalCameraPosition.copy(this.camera.position);

    // Move renderer to game view and adjust size
    this.game3DView.appendChild(this.renderer.domElement);
    this.resizeRendererForGameView();

    // Update UI
    this.updateScoreDisplay();
    this.updatePrimaryButton("WAIT", true);

    // Start first round
    this.startNextRound();
  }

  /**
   * Resize renderer to fit the game view container
   */
  private resizeRendererForGameView(): void {
    const rect = this.game3DView.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Exit the game and return to normal simulator
   */
  public exitGame(): void {
    console.log("Exiting Separation Game");

    // Stop animation
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    // Clean up jumpers
    this.cleanupRoundJumpers();

    // Hide game container
    this.gameContainer.classList.remove("active");
    document.body.classList.remove("separation-game-active");

    // Restore renderer to main view
    document.body.appendChild(this.renderer.domElement);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();

    // Restore camera
    this.camera.position.copy(this.originalCameraPosition);
    this.cameraFollowTarget = null;

    // Reset state
    this.state = GameState.NOT_STARTED;
    const bonusIndicator = document.getElementById("bonus-indicator");
    if (bonusIndicator) bonusIndicator.style.display = "none";
    this.updatePrimaryButton("JUMP!", true);
  }

  /**
   * Start the next round
   */
  private startNextRound(): void {
    this.currentRound++;
    this.state = GameState.NOT_STARTED;
    this.isBonusRound = false;
    if (this.streakWinPending) {
      this.streak = 0;
      this.streakWinPending = false;
    }

    const bonusIndicator = document.getElementById("bonus-indicator");
    if (bonusIndicator) bonusIndicator.style.display = "none";

    // Choose a ground speed from the Perris table based on airspeed
    this.airSpeedKnots = this.getPlaneAirspeedKnots();
    const eligible = SEPARATION_TABLE.filter(
      (row) => row.speed <= Math.max(5, Math.floor(this.airSpeedKnots)),
    );
    const choice = eligible.length
      ? eligible[Math.floor(Math.random() * eligible.length)]
      : SEPARATION_TABLE[SEPARATION_TABLE.length - 1];

    this.groundSpeed = choice.speed;
    this.requiredSeparation = choice.separation;
    this.headwindKnots = Math.max(
      0,
      Math.round(this.airSpeedKnots - this.groundSpeed),
    );

    // Alternate camera view each round for variety
    this.cameraMode = this.currentRound % 2 === 1 ? "door" : "side";

    console.log(
      `Round ${this.currentRound}: Speed=${this.groundSpeed}kts, Required=${this.requiredSeparation}sec`,
    );

    // Update UI
    this.updateRoundDisplay();
    highlightTableRow(this.groundSpeed);

    const airspeedElement = document.getElementById("current-airspeed");
    const headwindElement = document.getElementById("current-headwind");
    const speedElement = document.getElementById("current-speed");
    const separationElement = document.getElementById("required-separation");
    if (airspeedElement)
      airspeedElement.textContent = `${this.airSpeedKnots.toFixed(0)} kts`;
    if (headwindElement)
      headwindElement.textContent = `${this.headwindKnots.toFixed(0)} kts`;
    if (speedElement) speedElement.textContent = `${this.groundSpeed} kts`;
    if (separationElement)
      separationElement.textContent = `${this.requiredSeparation} sec`;

    // Hide results overlay
    const resultsOverlay = document.getElementById("results-overlay");
    resultsOverlay?.classList.remove("show");

    // Create jumpers for this round
    this.setupRoundJumpers();

    // Start the round animation
    this.beginRound();
  }

  /**
   * Setup jumpers for the current round
   */
  private setupRoundJumpers(): void {
    // Remove previous round's jumpers from scene
    this.cleanupRoundJumpers();

    // Create two jumpers: first jumper and player
    const deployDelay = 999; // keep in freefall for the game
    const canopySize = 190;
    this.firstJumper = new SimJumper(0, this.plane, 0, deployDelay, canopySize);
    this.playerJumper = new SimJumper(
      1,
      this.plane,
      this.requiredSeparation,
      deployDelay,
      canopySize,
    );

    // Precalculate their trajectories
    this.firstJumper.precalculate(120);
    this.playerJumper.precalculate(120);

    // Add meshes to scene (reuse existing jumper mesh from main sim if available)
    const existingJumpers = (window as any).simJumpers || [];
    const meshTemplate =
      existingJumpers.length > 0 ? existingJumpers[0].getMesh() : null;

    const mesh1 = meshTemplate ? meshTemplate.clone() : this.createJumperMesh();
    const mesh2 = meshTemplate ? meshTemplate.clone() : this.createJumperMesh();

    this.tintMesh(mesh1, 0xff3333, 0x330000); // Bright red for first jumper
    this.tintMesh(mesh2, 0x3333ff, 0x000033); // Bright blue for player

    this.firstJumper.setMesh(mesh1);
    this.playerJumper.setMesh(mesh2);
    this.scene.add(mesh1);
    this.scene.add(mesh2);

    // Trajectory lines for visual separation
    this.clearTrajectoryLines();
    this.trajectoryLines = [
      createDynamicTrajectoryLine(this.firstJumper),
      createDynamicTrajectoryLine(this.playerJumper),
    ];
    this.trajectoryLines.forEach((line) => {
      line.visible = false;
      this.scene.add(line);
    });
  }

  private clearTrajectoryLines(): void {
    this.trajectoryLines.forEach((line) => this.scene.remove(line));
    this.trajectoryLines = [];
  }

  private createJumperMesh(): THREE.Object3D {
    const geometry = new THREE.CapsuleGeometry(0.25, 0.6, 4, 8);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.6,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }

  private tintMesh(
    object: THREE.Object3D,
    colorHex: number,
    emissiveHex: number,
  ): void {
    object.traverse((child: any) => {
      if (!child.isMesh) return;
      const material = child.material?.clone?.() || child.material;
      if (material?.color) material.color.setHex(colorHex);
      if (material?.emissive) material.emissive.setHex(emissiveHex);
      child.material = material;
    });
  }

  /**
   * Clean up jumpers from previous round
   */
  private cleanupRoundJumpers(): void {
    this.clearTrajectoryLines();
    if (this.firstJumper && this.firstJumper.getMesh()) {
      this.scene.remove(this.firstJumper.getMesh());
    }
    if (this.playerJumper && this.playerJumper.getMesh()) {
      this.scene.remove(this.playerJumper.getMesh());
    }
    this.firstJumper = null;
    this.playerJumper = null;
  }

  /**
   * Begin the round - show first jumper exiting
   */
  private beginRound(): void {
    this.state = GameState.WATCHING_FIRST_JUMPER;
    this.roundStartTime = performance.now();
    this.gameTime = 0;
    this.isTimerRunning = false;

    const planeSample = this.plane.track.getInterpolatedSample(0);
    const planePos =
      planeSample?.position.clone() || this.plane.position.clone();
    const { forward, right, up } = this.getPlaneBasis(planeSample);
    this.spectatorDoorPos = planePos
      .clone()
      .add(right.clone().multiplyScalar(65))
      .add(up.clone().multiplyScalar(-3.8))
      .add(forward.clone().multiplyScalar(-12));
    this.spectatorWidePos = planePos
      .clone()
      .add(right.clone().multiplyScalar(60))
      .add(up.clone().multiplyScalar(18))
      .add(forward.clone().multiplyScalar(-90));
    this.spectatorLookAt = planePos
      .clone()
      .add(forward.clone().multiplyScalar(30));

    // Reset timer display
    const timerElement = document.getElementById("game-timer");
    if (timerElement) {
      timerElement.textContent = "0.00";
      timerElement.classList.remove("counting");
    }

    // Update status
    const statusElement = document.getElementById("game-view-status");
    if (statusElement) {
      const viewLabel =
        this.cameraMode === "door" ? "Door View" : "Wide Aligned View";
      statusElement.textContent = `Watch for the first jumper to exit... (${viewLabel})`;
      statusElement.style.color = "#4CAF50";
    }

    // Disable primary button while waiting
    this.updatePrimaryButton("WAIT", true);

    // Position camera to view the plane
    this.positionCameraForPlaneView();

    // Start animation loop
    this.startAnimationLoop();
  }

  /**
   * Position camera to view the plane from the side
   * Camera stays near the plane door, looking out at jumpers
   */
  private positionCameraForPlaneView(): void {
    const pos =
      this.cameraMode === "door"
        ? this.spectatorDoorPos
        : this.spectatorWidePos;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.spectatorLookAt);
  }

  /**
   * Main animation loop for the game
   */
  private startAnimationLoop(): void {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      const now = performance.now();
      const deltaTime = (now - this.roundStartTime) / 1000;
      this.gameTime = deltaTime;

      // Update plane position
      this.updatePlanePosition();

      // Update jumper positions based on game time
      this.updateJumperPositions();

      if (this.trajectoryLines.length) {
        updateTrajectoryLines(this.trajectoryLines, this.gameTime);
      }

      // Update camera if following a target
      this.updateCamera();

      // Check for state transitions
      this.checkStateTransitions();

      // Update timer display if running
      if (this.isTimerRunning) {
        this.updateTimerDisplay();
      }

      // Render
      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  /**
   * Update plane position during the game
   */
  private updatePlanePosition(): void {
    const planeSample = this.plane.track.getInterpolatedSample(this.gameTime);
    const planeMesh = this.plane.getMesh();
    if (planeSample && planeMesh) {
      planeMesh.position.copy(planeSample.position);
      planeMesh.quaternion.copy(planeSample.angle);
    }
  }

  /**
   * Update jumper positions based on current game time
   */
  private updateJumperPositions(): void {
    if (!this.firstJumper || !this.playerJumper) return;

    // Update first jumper (always visible after exit)
    if (this.state !== GameState.WATCHING_FIRST_JUMPER) {
      const sample1 = this.firstJumper.track.getInterpolatedSample(
        this.gameTime,
      );
      const mesh1 = this.firstJumper.getMesh();
      if (sample1 && mesh1) {
        mesh1.position.copy(sample1.position);
        mesh1.quaternion.copy(sample1.angle);
        mesh1.visible = true;
      }
    } else {
      // Hide first jumper before exit
      const mesh1 = this.firstJumper.getMesh();
      if (mesh1) mesh1.visible = false;
    }

    // Update player jumper (only visible after they've jumped)
    if (
      this.state === GameState.PLAYER_JUMPED ||
      this.state === GameState.SHOWING_RESULTS
    ) {
      const sample2 = this.playerJumper.track.getInterpolatedSample(
        this.gameTime,
      );
      const mesh2 = this.playerJumper.getMesh();
      if (sample2 && mesh2) {
        mesh2.position.copy(sample2.position);
        mesh2.quaternion.copy(sample2.angle);
        mesh2.visible = true;
      }
    } else {
      // Hide player jumper until they jump
      const mesh2 = this.playerJumper.getMesh();
      if (mesh2) mesh2.visible = false;
    }
  }

  /**
   * Update camera position - stays on plane looking at jumpers
   */
  private updateCamera(): void {
    const planeSample = this.plane.track.getInterpolatedSample(this.gameTime);
    const planePos =
      planeSample?.position.clone() || this.plane.position.clone();
    const { forward, right, up } = this.getPlaneBasis(planeSample);

    const followOffset = right
      .clone()
      .multiplyScalar(13)
      .add(up.clone().multiplyScalar(-6.2))
      .add(forward.clone().multiplyScalar(-14));

    let targetPos =
      this.cameraMode === "door"
        ? planePos.clone().add(followOffset)
        : this.spectatorWidePos.clone();
    let targetLookAt =
      this.cameraMode === "door"
        ? planePos.clone().add(forward.clone().multiplyScalar(25))
        : this.spectatorLookAt.clone();

    if (
      this.state === GameState.COUNTING ||
      this.state === GameState.PLAYER_JUMPED
    ) {
      if (this.firstJumper && this.firstJumper.getMesh()) {
        targetLookAt = this.firstJumper.getMesh().position.clone();
      }
    }

    if (this.state === GameState.SHOWING_RESULTS) {
      if (this.firstJumper && this.playerJumper) {
        const pos1 =
          this.firstJumper.getMesh()?.position || new THREE.Vector3();
        const pos2 =
          this.playerJumper.getMesh()?.position || new THREE.Vector3();

        const center = new THREE.Vector3()
          .addVectors(pos1, pos2)
          .multiplyScalar(0.5);
        const distance = pos1.distanceTo(pos2);

        const spread = Math.max(12, distance);
        const basePos =
          this.cameraMode === "door"
            ? planePos.clone().add(followOffset)
            : this.spectatorWidePos;
        targetPos = basePos.clone().add(new THREE.Vector3(0, spread * 0.15, 0));
        targetLookAt = center.clone();
      }
    }

    this.camera.position.lerp(targetPos, 0.12);
    this.camera.lookAt(targetLookAt);
  }

  /**
   * Check for state transitions during the round
   */
  private checkStateTransitions(): void {
    // Check if first jumper has exited the plane
    if (
      this.state === GameState.WATCHING_FIRST_JUMPER &&
      this.gameTime >= this.firstJumper!.jumpTime
    ) {
      this.onFirstJumperExit();
    }

    // Check if we should show results (when player has fallen for a few seconds)
    if (
      this.state === GameState.PLAYER_JUMPED &&
      this.gameTime >= this.playerJumpTime + 5
    ) {
      this.showResults();
    }
  }

  /**
   * Called when the first jumper exits the plane
   */
  private onFirstJumperExit(): void {
    console.log("First jumper has exited!");
    this.state = GameState.COUNTING;
    this.firstJumperExitTime = this.gameTime;
    this.isTimerRunning = true;

    // Camera will now look at jumper from plane (handled in updateCamera)
    // No longer following the jumper - camera stays on plane
    this.cameraFollowTarget = null;

    // Enable primary button
    this.updatePrimaryButton("JUMP!", false);

    // Update status
    const statusElement = document.getElementById("game-view-status");
    if (statusElement) {
      statusElement.textContent = `Wait ${this.requiredSeparation} seconds and press JUMP!`;
      statusElement.style.color = "#4CAF50";
    }

    // Add counting animation to timer
    const timerElement = document.getElementById("game-timer");
    timerElement?.classList.add("counting");
  }

  /**
   * Handle player pressing the jump button
   */
  private handlePlayerJump(): void {
    if (this.state !== GameState.COUNTING) return;

    this.playerJumpTime = this.gameTime;
    this.state = GameState.PLAYER_JUMPED;
    this.isTimerRunning = false;

    const actualSeparation = this.playerJumpTime - this.firstJumperExitTime;
    console.log(
      `Player jumped at ${this.playerJumpTime.toFixed(
        2,
      )}s (separation: ${actualSeparation.toFixed(2)}s)`,
    );

    // Disable primary button while analyzing
    this.updatePrimaryButton("ANALYZING...", true);

    // Remove counting animation
    const timerElement = document.getElementById("game-timer");
    timerElement?.classList.remove("counting");

    // Update status with immediate feedback
    const statusElement = document.getElementById("game-view-status");
    if (statusElement) {
      const diff = Math.abs(actualSeparation - this.requiredSeparation);
      if (actualSeparation < this.requiredSeparation) {
        statusElement.textContent = "⚠️ Too early! Analyzing separation...";
        statusElement.style.color = "#f44336";
      } else if (diff <= 2.0) {
        statusElement.textContent = "✓ Good timing! Analyzing separation...";
        statusElement.style.color = "#4CAF50";
      } else {
        statusElement.textContent = "⚠️ Too late! Analyzing separation...";
        statusElement.style.color = "#ff9800";
      }
    }

    // Update player jumper's jump time
    if (this.playerJumper) {
      this.playerJumper.jumpTime = this.playerJumpTime;
    }

    // Zoom out camera to show both jumpers
    this.zoomOutCamera();

    // No replay messaging
  }

  /**
   * Zoom out the camera to show both jumpers
   * This happens after the player jumps
   */
  private zoomOutCamera(): void {
    // Camera zoom will be handled in updateCamera based on state
    // Just ensure we're no longer locked to any target
    this.cameraFollowTarget = null;
  }

  /**
   * Update the timer display
   */
  private updateTimerDisplay(): void {
    const elapsed = this.gameTime - this.firstJumperExitTime;
    const timerElement = document.getElementById("game-timer");
    if (timerElement) {
      timerElement.textContent = elapsed.toFixed(2);
    }
  }

  /**
   * Show the results of the round
   */
  private showResults(): void {
    this.state = GameState.SHOWING_RESULTS;

    const actualSeparation = this.playerJumpTime - this.firstJumperExitTime;
    const difference = Math.abs(actualSeparation - this.requiredSeparation);

    // Determine if player won or lost
    const isWin =
      difference <= 2.0 && actualSeparation >= this.requiredSeparation;
    const isPerfect = isWin && difference <= 0.5;
    const isGreat = isWin && difference > 0.5 && difference <= 1.0;

    if (isWin) {
      this.wins++;
      this.streak++;
    } else {
      this.losses++;
      this.streak = 0;
    }

    const streakWin = isWin && this.streak >= 3;
    if (streakWin) {
      this.streakWinPending = true;
    }

    console.log(`Round ${this.currentRound} result: ${isWin ? "WIN" : "LOSS"}`);
    console.log(
      `Actual: ${actualSeparation.toFixed(2)}s, Required: ${
        this.requiredSeparation
      }s, Diff: ${difference.toFixed(2)}s`,
    );

    // Update score display
    this.updateScoreDisplay();

    // Show results overlay
    const resultsOverlay = document.getElementById("results-overlay");
    const resultsTitle = document.getElementById("results-title");
    const resultsDetails = document.getElementById("results-details");
    const playerSepElement = document.getElementById("player-separation");
    const requiredSepElement = document.getElementById(
      "required-separation-result",
    );
    const diffElement = document.getElementById("separation-diff");
    const nextRoundButton = document.getElementById(
      "next-round-button",
    ) as HTMLButtonElement;

    if (resultsTitle) {
      resultsTitle.textContent = streakWin
        ? "STREAK WIN!"
        : isPerfect
          ? "PERFECT!"
          : isGreat
            ? "GREAT!"
            : isWin
              ? "SUCCESS!"
              : "MISSED!";
      resultsTitle.className = isWin
        ? "results-title success"
        : "results-title fail";
    }

    if (playerSepElement)
      playerSepElement.textContent = `${actualSeparation.toFixed(2)} sec`;
    if (requiredSepElement)
      requiredSepElement.textContent = `${this.requiredSeparation.toFixed(
        1,
      )} sec`;
    if (diffElement) {
      diffElement.textContent = `${difference.toFixed(2)} sec`;
      diffElement.style.color = difference <= 2.0 ? "#4CAF50" : "#f44336";
    }

    if (resultsDetails) {
      if (isWin) {
        resultsDetails.innerHTML = `
          ${streakWin ? "🎉 You hit a 3-streak!" : isPerfect ? "Bullseye timing!" : isGreat ? "Nice timing!" : "Good timing!"}<br>
          <span class="highlight">Your separation: ${actualSeparation.toFixed(
            2,
          )} sec</span>
          <span class="highlight">Required: ${this.requiredSeparation.toFixed(
            1,
          )} sec</span>
          <span class="highlight">Difference: ${difference.toFixed(
            2,
          )} sec</span>
          <span class="highlight">Streak: ${this.streak}</span>
          ${streakWin ? '<span class="highlight">You win this run! Streak resets next round.</span>' : ""}
        `;
      } else if (actualSeparation < this.requiredSeparation) {
        resultsDetails.innerHTML = `
          You jumped too early! This could result in a collision.<br>
          <span class="highlight">Your separation: ${actualSeparation.toFixed(
            2,
          )} sec</span>
          <span class="highlight">Required: ${this.requiredSeparation.toFixed(
            1,
          )} sec</span>
          <span class="highlight">Too early by: ${(
            this.requiredSeparation - actualSeparation
          ).toFixed(2)} sec</span>
          <span class="highlight">Streak reset</span>
          <span class="highlight">Tip: Count slower or watch the timer tick.</span>
        `;
      } else {
        resultsDetails.innerHTML = `
          You jumped too late! You were off by more than 2 seconds.<br>
          <span class="highlight">Your separation: ${actualSeparation.toFixed(
            2,
          )} sec</span>
          <span class="highlight">Required: ${this.requiredSeparation.toFixed(
            1,
          )} sec</span>
          <span class="highlight">Too late by: ${(
            actualSeparation - this.requiredSeparation
          ).toFixed(2)} sec</span>
          <span class="highlight">Streak reset</span>
          <span class="highlight">Tip: Start counting as soon as red exits.</span>
        `;
      }
    }

    // Update next round button text
    const primaryLabel = "Next Round";
    if (nextRoundButton) {
      nextRoundButton.textContent = primaryLabel;
    }

    // Enable primary action button to continue
    this.updatePrimaryButton(primaryLabel.toUpperCase(), false);

    // Update view separation button
    const viewSeparationButton = document.getElementById(
      "view-replay-button",
    ) as HTMLButtonElement;
    if (viewSeparationButton) {
      viewSeparationButton.textContent = "View Separation";
    }

    resultsOverlay?.classList.add("show");

    this.trajectoryLines.forEach((line) => (line.visible = true));
  }

  /**
   * View the separation between jumpers
   * Zooms camera to show both jumpers clearly
   */
  private viewSeparation(): void {
    console.log("Viewing separation between jumpers");

    // Make sure both jumpers are visible
    const mesh1 = this.firstJumper?.getMesh();
    const mesh2 = this.playerJumper?.getMesh();

    if (mesh1) mesh1.visible = true;
    if (mesh2) mesh2.visible = true;

    // Update camera to optimal viewing position
    if (this.firstJumper && this.playerJumper && mesh1 && mesh2) {
      const pos1 = mesh1.position;
      const pos2 = mesh2.position;

      const center = new THREE.Vector3()
        .addVectors(pos1, pos2)
        .multiplyScalar(0.5);
      const distance = pos1.distanceTo(pos2);

      // Position camera to see both jumpers with good perspective
      const offset = new THREE.Vector3(
        distance * 1.2,
        distance * 0.6,
        distance * 1.2,
      );

      this.camera.position.copy(center).add(offset);
      this.camera.lookAt(center);

      // Update status
      const statusElement = document.getElementById("game-view-status");
      if (statusElement) {
        statusElement.textContent = `Separation: ${distance.toFixed(1)}m (${(
          distance * 3.28084
        ).toFixed(0)}ft)`;
      }
    }
  }

  /**
   * Update the round display
   */
  private updateRoundDisplay(): void {
    const roundElement = document.getElementById("current-round");
    if (roundElement) {
      roundElement.textContent = `${this.currentRound}`;
    }
  }

  private updatePrimaryButton(label: string, disabled: boolean): void {
    const jumpButton = document.getElementById(
      "jump-now-button",
    ) as HTMLButtonElement;
    if (jumpButton) {
      jumpButton.textContent = label;
      jumpButton.disabled = disabled;
      jumpButton.style.opacity = disabled ? "0.5" : "1";
    }
  }

  /**
   * Update the score display
   */
  private updateScoreDisplay(): void {
    const winsElement = document.getElementById("wins-count");
    const lossesElement = document.getElementById("losses-count");
    const streakElement = document.getElementById("streak-count");

    if (winsElement) winsElement.textContent = `${this.wins}`;
    if (lossesElement) lossesElement.textContent = `${this.losses}`;
    if (streakElement) streakElement.textContent = `${this.streak}`;
  }

  /**
   * Start the bonus round
   */
  private startBonusRound(): void {
    console.log("Starting BONUS ROUND!");
    this.isBonusRound = true;
    this.currentRound = 4;
    this.cameraMode = "side";

    // Use faster table entries for a tougher bonus round
    this.airSpeedKnots = this.getPlaneAirspeedKnots();
    const eligible = SEPARATION_TABLE.filter(
      (row) =>
        row.speed <= Math.max(5, Math.floor(this.airSpeedKnots)) &&
        row.speed >= 60,
    );
    const choice = eligible.length
      ? eligible[Math.floor(Math.random() * eligible.length)]
      : SEPARATION_TABLE[0];

    this.groundSpeed = choice.speed;
    this.requiredSeparation = choice.separation;
    this.headwindKnots = Math.max(
      0,
      Math.round(this.airSpeedKnots - this.groundSpeed),
    );

    const bonusIndicator = document.getElementById("bonus-indicator");
    if (bonusIndicator) bonusIndicator.style.display = "block";

    this.updateRoundDisplay();
    highlightTableRow(this.groundSpeed);

    const airspeedElement = document.getElementById("current-airspeed");
    const headwindElement = document.getElementById("current-headwind");
    const speedElement = document.getElementById("current-speed");
    const separationElement = document.getElementById("required-separation");
    if (airspeedElement)
      airspeedElement.textContent = `${this.airSpeedKnots.toFixed(0)} kts`;
    if (headwindElement)
      headwindElement.textContent = `${this.headwindKnots.toFixed(0)} kts`;
    if (speedElement) speedElement.textContent = `${this.groundSpeed} kts`;
    if (separationElement)
      separationElement.textContent = `${this.requiredSeparation} sec`;

    // Hide results overlay
    const resultsOverlay = document.getElementById("results-overlay");
    resultsOverlay?.classList.remove("show");

    // Create jumpers and begin
    this.setupRoundJumpers();
    this.beginRound();
  }

  /**
   * End the game and show final results
   */
  private endGame(): void {
    this.state = GameState.GAME_COMPLETE;

    const resultsOverlay = document.getElementById("results-overlay");
    const resultsContent = resultsOverlay?.querySelector(".results-content");

    if (resultsContent) {
      resultsContent.innerHTML = `
        <div class="results-title ${this.wins === 3 ? "success" : "fail"}">
          Game Complete!
        </div>
        <div class="results-details">
          <span class="highlight">Final Score</span>
          <span class="highlight">Wins: ${this.wins}</span>
          <span class="highlight">Losses: ${this.losses}</span>
          ${this.wins === 3 ? "<br><strong>Perfect Score! 🎉</strong>" : ""}
        </div>
        <div class="results-actions">
          <button class="results-button primary" id="play-again-button">Play Again</button>
          <button class="results-button secondary" id="exit-final-game">Exit to Simulator</button>
        </div>
      `;

      // Add event listener to exit button
      const playAgainButton =
        resultsContent.querySelector("#play-again-button");
      playAgainButton?.addEventListener("click", () => this.restartGame());
      const exitButton = resultsContent.querySelector("#exit-final-game");
      exitButton?.addEventListener("click", () => this.exitGame());
    }

    resultsOverlay?.classList.add("show");
    this.updatePrimaryButton("PLAY AGAIN", false);
  }
}

// Export a singleton instance that can be accessed globally
let separationGameInstance: SeparationGame | null = null;

export function initializeSeparationGame(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  plane: SimPlane,
): SeparationGame {
  if (!separationGameInstance) {
    separationGameInstance = new SeparationGame(scene, camera, renderer, plane);
  }
  return separationGameInstance;
}

export function getSeparationGame(): SeparationGame | null {
  return separationGameInstance;
}
