// Map layouts, carved out of a grid. No three.js here so layouts can be previewed/tested in Node.
// Legend:  # building   . floor   x void (fall)   c crate   C big cover   w low wall   W pillar
//          p platform (2.4m)   s stairs (rise toward the neighbouring p)   o themed prop   1/2 spawns
// Columns run west -> east (attackers west, defenders east); rows run north -> south.

export class Grid {
  constructor(cols, rows, fill = '#') {
    this.cols = cols; this.rows = rows;
    this.g = Array.from({ length: rows }, () => Array(cols).fill(fill));
    this.sites = {}; this.roofs = []; this.raised = new Set();
  }
  in(c, r) { return c >= 1 && r >= 1 && c < this.cols - 1 && r < this.rows - 1; } // keep the outer ring solid
  at(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows ? this.g[r][c] : '#'; }
  carve(c0, r0, c1, r1, ch = '.') {
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++)
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) if (this.in(c, r)) { this.g[r][c] = ch; this.raised.delete(c + ',' + r); }
    return this;
  }
  set(c, r, ch) {
    if (!this.in(c, r)) return this;
    // Props dropped onto a platform keep standing on it
    if ((this.g[r][c] === 'p' || this.raised.has(c + ',' + r)) && 'cCwWo'.includes(ch)) this.raised.add(c + ',' + r);
    else this.raised.delete(c + ',' + r);
    this.g[r][c] = ch; return this;
  }
  cells(list, ch) { for (const [c, r] of list) this.set(c, r, ch); return this; }
  pk(c, r) { (this.pickups ||= []).push([c, r]); return this; }
  site(name, c0, r0, c1, r1) { this.sites[name] = [c0, r0, c1, r1]; return this; }
  roof(c0, r0, c1, r1, y) { this.roofs.push([c0, r0, c1, r1, y]); return this; }
  toString() { return this.g.map(r => r.join('')).join('\n'); }
}

// Every map: attacker spawn west, defender spawn east, A site north-east, B site south-east.
export const LAYOUTS = {
  // Mediterranean town: classic three lanes, A with a raised "heaven", B through a covered market street
  bastion(G) {
    G.carve(1, 7, 4, 14).cells([[2, 9], [2, 12], [3, 10], [3, 11]], '1');
    G.carve(25, 8, 28, 13).cells([[27, 9], [27, 12], [26, 10], [26, 11]], '2');
    // A long (north) with a 2-wide choke into A
    G.carve(1, 3, 3, 7).carve(1, 2, 17, 4).set(17, 2, '#');
    G.carve(18, 2, 24, 7).site('A', 18, 2, 24, 7);
    G.cells([[23, 2], [24, 2], [24, 3]], 'p').set(22, 2, 's');
    G.set(20, 4, 'C').set(21, 4, 'C').set(22, 6, 'c').set(19, 6, 'w');
    G.set(9, 3, 'c').set(13, 2, 'w').set(6, 4, 'c');
    // Mid: street into a courtyard with pillars and a container
    G.carve(4, 9, 15, 12).carve(11, 7, 16, 14);
    G.set(13, 9, 'W').set(13, 12, 'W').set(8, 10, 'C').set(6, 11, 'c').set(15, 8, 'c');
    G.carve(16, 5, 17, 7);                       // mid -> A link
    G.carve(15, 14, 16, 15);                     // mid -> B link
    G.carve(16, 10, 25, 11).set(21, 10, 'c');    // defenders' market street into mid
    // B main (south) with a covered market section
    G.carve(1, 14, 3, 18).carve(1, 16, 16, 18).set(16, 16, '#');
    G.roof(7, 16, 12, 18, 4);
    G.set(6, 17, 'c').set(11, 16, 'C').set(9, 18, 'o');
    G.carve(17, 14, 24, 19).site('B', 17, 14, 24, 19);
    G.set(19, 16, 'C').set(20, 16, 'C').set(22, 18, 'c').set(23, 15, 'W').set(18, 19, 'c');
    // Defender rotations
    G.carve(25, 3, 27, 8).carve(24, 3, 25, 5);
    G.carve(25, 13, 27, 18).carve(24, 17, 25, 18);
    // Break up long sightlines: doglegs and cover
    G.carve(8, 2, 9, 3, '#').set(16, 3, 'C').set(16, 4, '#').set(17, 7, 'W');
    G.set(18, 11, 'C').set(20, 10, 'W').set(11, 11, 'C').set(16, 14, '#');
    G.carve(13, 17, 13, 18, '#').set(26, 15, 'C');
    G.carve(1, 5, 2, 6, '#').carve(2, 15, 3, 16, '#');
    G.pk(10, 11).pk(14, 13);
  },

  // Indoor steel plant: A is a roofed smelter hall with a vent flank; B is an outdoor container yard with a catwalk
  foundry(G) {
    G.carve(1, 7, 4, 14).cells([[2, 9], [2, 12], [3, 10], [3, 11]], '1');
    G.carve(25, 8, 28, 13).cells([[27, 9], [27, 12], [26, 10], [26, 11]], '2');
    // A main: wide conveyor corridor
    G.carve(1, 2, 3, 7).carve(1, 2, 17, 4);
    G.set(6, 3, 'w').set(9, 2, 'c').set(12, 4, 'w').set(15, 3, 'c');
    G.carve(18, 2, 25, 8).site('A', 18, 3, 24, 8);
    G.roof(18, 2, 25, 8, 6);
    G.cells([[24, 3], [25, 3], [24, 4], [25, 4]], 'p').set(23, 3, 's');
    G.set(20, 3, 'W').set(20, 7, 'W').set(22, 5, 'C').set(19, 5, 'c').set(21, 8, 'o');
    // Vent: 1-wide flank from mid into A
    G.carve(14, 6, 17, 6).roof(14, 6, 17, 6, 2.6);
    // Mid: furnace room
    G.carve(4, 10, 8, 11).carve(8, 8, 16, 13);
    G.cells([[11, 10], [12, 10], [11, 11], [12, 11]], 'o');
    G.set(9, 9, 'c').set(14, 12, 'c').set(15, 9, 'W');
    G.carve(14, 13, 15, 15);                     // mid -> B
    G.carve(16, 11, 26, 11);                     // defender link (narrow)
    // B: yard with containers and a raised catwalk on the south edge
    G.carve(1, 14, 3, 18).carve(1, 17, 14, 19);
    G.set(5, 18, 'c').set(9, 17, 'C').set(12, 19, 'c');
    G.carve(15, 14, 25, 20).site('B', 16, 15, 23, 19);
    G.cells([[21, 20], [22, 20], [23, 20], [24, 20]], 'p').set(20, 20, 's');
    G.set(17, 16, 'C').set(18, 16, 'C').set(21, 17, 'C').set(19, 18, 'c').set(23, 15, 'c');
    // Defender rotations
    G.carve(26, 3, 27, 8).carve(25, 3, 26, 4);
    G.carve(26, 13, 27, 18).carve(25, 17, 26, 18);
    G.carve(8, 2, 8, 3, '#').carve(13, 3, 13, 4, '#').set(16, 2, 'C');
    G.carve(7, 18, 7, 19, '#').set(13, 18, 'C').set(17, 19, 'W').set(16, 13, '#');
    G.set(25, 6, 'C').set(25, 15, 'C').set(26, 15, 'C').set(27, 6, 'W');
    G.pk(9, 11).pk(10, 3);
  },

  // Night rooftops: bridges over drops, a raised helipad A, a rooftop-garden B, a roofed interior route through mid
  skyline(G) {
    G.carve(1, 6, 6, 15).cells([[2, 9], [2, 12], [3, 10], [3, 11]], '1');
    G.carve(25, 8, 28, 13).cells([[27, 9], [27, 12], [26, 10], [26, 11]], '2');
    // A route: north roof, narrow bridge, billboard roof, stairs up to the helipad
    G.carve(3, 2, 6, 6).carve(7, 3, 11, 3).carve(12, 1, 17, 5).set(14, 1, '#').set(15, 1, '#');
    G.set(4, 3, 'c').set(13, 4, 'C').set(16, 2, 'c');
    G.carve(18, 2, 24, 7, 'p').site('A', 19, 2, 24, 7);
    G.set(18, 3, 's').set(18, 4, 's');
    G.set(21, 4, 'o').set(23, 6, 'w').set(19, 6, 'c');
    // Mid: skybridge on top, roofed interior corridor below it
    G.carve(7, 10, 15, 10);
    G.carve(7, 12, 15, 12).roof(7, 12, 15, 12, 3.2);
    G.carve(16, 7, 19, 13).set(17, 9, 'C').set(18, 12, 'c');
    G.set(18, 7, 's').set(19, 7, 'p');
    G.carve(19, 10, 25, 11);                     // defender link into mid roof
    // B route: south roof, bridge into the garden
    G.carve(3, 15, 6, 19).carve(6, 17, 13, 20).carve(14, 18, 16, 18);
    G.set(8, 18, 'c').set(11, 19, 'C').set(5, 17, 'c');
    G.carve(17, 14, 24, 20).site('B', 17, 15, 23, 20);
    G.carve(18, 13, 18, 14);                     // mid roof -> B
    G.set(19, 16, 'w').set(20, 16, 'w').set(21, 18, 'o').set(23, 19, 'c').set(18, 19, 'c');
    // Defender rotations
    G.carve(25, 4, 27, 8).set(25, 5, 's').set(25, 6, 's').set(25, 4, 'p');
    G.carve(25, 13, 27, 18).carve(24, 17, 25, 18);
    G.set(22, 10, 'C').set(16, 10, 'W').set(16, 12, 'W');
    G.carve(10, 17, 10, 18, '#').set(18, 15, 'W').set(19, 13, 'C');
    G.pk(10, 10).pk(9, 19);
  },

  // Desert canyon: A is temple ruins on a mesa, mid is a chasm with two bridges, B is a mining camp reached through a cave
  canyon(G) {
    G.carve(1, 7, 4, 14).cells([[2, 9], [2, 12], [3, 10], [3, 11]], '1');
    G.carve(25, 8, 28, 13).cells([[27, 9], [27, 12], [26, 10], [26, 11]], '2');
    // A: broad canyon floor, ramps up onto the mesa
    G.carve(1, 2, 3, 7).carve(1, 2, 16, 5);
    G.set(6, 3, 'C').set(10, 4, 'c').set(13, 2, 'C').set(15, 5, 'c');
    G.carve(18, 2, 24, 7, 'p').site('A', 18, 2, 24, 7);
    G.set(17, 4, 's').set(17, 5, 's');
    G.cells([[19, 3], [22, 3], [19, 6], [22, 6]], 'W').set(20, 4, 'o').set(23, 5, 'w');
    // Mid: dunes, a chasm with two bridges, a plateau on the far side
    G.carve(5, 8, 11, 13).set(7, 9, 'c').set(9, 12, 'C');
    G.carve(12, 8, 15, 13, 'x').carve(12, 9, 15, 9).carve(12, 12, 15, 12);
    G.carve(16, 8, 19, 13).set(18, 10, 'C');
    G.carve(16, 6, 17, 7).set(17, 6, 'p').set(17, 7, 's');   // plateau -> mesa ramp
    // Cave tunnel from mid to B (roofed)
    G.carve(5, 14, 15, 15).roof(6, 14, 14, 15, 3.4).carve(15, 15, 16, 16);
    // B main + mining camp
    G.carve(1, 14, 3, 19).carve(1, 17, 16, 19).set(8, 18, 'c').set(12, 17, 'c');
    G.carve(17, 15, 24, 20).site('B', 17, 15, 24, 20);
    G.set(19, 17, 'C').set(20, 17, 'o').set(22, 19, 'c').set(23, 16, 'C').set(18, 19, 'c');
    G.carve(19, 10, 25, 11);
    // Defender rotations
    G.carve(25, 4, 27, 8).set(25, 5, 's').set(25, 6, 's').set(25, 4, 'p');
    G.carve(25, 13, 27, 19).carve(24, 18, 25, 19);
    G.carve(9, 4, 9, 5, '#').set(10, 9, 'C').set(16, 8, 'W').set(9, 10, 'W');
    G.set(22, 11, 'C').set(16, 11, 'W').set(7, 13, 'C');
    G.set(10, 15, '#').set(19, 15, 'W');
    G.carve(6, 17, 6, 18, '#').set(14, 18, 'C').set(10, 19, 'C').set(21, 19, 'W');
    G.pk(6, 11).pk(17, 11);
  },

  // Docks: A is a cargo ship deck (gangways), mid is a container maze, B is a roofed warehouse with racks
  harbor(G) {
    G.carve(1, 7, 5, 14).cells([[2, 9], [2, 12], [3, 10], [3, 11]], '1');
    G.carve(25, 8, 28, 13).cells([[27, 9], [27, 12], [26, 10], [26, 11]], '2');
    // Water north of the dock, ship deck (raised) on the water
    G.carve(1, 1, 28, 2, 'x');
    G.carve(2, 3, 17, 6).set(6, 4, 'C').set(10, 5, 'c').set(13, 3, 'C').set(16, 6, 'c');
    G.carve(18, 2, 18, 6, 'x');
    G.carve(19, 1, 25, 6, 'p').site('A', 19, 2, 25, 6);
    G.set(18, 5, 's');                           // gangway from A main
    G.carve(19, 7, 25, 8).set(21, 7, 's').set(24, 7, 's');  // dock in front of the ship, two gangways
    G.set(22, 2, '#').set(23, 2, '#').set(20, 4, 'C').set(24, 5, 'c');
    G.carve(17, 7, 18, 8);
    // Mid container maze
    G.carve(6, 9, 17, 13);
    G.cells([[8, 9], [8, 10], [10, 12], [11, 12], [12, 10], [14, 9], [14, 13], [16, 11], [9, 13]], 'C');
    G.carve(16, 13, 17, 15);
    G.carve(18, 10, 25, 11).set(21, 11, 'c');
    // B warehouse (roofed) with racks
    G.carve(1, 14, 3, 18).carve(1, 16, 14, 18).set(7, 17, 'c').set(11, 16, 'C');
    G.carve(15, 15, 25, 20).site('B', 16, 16, 23, 19).roof(15, 15, 25, 20, 5.5);
    G.cells([[18, 17], [20, 17], [22, 17]], 'W').set(17, 19, 'C').set(21, 19, 'c').set(24, 16, 'c');
    // Defender rotations
    G.carve(26, 5, 27, 8).set(26, 6, 's').set(26, 5, 'p');
    G.carve(25, 13, 27, 17);
    G.carve(9, 5, 9, 6, '#');
    G.carve(7, 17, 7, 18, '#').set(19, 18, 'C').set(17, 11, 'W');
    G.pk(7, 11).pk(15, 10);
  },

  // Temple: A is a roofed throne hall with a dais, mid climbs a grand stair to an upper plaza, B is a fountain garden
  citadel(G) {
    G.carve(1, 7, 5, 14).cells([[2, 9], [2, 12], [3, 10], [3, 11]], '1');
    G.carve(25, 8, 28, 13).cells([[27, 9], [27, 12], [26, 10], [26, 11]], '2');
    // Cloister (colonnade, roofed) to A
    G.carve(1, 2, 3, 7).carve(1, 2, 17, 4).roof(4, 2, 16, 4, 4.2);
    for (let c = 5; c <= 15; c += 3) G.set(c, 2, 'W');
    G.set(8, 4, 'c').set(14, 4, 'c');
    G.carve(18, 2, 25, 8).site('A', 18, 2, 24, 8).roof(18, 2, 25, 8, 6.5);
    G.cells([[23, 3], [24, 3], [23, 4], [24, 4], [23, 5], [24, 5]], 'p').set(22, 4, 's');
    G.cells([[19, 3], [19, 7], [21, 3], [21, 7]], 'W').set(20, 5, 'C');
    // Mid: grand stair up to an upper plaza
    G.carve(6, 8, 17, 13);
    G.cells([[12, 9], [13, 9], [14, 9], [12, 10], [13, 10], [14, 10], [12, 11], [13, 11], [14, 11], [12, 12], [13, 12], [14, 12]], 'p');
    G.set(11, 10, 's').set(11, 11, 's').set(15, 10, 's');
    G.set(8, 9, 'c').set(9, 12, 'C').set(16, 12, 'c');
    G.carve(16, 6, 17, 8).carve(16, 13, 17, 16);
    G.carve(18, 10, 25, 11);
    // B garden
    G.carve(1, 14, 3, 18).carve(1, 16, 16, 18).set(6, 17, 'w').set(10, 16, 'c').set(13, 18, 'C');
    G.carve(17, 14, 24, 20).site('B', 17, 15, 24, 20);
    G.cells([[20, 17], [21, 17], [20, 18], [21, 18]], 'o');
    G.set(18, 16, 'w').set(23, 19, 'w').set(23, 15, 'c').set(18, 19, 'c');
    // Defender rotations
    G.carve(26, 4, 27, 8);
    G.carve(25, 13, 27, 18).carve(24, 17, 25, 18);
    G.carve(9, 3, 9, 4, '#').set(17, 8, 'W').set(7, 8, 'C').set(13, 13, 'C');
    G.carve(8, 17, 8, 18, '#').set(12, 16, 'C').set(22, 16, 'W').set(16, 14, '#');
    G.pk(8, 11).pk(16, 9);
  },

  // Practice range is hand-built in maps.js
};
