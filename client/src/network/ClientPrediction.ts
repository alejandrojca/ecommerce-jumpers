import { NETWORK, PHYSICS, type PlayerInput, type PlayerSnapshot } from "@tetherbound/shared";

interface Predicted { input: PlayerInput; dt: number }
export class ClientPrediction {
  private simulationX = 0;
  private simulationY = 0;
  private simulationVx = 0;
  private simulationVy = 0;
  private correctionX = 0;
  private correctionY = 0;
  private pending: Predicted[] = [];
  private initialized = false;
  private grounded = false;
  private movementLocked = false;

  get x(): number { return this.simulationX + this.correctionX; }
  get y(): number { return this.simulationY + this.correctionY; }
  get vx(): number { return this.simulationVx; }
  get vy(): number { return this.simulationVy; }

  predict(input: PlayerInput, dt: number): void {
    if (!this.initialized) return;
    this.pending.push({ input, dt });
    this.integrate(input, dt);
    const smoothing = Math.pow(0.78, dt * 60);
    this.correctionX *= smoothing;
    this.correctionY *= smoothing;
  }

  reconcile(authoritative: PlayerSnapshot): number {
    if (!this.initialized) {
      this.setAuthoritative(authoritative);
      this.grounded = authoritative.grounded;
      this.movementLocked = authoritative.state === "Hanging";
      this.initialized = true;
      return 0;
    }
    const previousX = this.x;
    const previousY = this.y;
    this.pending = this.pending.filter((p) => p.input.sequence > authoritative.lastProcessedInput);
    this.setAuthoritative(authoritative);
    this.grounded = authoritative.grounded;
    this.movementLocked = authoritative.state === "Hanging";
    for (const pending of this.pending) this.integrate(pending.input, pending.dt);
    const error = Math.hypot(this.simulationX - previousX, this.simulationY - previousY);
    if (error > NETWORK.HARD_CORRECTION_DISTANCE || this.movementLocked) {
      this.correctionX = 0;
      this.correctionY = 0;
    } else {
      // Keep the rendered position continuous while the correction offset
      // decays. The simulation itself always starts from the authoritative
      // state, so pending inputs are replayed exactly once.
      this.correctionX = previousX - this.simulationX;
      this.correctionY = previousY - this.simulationY;
    }
    return error;
  }

  get pendingCount(): number { return this.pending.length; }

  private integrate(input: PlayerInput, dt: number): void {
    const direction = this.movementLocked ? 0 : Number(input.right) - Number(input.left);
    if (direction) {
      this.simulationVx = Math.max(
        -PHYSICS.MAX_RUN_SPEED,
        Math.min(PHYSICS.MAX_RUN_SPEED, this.simulationVx + direction * PHYSICS.AIR_ACCELERATION * dt)
      );
    } else {
      this.simulationVx *= Math.pow(PHYSICS.AIR_DRAG, dt * 60);
    }
    if (!this.movementLocked && input.jumpPressed && this.grounded) {
      this.simulationVy = PHYSICS.JUMP_VELOCITY;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.simulationVy = Math.min(PHYSICS.MAX_FALL_SPEED, this.simulationVy + PHYSICS.GRAVITY * dt);
    } else {
      this.simulationVy = 0;
    }
    this.simulationX += this.simulationVx * dt;
    this.simulationY += this.simulationVy * dt;
  }

  private setAuthoritative(authoritative: PlayerSnapshot): void {
    this.simulationX = authoritative.x;
    this.simulationY = authoritative.y;
    this.simulationVx = authoritative.velocityX;
    this.simulationVy = authoritative.velocityY;
    this.correctionX = 0;
    this.correctionY = 0;
  }
}
