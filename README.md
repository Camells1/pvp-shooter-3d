# PvP Shooter 3D

A fast **1v1 third-person 3D shooter** you play with a friend over the internet. It's peer-to-peer, so there's **no server to run** and no account to create.

## ▶ Download & play

1. Go to **[Releases → latest](../../releases/latest)**
2. Download one of these:
   - **`PvP-Shooter-3D-Portable-x.x.x.exe`**: no install, just double-click and play
   - **`PvP-Shooter-3D-Setup-x.x.x.exe`**: installs it and adds a desktop shortcut
3. If Windows SmartScreen says *"Windows protected your PC"*, click **More info → Run anyway**. The game isn't code-signed, which is normal for small indie games.

## 🎮 Playing with a friend

1. **You:** click **Host Online** and send your friend the 6-letter code.
2. **Friend:** clicks **Join Online**, types the code, and hits **Connect**.
3. Both of you pick a fighter and click **Ready**. The host picks the map and the score limit.

No port forwarding is needed. The connection is made directly between your two PCs (WebRTC via PeerJS).

No friend online? **Play vs Bot** has Easy, Normal and Hard bots.

## Controls

| Action | Key |
|---|---|
| Move | W A S D |
| Aim / Fire | Mouse / Left click |
| Aim down sights (scope on Marksman) | Right click |
| Jump | Space |
| Ability | Shift |
| Reload | R |
| Switch weapon | 1–4, Q / E, mouse wheel |
| Pause / free the mouse | Esc |
| Fullscreen | F11 |

## Fighters

| Fighter | Role | HP | Ability |
|---|---|---|---|
| **Blaze** | Assault | 90 | **Dash**: blast forward in any direction |
| **Tank** | Heavy | 160 | **Barrier**: blocks all damage for 2.5s |
| **Ghost** | Infiltrator | 100 | **Blink**: teleport 9m where you're looking |
| **Volt** | Gunner | 100 | **Overclock**: double fire rate + instant reloads for 4s |

## Weapons

**Pistol** (accurate, 2× headshots) · **SMG** (full-auto) · **Shotgun** (9 pellets, devastating up close) · **Marksman** (scoped, 96 dmg headshots)

## Maps

- **Foundry**: a warehouse at sunset with catwalks, containers and close quarters
- **Skyline**: a neon rooftop at night with long sightlines. Don't fall off.
- **Canyon**: a desert canyon split by a chasm. Cross the rope bridges.

Health packs respawn every 20 seconds. The first player to the kill limit wins.

---

## Development

```bash
npm install
npm start          # run the game (Electron)
npm run serve      # or play in a browser at http://localhost:5178
npm run build      # build the installer + portable exe into dist/
```

Built with [three.js](https://threejs.org) and [PeerJS](https://peerjs.com). All models, textures and sounds are generated in code, so there are no asset files.

Pushing a tag like `v2.0.1` makes GitHub Actions build the Windows `.exe` files and attach them to a new Release automatically.
