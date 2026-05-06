import Phaser from 'phaser';

export class PreloadScene extends Phaser.Scene {
  constructor() { super('Preload'); }
  preload() {
    // No external assets yet — geometry is procedural.
  }
  create() { this.scene.start('MainGame'); }
}
