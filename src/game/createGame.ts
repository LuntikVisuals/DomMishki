import * as THREE from "three";
import { animateHuman, createGrandma, createSurvivor, type GrandmaLook, type SurvivorLook } from "./actors";
import { Sfx } from "./audio";
import {
  BEAR_SPAWN,
  buildLevel,
  SPAWN,
  supportY,
  type Box,
  type DoorSpec,
  type NavNode,
} from "./level";
import { formatTime, grade, type Rank } from "./rating";

export type ViewMode = "3d" | "top";
export type PlayMode = {
  control: "survivor" | "bear";
  aiBear: boolean;
  view?: ViewMode;
  survivor?: SurvivorLook;
  grandma?: GrandmaLook;
};

export type NetMsg =
  | { t: "p"; x: number; y: number; z: number; yaw: number; c: number; h: number }
  | { t: "b"; x: number; y: number; z: number; yaw: number; st: string }
  | { t: "door"; id: string; open: number }
  | { t: "item"; id: string }
  | { t: "noise"; x: number; y: number; z: number; r: number }
  | { t: "grab" }
  | {
      t: "end";
      escaped: boolean;
      score: number;
      rank: Rank;
      title: string;
      time: number;
      noises: number;
      spots: number;
    };

export type Result = {
  escaped: boolean;
  score: number;
  rank: Rank;
  title: string;
  time: number;
  noises: number;
  spots: number;
  you: "survivor" | "bear";
};

export type Hud = {
  time: string;
  goal: string;
  prompt: string;
  stamina: number;
  battery: number;
  flash: boolean;
  hasKey: boolean;
  hasHammer: boolean;
  boards: number;
  bearNear: number;
  crouch: boolean;
  you: "survivor" | "bear";
};

type Ghost = { x: number; y: number; z: number; yaw: number; tx: number; ty: number; tz: number; tyaw: number };

const TURN = 2.45;
const WALK = 2.5;
const SPRINT = 4.65;
const CROUCH = 1.2;
const NOTE =
  "Кладовая за кабинетом, код 471.\nКлюч от парадной двери — в комоде на втором этаже, восточная комната.\nОкно кухни заколочено. Молоток лежит в кладовой.\nНе бегай. Он слышит.";

const tmp = new THREE.Vector3();

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function yawToForward(yaw: number) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

function shortest(a: number, b: number) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export type Engine = {
  start: (mode: PlayMode) => void;
  setCast: (cast: { survivor: SurvivorLook; grandma: GrandmaLook; view: ViewMode }) => void;
  destroy: () => void;
  setStick: (x: number, y: number) => void;
  addLook: (dx: number, dy: number) => void;
  hold: (what: "crouch" | "sprint", on: boolean) => void;
  tap: (what: "interact" | "flash" | "pause") => void;
  enterCode: (code: string) => void;
  closeOverlay: () => void;
  resume: () => void;
  toMenu: () => void;
  applyNet: (msg: NetMsg) => void;
  setNet: (send: ((msg: NetMsg, reliable: boolean) => void) | null) => void;
  sfx: Sfx;
};

export function createGame(
  canvas: HTMLCanvasElement,
  hooks: {
    onHud: (h: Hud) => void;
    onResult: (r: Result) => void;
    onNote: (text: string | null) => void;
    onPad: (open: boolean) => void;
    onPause: (open: boolean) => void;
    onReady: () => void;
  },
): Engine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.65;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.95);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.08, 80);
  camera.position.set(8, 6, 12);
  const ortho = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 80);
  ortho.up.set(0, 0, -1);

  const level = buildLevel(scene);
  const survivorLooks: Record<SurvivorLook, ReturnType<typeof createSurvivor>> = {
    hood: createSurvivor("hood"),
    coat: createSurvivor("coat"),
    cap: createSurvivor("cap"),
  };
  const grandmaLooks: Record<GrandmaLook, ReturnType<typeof createGrandma>> = {
    shawl: createGrandma("shawl"),
    coat: createGrandma("coat"),
    braid: createGrandma("braid"),
  };
  let human = survivorLooks.hood;
  let grandma = grandmaLooks.shawl;
  let viewMode: ViewMode = "3d";
  for (const rig of Object.values(survivorLooks)) scene.add(rig.root);
  for (const rig of Object.values(grandmaLooks)) scene.add(rig.root);

  const sfx = new Sfx();
  const timer = new THREE.Timer();
  timer.connect(document);

  const keys = new Set<string>();
  let forced: Set<string> | null = null;
  let stickX = 0;
  let stickY = 0;
  let lookX = 0;
  let lookY = 0;
  let crouchHeld = false;
  let sprintHeld = false;
  let tapInteract = false;
  let tapFlash = false;
  let prevInteract = false;
  let prevFlash = false;

  const player = { x: SPAWN.x, y: 0, z: SPAWN.z, yaw: SPAWN.yaw, pitch: 0 };
  const bear = { x: BEAR_SPAWN.x, y: 0, z: BEAR_SPAWN.z, yaw: BEAR_SPAWN.yaw };
  const ghostP: Ghost = { x: SPAWN.x, y: 0, z: SPAWN.z, yaw: 0, tx: SPAWN.x, ty: 0, tz: SPAWN.z, tyaw: 0 };
  const ghostB: Ghost = {
    x: BEAR_SPAWN.x,
    y: 0,
    z: BEAR_SPAWN.z,
    yaw: BEAR_SPAWN.yaw,
    tx: BEAR_SPAWN.x,
    ty: 0,
    tz: BEAR_SPAWN.z,
    tyaw: BEAR_SPAWN.yaw,
  };

  let playing = false;
  let paused = false;
  let over = false;
  let control: "survivor" | "bear" = "survivor";
  let aiBear = true;
  let modeStarted = false;

  function showCast() {
    for (const rig of Object.values(survivorLooks)) rig.root.visible = false;
    for (const rig of Object.values(grandmaLooks)) rig.root.visible = false;
    human.root.visible = true;
    grandma.root.visible = true;
  }
  showCast();

  let hasKey = false;
  let hasHammer = false;
  let codeOk = false;
  let readNote = false;
  let boards = 3;
  let hiding = false;
  let hideId = "";
  let noteOpen = false;
  let padOpen = false;
  let flashOn = true;
  let battery = 100;
  let stamina = 100;
  let time = 0;
  let noises = 0;
  let spots = 0;
  let grace = 0;
  let horizSpeed = 0;
  let stepAcc = 0;
  let phaseH = 0;
  let phaseB = 0;
  let shake = 0;
  let scare = 0;
  let clockAcc = 0;
  let sendAcc = 0;
  let seeAcc = 0;
  let lostSee = 0;
  let bearState: "patrol" | "investigate" | "chase" = "patrol";
  let patrolI = 0;
  let path: { x: number; y: number; z: number }[] = [];
  let pathCd = 0;
  let searchLeft = 0;
  let investigate = { x: 4.5, y: 0, z: 2.4 };
  let lastBearSt = "patrol";
  let net: ((msg: NetMsg, reliable: boolean) => void) | null = null;
  let pending: Result | null = null;
  let resultShown = false;

  const patrol = ["kit", "hallS", "liv", "hallM", "study", "hallN", "bed", "stairB", "stairM", "stairT", "loftE", "loftW", "stairT", "stairM", "stairB", "hallS"];
  const byId = new Map<string, NavNode>(level.nodes.map((n) => [n.id, n]));

  const held = (code: string) => (forced ? forced.has(code) : keys.has(code));

  function readMove(yaw: number, turn: number, dt: number) {
    if (viewMode === "top") {
      let mx = stickX;
      let mz = -stickY;
      if (held("KeyW") || held("ArrowUp")) mz -= 1;
      if (held("KeyS") || held("ArrowDown")) mz += 1;
      if (held("KeyA") || held("ArrowLeft")) mx -= 1;
      if (held("KeyD") || held("ArrowRight")) mx += 1;
      const len = Math.hypot(mx, mz);
      return { throttle: Math.min(1, len), yaw: len > 0.12 ? Math.atan2(-mx / len, -mz / len) : yaw };
    }
    let steer = 0;
    if (held("KeyA") || held("ArrowLeft")) steer += 1;
    if (held("KeyD") || held("ArrowRight")) steer -= 1;
    steer = clamp(steer - stickX, -1, 1);
    let throttle = 0;
    if (held("KeyW") || held("ArrowUp")) throttle += 1;
    if (held("KeyS") || held("ArrowDown")) throttle -= 1;
    throttle = clamp(throttle + stickY, -1, 1);
    return { throttle, yaw: yaw + steer * turn * dt };
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();

  function collide(x: number, z: number, y: number, h: number, r: number) {
    for (let n = 0; n < 3; n++) {
      for (const b of level.colliders) {
        if (!b.on) continue;
        if (y + h < b.y0 + 0.02 || y + 0.04 > b.y1) continue;
        const cx = Math.max(b.x0, Math.min(x, b.x1));
        const cz = Math.max(b.z0, Math.min(z, b.z1));
        let dx = x - cx;
        let dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-8) {
          const pl = x - b.x0;
          const pr = b.x1 - x;
          const pb = z - b.z0;
          const pf = b.z1 - z;
          const m = Math.min(pl, pr, pb, pf);
          if (m === pl) x = b.x0 - r;
          else if (m === pr) x = b.x1 + r;
          else if (m === pb) z = b.z0 - r;
          else z = b.z1 + r;
          continue;
        }
        const d = Math.sqrt(d2);
        const pen = r - d;
        x += (dx / d) * pen;
        z += (dz / d) * pen;
      }
    }
    return { x, z };
  }

  function blocked(x: number, y: number, z: number) {
    for (const b of level.colliders) {
      if (!b.on) continue;
      if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return true;
    }
    return false;
  }

  function syncDoorVisual(d: DoorSpec) {
    d.pivot.rotation.y = d.open * (Math.PI / 2) * (d.along === "z" && d.x > 0 ? -1 : 1);
    d.box.on = d.open < 0.42;
  }

  function doorLocked(d: DoorSpec) {
    if (d.lock === "key") return !hasKey;
    if (d.lock === "code") return !codeOk;
    return false;
  }

  function setDoorTarget(id: string, target: number, echo: boolean) {
    const d = level.doors.find((door) => door.id === id);
    if (!d || doorLocked(d)) return;
    if (d.target === target) return;
    d.target = target;
    sfx.creak();
    noises += 1;
    shake = Math.max(shake, 0.15);
    hear(d.x, 1, d.z, 10);
    if (echo) net?.({ t: "door", id, open: target }, true);
  }

  function takeKey(echo: boolean) {
    if (hasKey) return;
    hasKey = true;
    level.keyMesh.visible = false;
    sfx.pickup();
    if (echo) net?.({ t: "item", id: "key" }, true);
  }

  function takeHammer(echo: boolean) {
    if (hasHammer) return;
    hasHammer = true;
    level.hammerMesh.visible = false;
    sfx.pickup();
    if (echo) net?.({ t: "item", id: "hammer" }, true);
  }

  function unlockCode(echo: boolean) {
    if (codeOk) return;
    codeOk = true;
    sfx.pickup();
    setDoorTarget("cellar", 1, echo);
    if (echo) net?.({ t: "item", id: "code" }, true);
  }

  function hitBoard(echo: boolean) {
    if (boards <= 0) return;
    boards -= 1;
    const plank = level.planks[boards];
    if (plank) plank.visible = false;
    sfx.bang();
    noises += 1;
    shake = 0.55;
    hear(7.4, 1.4, 3, 16);
    if (echo) net?.({ t: "item", id: "board" }, true);
  }

  function nearestNode(x: number, y: number, z: number) {
    let best: NavNode | null = null;
    let bestD = 1e9;
    for (const n of level.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2 + (n.y - y) ** 2 * 2.2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  function buildPath(x: number, y: number, z: number, gx: number, gy: number, gz: number) {
    const start = nearestNode(x, y, z);
    const end = nearestNode(gx, gy, gz);
    if (!start || !end) return [{ x: gx, y: gy, z: gz }];
    if (start.id === end.id) return [{ x: gx, y: gy, z: gz }];
    const q = [start.id];
    const prev = new Map<string, string | null>([[start.id, null]]);
    while (q.length) {
      const id = q.shift();
      if (!id) break;
      if (id === end.id) break;
      const node = byId.get(id);
      if (!node) continue;
      for (const nxt of node.links) {
        if (!prev.has(nxt)) {
          prev.set(nxt, id);
          q.push(nxt);
        }
      }
    }
    const ids: string[] = [];
    if (prev.has(end.id)) {
      let cur: string | null = end.id;
      while (cur) {
        ids.push(cur);
        cur = prev.get(cur) ?? null;
      }
      ids.reverse();
    }
    const pts = ids.map((id) => {
      const n = byId.get(id)!;
      return { x: n.x, y: n.y, z: n.z };
    });
    pts.push({ x: gx, y: gy, z: gz });
    return pts;
  }

  function hear(x: number, y: number, z: number, radius: number) {
    if (!aiBear || over) return;
    const d = Math.hypot(bear.x - x, bear.z - z) + Math.abs(bear.y - y) * 0.85;
    if (d > radius) return;
    if (bearState === "chase") return;
    investigate = { x, y, z };
    bearState = "investigate";
    searchLeft = 3.2;
    path = [];
    pathCd = 0;
  }

  function canSee() {
    if (hiding || over) return false;
    const dx = player.x - bear.x;
    const dz = player.z - bear.z;
    const dist = Math.hypot(dx, dz);
    const range = (bearState === "chase" ? 11.5 : 7.6) * (crouchHeld || held("ControlLeft") || held("KeyC") ? 0.55 : 1);
    if (dist > range || dist < 0.05) return dist < 1.2;
    if (Math.abs(player.y - bear.y) > 2 && dist > 2.2) return false;
    const f = yawToForward(bear.yaw);
    const dot = (dx * f.x + dz * f.z) / dist;
    if (bearState !== "chase" && dot < 0.62) return false;
    if (bearState === "chase" && dot < -0.15 && dist > 2.4) return false;
    const y0 = bear.y + 1.65;
    const y1 = player.y + 1.35;
    for (let i = 1; i <= 6; i++) {
      const t = i / 7;
      if (blocked(bear.x + dx * t, y0 + (y1 - y0) * t, bear.z + dz * t)) return false;
    }
    return true;
  }

  function moveActor(
    body: { x: number; y: number; z: number; yaw: number },
    speed: number,
    tx: number,
    tz: number,
    dt: number,
    turn: number,
    radius: number,
  ) {
    const dx = tx - body.x;
    const dz = tz - body.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const desired = Math.atan2(-dx, -dz);
      const diff = shortest(body.yaw, desired);
      body.yaw += clamp(diff, -turn * dt, turn * dt);
      const f = yawToForward(body.yaw);
      const step = Math.min(Math.abs(speed) * dt, d);
      body.x += f.x * step;
      body.z += f.z * step;
    }
    const c = collide(body.x, body.z, body.y, 1.7, radius);
    body.x = c.x;
    body.z = c.z;
    body.y = supportY(body.x, body.z, body.y);
  }

  function updateBear(dt: number) {
    if (!aiBear) {
      pullGhost(ghostB, dt);
      bear.x = ghostB.x;
      bear.y = ghostB.y;
      bear.z = ghostB.z;
      bear.yaw = ghostB.yaw;
      tryCatch();
      return;
    }
    seeAcc -= dt;
    if (seeAcc <= 0) {
      seeAcc = 0.12;
      if (canSee()) {
        if (bearState !== "chase") spots += 1;
        bearState = "chase";
        lostSee = 0;
      } else if (bearState === "chase") {
        lostSee += 0.12;
        if (lostSee > 3.4) {
          bearState = "investigate";
          investigate = { x: player.x, y: player.y, z: player.z };
          searchLeft = 3;
          path = [];
        }
      }
    }
    if (flashOn && !hiding && battery > 0) {
      const f = yawToForward(player.yaw);
      const dx = bear.x - player.x;
      const dz = bear.z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 8.5 && dist > 0.2 && (dx * f.x + dz * f.z) / dist > 0.82) {
        if (bearState !== "chase") spots += 1;
        bearState = "chase";
        lostSee = 0;
      }
    }

    let tx = bear.x;
    let tz = bear.z;
    const speed = bearState === "chase" ? 3.55 : bearState === "investigate" ? 2.4 : 1.55;
    if (bearState === "chase" && Math.abs(player.y - bear.y) < 2.05) {
      tx = player.x;
      tz = player.z;
    } else {
      const goal =
        bearState === "patrol"
          ? (byId.get(patrol[patrolI] ?? "kit") ?? { x: 0, y: 0, z: 0 })
          : investigate;
      pathCd -= dt;
      if (path.length === 0 || pathCd <= 0) {
        path = buildPath(bear.x, bear.y, bear.z, goal.x, goal.y, goal.z);
        pathCd = 0.55;
      }
      const wp = path[0];
      if (wp) {
        tx = wp.x;
        tz = wp.z;
        if (Math.hypot(bear.x - wp.x, bear.z - wp.z) < 0.5) path.shift();
      }
      if (path.length === 0 && bearState === "patrol") {
        patrolI = (patrolI + 1) % patrol.length;
      }
      if (bearState === "investigate" && path.length === 0) {
        searchLeft -= dt;
        bear.yaw += dt * 0.9;
        if (searchLeft <= 0) bearState = "patrol";
      }
    }
    moveActor(bear, speed, tx, tz, dt, bearState === "chase" ? 3.4 : 2.3, 0.42);
    for (const d of level.doors) {
      if (doorLocked(d)) continue;
      if (d.target < 0.5 && Math.hypot(d.x - bear.x, d.z - bear.z) < 1.3) setDoorTarget(d.id, 1, true);
    }
    tryCatch();
  }

  function tryCatch() {
    if (over || grace > 0) return;
    const dist = Math.hypot(player.x - bear.x, player.z - bear.z);
    const dy = Math.abs(player.y - bear.y);
    if (hiding) {
      const spot = level.hides.find((h) => h.id === hideId);
      if (spot && bearState === "chase" && Math.hypot(spot.x - bear.x, spot.z - bear.z) < 1.2 && dy < 1.6) {
        finish(false);
      }
      return;
    }
    if (dy < 1.35 && ((bearState === "chase" && dist < 1.08) || dist < 0.72)) finish(false);
  }

  function showResult(r: Result) {
    if (resultShown) return;
    resultShown = true;
    pending = null;
    hooks.onResult(r);
  }

  function finish(escaped: boolean) {
    if (over) return;
    over = true;
    hiding = false;
    const g = grade(time, noises, spots, escaped);
    const result: Result = { ...g, time, noises, spots, escaped, you: control === "bear" ? "bear" : "survivor" };
    if (escaped) sfx.escape();
    else {
      sfx.scream();
      scare = 1.05;
      shake = 1;
    }
    if (control !== "bear") {
      net?.({ t: "end", escaped, score: g.score, rank: g.rank, title: g.title, time, noises, spots }, true);
    } else if (!escaped) {
      net?.({ t: "grab" }, true);
      result.title = "Поймал";
    }
    if (escaped) showResult(result);
    else pending = result;
  }

  function goalText() {
    const front = level.doors.find((d) => d.id === "front");
    if (front && front.target > 0.5 && hasKey) return "Дверь открыта. Беги через порог во двор — на юг.";
    if (hasKey) return "Ключ у тебя. Открой парадную дверь на юге холла и выйди.";
    if (boards <= 0) return "Кухонное окно свободно. Подойди и нажми E.";
    if (hasHammer) return `Молоток есть. Досок на кухонном окне: ${boards}. Удар — E, это громко.`;
    if (!readNote) return "Записка в гостиной слева. Ключ — наверху, молоток — в кладовой.";
    return "Код кладовой 471. Ключ в восточной комнате на втором этаже. Тише на поворотах.";
  }

  function promptText() {
    if (!playing || over || paused) return "";
    if (hiding) return "E — вылезти";
    const spots = [
      { x: -4.75, y: 0.8, z: 3.7, r: 1.35, t: readNote ? "E — перечитать записку" : "E — записка" },
      { x: -3.6, y: 0.8, z: -8.05, r: 1.3, t: hasHammer ? "" : "E — взять молоток" },
      { x: 4.45, y: 3.35 + 0.9, z: -3.95, r: 1.35, t: hasKey ? "" : "E — забрать ключ" },
      { x: 7.35, y: 1.3, z: 3.0, r: 1.4, t: boards <= 0 ? "E — вылезти в окно" : hasHammer ? "E — бить доску" : "Нужен молоток" },
    ];
    for (const s of spots) {
      if (!s.t) continue;
      if (Math.hypot(player.x - s.x, player.z - s.z) < s.r && Math.abs(player.y - (s.y > 2 ? 3.35 : 0)) < 1.4) return s.t;
    }
    for (const h of level.hides) {
      if (Math.hypot(player.x - h.x, player.z - h.z) < 1.15 && Math.abs(player.y - h.y) < 1.2) return `E — ${h.label.toLowerCase()}`;
    }
    let best: DoorSpec | null = null;
    let bestD = 1.45;
    for (const d of level.doors) {
      const dist = Math.hypot(player.x - d.x, player.z - d.z);
      if (dist < bestD && Math.abs(player.y - (d.x === -0.75 ? 0 : player.y)) < 2) {
        best = d;
        bestD = dist;
      }
    }
    if (!best) return "";
    if (best.lock === "key" && !hasKey) return "Нужен ключ от парадной";
    if (best.lock === "code" && !codeOk) return "E — код кладовой";
    return best.target > 0.5 ? "E — закрыть дверь" : "E — открыть дверь";
  }

  function doInteract() {
    if (!playing || paused || over || control === "bear") {
      if (control === "bear" && playing && !over) {
        let best: DoorSpec | null = null;
        let bestD = 1.5;
        for (const d of level.doors) {
          const dist = Math.hypot(bear.x - d.x, bear.z - d.z);
          if (dist < bestD) {
            best = d;
            bestD = dist;
          }
        }
        if (best && !doorLocked(best)) setDoorTarget(best.id, best.target > 0.5 ? 0 : 1, true);
      }
      return;
    }
    if (noteOpen) {
      noteOpen = false;
      hooks.onNote(null);
      return;
    }
    if (padOpen) return;
    if (hiding) {
      hiding = false;
      hideId = "";
      hear(player.x, player.y, player.z, 4);
      return;
    }
    for (const h of level.hides) {
      if (Math.hypot(player.x - h.x, player.z - h.z) < 1.15 && Math.abs(player.y - h.y) < 1.2) {
        hiding = true;
        hideId = h.id;
        player.x = h.x;
        player.z = h.z;
        player.y = h.y;
        return;
      }
    }
    if (!hasKey && Math.hypot(player.x - 4.45, player.z + 3.95) < 1.35 && player.y > 2) {
      takeKey(true);
      return;
    }
    if (!hasHammer && Math.hypot(player.x + 3.6, player.z + 8.05) < 1.3 && player.y < 1.2) {
      takeHammer(true);
      return;
    }
    if (Math.hypot(player.x + 4.75, player.z - 3.7) < 1.35 && player.y < 1.2) {
      readNote = true;
      noteOpen = true;
      hooks.onNote(NOTE);
      return;
    }
    if (Math.hypot(player.x - 7.35, player.z - 3) < 1.4 && player.y < 1.4) {
      if (boards <= 0) {
        finish(true);
        return;
      }
      if (hasHammer) {
        hitBoard(true);
        return;
      }
    }
    let best: DoorSpec | null = null;
    let bestD = 1.45;
    for (const d of level.doors) {
      const dist = Math.hypot(player.x - d.x, player.z - d.z);
      if (dist < bestD) {
        best = d;
        bestD = dist;
      }
    }
    if (!best) return;
    if (best.lock === "code" && !codeOk) {
      padOpen = true;
      hooks.onPad(true);
      return;
    }
    if (best.lock === "key" && !hasKey) return;
    setDoorTarget(best.id, best.target > 0.5 ? 0 : 1, true);
  }

  function resetWorld() {
    player.x = SPAWN.x;
    player.y = 0;
    player.z = SPAWN.z;
    player.yaw = SPAWN.yaw;
    player.pitch = 0;
    bear.x = BEAR_SPAWN.x;
    bear.y = 0;
    bear.z = BEAR_SPAWN.z;
    bear.yaw = BEAR_SPAWN.yaw;
    ghostP.x = ghostP.tx = SPAWN.x;
    ghostP.z = ghostP.tz = SPAWN.z;
    ghostB.x = ghostB.tx = BEAR_SPAWN.x;
    ghostB.z = ghostB.tz = BEAR_SPAWN.z;
    ghostB.yaw = ghostB.tyaw = BEAR_SPAWN.yaw;
    hasKey = false;
    hasHammer = false;
    codeOk = false;
    readNote = false;
    boards = 3;
    hiding = false;
    flashOn = true;
    battery = 100;
    stamina = 100;
    time = 0;
    noises = 0;
    spots = 0;
    grace = 2.4;
    over = false;
    paused = false;
    noteOpen = false;
    padOpen = false;
    bearState = "patrol";
    patrolI = 0;
    path = [];
    scare = 0;
    resultShown = false;
    level.keyMesh.visible = true;
    level.hammerMesh.visible = true;
    for (const p of level.planks) p.visible = true;
    for (const d of level.doors) {
      d.open = 0;
      d.target = 0;
      syncDoorVisual(d);
    }
  }

  function pullGhost(g: Ghost, dt: number) {
    const k = 1 - Math.exp(-dt * 14);
    g.x += (g.tx - g.x) * k;
    g.y += (g.ty - g.y) * k;
    g.z += (g.tz - g.z) * k;
    g.yaw += shortest(g.yaw, g.tyaw) * k;
  }

  function step(dt: number) {
    grace = Math.max(0, grace - dt);
    for (const d of level.doors) {
      d.open += (d.target - d.open) * Math.min(1, dt * 7);
      syncDoorVisual(d);
    }
    if (!playing || paused) {
      lookX = 0;
      lookY = 0;
      return;
    }

    const inputLocked = noteOpen || padOpen || over;
    if (control === "survivor") {
      if (!over) time += dt;
      if (control === "survivor" && !aiBear) {
        /* remote player is us */
      }
      if (viewMode !== "top") {
        player.yaw -= lookX * 0.00215;
        player.pitch = clamp(player.pitch - lookY * 0.0018, -0.85, 0.7);
      }
      lookX = 0;
      lookY = 0;
      if (!inputLocked && !hiding) {
        const move = readMove(player.yaw, TURN, dt);
        player.yaw = move.yaw;
        const throttle = move.throttle;
        const crouch = crouchHeld || held("ControlLeft") || held("KeyC");
        const wantSprint = (sprintHeld || held("ShiftLeft") || held("ShiftRight")) && throttle > 0.15 && !crouch;
        const sprinting = wantSprint && stamina > 6;
        if (sprinting) stamina = Math.max(0, stamina - 28 * dt);
        else stamina = Math.min(100, stamina + 16 * dt);
        const sp = crouch ? CROUCH : sprinting ? SPRINT : WALK;
        const f = yawToForward(player.yaw);
        const beforeX = player.x;
        const beforeZ = player.z;
        player.x += f.x * throttle * sp * dt;
        player.z += f.z * throttle * sp * dt;
        const c = collide(player.x, player.z, player.y, crouch ? 1.05 : 1.65, 0.32);
        player.x = c.x;
        player.z = c.z;
        player.y = supportY(player.x, player.z, player.y);
        const moved = Math.hypot(player.x - beforeX, player.z - beforeZ);
        horizSpeed = moved / dt;
        if (moved > 0.002) {
          stepAcc += moved;
          const stride = crouch ? 0.85 : sprinting ? 1.15 : 0.95;
          if (stepAcc >= stride) {
            stepAcc = 0;
            sfx.step(crouch ? "crouch" : sprinting ? "run" : "walk");
            const radius = crouch ? 2.1 : sprinting ? 13.5 : 6.2;
            hear(player.x, player.y, player.z, radius);
            if (sprinting) noises += 1;
            else if (!crouch) noises += 0.25;
          }
        } else horizSpeed = 0;
        phaseH += dt * (2 + horizSpeed * 1.4);
      } else {
        horizSpeed = 0;
        if (!aiBear) {
          pullGhost(ghostP, dt);
        }
      }
      if (hasKey && player.z > 8.15 && player.y < 0.8) {
        const front = level.doors.find((d) => d.id === "front");
        if (front && front.open > 0.7) finish(true);
      }
    } else {
      time += dt;
      if (viewMode !== "top") bear.yaw -= lookX * 0.00215;
      lookX = 0;
      lookY = 0;
      if (!inputLocked && !over) {
        const move = readMove(bear.yaw, 2.1, dt);
        bear.yaw = move.yaw;
        const throttle = move.throttle;
        const f = yawToForward(bear.yaw);
        const sp = 3.35;
        bear.x += f.x * throttle * sp * dt;
        bear.z += f.z * throttle * sp * dt;
        const c = collide(bear.x, bear.z, bear.y, 2.1, 0.42);
        bear.x = c.x;
        bear.z = c.z;
        bear.y = supportY(bear.x, bear.z, bear.y);
        horizSpeed = Math.abs(throttle) * sp;
        phaseB += dt * (2 + horizSpeed);
        for (const d of level.doors) {
          if (!doorLocked(d) && d.target < 0.5 && Math.hypot(d.x - bear.x, d.z - bear.z) < 1.15) {
            setDoorTarget(d.id, 1, true);
          }
        }
      }
      pullGhost(ghostP, dt);
      player.x = ghostP.x;
      player.y = ghostP.y;
      player.z = ghostP.z;
      player.yaw = ghostP.yaw;
      const dist = Math.hypot(player.x - bear.x, player.z - bear.z);
      if (!over && grace <= 0 && dist < 1.12 && Math.abs(player.y - bear.y) < 1.4) finish(false);
    }

    if (control === "survivor") updateBear(dt);
    else {
      /* bear is local, survivor ghost already applied */
    }

    if (flashOn && control === "survivor") battery = Math.max(0, battery - dt * 0.32);
    if (battery <= 0) flashOn = false;

    const interact = tapInteract || held("KeyE");
    tapInteract = false;
    if (interact && !prevInteract) doInteract();
    prevInteract = interact;

    sendAcc += dt;
    if (sendAcc > 1 / 14 && net && playing && !over) {
      sendAcc = 0;
      if (control === "survivor") {
        net(
          { t: "p", x: player.x, y: player.y, z: player.z, yaw: player.yaw, c: crouchHeld ? 1 : 0, h: hiding ? 1 : 0 },
          false,
        );
        if (aiBear) {
          net({ t: "b", x: bear.x, y: bear.y, z: bear.z, yaw: bear.yaw, st: bearState }, false);
        }
      } else {
        net({ t: "b", x: bear.x, y: bear.y, z: bear.z, yaw: bear.yaw, st: "chase" }, false);
      }
    }
  }

  // The flashlight toggle above is messy. Replace with a clean edge in the loop by rewriting prev logic.
  // Kept simple in stepFlash() called from step — see fixup function used instead.
  function toggleFlash() {
    if (control !== "survivor" || battery <= 0) return;
    flashOn = !flashOn;
  }

  function render(dt: number) {
    const elapsed = timer.getElapsed();
    clockAcc += dt;
    if (playing && clockAcc > 1) {
      clockAcc = 0;
      sfx.tick();
    }
    const px = control === "bear" ? bear.x : player.x;
    const py = control === "bear" ? bear.y : player.y;
    const pz = control === "bear" ? bear.z : player.z;
    const yaw = control === "bear" ? bear.yaw : player.yaw;
    const crouch = control === "survivor" && (hiding || crouchHeld || held("ControlLeft") || held("KeyC"));

    const f = yawToForward(player.yaw);
    human.root.position.set(player.x, player.y, player.z);
    human.root.lookAt(player.x + f.x, player.y, player.z + f.z);
    animateHuman(human, phaseH, control === "survivor" ? horizSpeed : 0, crouch || hiding);

    const bf = yawToForward(bear.yaw);
    grandma.root.position.set(bear.x, bear.y, bear.z);
    grandma.root.lookAt(bear.x + bf.x, bear.y, bear.z + bf.z);
    const huntSpeed = control === "bear" ? horizSpeed : bearState === "chase" ? 3.2 : 1.4;
    animateHuman(grandma, phaseB, huntSpeed, false);
    phaseB += dt * 3;

    let draw: THREE.Camera = camera;
    renderer.clippingPlanes = [];
    if (!playing) {
      const a = elapsed * 0.22;
      camera.position.set(Math.sin(a) * 3.2, 2.15, 10.2);
      camera.lookAt(0.2, 1.35, 5.2);
      human.root.position.set(-0.35, 0, 5.35);
      human.root.lookAt(0, 1, 8);
      animateHuman(human, elapsed * 2, 0, false);
      grandma.root.position.set(1.55, 0, 7.55);
      grandma.root.lookAt(camera.position.x, 1.1, camera.position.z);
      animateHuman(grandma, elapsed * 2.2, 0.4, false);
      level.flash.intensity = 0;
      renderer.clippingPlanes = [];
      showCast();
    } else if (scare > 0) {
      scare -= dt;
      const face = yawToForward(bear.yaw);
      camera.position.set(bear.x + face.x * 0.85, bear.y + 1.65, bear.z + face.z * 0.85);
      camera.lookAt(bear.x, bear.y + 1.7, bear.z);
      level.flash.intensity = 0;
      if (scare <= 0 && pending) showResult(pending);
    } else if (viewMode === "top") {
      const aspect = camera.aspect || 1;
      const halfH = 7.4;
      ortho.left = -halfH * aspect;
      ortho.right = halfH * aspect;
      ortho.top = halfH;
      ortho.bottom = -halfH;
      ortho.position.set(px, 22, pz);
      ortho.up.set(0, 0, -1);
      ortho.lookAt(px, 0, pz);
      ortho.updateProjectionMatrix();
      human.root.visible = !hiding;
      grandma.root.visible = true;
      level.flash.position.set(px, 8, pz);
      level.flash.target.position.set(px, 0, pz);
      level.flash.intensity = flashOn && battery > 0 && control === "survivor" ? 90 : 0;
      renderer.clippingPlanes = [clipPlane];
      clipPlane.constant = py > 1.6 ? 5.85 : 2.95;
      draw = ortho;
    } else {
      renderer.clippingPlanes = [];
      const eye = py + (crouch ? 1.05 : 1.55);
      const dist = crouch ? 2.35 : 3.25;
      const ff = yawToForward(yaw);
      let cx = px - ff.x * dist;
      let cy = eye + 0.45 - player.pitch * 0.3;
      let cz = pz - ff.z * dist;
      const samples = 8;
      let fx = px;
      let fy = eye;
      let fz = pz;
      for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        const sx = px + (cx - px) * t;
        const sy = eye + (cy - eye) * t;
        const sz = pz + (cz - pz) * t;
        if (blocked(sx, sy, sz)) break;
        fx = sx;
        fy = sy;
        fz = sz;
      }
      shake *= Math.max(0, 1 - dt * 2.4);
      const sx = (Math.random() - 0.5) * shake * 0.25;
      const sy = (Math.random() - 0.5) * shake * 0.18;
      camera.position.set(fx + sx, fy + sy + Math.sin(phaseH * 2) * 0.02, fz);
      const look = tmp.set(px + ff.x * 2.2, eye + 0.1 + Math.sin(player.pitch) * 1.6, pz + ff.z * 2.2);
      camera.lookAt(look);
      const camDist = Math.hypot(camera.position.x - px, camera.position.z - pz);
      human.root.visible = control === "bear" ? true : !hiding && camDist > 0.9;
      grandma.root.visible = control === "survivor" ? true : camDist > 0.9;

      level.flash.position.copy(camera.position);
      level.flash.target.position.copy(look);
      level.flash.intensity = flashOn && battery > 0 && control === "survivor" && playing ? 280 * clamp(battery / 20, 0.25, 1) : 0;
    }

    const near = Math.hypot(player.x - bear.x, player.z - bear.z);
    const closeness = clamp(1 - near / 10, 0, 1) * (playing ? 1 : 0);
    sfx.heartbeat(bearState === "chase" ? Math.max(closeness, 0.35) : closeness * 0.65);

    hooks.onHud({
      time: formatTime(time),
      goal: playing ? goalText() : "",
      prompt: promptText(),
      stamina,
      battery,
      flash: flashOn,
      hasKey,
      hasHammer,
      boards,
      bearNear: closeness,
      crouch: crouchHeld || hiding,
      you: control,
    });

    renderer.render(scene, draw);
  }

  let acc = 0;
  let raf = 0;
  let dead = false;
  function frame(now: number) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.1);
    acc += dt;
    let steps = 0;
    while (acc >= 1 / 60 && steps < 5) {
      // look is consumed inside step; only first physics step should eat the whole mouse delta
      const lx = lookX;
      const ly = lookY;
      lookX = 0;
      lookY = 0;
      if (steps === 0) {
        lookX = lx;
        lookY = ly;
      }
      step(1 / 60);
      steps++;
    }
    render(dt);
  }
  raf = requestAnimationFrame(frame);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === "Tab") e.preventDefault();
    keys.add(e.code);
    if (e.code === "KeyF") toggleFlash();
    if (e.code === "Escape" && playing && !over) {
      paused = !paused;
      hooks.onPause(paused);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  const onMove = (e: MouseEvent) => {
    if (document.pointerLockElement === canvas) {
      lookX += e.movementX;
      lookY += e.movementY;
    }
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", onMove);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const probe = {
    getYaw: () => (control === "bear" && modeStarted ? bear.yaw : player.yaw),
    getSpeed: () => horizSpeed,
    setKeys: (codes: string[]) => {
      forced = new Set(codes);
    },
    setSteer: (v: number) => {
      forced = new Set(["KeyW", v > 0 ? "KeyA" : "KeyD"]);
    },
  };
  window.__controlsTest = probe;

  hooks.onReady();

  // Fix flashlight: the inner step() toggles in a confusing way. Neutralize by
  // redefining consumption — step() currently may double-toggle. Track cleanly.
  prevFlash = false;

  return {
    sfx,
    start(mode) {
      control = mode.control;
      aiBear = mode.aiBear;
      if (mode.view) viewMode = mode.view;
      if (mode.survivor) human = survivorLooks[mode.survivor];
      if (mode.grandma) grandma = grandmaLooks[mode.grandma];
      showCast();
      resetWorld();
      playing = true;
      modeStarted = true;
      paused = false;
      document.body.focus();
    },
    setCast(cast) {
      human = survivorLooks[cast.survivor];
      grandma = grandmaLooks[cast.grandma];
      viewMode = cast.view;
      showCast();
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      timer.disconnect();
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      if (window.__controlsTest === probe) delete window.__controlsTest;
      sfx.dispose();
      renderer.dispose();
    },
    setStick(x, y) {
      stickX = x;
      stickY = y;
    },
    addLook(dx, dy) {
      lookX += dx;
      lookY += dy;
    },
    hold(what, on) {
      if (what === "crouch") crouchHeld = on;
      else sprintHeld = on;
    },
    tap(what) {
      if (what === "interact") tapInteract = true;
      else if (what === "flash") toggleFlash();
      else if (playing && !over) {
        paused = !paused;
        hooks.onPause(paused);
      }
    },
    enterCode(code) {
      padOpen = false;
      hooks.onPad(false);
      if (code === "471") unlockCode(true);
      else {
        sfx.wrong();
        noises += 1;
        shake = 0.4;
        hear(player.x, player.y, player.z, 12);
      }
    },
    closeOverlay() {
      noteOpen = false;
      padOpen = false;
      hooks.onNote(null);
      hooks.onPad(false);
    },
    resume() {
      paused = false;
      hooks.onPause(false);
    },
    toMenu() {
      playing = false;
      paused = false;
      over = false;
      modeStarted = false;
      horizSpeed = 0;
    },
    applyNet(msg) {
      if (msg.t === "p") {
        ghostP.tx = msg.x;
        ghostP.ty = msg.y;
        ghostP.tz = msg.z;
        ghostP.tyaw = msg.yaw;
        if (control === "bear") hiding = msg.h > 0;
      } else if (msg.t === "b") {
        ghostB.tx = msg.x;
        ghostB.ty = msg.y;
        ghostB.tz = msg.z;
        ghostB.tyaw = msg.yaw;
        if (control === "survivor" && !aiBear && msg.st === "chase" && lastBearSt !== "chase") spots += 1;
        lastBearSt = msg.st;
        if (!aiBear) bearState = msg.st === "chase" ? "chase" : "investigate";
      } else if (msg.t === "door") {
        const d = level.doors.find((door) => door.id === msg.id);
        if (d && !doorLocked(d)) d.target = msg.open;
      } else if (msg.t === "item") {
        if (msg.id === "key") takeKey(false);
        else if (msg.id === "hammer") takeHammer(false);
        else if (msg.id === "code") {
          codeOk = true;
          const d = level.doors.find((door) => door.id === "cellar");
          if (d) d.target = 1;
        } else if (msg.id === "board") {
          if (boards > 0) {
            boards -= 1;
            const plank = level.planks[boards];
            if (plank) plank.visible = false;
          }
        }
      } else if (msg.t === "noise") hear(msg.x, msg.y, msg.z, msg.r);
      else if (msg.t === "grab" && control === "survivor") finish(false);
      else if (msg.t === "end") {
        over = true;
        const r: Result = {
          escaped: msg.escaped,
          score: msg.score,
          rank: msg.rank,
          title: control === "bear" ? (msg.escaped ? "Ушёл" : "Поймал") : msg.title,
          time: msg.time,
          noises: msg.noises,
          spots: msg.spots,
          you: control,
        };
        if (scare > 0 || pending) pending = resultShown ? null : r;
        else showResult(r);
      }
    },
    setNet(send) {
      net = send;
    },
  };
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setKeys?: (codes: string[]) => void;
      setSteer?: (v: number) => void;
    };
  }
}
