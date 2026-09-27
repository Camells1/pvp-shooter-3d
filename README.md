# PvP Shooter 3D

A **round-based 3D team shooter** for **1v1 or 2v2** with your friends over the internet. It has an economy, a buy menu, and guns that drop when you die. It's peer-to-peer, so there's **no server to run** and no account to create.

## ▶ Download & play

1. Go to **[Releases → latest](../../releases/latest)**
2. Download one of these:
   - **`PvP-Shooter-3D-Portable-x.x.x.exe`**: no install, just double-click and play
   - **`PvP-Shooter-3D-Setup-x.x.x.exe`**: installs it and adds a desktop shortcut
3. If Windows SmartScreen says *"Windows protected your PC"*, click **More info → Run anyway**. The game isn't code-signed, which is normal for small indie games.

Everyone needs the **same version** to play together.

## 🎮 Playing with friends (up to 4)

1. **Host:** click **Host Online**. You go straight into the lobby, and the room code is shown at the top.
2. **Friends (up to 3):** click **Join Online**, type the code, and hit **Connect**.
3. Everyone picks a fighter and clicks **Ready**. Use **Switch team** to choose sides.
4. The host picks **1v1 or 2v2**, the map and the rounds to win, then clicks **Start match**. Empty slots are filled with bots.

No port forwarding is needed. The host's PC links everyone together (WebRTC via PeerJS).

No friends online? **Play vs Bots** runs 1v1 or 2v2 with a bot teammate, on Easy, Normal or Hard.

## How a match works

- **Rounds:** everyone gets one life per round. A round ends when a team is wiped out, or when the 100-second timer runs out (then the team with more players alive wins). The first team to 5, 7 or 9 rounds wins.
- **Buy phase:** each round starts with 15 seconds to buy (press **B**). You start the match with ¤800.
- **Economy:** a win pays ¤3000, a loss ¤1900 (+¤500 per loss in a row, up to ¤2900), and each kill ¤200. Credits cap at ¤9000.
- **Keep what you survive with:** if you're alive at the end of a round, you keep your guns and shield.
- **Dropped guns:** when someone dies, their gun drops. Anyone can grab it with **F** before the round ends. Press **G** to drop your gun on purpose (for example, to give a teammate a rifle). Buying a new gun drops your old one.
- **Shields:** a **Light Shield** (+25, ¤400) or **Heavy Shield** (+50, ¤1000) absorbs damage before your health does.

## Controls

| Action | Key |
|---|---|
| Move / Jump | W A S D / Space |
| Aim / Fire | Mouse / Left click |
| Aim down sights (scope on Sniper) | Right click |
| Ability | Shift |
| Reload | R |
| Primary / Sidearm / Last weapon | 1 / 2 / Q (or mouse wheel) |
| Buy menu (buy phase only) | B |
| Pick up gun / Drop gun | F / G |
| Spectate next teammate (when dead) | Left click |
| Pause / free the mouse | Esc |
| Fullscreen | F11 |

## Fighters

| Fighter | Role | HP | Ability |
|---|---|---|---|
| **Blaze** | Assault | 90 | **Dash**: blast forward in any direction |
| **Tank** | Heavy | 140 | **Barrier**: blocks all damage for 2.5s |
| **Ghost** | Infiltrator | 100 | **Blink**: teleport 9m where you're looking |
| **Volt** | Gunner | 100 | **Overclock**: double fire rate + instant reloads for 4s |
| **Frost** | Controller | 100 | **Ice Wall**: a wall that blocks movement and bullets for 8s |
| **Nova** | Medic | 100 | **Mend**: heal yourself and allies within 8m for 50 HP |
| **Echo** | Recon | 95 | **Pulse**: reveal all enemies through walls to your team for 4s |

## Weapons

| Weapon | Price | Notes |
|---|---|---|
| Pistol | Free | Everyone's default sidearm |
| Machine Pistol | ¤500 | Full-auto sidearm |
| Hand Cannon | ¤900 | Two headshots kill anyone |
| SMG | ¤1500 | Fast, great on the move |
| Shotgun | ¤1800 | 9 pellets, brutal up close |
| Scout | ¤1100 | Light scoped rifle, cheap and accurate |
| Assault Rifle | ¤2900 | The all-rounder; 75-damage headshots |
| LMG | ¤3200 | 60-round mag, slows you down |
| Sniper | ¤4200 | One-shots most fighters to the body |

## Maps

| Map | Size | |
|---|---|---|
| Foundry | Small | Warehouse at sunset: catwalks, containers, close quarters |
| Skyline | Small | Neon rooftop at night. Don't fall off. |
| Canyon | Small | Desert canyon split by a chasm. Cross the bridges. |
| **Harbor** | Large | Container yard between two warehouses. Stack up for high ground. |
| **Citadel** | Large | Temple at dusk. Fight for the raised plaza. |

---

## Development

```bash
npm install
npm start          # run the game (Electron)
npm run serve      # or play in a browser at http://localhost:5178
npm run build      # build the installer + portable exe into dist/
```

Built with [three.js](https://threejs.org) and [PeerJS](https://peerjs.com). All models, textures and sounds are generated in code, so there are no asset files.

Pushing a tag like `v2.1.1` makes GitHub Actions build the Windows `.exe` files and attach them to a new Release automatically.
