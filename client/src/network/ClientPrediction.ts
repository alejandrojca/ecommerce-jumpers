import {
  NETWORK, PHYSICS, type GameSnapshot, type PlayerInput, type PlayerSnapshot
} from "@tetherbound/shared";

interface Predicted { input: PlayerInput; dt: number }
interface PredictiveSurface {
  id: string;
  minX: number;
  maxX: number;
  topY: number;
  velocityX: number;
  velocityY: number;
}

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
  private exited = false;
  private supportId?: string;
  private jumpStartFeetY?: number;
  private surfaces: PredictiveSurface[] = [];

  get x(): number { return this.simulationX + this.correctionX; }
  get y(): number { return this.simulationY + this.correctionY; }
  get vx(): number { return this.simulationVx; }
  get vy(): number { return this.simulationVy; }

  predict(input: PlayerInput, dt: number): void {
    if (!this.initialized || this.exited) return;
    this.pending.push({ input, dt });
    this.integrate(input, dt);
    const smoothing = Math.pow(0.78, dt * 60);
    this.correctionX *= smoothing;
    this.correctionY *= smoothing;
  }

  reconcile(authoritative: PlayerSnapshot, snapshot?: GameSnapshot): number {
    if (snapshot) this.updateSurfaces(snapshot, authoritative.id);
    if (!this.initialized) {
      this.setAuthoritative(authoritative);
      this.grounded = authoritative.grounded;
      this.supportId = authoritative.support?.id;
      this.snapToAuthoritativeSupport(authoritative);
      this.movementLocked = authoritative.state === "Hanging" || authoritative.state === "AtExit";
      this.exited = authoritative.state === "AtExit";
      this.initialized = true;
      return 0;
    }
    const previousX = this.x;
    const previousY = this.y;
    this.pending = this.pending.filter((p) => p.input.sequence > authoritative.lastProcessedInput);
    this.setAuthoritative(authoritative);
    this.grounded = authoritative.grounded;
    this.supportId = authoritative.support?.id;
    this.snapToAuthoritativeSupport(authoritative);
    this.movementLocked = authoritative.state === "Hanging" || authoritative.state === "AtExit";
    this.exited = authoritative.state === "AtExit";
    if (authoritative.state === "AtExit") this.pending = [];
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
    const standingSurface = this.grounded ? this.findStandingSurface() : undefined;
    if (this.grounded && this.surfaces.length > 0 && !standingSurface) {
      this.grounded = false;
      this.supportId = undefined;
    } else if (standingSurface) {
      this.simulationY = standingSurface.topY - PHYSICS.PLAYER_HEIGHT / 2;
      this.simulationX += standingSurface.velocityX * dt;
      this.simulationVy = standingSurface.velocityY;
      this.supportId = standingSurface.id;
    }
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
      this.jumpStartFeetY = this.simulationY + PHYSICS.PLAYER_HEIGHT / 2;
      this.grounded = false;
      this.supportId = undefined;
    }
    const velocityBeforeGravity = this.simulationVy;
    if (!this.grounded) {
      this.simulationVy = Math.min(PHYSICS.MAX_FALL_SPEED, velocityBeforeGravity + PHYSICS.GRAVITY * dt);
    } else {
      this.simulationVy = 0;
    }
    const previousBottom = this.simulationY + PHYSICS.PLAYER_HEIGHT / 2;
    const nextX = this.simulationX + this.simulationVx * dt;
    let nextY = this.grounded
      ? this.simulationY
      : this.simulationY + velocityBeforeGravity * dt + PHYSICS.GRAVITY * dt * dt / 2;
    if (this.jumpStartFeetY !== undefined) {
      const apexY = this.jumpStartFeetY - PHYSICS.MAX_JUMP_HEIGHT - PHYSICS.PLAYER_HEIGHT / 2;
      // Resolve the analytical apex rather than accepting a frame-sampled one.
      if (velocityBeforeGravity < 0 && this.simulationVy >= 0) nextY = apexY;
      if (nextY < apexY) {
        nextY = apexY;
        if (this.simulationVy < 0) this.simulationVy = 0;
      }
    }
    if (!this.grounded && this.simulationVy >= 0) {
      const nextBottom = nextY + PHYSICS.PLAYER_HEIGHT / 2;
      const landing = this.findLandingSurface(previousBottom, nextBottom, nextX);
      if (landing) {
        nextY = landing.topY - PHYSICS.PLAYER_HEIGHT / 2;
        this.simulationVy = landing.velocityY;
        this.grounded = true;
        this.supportId = landing.id;
        this.jumpStartFeetY = undefined;
      }
    }
    this.simulationX = nextX;
    this.simulationY = nextY;
  }

  private setAuthoritative(authoritative: PlayerSnapshot): void {
    this.simulationX = authoritative.x;
    this.simulationY = authoritative.y;
    this.simulationVx = authoritative.velocityX;
    this.simulationVy = authoritative.velocityY;
    this.correctionX = 0;
    this.correctionY = 0;
  }

  private updateSurfaces(snapshot: GameSnapshot, ownId: string): void {
    this.surfaces = [
      ...snapshot.objects.map((object) => ({
        id: object.id,
        minX: object.x - object.width / 2,
        maxX: object.x + object.width / 2,
        topY: object.y - object.height / 2,
        velocityX: object.velocityX,
        velocityY: object.velocityY,
      })),
      ...snapshot.players
        .filter((player) => player.id !== ownId && player.state !== "Dead")
        .map((player) => ({
          id: `player:${player.id}`,
          minX: player.x - PHYSICS.PLAYER_WIDTH / 2,
          maxX: player.x + PHYSICS.PLAYER_WIDTH / 2,
          topY: player.y - PHYSICS.PLAYER_HEIGHT / 2,
          velocityX: player.velocityX,
          velocityY: player.velocityY,
        })),
    ];
  }

  private snapToAuthoritativeSupport(authoritative: PlayerSnapshot): void {
    if (!authoritative.grounded || !authoritative.support) return;
    this.simulationY = authoritative.support.topY - PHYSICS.PLAYER_HEIGHT / 2;
    this.simulationVy = authoritative.support.velocityY;
  }

  private findStandingSurface(): PredictiveSurface | undefined {
    const bottom = this.simulationY + PHYSICS.PLAYER_HEIGHT / 2;
    const candidates = this.surfaces.filter((surface) =>
      this.overlapsHorizontally(this.simulationX, surface)
      && Math.abs(bottom - surface.topY) <= 12
    );
    return candidates.find((surface) => surface.id === this.supportId)
      ?? candidates.sort((a, b) => a.topY - b.topY)[0];
  }

  private findLandingSurface(previousBottom: number, nextBottom: number, x: number): PredictiveSurface | undefined {
    return this.surfaces
      .filter((surface) =>
        this.overlapsHorizontally(x, surface)
        && previousBottom <= surface.topY + 6
        && nextBottom >= surface.topY
      )
      .sort((a, b) => a.topY - b.topY)[0];
  }

  private overlapsHorizontally(x: number, surface: PredictiveSurface): boolean {
    const halfWidth = PHYSICS.PLAYER_WIDTH / 2;
    return x + halfWidth > surface.minX + 2 && x - halfWidth < surface.maxX - 2;
  }
}
