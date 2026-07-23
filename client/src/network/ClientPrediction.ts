import { NETWORK, PHYSICS, type PlayerInput, type PlayerSnapshot } from "@tetherbound/shared";

interface Predicted { input: PlayerInput; dt: number }
export class ClientPrediction {
  x = 0; y = 0; vx = 0; vy = 0;
  private pending: Predicted[] = [];
  private initialized = false;
  private grounded = false;
  private movementLocked = false;

  predict(input: PlayerInput, dt: number): void {
    if (!this.initialized) return;
    this.pending.push({ input, dt });
    this.integrate(input, dt);
  }

  reconcile(authoritative: PlayerSnapshot): number {
    if (!this.initialized) {
      this.x = authoritative.x; this.y = authoritative.y;
      this.vx = authoritative.velocityX; this.vy = authoritative.velocityY;
      this.grounded = authoritative.grounded;
      this.movementLocked = authoritative.state === "Hanging";
      this.initialized = true;
      return 0;
    }
    const error = Math.hypot(authoritative.x - this.x, authoritative.y - this.y);
    this.pending = this.pending.filter((p) => p.input.sequence > authoritative.lastProcessedInput);
    if (error > NETWORK.HARD_CORRECTION_DISTANCE || authoritative.state === "Hanging") {
      this.x = authoritative.x; this.y = authoritative.y;
    } else {
      this.x += (authoritative.x - this.x) * 0.18;
      // Ground contact is not predicted locally. Pinning the vertical axis to
      // the authoritative floor prevents gravity from visually sinking the body.
      this.y = authoritative.grounded
        ? authoritative.y
        : this.y + (authoritative.y - this.y) * 0.18;
    }
    this.vx = authoritative.velocityX;
    this.vy = authoritative.velocityY;
    this.grounded = authoritative.grounded;
    this.movementLocked = authoritative.state === "Hanging";
    for (const pending of this.pending) this.integrate(pending.input, pending.dt);
    return error;
  }

  get pendingCount(): number { return this.pending.length; }

  private integrate(input: PlayerInput, dt: number): void {
    const direction = this.movementLocked ? 0 : Number(input.right) - Number(input.left);
    if (direction) this.vx = Math.max(-PHYSICS.MAX_RUN_SPEED, Math.min(PHYSICS.MAX_RUN_SPEED, this.vx + direction * PHYSICS.AIR_ACCELERATION * dt));
    else this.vx *= Math.pow(PHYSICS.AIR_DRAG, dt * 60);
    if (!this.movementLocked && input.jumpPressed && this.grounded) {
      this.vy = PHYSICS.JUMP_VELOCITY;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vy = Math.min(PHYSICS.MAX_FALL_SPEED, this.vy + PHYSICS.GRAVITY * dt);
    } else {
      this.vy = 0;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
}
