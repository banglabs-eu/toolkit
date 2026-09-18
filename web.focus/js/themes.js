/* Every scene the clock is drawn over, ported cell for cell from `focus`.
 *
 * A theme owns nothing but its own animation: draw() is handed a canvas and
 * the seconds since the page loaded, and paints whatever the block looks
 * like at that instant. The clock is composed on top afterwards.
 */

import { Theme, Sprite } from "./canvas.js";
import {
  AMBER, BOLD, DIM, GREEN, addDays, chance, choice, easterSunday, line, mirror,
  mod, randint, randrange, rgb, today, trunc, uniform, width,
} from "./util.js";
import { loadProfile } from "./store.js";

const TAU = Math.PI * 2;

/* --- aquarium --------------------------------------------------------------- */

export class Aquarium extends Theme {
  static themeName = "aquarium";
  static blurb = "fish, seaweed and a smoking volcano, with a crab or a squid "
    + "now and then and one blue whale a block";

  static SAND = rgb(125, 105, 75);
  static WEED = rgb(40, 150, 95);
  static BUBBLE = rgb(110, 165, 200);
  static CRAB = rgb(225, 95, 80);
  static SQUID = rgb(195, 130, 220);

  static FISH = [
    [["><>"], rgb(110, 200, 220)],
    [["><(((\u00b0>"], rgb(235, 145, 65)],
    [["  /\\", "><(((\u00b0>", "  \\/"], rgb(240, 200, 90)],
    [["><}}}*>"], rgb(205, 125, 205)],
    [["<>>><"], rgb(150, 180, 240)],
  ];
  static ROCK = rgb(92, 80, 86);
  static EMBER = rgb(200, 95, 55);
  static LAVA = rgb(252, 180, 70);
  static ASH = rgb(105, 105, 122);
  static WHALE_BLUE = rgb(80, 120, 205);

  static VOLCANO = ["  /\\_/\\", " /     \\", "/_______\\"];
  static WHALE = [
    "                     /\\",
    "  \\/   ____________/  \\___________",
    "   \\__/                           \\__",
    "   /        o                         >",
    "  /\\______________________________.--/",
  ];
  static CRAB_FRAMES = [["(\\/)o,,o(\\/)"], ["(/\\)o,,o(/\\)"]];
  static SQUID_FRAMES = [[" .--.", "(o  o)", " ;||;"], [" .--.", "(o  o)", " ;)(;"]];

  constructor() {
    super();
    this.fish = [];
    this.bubbles = [];
    this.visitor = null;
    this.weeds = [];
    this.weedCols = 0;
    this.nextFish = 0.0;
    this.nextBubble = 0.0;
    this.nextVisitor = 25.0;
    this.cone = null;
    this.vent = [];
    this.nextPuff = 0.0;
    this.nextEruption = 0.0;
    this.erupting = 0.0;
    this.whale = null;
    this.whaleAt = null;
    this.started = null;
  }

  // --- the tank itself ---

  /** Seaweed stays where it grew, so it is only re-sown on a resize. */
  plant(cols, floor) {
    if (cols === this.weedCols) return;
    this.weedCols = cols;
    this.cone = cols >= 26 ? choice([Math.floor(cols / 7), cols - Math.floor(cols / 4)]) : null;
    this.weeds = [];
    for (let x = 1; x < cols - 1; x += 5) {
      if (this.cone !== null && this.cone - 2 <= x && x <= this.cone + 10) continue;
      if (chance(0.55)) {
        this.weeds.push([x + randint(0, 3),
                         randint(3, Math.max(4, Math.min(9, floor - 4))),
                         uniform(0, 6.3), uniform(0.6, 1.4)]);
      }
    }
  }

  /** A sparse, stable scatter of sand — the crab needs something to walk on. */
  floorSand(canvas, floor) {
    let sand = "";
    for (let x = 0; x < canvas.cols; x++) {
      sand += (x * 7) % 13 === 0 ? "." : ((x * 5) % 17 === 0 ? "," : " ");
    }
    canvas.put(0, floor, sand, Aquarium.SAND);
  }

  seaweed(canvas, now, floor) {
    for (const [x, height, phase, speed] of this.weeds) {
      for (let i = 0; i < height; i++) {
        const lean = Math.sin(now * speed + phase + i * 0.55);
        canvas.put(x + (lean > 0.6 ? 1 : 0), floor - 1 - i,
                   lean > 0 ? ")" : "(", Aquarium.WEED);
      }
    }
  }

  // --- what lives in it ---

  spawnFish(cols, rows, anywhere = false) {
    let [art, tint] = choice(Aquarium.FISH);
    const height = art.length;
    if (rows - 3 <= 1) return;
    const y = randint(1, Math.max(1, rows - 3 - height));
    const speed = height > 1 ? uniform(2.5, 4.0) : uniform(3.0, 7.5);
    const span = Math.max(...art.map(width));
    if (chance(0.5)) {
      const x = anywhere ? uniform(0, cols) : -span - 1;
      this.fish.push(new Sprite(art, tint, x, y, speed));
    } else {
      art = mirror(art);
      const x = anywhere ? uniform(0, cols) : cols + 1;
      this.fish.push(new Sprite(art, tint, x, y, -speed));
    }
  }

  swim(canvas, dt, now, cols, rows) {
    if (now >= this.nextFish && this.fish.length < 7) {
      this.spawnFish(cols, rows);
      this.nextFish = now + uniform(2.5, 7.0);
    }
    for (const fish of [...this.fish]) {
      fish.move(dt);
      if ((fish.vx > 0 && fish.x > cols) || (fish.vx < 0 && fish.x + fish.width < 0)) {
        this.fish.splice(this.fish.indexOf(fish), 1);
        continue;
      }
      canvas.sprite(fish.x, fish.y, fish.art, fish.tint);
    }
  }

  blow(canvas, dt, now, cols, rows) {
    if (now >= this.nextBubble && this.bubbles.length < 14) {
      this.bubbles.push(new Sprite(["."], Aquarium.BUBBLE,
                                   randint(1, Math.max(1, cols - 2)), rows - 2,
                                   uniform(-0.6, 0.6), -uniform(2.5, 5.0)));
      this.nextBubble = now + uniform(0.4, 1.6);
    }
    for (const bubble of [...this.bubbles]) {
      bubble.move(dt);
      if (bubble.y < 0) {
        this.bubbles.splice(this.bubbles.indexOf(bubble), 1);
        continue;
      }
      canvas.put(bubble.x, bubble.y, "oO."[mod(trunc(bubble.y), 3)], bubble.tint);
    }
  }

  /** A crab along the floor or a squid rising through the tank, rarely. */
  guest(canvas, dt, now, cols, rows) {
    if (this.visitor === null) {
      if (now < this.nextVisitor) return;
      if (chance(0.6)) {
        const speed = uniform(1.2, 2.2);
        const art = Aquarium.CRAB_FRAMES[0];
        this.visitor = chance(0.5)
          ? new Sprite(art, Aquarium.CRAB, -12, rows - 1, speed, 0.0, "crab")
          : new Sprite(art, Aquarium.CRAB, cols, rows - 1, -speed, 0.0, "crab");
      } else {
        this.visitor = new Sprite(Aquarium.SQUID_FRAMES[0], Aquarium.SQUID,
                                  randint(2, Math.max(2, cols - 8)), rows - 3,
                                  uniform(-0.8, 0.8), -uniform(1.1, 1.8), "squid");
      }
      this.visitor.born = now;
    }

    const guest = this.visitor;
    guest.move(dt);
    let gone;
    if (guest.kind === "crab") {
      guest.art = Aquarium.CRAB_FRAMES[mod(trunc(now * 3), 2)];
      canvas.sprite(guest.x, rows - 1 - (guest.art.length - 1), guest.art, guest.tint);
      gone = guest.vx > 0 ? guest.x > cols : guest.x + guest.width < 0;
    } else {
      guest.art = Aquarium.SQUID_FRAMES[mod(trunc(now * 2.5), 2)];
      canvas.sprite(guest.x, guest.y, guest.art, guest.tint);
      gone = guest.y + guest.art.length < 0;
    }
    if (gone) {
      this.visitor = null;
      this.nextVisitor = now + uniform(45.0, 100.0);
    }
  }

  /** It smokes all block, and lets go properly every couple of minutes. */
  volcano(canvas, dt, now, rows) {
    if (this.cone === null) return;
    const x = this.cone, floor = rows - 1;
    if (now >= this.nextEruption) {
      this.erupting = now + uniform(4.0, 8.0);
      this.nextEruption = this.erupting + uniform(70.0, 150.0);
    }
    const blowing = now < this.erupting;

    if (now >= this.nextPuff) {
      const hot = blowing && chance(0.8);
      const mote = new Sprite(["*"], Aquarium.LAVA, x + 4, floor - 3, uniform(-0.7, 0.7),
                              hot ? -uniform(4.0, 7.0) : -uniform(1.4, 2.6),
                              hot ? "lava" : "ash");
      mote.born = now;
      this.vent.push(mote);
      this.nextPuff = now + (blowing ? uniform(0.03, 0.1) : uniform(0.5, 1.5));
    }
    for (const mote of [...this.vent]) {
      mote.move(dt);
      const age = now - mote.born;
      if (mote.y < 0 || age > 14.0) {
        this.vent.splice(this.vent.indexOf(mote), 1);
        continue;
      }
      let char, tint;
      if (mote.kind === "lava" && age < 0.7) {      // thrown out glowing, then cooling
        char = "*"; tint = Aquarium.LAVA;
      } else if (mote.kind === "lava" && age < 1.8) {
        char = "o"; tint = Aquarium.EMBER;
      } else {
        char = age > 4.0 ? "." : "\u00b0"; tint = Aquarium.ASH;
      }
      canvas.put(mote.x, mote.y, char, tint);
    }

    canvas.sprite(x, floor - 2, Aquarium.VOLCANO, Aquarium.ROCK, true);
    canvas.put(x + 4, floor - 2, blowing ? "^" : "_",
               blowing ? Aquarium.LAVA
                 : (Math.sin(now * 2.2) > 0 ? Aquarium.EMBER : Aquarium.ROCK));
  }

  /** One crossing per block, somewhere in the middle of it. */
  cross(canvas, dt, now, cols, rows) {
    if (this.whale === null) {
      if (this.whaleAt === null || now < this.whaleAt || cols < 30 || rows < 10) return;
      this.whaleAt = null;                          // and never a second time
      const heading = choice([-1, 1]);
      const art = heading > 0 ? Aquarium.WHALE : mirror(Aquarium.WHALE);
      const span = Math.max(...art.map(width));
      this.whale = new Sprite(art, Aquarium.WHALE_BLUE,
                              heading > 0 ? -span - 2 : cols + 2,
                              randint(1, Math.max(1, rows - art.length - 3)),
                              heading * uniform(2.5, 4.0));
      this.whale.born = now;
    }

    const whale = this.whale;
    whale.move(dt);
    if ((whale.vx > 0 && whale.x > cols + 2) || (whale.vx < 0 && whale.x + whale.width < 0)) {
      this.whale = null;
      return;
    }
    canvas.sprite(whale.x, whale.y, whale.art, whale.tint);
    if (chance(0.15)) {                             // a breath from the blowhole
      const blow = whale.x + (whale.vx > 0 ? 21 : whale.width - 22);
      this.bubbles.push(new Sprite(["."], Aquarium.BUBBLE, blow, whale.y,
                                   uniform(-0.3, 0.3), -uniform(2.0, 3.5)));
    }
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    if (this.started === null) {
      this.started = now;
      this.nextVisitor = now + uniform(20.0, 50.0);
      this.nextEruption = now + uniform(15.0, 60.0);
      const span = Math.max(20.0, this.total);
      this.whaleAt = now + (span < 60.0 ? uniform(5.0, 20.0) : uniform(0.15, 0.7) * span);
      for (let i = 0; i < 4; i++) this.spawnFish(canvas.cols, canvas.rows, true);
    }
    const cols = canvas.cols, rows = canvas.rows, floor = canvas.rows - 1;
    this.plant(cols, floor);
    this.floorSand(canvas, floor);
    this.seaweed(canvas, now, floor);
    this.blow(canvas, dt, now, cols, rows);
    this.swim(canvas, dt, now, cols, rows);
    this.guest(canvas, dt, now, cols, rows);
    this.cross(canvas, dt, now, cols, rows);
    this.volcano(canvas, dt, now, rows);
  }
}

/* --- airport ---------------------------------------------------------------- */

export class Airport extends Theme {
  static themeName = "airport";
  static blurb = "a terminal below, departures, arrivals and helicopters over it";

  static GROUND = rgb(110, 120, 140);
  static TARMAC = rgb(80, 88, 105);
  static GLASS = rgb(150, 190, 220);
  static PLANE = rgb(220, 225, 235);
  static TAIL = rgb(99, 102, 241);
  static CLOUD = rgb(140, 155, 180);
  static TUG = rgb(210, 200, 120);

  static JET = ["      |\\", "  ____|_\\____", "  \\___o____o__>"];
  static PROP = ["   |\\", " __|_\\__", " \\__o___>"];
  static HELI = ["  --o--", "+=[___]>", "   ^ ^"];
  static ROTOR = ["  --o--", "  -=o=-"];
  static TUG_ART = ["[oo]="];

  constructor() {
    super();
    this.traffic = [];
    this.clouds = [];
    this.nextMovement = 0.0;
    this.nextTug = 30.0;
    this.nextCloud = 0.0;
    this.started = null;
  }

  // --- the field ---

  field(canvas, now) {
    const cols = canvas.cols, rows = canvas.rows;
    const runway = rows - 1, apron = rows - 2;

    canvas.put(0, runway, "\u2501".repeat(cols), Airport.TARMAC);
    for (let x = 3; x < cols; x += 9) {              // edge lights, blinking
      const lit = mod(trunc(now * 1.5) + Math.floor(x / 9), 4) !== 0;
      canvas.put(x, runway, lit ? "\u2579" : "\u2577", lit ? AMBER : Airport.TARMAC);
    }

    const span = Math.max(16, Math.min(34, Math.floor(cols / 3)));
    if (cols < 26 || rows < 12) return;
    const top = apron - 3;
    canvas.put(1, top, "\u256d" + "\u2500".repeat(span - 2) + "\u256e", Airport.GROUND);
    let windows = "";
    for (let i = 0; i < Math.floor((span - 4) / 2); i++) windows += i % 2 === 0 ? "\u25ab " : "  ";
    canvas.put(1, top + 1, "\u2502 ", Airport.GROUND);
    canvas.put(3, top + 1, windows.slice(0, span - 4), Airport.GLASS);
    canvas.put(span - 1, top + 1, "\u2502", Airport.GROUND);
    canvas.put(1, top + 2, "\u2570" + "\u2500".repeat(span - 2) + "\u256f", Airport.GROUND);

    const tower = span + 4;
    if (tower + 4 < cols && rows >= 16) {   // a short terminal has no room for it
      const beacon = mod(trunc(now * 1.2), 2);
      canvas.put(tower + 1, top - 3, "\u2022", beacon ? GREEN : AMBER);
      canvas.put(tower, top - 2, "\u256d\u2500\u256e", Airport.GROUND);
      canvas.put(tower, top - 1, "\u2502\u25ab\u2502", Airport.GLASS);
      canvas.put(tower, top, "\u2570\u252c\u256f", Airport.GROUND);
      for (let y = top + 1; y <= apron; y++) canvas.put(tower + 1, y, "\u2502", Airport.GROUND);
    }
  }

  // --- the traffic ---

  /** In from one side, down onto the apron, a pause, then up and away. */
  helicopter(cols, rows) {
    const flip = chance(0.5);
    const art = flip ? mirror(Airport.HELI) : Airport.HELI;
    const speed = uniform(5.0, 8.0);
    const heli = new Sprite(art, Airport.PLANE, flip ? cols + 2 : -10,
                            randint(2, Math.max(2, Math.floor(rows / 3))),
                            flip ? -speed : speed, 0.0, "helicopter", flip);
    heli.phase = "inbound";
    heli.timer = cols * uniform(0.5, 0.75);          // where the pad is
    return heli;
  }

  /** A departure rolling out and climbing, or an arrival coming down. */
  movement(cols, rows) {
    if (chance(0.3)) return this.helicopter(cols, rows);
    const art = chance(0.7) ? Airport.JET : Airport.PROP;
    const ground = rows - 1 - art.length;
    if (chance(0.5)) {
      const span = Math.max(...art.map(width));
      return new Sprite(art, Airport.PLANE, -span - 2, ground,
                        uniform(7.0, 10.0), 0.0, "departure");
    }
    const speed = uniform(9.0, 13.0);
    const plane = new Sprite(mirror(art), Airport.PLANE, cols + 2, 1, -speed, 0.0, "arrival");
    // Descend so the wheels meet the tarmac about two thirds of the way across.
    plane.vy = (ground - 1) / ((cols * 0.66) / speed);
    return plane;
  }

  fly(canvas, dt, now, cols, rows) {
    if (now >= this.nextMovement && this.traffic.length < 3) {
      this.traffic.push(this.movement(cols, rows));
      this.nextMovement = now + uniform(7.0, 16.0);
    }
    if (now >= this.nextTug) {                       // something on the apron
      const heading = choice([-1, 1]);
      const art = heading > 0 ? Airport.TUG_ART : mirror(Airport.TUG_ART);
      this.traffic.push(new Sprite(art, Airport.TUG, heading > 0 ? -6 : cols + 2,
                                   rows - 2, heading * uniform(3.0, 5.0), 0.0, "tug"));
      this.nextTug = now + uniform(25.0, 60.0);
    }

    for (const plane of [...this.traffic]) {
      plane.move(dt);
      const wheels = rows - 1 - plane.art.length;
      if (plane.kind === "departure") {
        plane.vx = Math.min(plane.vx + 4.0 * dt, 18.0);
        if (plane.x > cols * 0.4) plane.vy = -3.0;   // rotate, then climb away
      } else if (plane.kind === "arrival") {
        if (plane.y >= wheels) {                     // touchdown, then roll out
          plane.y = wheels;
          plane.vy = 0.0;
          plane.vx = Math.min(plane.vx + 6.0 * dt, -3.0);
        }
      } else if (plane.kind === "helicopter") {
        const frame = Airport.ROTOR[mod(trunc(now * 9), 2)];
        plane.art = [plane.flip ? mirror([frame])[0] : frame, ...plane.art.slice(1)];
        if (plane.phase === "inbound" && Math.abs(plane.x - plane.timer) < 2.5) {
          plane.vx = 0.0; plane.vy = 2.6; plane.phase = "descending";
        } else if (plane.phase === "descending" && plane.y >= wheels) {
          plane.y = wheels; plane.vy = 0.0;
          plane.phase = "parked"; plane.timer = now + uniform(4.0, 9.0);
        } else if (plane.phase === "parked" && now >= plane.timer) {
          plane.vy = -2.2; plane.phase = "lifting";
        } else if (plane.phase === "lifting" && plane.y <= 2) {
          plane.vy = 0.0;
          plane.vx = plane.flip ? -6.0 : 6.0;
          plane.phase = "outbound";
        }
      }

      const goneRight = plane.vx > 0 && plane.x > cols + 2;
      const goneLeft = plane.vx < 0 && plane.x + plane.width < 0;
      if (goneRight || goneLeft || plane.y + plane.art.length < 0) {
        this.traffic.splice(this.traffic.indexOf(plane), 1);
        continue;
      }

      // The top line of a plane is its tail fin, and wears the tail colour.
      if (plane.kind === "helicopter") {
        canvas.sprite(plane.x, plane.y, plane.art, plane.tint);
      } else if (plane.art.length > 1) {
        canvas.put(plane.x, plane.y, plane.art[0], Airport.TAIL);
        canvas.sprite(plane.x, plane.y + 1, plane.art.slice(1), plane.tint);
      } else {
        canvas.sprite(plane.x, plane.y, plane.art, plane.tint);
      }
    }
  }

  weather(canvas, dt, now, cols, rows) {
    if (now >= this.nextCloud && this.clouds.length < 3) {
      this.clouds.push(new Sprite([" .--.", "(    )"], Airport.CLOUD,
                                  -7, randint(0, Math.max(0, Math.floor(rows / 3))),
                                  uniform(0.5, 1.3)));
      this.nextCloud = now + uniform(18.0, 40.0);
    }
    for (const cloud of [...this.clouds]) {
      cloud.move(dt);
      if (cloud.x > cols) {
        this.clouds.splice(this.clouds.indexOf(cloud), 1);
        continue;
      }
      canvas.sprite(cloud.x, cloud.y, cloud.art, cloud.tint);
    }
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (this.started === null) {
      this.started = now;
      this.nextMovement = now + 1.0;
      this.nextTug = now + uniform(15.0, 40.0);
      for (let i = 0; i < 2; i++) {
        this.clouds.push(new Sprite([" .--.", "(    )"], Airport.CLOUD,
                                    randint(0, cols), randint(0, Math.floor(rows / 3)),
                                    uniform(0.5, 1.3)));
      }
      this.nextCloud = now + uniform(15.0, 30.0);
    }
    this.weather(canvas, dt, now, cols, rows);
    this.field(canvas, now);
    this.fly(canvas, dt, now, cols, rows);
  }
}

/* --- space ------------------------------------------------------------------ */

export class Space extends Theme {
  static themeName = "space";
  static blurb = "a twinkling starfield, a ringed planet, rockets and comets";

  static FAR = rgb(120, 128, 155);
  static NEAR = rgb(215, 220, 240);
  static PLANET = rgb(205, 145, 95);
  static HULL = rgb(225, 228, 238);
  static PANEL = rgb(120, 150, 210);
  static COMET = rgb(165, 215, 255);
  static FLAME = rgb(250, 160, 60);

  static PLANET_ART = ["    .--.", " -=(    )=-", "    '--'"];
  static ROCKET = [" /|", "(====>", " \\|"];
  static SATELLITE = ["[#]-o-[#]"];
  static COMET_ART = [".\u00b7-=o"];

  constructor() {
    super();
    this.stars = [];
    this.sky = [0, 0];
    this.craft = [];
    this.nextCraft = 0.0;
    this.started = null;
  }

  starfield(canvas, now) {
    const cols = canvas.cols, rows = canvas.rows;
    if (cols !== this.sky[0] || rows !== this.sky[1]) {   // stars keep their places
      this.sky = [cols, rows];
      this.stars = [];
      for (let i = 0; i < Math.floor((cols * rows) / 22); i++) {
        this.stars.push([randrange(cols), randrange(rows), uniform(0, 6.3), Math.random()]);
      }
    }
    for (const [x, y, phase, size] of this.stars) {
      const twinkle = Math.sin(now * 1.6 + phase);
      let char, tint;
      if (size > 0.93) { char = twinkle > 0 ? "+" : "*"; tint = Space.NEAR; }
      else if (size > 0.6) { char = twinkle > -0.4 ? "\u00b7" : "*"; tint = Space.NEAR; }
      else { char = "."; tint = Space.FAR; }
      canvas.put(x, y, char, tint);
    }
  }

  launch(cols, rows) {
    const kind = Math.random();
    const y = randint(1, Math.max(1, rows - 4));
    let craft;
    if (kind < 0.45) {
      craft = new Sprite(Space.ROCKET, Space.HULL, -8, y, uniform(6.0, 11.0),
                         -uniform(0.0, 0.5), "rocket");
    } else if (kind < 0.8) {
      craft = new Sprite(Space.SATELLITE, Space.PANEL, -10, y, uniform(1.5, 3.0),
                         0.0, "satellite");
    } else {
      craft = new Sprite(Space.COMET_ART, Space.COMET, cols + 4,
                         randint(0, Math.floor(rows / 2)),
                         -uniform(22.0, 34.0), uniform(1.5, 3.0), "comet");
    }
    if (craft.vx > 0 && chance(0.5)) {              // half of them fly the other way
      craft.art = mirror(craft.art);
      craft.x = cols + 4;
      craft.vx = -craft.vx;
    }
    return craft;
  }

  traffic(canvas, dt, now, cols, rows) {
    if (now >= this.nextCraft && this.craft.length < 2) {
      this.craft.push(this.launch(cols, rows));
      this.nextCraft = now + uniform(11.0, 26.0);
    }
    for (const craft of this.craft) {
      if (craft.kind === "rocket") {                // exhaust, trailing the fins
        const tail = craft.vx > 0 ? craft.x - 2 : craft.x + craft.width;
        canvas.put(tail, craft.y + 1, "\u2248~-"[mod(trunc(now * 12), 3)].repeat(2), Space.FLAME);
      } else if (craft.kind === "satellite") {
        canvas.put(craft.x + 4, craft.y - 1, mod(trunc(now * 2), 2) ? "\u2022" : " ", GREEN);
      }
    }
    this.advance(canvas, this.craft, dt, cols, rows);
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (this.started === null) {
      this.started = now;
      this.nextCraft = now + uniform(2.0, 8.0);
    }
    this.starfield(canvas, now);
    if (cols > 40 && rows > 10) {
      canvas.sprite(cols - 14, 1, Space.PLANET_ART, Space.PLANET, true);
    }
    this.traffic(canvas, dt, now, cols, rows);
  }
}

/* --- galaxy ----------------------------------------------------------------- */

export class Galaxy extends Theme {
  static themeName = "galaxy";
  static blurb = "a spiral galaxy turning slowly, arms of stars around a bright core";

  static CORE = rgb(255, 246, 215);
  static INNER = rgb(232, 200, 255);
  static ARM = rgb(150, 170, 245);
  static OUTER = rgb(96, 110, 180);
  static FIELD = rgb(115, 122, 150);

  constructor() {
    super();
    this.stars = [];
    this.jitter = [];
    this.size = [0, 0];
  }

  seed(cols, rows) {
    this.size = [cols, rows];
    this.stars = [];
    for (let i = 0; i < Math.floor((cols * rows) / 40); i++) {
      this.stars.push([randrange(cols), randrange(rows), uniform(0, 6.3)]);
    }
    this.jitter = [];
    for (let i = 0; i < 600; i++) this.jitter.push([uniform(-1.2, 1.2), uniform(-0.6, 0.6)]);
  }

  draw(canvas, now) {
    this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (cols !== this.size[0] || rows !== this.size[1]) this.seed(cols, rows);

    for (const [x, y, phase] of this.stars) {       // the field it sits in
      canvas.put(x, y, Math.sin(now * 1.3 + phase) < 0.7 ? "." : "\u00b7", Galaxy.FIELD);
    }

    const cx = cols * 0.71, cy = rows * 0.32;
    const reach = Math.min(cols / 3.1, rows / 1.55);
    const spin = now * 0.07;
    let index = 0;
    for (let arm = 0; arm < 2; arm++) {
      let radius = 0.6;
      while (radius < reach) {
        const angle = spin + arm * Math.PI + radius * 0.62;
        const wobble = this.jitter[index % this.jitter.length];
        index++;
        const x = cx + Math.cos(angle) * radius * 2.05 + wobble[0];
        const y = cy + Math.sin(angle) * radius + wobble[1];
        const near = radius / reach;
        canvas.put(x, y, near < 0.35 ? "*" : near < 0.7 ? "\u00b7" : ".",
                   near < 0.3 ? Galaxy.INNER : near < 0.72 ? Galaxy.ARM : Galaxy.OUTER);
        radius += 0.12;
      }
    }

    canvas.sprite(trunc(cx) - 2, trunc(cy) - 1,                      // the core
                  [" \u00b7*\u00b7 ", "*(@)*", " \u00b7*\u00b7 "], Galaxy.CORE, true);
  }
}

/* --- desert ----------------------------------------------------------------- */

export class Desert extends Theme {
  static themeName = "desert";
  static blurb = "dunes under a blazing sun, an oasis, and camel caravans crossing";

  static SAND = rgb(226, 196, 132);
  static SHADE = rgb(190, 156, 100);
  static DEEP = rgb(158, 124, 78);
  static SUN = rgb(255, 214, 92);
  static HAZE = rgb(228, 202, 158);
  static CAMEL = rgb(184, 132, 78);
  static RIDER = rgb(88, 84, 118);
  static PALM = rgb(92, 160, 82);
  static TRUNK = rgb(142, 106, 66);
  static WATER = rgb(95, 175, 205);
  static VULTURE = rgb(74, 68, 74);

  static CAMEL_ART = [
    "          _,",
    "   /\\_/\\ / o\\",
    "  /       \\__/",
    "  |  |  |  |",
  ];
  static LEGS = ["  |  |  |  |", "  /  |  |  \\"];
  static RIDER_ART = [" o ", "/|\\"];
  static PALM_ART = [" \\\\|//", "  \\|/", "   |", "   |"];
  static SUN_ART = [" \\ | /", "-- O --", " / | \\"];
  static WINGS = [["~^~"], ["~v~"]];

  constructor() {
    super();
    this.dunes = [];
    this.shaped = 0;
    this.oasis = null;
    this.caravan = [];
    this.grains = [];
    this.nextCaravan = 0.0;
    this.started = null;
  }

  /** The dune profile is fixed for a width, so the sand stays put. */
  shape(cols, rows) {
    if (cols === this.shaped) return;
    this.shaped = cols;
    const crest = Math.max(2, Math.min(4, Math.floor(rows / 7)));
    this.dunes = [];
    for (let x = 0; x < cols; x++) {
      this.dunes.push(1 + trunc(crest + Math.sin(x * 0.07) * 1.7
                                + Math.sin(x * 0.17 + 2.0) * 1.0));
    }
    this.oasis = cols >= 40 ? randint(4, Math.max(5, cols - 18)) : null;
    this.grains = [];
    for (let i = 0; i < 9; i++) {
      this.grains.push([uniform(0, cols), uniform(rows - 9, rows - 5), uniform(5.0, 13.0)]);
    }
  }

  /** The sand under a footprint — the highest of it, so nothing sinks in. */
  height(x, cols, span = 1) {
    if (!this.dunes.length) return 2;
    const left = Math.min(Math.max(trunc(x), 0), cols - 1);
    const right = Math.min(Math.max(trunc(x + span), 0), cols - 1);
    const slice = this.dunes.slice(Math.min(left, right), Math.max(left, right) + 1);
    return slice.length ? Math.max(...slice) : 2;
  }

  sand(canvas, dt, now, cols, rows) {
    const floor = rows - 1;
    for (let x = 0; x < Math.min(this.dunes.length, cols); x++) {
      const height = this.dunes[x];
      const top = floor - height + 1;
      canvas.put(x, top, "\u2592", Desert.SAND);
      for (let y = top + 1; y <= floor; y++) {
        canvas.put(x, y, "\u2591", y < floor - 1 ? Desert.SHADE : Desert.DEEP);
      }
      if (Math.sin(now * 3.0 + x * 0.35) > 0.85) {   // heat coming off the crest
        canvas.put(x, top - 1, "~", Desert.HAZE);
      }
    }
    for (const grain of this.grains) {               // wind off the dunes
      grain[0] += grain[2] * dt;
      if (grain[0] > cols) {
        grain[0] = -1.0;
        grain[1] = uniform(rows - 9, rows - 5);
      }
      canvas.put(grain[0], grain[1], ".", Desert.HAZE);
    }
  }

  oasisPool(canvas, now, cols, rows) {
    if (this.oasis === null) return;
    const x = this.oasis;
    const base = rows - this.height(x, cols);
    canvas.sprite(x, base - Desert.PALM_ART.length, Desert.PALM_ART, Desert.PALM);
    canvas.put(x + 3, base - 1, "|", Desert.TRUNK);
    canvas.sprite(x + 7, base - 3, [" \\|/", "  |", "  |"], Desert.PALM);
    canvas.put(x + 2, base, "~\u2248~~\u2248~", Desert.WATER);
  }

  caravanCross(canvas, dt, now, cols, rows) {
    if (!this.caravan.length && now >= this.nextCaravan) {
      const heading = choice([-1, 1]);
      const speed = heading * uniform(1.8, 3.0);
      const art = heading > 0 ? Desert.CAMEL_ART : mirror(Desert.CAMEL_ART);
      const span = Math.max(...art.map(width));
      const beasts = randint(2, 4);
      for (let i = 0; i < beasts; i++) {             // roped nose to tail
        const start = heading > 0
          ? -span - 2 - i * randint(18, 24)
          : cols + 2 + i * randint(18, 24);
        const camel = new Sprite([...art], Desert.CAMEL, start, 0, speed, 0.0,
                                 "camel", heading < 0);
        camel.born = i === 0 ? 1.0 : 0.0;            // the leader carries a rider
        this.caravan.push(camel);
      }
      this.nextCaravan = now + uniform(35.0, 70.0);
    }

    for (const camel of [...this.caravan]) {
      camel.move(dt);
      if ((camel.vx > 0 && camel.x > cols + 2) || (camel.vx < 0 && camel.x + camel.width < 0)) {
        this.caravan.splice(this.caravan.indexOf(camel), 1);
        continue;
      }
      const legs = Desert.LEGS[mod(trunc(now * 3.5 + camel.x * 0.1), 2)];
      camel.art[3] = camel.flip ? mirror([legs])[0] : legs;
      const top = rows - this.height(camel.x, cols, camel.width) - camel.art.length;
      canvas.sprite(camel.x, top, camel.art, camel.tint);
      if (camel.born) {
        canvas.sprite(camel.x + (!camel.flip ? 3 : camel.width - 6),
                      top - 1, Desert.RIDER_ART, Desert.RIDER);
      }
    }
    if (this.caravan.length) this.nextCaravan = Math.max(this.nextCaravan, now + 20.0);
  }

  vulture(canvas, now, cols, rows) {
    const turn = now * 0.35;
    const x = cols * 0.5 + Math.cos(turn) * cols * 0.3;
    const y = Math.max(0, rows * 0.16) + Math.sin(turn) * 2.0;
    canvas.sprite(x, y, Desert.WINGS[mod(trunc(now * 4), 2)], Desert.VULTURE);
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (this.started === null) {
      this.started = now;
      this.nextCaravan = now + uniform(4.0, 14.0);
    }
    this.shape(cols, rows);
    if (cols > 30) canvas.sprite(cols - 9, 0, Desert.SUN_ART, Desert.SUN);
    this.sand(canvas, dt, now, cols, rows);
    this.oasisPool(canvas, now, cols, rows);
    this.vulture(canvas, now, cols, rows);
    this.caravanCross(canvas, dt, now, cols, rows);
  }
}

/* --- farm ------------------------------------------------------------------- */

export class Farm extends Theme {
  static themeName = "farm";
  static blurb = "barn, silo and turning windmill, hens in the yard, a tractor going by";

  static SUN = rgb(250, 205, 90);
  static CLOUD = rgb(205, 210, 220);
  static BARN = rgb(190, 75, 60);
  static ROOF = rgb(140, 55, 45);
  static SILO = rgb(175, 180, 190);
  static TIMBER = rgb(165, 135, 100);
  static GRASS = rgb(120, 175, 85);
  static WHEAT = rgb(220, 190, 105);
  static HEN = rgb(240, 238, 228);
  static COMB = rgb(220, 80, 70);
  static COW = rgb(235, 235, 235);
  static TRACTOR = rgb(95, 155, 75);
  static SMOKE = rgb(150, 150, 160);

  static BARN_ART = ["   _____", "  /     \\", " /_______\\", " |  ___  |", " |_|___|_|"];
  static SILO_ART = [" ___ ", "(   )", "|   |", "|   |", "|___|"];
  static BLADES = [[" \\ /", "  o  ", " / \\"], ["  |  ", " -o- ", "  |  "]];
  static HEN_ART = [[" ,", "(\u00b0>", " ^"], [" ,", "(\u00b0_", " ^"]];
  static COW_ART = ["  ^__^", " (oo)\\___", " (__)   )"];
  static TRACTOR_ART = ["   __", "  |__|_", " (O)_(o)"];
  static BIRD = [["~^~"], ["~v~"]];

  constructor() {
    super();
    this.crop = [];
    this.sown = 0;
    this.fence = [1, 10];
    this.hens = [];
    this.sky = [];
    this.yard = [];
    this.nextTractor = 0.0;
    this.nextBird = 0.0;
    this.cowX = 0;
    this.started = null;
  }

  sow(cols, rows) {
    if (cols === this.sown) return;
    this.sown = cols;
    this.crop = [];
    for (let x = 0; x < cols; x += 2) {
      if (chance(0.8)) this.crop.push([x, uniform(0, 6.3)]);
    }
    this.cowX = randint(Math.floor(cols / 2), Math.max(Math.floor(cols / 2), cols - 12));
    // The yard is the open ground between the silo and the windmill.
    this.fence = cols >= 34 ? [20, Math.max(24, cols - 11)] : [1, Math.max(4, cols - 5)];
    this.hens = [];
    for (let i = 0; i < 3; i++) {
      this.hens.push(new Sprite(Farm.HEN_ART[0], Farm.HEN,
                                randint(this.fence[0], this.fence[1]), rows - 5,
                                choice([-1, 1]) * uniform(1.0, 2.2), 0.0, "hen"));
    }
  }

  field(canvas, now, cols, rows) {
    for (const [x, phase] of this.crop) {            // wheat, leaning in the wind
      const lean = Math.sin(now * 1.1 + phase + x * 0.12);
      canvas.put(x, rows - 2, lean > 0 ? "*" : "v", Farm.WHEAT);
      canvas.put(x, rows - 1, "|", lean > 0.7 ? Farm.WHEAT : Farm.GRASS);
    }
  }

  buildings(canvas, now, cols, rows) {
    const base = rows - 3;                           // everything stands on the yard
    if (rows < 12 || cols < 34) return;
    const top = base - Farm.BARN_ART.length + 1;
    canvas.sprite(2, top, Farm.BARN_ART.slice(0, 3), Farm.ROOF, true);
    canvas.sprite(2, top + 3, Farm.BARN_ART.slice(3), Farm.BARN, true);
    canvas.sprite(13, base - Farm.SILO_ART.length + 1, Farm.SILO_ART, Farm.SILO, true);

    const mill = cols - 9;
    canvas.sprite(mill, base - 5, Farm.BLADES[mod(trunc(now * 5), 2)], Farm.TIMBER);
    for (let y = base - 2; y <= base; y++) canvas.put(mill + 2, y, "\u2551", Farm.TIMBER);
    canvas.put(mill + 1, base, "\u2571\u2572", Farm.TIMBER);

    let post = this.fence[0];
    while (post < mill - 2) {                        // a rail between yard and field
      canvas.put(post, base, "\u2500\u253c\u2500\u2500", Farm.TIMBER);
      post += 4;
    }
  }

  stock(canvas, dt, now, cols, rows) {
    canvas.sprite(this.cowX, rows - 5, Farm.COW_ART, Farm.COW, true);
    canvas.put(this.cowX - 1, rows - 4, mod(trunc(now * 1.5), 2) ? "\\" : "/", Farm.COW);

    for (const hen of this.hens) {
      hen.move(dt);
      const [left, right] = this.fence;
      if (hen.x < left || hen.x > right) {           // turn round at the yard edge
        hen.vx = -hen.vx;
        hen.art = mirror(hen.art);
        hen.x = Math.min(Math.max(hen.x, left), right);
      }
      const pecking = Math.sin(now * 2.0 + hen.y + hen.x * 0.1) > 0.75;
      let art = Farm.HEN_ART[pecking ? 1 : 0];
      if (hen.vx < 0) art = mirror(art);
      canvas.sprite(hen.x, hen.y, art, hen.tint);
      canvas.put(hen.x + (hen.vx > 0 ? 1 : 0), hen.y, ",", Farm.COMB);
    }

    if (now >= this.nextTractor) {
      const heading = choice([-1, 1]);
      const art = heading > 0 ? Farm.TRACTOR_ART : mirror(Farm.TRACTOR_ART);
      this.yard.push(new Sprite(art, Farm.TRACTOR, heading > 0 ? -10 : cols + 2,
                                rows - 5, heading * uniform(4.0, 7.0), 0.0, "tractor"));
      this.nextTractor = now + uniform(30.0, 70.0);
    }
    for (const machine of this.yard) {
      canvas.put(machine.x + (machine.vx > 0 ? 3 : machine.width - 4),
                 machine.y - 1, "o\u00b0\u00b7"[mod(trunc(now * 4), 3)], Farm.SMOKE);
    }
    this.advance(canvas, this.yard, dt, cols);

    if (now >= this.nextBird && this.sky.length < 3) {
      const heading = choice([-1, 1]);
      this.sky.push(new Sprite(Farm.BIRD[0], Farm.SMOKE,
                               heading > 0 ? -4 : cols + 2,
                               randint(1, Math.max(1, Math.floor(rows / 3))),
                               heading * uniform(5.0, 9.0)));
      this.nextBird = now + uniform(8.0, 20.0);
    }
    for (const bird of this.sky) bird.art = Farm.BIRD[mod(trunc(now * 5), 2)];
    this.advance(canvas, this.sky, dt, cols);
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (this.started === null) {
      this.started = now;
      this.nextTractor = now + uniform(10.0, 30.0);
    }
    this.sow(cols, rows);
    if (cols > 30) canvas.sprite(cols - 7, 0, [" \\|/", "-(_)-", " /|\\"], Farm.SUN);
    this.field(canvas, now, cols, rows);
    this.buildings(canvas, now, cols, rows);
    this.stock(canvas, dt, now, cols, rows);
  }
}

/* --- matrix ----------------------------------------------------------------- */

export class Matrix extends Theme {
  static themeName = "matrix";
  static blurb = "glyph rain down the columns, bright at the head, fading behind";

  static HEAD = rgb(215, 255, 215);
  static BODY = rgb(60, 220, 90);
  static TRAIL = rgb(22, 110, 45);
  static RAIN = ("\uff71\uff72\uff73\uff74\uff75\uff76\uff77\uff78\uff79\uff7a\uff7b\uff7c"
    + "\uff7d\uff7e\uff7f\uff80\uff81\uff82\uff83\uff84\uff85\uff86\uff87\uff88\uff89\uff8a"
    + "\uff8b\uff8c\uff8d\uff8e\uff8f\uff90\uff91\uff92\uff93\uff94\uff95\uff96\uff97\uff98"
    + "\uff99\uff9a\uff9b\uff9c\uff9d" + "0123456789:=*+-<>|");

  constructor() {
    super();
    this.drops = new Map();
    this.width = 0;
  }

  drop(rows, high = true) {
    const length = randint(4, Math.max(5, rows - 6));
    const glyphs = [];
    for (let i = 0; i < length; i++) glyphs.push(choice(Matrix.RAIN));
    return [-uniform(0, high ? rows : rows / 3), uniform(5.0, 20.0), glyphs];
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (cols !== this.width) {
      this.width = cols;
      this.drops = new Map();
      for (let x = 0; x < cols; x++) {
        if (chance(0.75)) this.drops.set(x, this.drop(rows));
      }
    }
    for (const [x, drop] of this.drops) {
      drop[0] += drop[1] * dt;
      const glyphs = drop[2];
      if (chance(0.3)) {                             // glyphs flicker as they fall
        glyphs[randrange(glyphs.length)] = choice(Matrix.RAIN);
      }
      const head = trunc(drop[0]);
      for (let i = 0; i < glyphs.length; i++) {
        const y = head - i;
        if (y >= 0 && y < rows) {
          canvas.put(x, y, glyphs[i],
                     i === 0 ? Matrix.HEAD : i < 4 ? Matrix.BODY : Matrix.TRAIL);
        }
      }
      if (head - glyphs.length > rows) this.drops.set(x, this.drop(rows, false));
    }
  }
}

/* --- neurons ---------------------------------------------------------------- */

export class Neurons extends Theme {
  static themeName = "neurons";
  static blurb = "cells wired into a net, pulses running the dendrites, one firing at a time";

  static WIRE = rgb(58, 66, 105);
  static CELL = rgb(130, 140, 190);
  static FIRING = rgb(240, 230, 255);
  static PULSE = rgb(140, 200, 255);

  constructor() {
    super();
    this.cells = [];
    this.wires = [];
    this.size = [0, 0];
    this.pulses = [];
    this.lit = new Map();
    this.nextSpark = 0.0;
  }

  /** Distance between two cells, with rows counted double.
   *
   * A cell is about twice as tall as it is wide, so plain coordinates call a
   * cable two rows up shorter than one four columns across when it is drawn
   * longer.
   */
  static gap(here, there) {
    return (there[0] - here[0]) ** 2 + ((there[1] - here[1]) * 2) ** 2;
  }

  /** Scatter cells, wire each to its two nearest, then join up the rest. */
  wire(cols, rows) {
    this.size = [cols, rows];
    this.cells = [];
    this.wires = [];
    this.pulses = [];
    this.lit = new Map();
    let tries = 0;
    const wanted = Math.max(8, Math.min(26, Math.floor((cols * rows) / 70)));
    while (this.cells.length < wanted && tries < 600) {
      tries++;
      const spot = [randrange(Math.max(3, cols - 2) - 2) + 2,
                    randrange(Math.max(2, rows - 1) - 1) + 1];
      if (this.cells.every((c) => Math.abs(spot[0] - c[0]) + Math.abs(spot[1] - c[1]) * 2 > 7)) {
        this.cells.push(spot);
      }
    }
    const seen = new Set();
    for (let i = 0; i < this.cells.length; i++) {
      const here = this.cells[i];
      const span = (j) => Neurons.gap(here, this.cells[j]);
      const order = this.cells.map((_, j) => j).sort((a, b) => span(a) - span(b));
      for (const j of order.slice(1, 3)) {
        const pair = `${Math.min(i, j)},${Math.max(i, j)}`;
        if (seen.has(pair) || span(j) > 34 ** 2) continue;   // no cables across the net
        this.cable(i, j, seen);
      }
    }
    this.join(seen);
  }

  cable(i, j, seen) {
    seen.add(`${Math.min(i, j)},${Math.max(i, j)}`);
    this.wires.push([i, j, line(this.cells[i][0], this.cells[i][1],
                                this.cells[j][0], this.cells[j][1])]);
  }

  /** Wire the islands together, until the net is one net.
   *
   * Nearest neighbours alone leave clusters, and sometimes a cell with nothing
   * on it at all: a pulse started in one of them could never reach the others,
   * so half the screen sits dark for the whole block. This takes the two
   * closest cells that are not yet connected and cables them, over and over,
   * until every cell can be reached from every other. A joining cable ignores
   * the length limit above — a long dendrite is better than a piece of the net
   * nothing ever lights.
   */
  join(seen) {
    const home = this.cells.map((_, i) => i);
    const root = (i) => {
      while (home[i] !== i) {
        home[i] = home[home[i]];                   // flatten as we go
        i = home[i];
      }
      return i;
    };
    for (const [a, b] of this.wires) home[root(a)] = root(b);
    for (;;) {
      let nearest = null;
      for (let i = 0; i < this.cells.length; i++) {
        for (let j = i + 1; j < this.cells.length; j++) {
          if (root(i) === root(j)) continue;
          const gap = Neurons.gap(this.cells[i], this.cells[j]);
          if (nearest === null || gap < nearest[0]) nearest = [gap, i, j];
        }
      }
      if (nearest === null) return;                // nothing left to join
      const [, i, j] = nearest;
      home[root(i)] = root(j);
      this.cable(i, j, seen);
    }
  }

  fire(cell, now, spread = true) {
    this.lit.set(cell, now);
    if (!spread) return;
    for (let w = 0; w < this.wires.length; w++) {
      const [a, b] = this.wires[w];
      if ((cell === a || cell === b) && this.pulses.length < 14 && chance(0.65)) {
        this.pulses.push([w, 0.0, uniform(0.5, 1.1), cell === b]);
      }
    }
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (cols !== this.size[0] || rows !== this.size[1]) this.wire(cols, rows);
    if (!this.cells.length) return;

    for (const [, , path] of this.wires) {           // the dendrites themselves
      const run = [path[path.length - 1][0] - path[0][0], path[path.length - 1][1] - path[0][1]];
      const char = Math.abs(run[1]) * 2 < Math.abs(run[0]) ? "-"
        : Math.abs(run[0]) < Math.abs(run[1]) ? "|"
          : run[0] * run[1] > 0 ? "\\" : "/";
      for (const [x, y] of path) canvas.put(x, y, char, Neurons.WIRE);
    }

    for (const pulse of [...this.pulses]) {          // charge running along them
      pulse[1] += pulse[2] * dt;
      const path = this.wires[pulse[0]][2];
      if (pulse[1] >= 1.0) {
        this.pulses.splice(this.pulses.indexOf(pulse), 1);
        const target = this.wires[pulse[0]][pulse[3] ? 0 : 1];
        this.fire(target, now, chance(0.7));
        continue;
      }
      const where = pulse[3] ? 1.0 - pulse[1] : pulse[1];
      const at = path[Math.min(path.length - 1, trunc(where * (path.length - 1)))];
      canvas.put(at[0], at[1], "\u2022", Neurons.PULSE);
    }

    for (let i = 0; i < this.cells.length; i++) {    // the cells, lit or resting
      const [x, y] = this.cells[i];
      const age = now - (this.lit.has(i) ? this.lit.get(i) : -9.9);
      if (age < 0.5) canvas.put(x - 1, y, "(O)", Neurons.FIRING);
      else if (age < 1.2) canvas.put(x, y, "O", Neurons.FIRING);
      else canvas.put(x, y, "o", Neurons.CELL);
    }

    if (now >= this.nextSpark) {                     // something has to start it
      this.fire(randrange(this.cells.length), now);
      this.nextSpark = now + uniform(1.5, 4.5);
    }
  }
}

/* --- haunted ---------------------------------------------------------------- */

export class Haunted extends Theme {
  static themeName = "haunted";
  static blurb = "a house on the hill, bats, a ghost and lightning (Halloween week)";
  static seasonal = true;

  /** The Monday-to-Sunday week that holds the 31st of October. */
  static inSeason(day = today()) {
    const eve = new Date(day.getFullYear(), 9, 31);
    const monday = addDays(eve, -((eve.getDay() + 6) % 7));
    return monday <= day && day <= addDays(monday, 6);
  }

  static MOON = rgb(238, 236, 214);
  static CLOUD = rgb(78, 76, 98);
  static WALL = rgb(62, 56, 78);
  static ROOF = rgb(44, 40, 58);
  static LIT = rgb(255, 178, 58);
  static DARK = rgb(38, 34, 48);
  static BAT = rgb(96, 86, 110);
  static GHOST = rgb(205, 218, 238);
  static PUMPKIN = rgb(246, 138, 40);
  static TREE = rgb(74, 62, 62);
  static STONE = rgb(122, 120, 134);
  static FOG = rgb(84, 82, 100);
  static BOLT = rgb(255, 255, 235);

  static HOUSE = [
    "         /\\",
    "        /  \\",
    "     __/    \\__________",
    "    /                   \\",
    "   /_____________________\\",
    "   |                     |",
    "   |         ____        |",
    "   |        |    |       |",
    "   |________|____|_______|",
  ];
  static WINDOWS = [[5, 5], [17, 5], [9, 3]];      // offsets into the house
  static MOON_ART = [" .---.", "(  \u00b0  )", " '---'"];
  static TREE_ART = ["\\  |  /", " \\_|_/", "   |", "   |"];
  static GRAVE = [" ___ ", "|RIP|"];
  static BATS = [["\\^/"], ["/^\\"]];
  static GHOST_ART = [" .--.", "( .. )", " )~~("];

  constructor() {
    super();
    this.bats = [];
    this.ghost = null;
    this.clouds = [];
    this.nextBat = 0.0;
    this.nextGhost = 0.0;
    this.nextBolt = 0.0;
    this.flash = 0.0;
    this.bolt = [];
    this.site = null;
    this.built = 0;
    this.started = null;
  }

  build(cols, rows) {
    if (cols === this.built) return;
    this.built = cols;
    this.site = (cols >= 34 && rows >= 15)
      ? Math.max(2, trunc(cols * 0.42) - 12) : null;
    this.clouds = [];
    for (let i = 0; i < 2; i++) {
      this.clouds.push(new Sprite([" .--.", "(     )"], Haunted.CLOUD,
                                  randrange(cols), randint(0, Math.max(0, Math.floor(rows / 4))),
                                  uniform(0.4, 1.0)));
    }
  }

  sky(canvas, dt, now, cols, rows) {
    canvas.sprite(cols - 11, 1, Haunted.MOON_ART, Haunted.MOON, true);
    if (now >= this.nextBat && this.bats.length < 4) {
      const heading = choice([-1, 1]);
      this.bats.push(new Sprite(Haunted.BATS[0], Haunted.BAT,
                                heading > 0 ? -4 : cols + 2,
                                randint(1, Math.max(1, Math.floor(rows / 2))),
                                heading * uniform(7.0, 14.0)));
      this.nextBat = now + uniform(2.0, 6.0);
    }
    for (const bat of this.bats) {                   // they never fly straight
      bat.art = Haunted.BATS[mod(trunc(now * 8 + bat.y), 2)];
      bat.vy = Math.sin(now * 2.6 + bat.x * 0.2) * 3.0;
    }
    this.advance(canvas, this.bats, dt, cols, rows);
    for (const cloud of this.clouds) {
      cloud.move(dt);
      if (cloud.x > cols) cloud.x = -8.0;
      canvas.sprite(cloud.x, cloud.y, cloud.art, cloud.tint);
    }
  }

  ground(canvas, now, cols, rows) {
    if (this.site === null) return;
    const x = this.site;
    const top = rows - Haunted.HOUSE.length;
    const bright = now < this.flash;
    for (let gx = 0; gx < cols; gx += 9) {           // fog rolling along the ground
      canvas.put(gx + trunc(Math.sin(now * 0.6 + gx) * 3), rows - 1, "~~~", Haunted.FOG);
    }
    canvas.sprite(x, top, Haunted.HOUSE.slice(0, 5),
                  bright ? Haunted.BOLT : Haunted.ROOF, true);
    canvas.sprite(x, top + 5, Haunted.HOUSE.slice(5),
                  bright ? Haunted.BOLT : Haunted.WALL, true);
    for (let i = 0; i < Haunted.WINDOWS.length; i++) {   // candles guttering inside
      const [dx, dy] = Haunted.WINDOWS[i];
      const flicker = Math.sin(now * (3.1 + i) + i * 2.0) + Math.sin(now * 7.3 + i);
      canvas.put(x + dx, top + dy, "\u2588\u2588",
                 flicker > -0.4 ? Haunted.LIT : Haunted.DARK);
    }
    canvas.put(x + 13, top + 7, "\u00b7", Haunted.LIT);     // the door handle

    const pumpkin = x + 16;
    canvas.put(pumpkin, rows - 1, mod(trunc(now * 3), 4) ? "(^^)" : "(oo)", Haunted.PUMPKIN);
    canvas.sprite(Math.max(0, x - 12), rows - Haunted.TREE_ART.length, Haunted.TREE_ART,
                  bright ? Haunted.BOLT : Haunted.TREE);
    for (const spot of [x - 20, x + 30]) {
      if (spot >= 0 && spot < cols - 5) canvas.sprite(spot, rows - 2, Haunted.GRAVE, Haunted.STONE);
    }
  }

  spook(canvas, dt, now, cols, rows) {
    if (this.ghost === null) {
      if (now < this.nextGhost) return;
      // It comes off the roof, not out of the middle of the walls.
      const start = this.site !== null ? this.site + 8 : Math.floor(cols / 2);
      const roof = this.site !== null ? rows - Haunted.HOUSE.length - 3 : rows - 6;
      this.ghost = new Sprite(Haunted.GHOST_ART, Haunted.GHOST, start, roof,
                              0.0, -uniform(1.0, 1.8), "ghost");
      this.ghost.born = now;
    }
    const ghost = this.ghost;
    ghost.vx = Math.sin((now - ghost.born) * 1.4) * 4.0;
    ghost.move(dt);
    const age = now - ghost.born;
    if (ghost.y + ghost.art.length < 0 || age > 24.0) {
      this.ghost = null;
      this.nextGhost = now + uniform(30.0, 75.0);
      return;
    }
    canvas.sprite(ghost.x, ghost.y, ghost.art,
                  age < 6.0 ? Haunted.GHOST : DIM + Haunted.GHOST);
  }

  lightning(canvas, now, cols, rows) {
    if (now >= this.nextBolt) {
      this.flash = now + uniform(0.08, 0.2);
      this.nextBolt = now + uniform(25.0, 70.0);
      let x = randrange(Math.max(1, cols - 2));
      this.bolt = [];
      let y = 0;
      while (y < rows * 0.6) {                       // a jagged line out of the cloud
        const step = choice([-1, 0, 1]);
        this.bolt.push([x, y, step > 0 ? "\\" : step < 0 ? "/" : "|"]);
        x += step;
        y += 1;
      }
    }
    if (now < this.flash) {
      for (const [x, y, char] of this.bolt) canvas.put(x, y, char, Haunted.BOLT);
    }
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (this.started === null) {
      this.started = now;
      this.nextGhost = now + uniform(8.0, 30.0);
      this.nextBolt = now + uniform(10.0, 40.0);
    }
    this.build(cols, rows);
    this.sky(canvas, dt, now, cols, rows);
    this.ground(canvas, now, cols, rows);
    this.spook(canvas, dt, now, cols, rows);
    this.lightning(canvas, now, cols, rows);
  }
}

/* --- christmas -------------------------------------------------------------- */

export class Christmas extends Theme {
  static themeName = "christmas";
  static blurb = "snow over a cabin and a lit tree, with a sleigh going by (December)";
  static seasonal = true;

  static inSeason(day = today()) {
    return day.getMonth() === 11;
  }

  static SNOW = rgb(242, 247, 255);
  static DRIFT = rgb(206, 219, 238);
  static STAR = rgb(255, 228, 130);
  static NEEDLE = rgb(58, 138, 74);
  static TRUNK = rgb(122, 86, 56);
  static WALL = rgb(126, 88, 60);
  static LIT = rgb(255, 184, 62);
  static SMOKE = rgb(150, 150, 168);
  static SLEIGH = rgb(214, 66, 62);
  static DEER = rgb(156, 114, 72);
  static COAL = rgb(44, 42, 50);
  static CARROT = rgb(240, 142, 60);
  static BAUBLES = [rgb(236, 74, 74), rgb(250, 208, 92), rgb(96, 164, 242),
                    rgb(96, 224, 128), rgb(224, 126, 224)];

  static TREE = ["    /\\", "   /  \\", "  /    \\", " /      \\", "/________\\"];
  static LIGHTS = [[4, 1], [2, 2], [6, 2], [1, 3], [4, 3], [7, 3], [3, 4], [6, 4]];
  static CABIN = ["   ______", "  /      \\", " /________\\", " |        |", " |________|"];
  static SNOWMAN = ["  ___", " (o o)", "(  +  )"];
  static SLEIGH_ART = ["   o      \\|/   \\|/",
                       "  /#\\     (o)   (o)",
                       " (___)~~~~/\\~~~~/\\>"];

  constructor() {
    super();
    this.flakes = [];
    this.drifts = [];
    this.laid = 0;
    this.stars = [];
    this.smoke = [];
    this.nextPuff = 0.0;
    this.sleigh = null;
    this.nextSleigh = 0.0;
    this.yard = null;
    this.started = null;
  }

  /** Snow on the ground, and where the cabin, tree and snowman stand. */
  settle(cols, rows) {
    if (cols === this.laid) return;
    this.laid = cols;
    this.drifts = [];
    for (let x = 0; x < cols; x++) {
      this.drifts.push(1 + (Math.sin(x * 0.11) + Math.sin(x * 0.27) > 0.7 ? 1 : 0));
    }
    this.flakes = [];
    for (let i = 0; i < Math.floor((cols * rows) / 26); i++) {
      this.flakes.push([uniform(0, cols), uniform(0, rows), uniform(1.6, 5.0), uniform(0, 6.3)]);
    }
    this.stars = [];
    for (let i = 0; i < Math.floor(cols / 8); i++) {
      this.stars.push([randrange(cols), randrange(Math.max(1, Math.floor(rows / 3))),
                       uniform(0, 6.3)]);
    }
    // Cabin left, tree well right of the clock, snowman at the far end.
    this.yard = cols >= 44
      ? [2, Math.max(16, trunc(cols * 0.70)), Math.max(30, cols - 12)] : null;
  }

  sky(canvas, now, cols, rows) {
    for (const [x, y, phase] of this.stars) {
      canvas.put(x, y, Math.sin(now * 1.7 + phase) > 0 ? "\u00b7" : ".", Christmas.DRIFT);
    }
  }

  snow(canvas, dt, now, cols, rows) {
    for (const flake of this.flakes) {
      flake[1] += flake[2] * dt;
      flake[0] += Math.sin(now * 1.2 + flake[3]) * 1.6 * dt;
      if (flake[1] >= rows - this.drifts[Math.min(mod(trunc(flake[0]), cols), cols - 1)]) {
        flake[1] = 0.0;
        flake[0] = uniform(0, cols);
      }
      canvas.put(flake[0], flake[1],
                 flake[2] > 4.0 ? "*" : flake[2] > 2.6 ? "\u00b7" : ".", Christmas.SNOW);
    }
    for (let x = 0; x < Math.min(this.drifts.length, cols); x++) {   // what has landed
      const deep = this.drifts[x];
      for (let y = rows - deep; y < rows; y++) {
        canvas.put(x, y, "\u2588", y === rows - deep ? Christmas.SNOW : Christmas.DRIFT);
      }
    }
  }

  yardScene(canvas, dt, now, cols, rows) {
    if (this.yard === null) return;
    const [cabinX, treeX, manX] = this.yard;
    const ground = rows - 2;

    const top = ground - Christmas.CABIN.length + 1;
    canvas.sprite(cabinX, top, Christmas.CABIN.slice(0, 3), Christmas.SNOW, true);
    canvas.sprite(cabinX, top + 3, Christmas.CABIN.slice(3), Christmas.WALL, true);
    canvas.put(cabinX + 3, top + 3, "\u2593\u2593", Christmas.LIT);
    canvas.put(cabinX + 7, top - 1, "\u2590\u258c", Christmas.WALL);
    if (now >= this.nextPuff) {                      // chimney, drawing steadily
      const puff = new Sprite(["o"], Christmas.SMOKE, cabinX + 7, top - 2,
                              uniform(0.3, 1.0), -uniform(1.2, 2.2));
      puff.born = now;
      this.smoke.push(puff);
      this.nextPuff = now + uniform(0.6, 1.4);
    }
    for (const puff of [...this.smoke]) {
      puff.move(dt);
      const age = now - puff.born;
      if (puff.y < 0 || age > 9.0) {
        this.smoke.splice(this.smoke.indexOf(puff), 1);
        continue;
      }
      canvas.put(puff.x, puff.y, age < 1.5 ? "o" : age < 3.5 ? "\u00b0" : ".", Christmas.SMOKE);
    }

    const treeTop = ground - Christmas.TREE.length;
    canvas.sprite(treeX, treeTop, Christmas.TREE, Christmas.NEEDLE, true);
    canvas.put(treeX + 4, treeTop - 1, Math.sin(now * 3.0) > -0.3 ? "*" : "+", Christmas.STAR);
    canvas.put(treeX + 4, ground, "||", Christmas.TRUNK);
    for (let i = 0; i < Christmas.LIGHTS.length; i++) {   // the string blinks out of step
      const [dx, dy] = Christmas.LIGHTS[i];
      if (Math.sin(now * (1.7 + i * 0.3) + i) > -0.2) {
        canvas.put(treeX + dx, treeTop + dy, "o", Christmas.BAUBLES[i % 5]);
      }
    }

    canvas.sprite(manX, ground - 2, Christmas.SNOWMAN, Christmas.SNOW, true);
    canvas.put(manX + 2, ground - 1, "o o", Christmas.COAL);
    canvas.put(manX + 3, ground, "+", Christmas.CARROT);
    canvas.put(manX - 1, ground, "-", Christmas.TRUNK);
    canvas.put(manX + 7, ground, "-", Christmas.TRUNK);
  }

  sleighRide(canvas, dt, now, cols, rows) {
    if (this.sleigh === null) {
      if (now < this.nextSleigh) return;
      const heading = choice([-1, 1]);
      const art = heading > 0 ? Christmas.SLEIGH_ART : mirror(Christmas.SLEIGH_ART);
      const span = Math.max(...art.map(width));
      this.sleigh = new Sprite(art, Christmas.DEER, heading > 0 ? -span - 2 : cols + 2,
                               randint(0, Math.max(0, Math.floor(rows / 3))),
                               heading * uniform(7.0, 11.0), 0.0, "sleigh");
    }
    const rig = this.sleigh;
    rig.move(dt);
    rig.vy = Math.sin(now * 1.1) * 0.8;              // it rides the air
    if ((rig.vx > 0 && rig.x > cols + 2) || (rig.vx < 0 && rig.x + rig.width < 0)) {
      this.sleigh = null;
      this.nextSleigh = now + uniform(45.0, 110.0);
      return;
    }
    canvas.sprite(rig.x, rig.y, rig.art, rig.tint);
    // The reindeer are drawn in one piece; Santa and his sleigh are painted
    // back over it in red, on whichever end the team is pulling from.
    const box = rig.vx > 0 ? 1 : rig.width - 6;
    const head = rig.vx > 0 ? 3 : rig.width - 4;
    canvas.put(rig.x + box, rig.y + 2, "(___)", Christmas.SLEIGH);
    canvas.put(rig.x + head, rig.y, "o", Christmas.SLEIGH);
    canvas.put(rig.x + head - 1, rig.y + 1, "/#\\", Christmas.SLEIGH);
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (this.started === null) {
      this.started = now;
      this.nextSleigh = now + uniform(8.0, 30.0);
    }
    this.settle(cols, rows);
    this.sky(canvas, now, cols, rows);
    this.snow(canvas, dt, now, cols, rows);
    this.yardScene(canvas, dt, now, cols, rows);
    this.sleighRide(canvas, dt, now, cols, rows);
  }
}

/* --- easter ----------------------------------------------------------------- */

export class Easter extends Theme {
  static themeName = "easter";
  static blurb = "a meadow under a rainbow, bunnies hopping, eggs left behind (Easter)";
  static seasonal = true;

  /** Palm Sunday through Easter Monday — nine days around the feast. */
  static inSeason(day = today()) {
    const sunday = easterSunday(day.getFullYear());
    return addDays(sunday, -7) <= day && day <= addDays(sunday, 1);
  }

  static GRASS = rgb(104, 178, 88);
  static TURF = rgb(72, 140, 66);
  static STEM = rgb(92, 160, 80);
  static SUN = rgb(255, 222, 110);
  static CLOUD = rgb(238, 242, 250);
  static WHISKER = rgb(120, 110, 105);
  static PETALS = [rgb(242, 142, 190), rgb(250, 220, 110), rgb(246, 246, 236),
                   rgb(192, 142, 232)];
  static SHELLS = [rgb(242, 122, 142), rgb(250, 206, 92), rgb(122, 202, 232),
                   rgb(172, 222, 132), rgb(212, 152, 236)];
  static FURS = [rgb(238, 235, 228), rgb(186, 146, 112)];
  static ARC = [rgb(236, 92, 88), rgb(244, 152, 70), rgb(248, 214, 96),
                rgb(126, 200, 106), rgb(96, 168, 236), rgb(126, 124, 218),
                rgb(178, 128, 226)];
  static WINGS = [[">|<"], ["}|{"]];

  static BUNNY = ["  /)_/)", " ( o.o)", " (> <)"];
  static EGG = [" __", "(\u2248\u2248)"];
  static SUN_ART = [" \\|/", "-(_)-", " /|\\"];

  constructor() {
    super();
    this.flowers = [];
    this.sown = [0, 0];
    this.arc = [];
    this.eggs = [];
    this.bunnies = [];
    this.moths = [];
    this.nextBunny = 0.0;
    this.nextMoth = 0.0;
    this.started = null;
  }

  sow(cols, rows) {
    if (cols === this.sown[0] && rows === this.sown[1]) return;
    this.sown = [cols, rows];
    this.arc = this.rainbowCells(cols, rows);
    this.flowers = [];
    for (let x = 1; x < cols - 2; x += 6) {
      if (chance(0.7)) {
        this.flowers.push([x + randint(0, 2), randrange(4), uniform(0, 6.3), randint(1, 2)]);
      }
    }
    this.eggs = [];
    for (let i = 0; i < 4; i++) {
      this.eggs.push([uniform(2, Math.max(3, cols - 6)), randrange(5)]);
    }
  }

  meadow(canvas, now, cols, rows) {
    const ground = rows - 1;
    for (let x = 0; x < cols; x++) {
      canvas.put(x, ground, ",v.w"[(x * 7) % 4], x % 3 ? Easter.TURF : Easter.GRASS);
    }
    for (const [x, shade, phase, height] of this.flowers) {
      const lean = Math.round(Math.sin(now * 1.3 + phase));
      for (let i = 0; i < height; i++) canvas.put(x, ground - 1 - i, "|", Easter.STEM);
      canvas.put(x + lean, ground - 1 - height,
                 shade % 2 ? "*" : "o", Easter.PETALS[shade]);
    }
    for (const [x, shade] of this.eggs) {
      canvas.sprite(x, ground - 2, Easter.EGG, Easter.SHELLS[shade % 5]);
    }
  }

  /** The rainbow, worked out once per size and kept.
   *
   * Each band is a ring of cells at one distance from the centre, rather than
   * a line at one radius: a curve drawn a cell thick has no room for seven
   * colours, and they smear together down the flanks.
   */
  rainbowCells(cols, rows) {
    if (cols < 40 || rows < 12) return [];
    const cells = [];
    const cx = cols * 0.80, cy = rows * 0.66;   // off in the distance, clear of the meadow
    const base = Math.min(rows * 0.42, cols * 0.16);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const dy = cy - y;
        if (dy < 1.5) continue;
        const band = Math.round(base - Math.hypot((x - cx) / 2.0, dy));
        if (band >= 0 && band < Easter.ARC.length) cells.push([x, y, Easter.ARC[band]]);
      }
    }
    return cells;
  }

  rainbow(canvas) {
    for (const [x, y, tint] of this.arc) canvas.put(x, y, "\u2584", tint);
  }

  bunnies_(canvas, dt, now, cols, rows) {
    const ground = rows - 1;
    if (now >= this.nextBunny && this.bunnies.length < 2) {
      const heading = choice([-1, 1]);
      const art = heading < 0 ? Easter.BUNNY : mirror(Easter.BUNNY);
      const hare = new Sprite(art, choice(Easter.FURS),
                             heading > 0 ? -8 : cols + 2, 0,
                             heading * uniform(5.0, 9.0), 0.0, "bunny");
      hare.born = now;
      this.bunnies.push(hare);
      this.nextBunny = now + uniform(6.0, 18.0);
    }
    for (const hare of [...this.bunnies]) {
      hare.move(dt);
      if ((hare.vx > 0 && hare.x > cols + 2) || (hare.vx < 0 && hare.x + hare.width < 0)) {
        this.bunnies.splice(this.bunnies.indexOf(hare), 1);
        continue;
      }
      const hop = Math.abs(Math.sin((now - hare.born) * 4.5)) * 2.0;
      canvas.sprite(hare.x, ground - 2 - hare.art.length - hop + 1, hare.art, hare.tint);
      if (hare.x > 0 && hare.x < cols - 5 && this.eggs.length < 14 && chance(0.012)) {
        this.eggs.push([hare.x, randrange(5)]);       // one left behind
      }
    }
  }

  moths_(canvas, dt, now, cols, rows) {
    if (now >= this.nextMoth && this.moths.length < 3) {
      const heading = choice([-1, 1]);
      this.moths.push(new Sprite(Easter.WINGS[0], choice(Easter.PETALS),
                                 heading > 0 ? -3 : cols + 2,
                                 randint(1, Math.max(1, rows - 4)),
                                 heading * uniform(1.8, 3.6)));
      this.nextMoth = now + uniform(4.0, 10.0);
    }
    for (const moth of this.moths) {
      moth.art = Easter.WINGS[mod(trunc(now * 7), 2)];
      moth.vy = Math.sin(now * 3.0 + moth.x) * 1.7;
    }
    this.advance(canvas, this.moths, dt, cols, rows);
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (this.started === null) {
      this.started = now;
      this.nextBunny = now + uniform(2.0, 8.0);
    }
    this.sow(cols, rows);
    this.rainbow(canvas);
    if (cols > 30) canvas.sprite(2, 0, Easter.SUN_ART, Easter.SUN);
    this.meadow(canvas, now, cols, rows);
    this.moths_(canvas, dt, now, cols, rows);
    this.bunnies_(canvas, dt, now, cols, rows);
  }
}

/* --- birthday --------------------------------------------------------------- */

export class Birthday extends Theme {
  static themeName = "birthday";
  static blurb = "cake, candles and balloons \u2014 on your birthday, once Focus knows it";
  static seasonal = true;

  static inSeason(day = today()) {
    const who = loadProfile();
    return who.month === day.getMonth() + 1 && who.day === day.getDate();
  }

  static BUNTING = [rgb(240, 110, 120), rgb(250, 205, 90), rgb(120, 200, 235),
                    rgb(150, 220, 140), rgb(205, 145, 235)];
  static ICING = rgb(250, 240, 245);
  static SPONGE = rgb(190, 130, 85);
  static PLATE = rgb(200, 205, 215);
  static FLAME = rgb(255, 190, 70);
  static WAX = rgb(240, 245, 250);
  static RIBBON = rgb(240, 110, 120);
  static BOX = rgb(130, 170, 230);

  static CAKE = ["  __________ ", " |~~~~~~~~~~|", " |##########|", " \\__________/"];
  static GIFT = ["_|_", "[#]"];

  constructor() {
    super();
    this.balloons = [];
    this.bits = [];
    this.nextBalloon = 0.0;
    this.who = loadProfile().name || "";
    this.started = null;
  }

  banner(canvas, now, cols) {
    for (let x = 0; x < cols; x++) {                 // bunting along the top
      canvas.put(x, 0, "/\\"[x % 2], Birthday.BUNTING[Math.floor(x / 2) % 5]);
    }
    let greeting = this.who ? "HAPPY BIRTHDAY, " + this.who.toUpperCase() : "HAPPY BIRTHDAY";
    if (greeting.length > cols - 2) greeting = greeting.slice(0, cols - 3) + "\u2026";
    const start = Math.max(0, Math.floor((cols - greeting.length - 2) / 2));
    canvas.put(start, 2, " ".repeat(greeting.length + 2), "", true);
    for (let i = 0; i < greeting.length; i++) {      // each letter its own colour
      canvas.put(start + 1 + i, 2, greeting[i],
                 BOLD + Birthday.BUNTING[mod(i + trunc(now * 3), 5)]);
    }
  }

  balloonsUp(canvas, dt, now, cols, rows) {
    if (now >= this.nextBalloon && this.balloons.length < 7) {
      const balloon = new Sprite([" __ ", "(  )", " \\/ "], choice(Birthday.BUNTING),
                                 uniform(1, Math.max(1, cols - 5)), rows,
                                 0.0, -uniform(1.4, 3.0));
      balloon.born = now;
      this.balloons.push(balloon);
      this.nextBalloon = now + uniform(1.2, 3.5);
    }
    for (const balloon of [...this.balloons]) {
      balloon.vx = Math.sin(now * 1.3 + balloon.born) * 1.8;
      balloon.move(dt);
      if (balloon.y + 3 < 0) {
        this.balloons.splice(this.balloons.indexOf(balloon), 1);
        continue;
      }
      canvas.sprite(balloon.x, balloon.y, balloon.art, balloon.tint);
      for (let i = 1; i < 4; i++) {                  // its string, trailing below
        canvas.put(balloon.x + 2 + (i % 2), balloon.y + 2 + i, "|", DIM + balloon.tint);
      }
    }
  }

  confetti(canvas, dt, now, cols, rows) {
    while (this.bits.length < Math.floor(cols / 3)) {
      this.bits.push([uniform(0, cols), uniform(-rows, 0), uniform(2.5, 6.0),
                      choice(Birthday.BUNTING), uniform(0, 6.3)]);
    }
    for (const bit of this.bits) {
      bit[1] += bit[2] * dt;
      bit[0] += Math.sin(now * 3.0 + bit[4]) * 1.4 * dt;
      if (bit[1] > rows - 1) {
        bit[1] = -1.0;
        bit[0] = uniform(0, cols);
      }
      canvas.put(bit[0], bit[1], "*/\\-o"[mod(trunc(bit[4] * 5), 5)], bit[3]);
    }
  }

  cake(canvas, now, cols, rows) {
    if (cols < 26) return;
    const x = Math.floor(cols / 2) - 6;
    const top = rows - Birthday.CAKE.length;
    canvas.sprite(x, top, Birthday.CAKE.slice(0, 2), Birthday.ICING, true);
    canvas.sprite(x, top + 2, Birthday.CAKE.slice(2), Birthday.SPONGE, true);
    canvas.put(x, rows - 1, "=".repeat(13), Birthday.PLATE);
    for (let i = 0; i < 3; i++) {                    // candles, guttering
      const cx = x + 3 + i * 3;
      canvas.put(cx, top - 1, "|", Birthday.WAX);
      canvas.put(cx, top - 2, "*'."[mod(trunc(now * 7 + i * 2), 3)], Birthday.FLAME);
    }
    for (const gift of [x - 6, x + 14]) {            // presents either side
      if (gift >= 0 && gift < cols - 3) {
        canvas.sprite(gift, rows - 2, Birthday.GIFT, Birthday.BOX);
        canvas.put(gift + 1, rows - 2, "|", Birthday.RIBBON);
      }
    }
  }

  draw(canvas, now) {
    const dt = this.tick(now);
    const cols = canvas.cols, rows = canvas.rows;
    if (this.started === null) this.started = now;
    this.confetti(canvas, dt, now, cols, rows);
    this.balloonsUp(canvas, dt, now, cols, rows);
    this.banner(canvas, now, cols);                  // last, so nothing falls through it
    this.cake(canvas, now, cols, rows);
  }
}

/* --- the rota --------------------------------------------------------------- */

export const RANDOM = "random";                      // a different scene every block

export const THEMES = new Map([Theme, Aquarium, Airport, Space, Galaxy, Desert,
                               Farm, Matrix, Neurons, Haunted, Christmas, Easter, Birthday]
  .map((theme) => [theme.themeName, theme]));

/** Resolve a theme name, drawing a scene at random when asked to.
 *
 * Seasonal themes keep to their dates: ask for one by name any day of the
 * year, but random only offers it in season, where it is weighted to turn up
 * rather than hide among the other ten.
 */
export function pick(name) {
  if (name !== RANDOM) return name;
  if (Birthday.inSeason()) return Birthday.themeName;   // one day a year, it wins outright
  const pool = [];
  for (const [themeName, theme] of THEMES) {
    if (themeName === Theme.themeName) continue;
    if (!theme.seasonal) pool.push(themeName);
    else if (theme.inSeason()) pool.push(themeName, themeName, themeName);
  }
  return choice(pool);
}

export { Theme };
