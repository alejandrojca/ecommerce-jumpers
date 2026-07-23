import type { PlayerInput } from "@tetherbound/shared";

export class InputController {
  private sequence = 0;
  private previousJump = false;
  constructor(private readonly keys: Set<string>) {}

  read(): PlayerInput {
    const gamepad = navigator.getGamepads?.()[0];
    const axis = gamepad?.axes[0] ?? 0;
    const jump = this.keys.has("Space") || this.keys.has("KeyW") || this.keys.has("ArrowUp") || Boolean(gamepad?.buttons[0]?.pressed);
    const input = {
      sequence: ++this.sequence,
      left: this.keys.has("KeyA") || this.keys.has("ArrowLeft") || axis < -0.3,
      right: this.keys.has("KeyD") || this.keys.has("ArrowRight") || axis > 0.3,
      jumpPressed: jump && !this.previousJump,
      jumpHeld: jump,
      clientTime: Date.now()
    };
    this.previousJump = jump;
    return input;
  }
}
