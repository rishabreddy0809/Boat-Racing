# Wakefire

Armed offshore boat racing in the browser: 3 laps, 6 boats, turret-mounted twin guns, rockets and mines, over a Gerstner-wave ocean with sea stacks.

Built with three.js. The whole game bundles into one self-contained HTML file, which is used two ways:

- **Web:** `game-src/web/index.html` (static site, deployed on Vercel)
- **Apple app:** `Hyperrealistic_boat_game/Wakefire.html`, shown in a `WKWebView` by the SwiftUI app (`Hyperrealistic_boat_game.xcodeproj`)

## Controls

| | |
|---|---|
| Throttle / steer | W A S D or arrows |
| Aim / fire guns | Mouse / click or Space |
| Gunner view | Right mouse or V |
| Rocket / mine | E / Q |
| Boost / recover | Shift / R |
| Pause / mute | P / M |

## Building

```sh
cd game-src
npm install
node build.mjs   # writes Hyperrealistic_boat_game/Wakefire.html and game-src/web/index.html
```

Source is in `game-src/src` (`main.js` game loop, `water.js` ocean, `world.js` rocks and course, `boat.js` model, `fx.js` particles and rounds, `audio.js` synthesized sound).

## Credits

- Boat: "Patrol Boat PBR MK2" by SavyTheCreator, [Sketchfab](https://sketchfab.com/3d-models/dbd87172b2934063aa93ffd0c6f85750), CC BY 4.0. The forward gun mount was split into a separate part so it can rotate.
- Rock texture: "Rock Face 03", Poly Haven, CC0.
