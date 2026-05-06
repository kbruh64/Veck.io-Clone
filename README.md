# Veck.io Clone
Veck.io Clone
A browser-first clone of Veck.io built with Phaser 3 and Three.js.

Overview
This project combines Phaser as the game engine shell with Three.js for 3D rendering. Phaser manages scenes, input, UI overlays, and the main loop. Three.js renders the board, pieces, and camera inside a Phaser scene.

Architecture
Phaser = app shell, scenes, input, UI
Three.js = 3D board, meshes, camera, rendering
BoardState = game logic separate from rendering
MainGameScene = integrates Three.js render loop into Phaser
Initial scope
Browser-based playable prototype
3D board, game pieces, and camera orbit controls
Piece movement and basic game flow
Responsive canvas with UI overlay
Build-ready via Vite
Future goals
Desktop / mobile packaging
Multiplayer support
Level editor / custom boards
Enhanced 3D visuals and effects
Getting started
Install dependencies
Run the dev server
Open the app in a browser
Build for production
Recommended folder structure
src/main.ts — bootstrap Phaser and app entry
src/scenes/BootScene.ts — startup and scene launch
src/scenes/PreloadScene.ts — load assets and prepare the game
src/scenes/MainGameScene.ts — main gameplay and Three.js integration
src/three/ThreeGameRenderer.ts — Three.js scene helper
src/game/BoardState.ts — board and game logic
