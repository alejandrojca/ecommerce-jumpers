import Phaser from "phaser";
import type { SocketClient } from "../network/SocketClient";
import { GameScene } from "./scenes/GameScene";

export function createGame(network: SocketClient, debugElement: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: 1280,
    height: 720,
    backgroundColor: "#11172b",
    render: { antialias: true, pixelArt: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [new GameScene(network, debugElement)]
  });
}
