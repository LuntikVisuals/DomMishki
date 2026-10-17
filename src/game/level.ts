import * as THREE from "three";

export type Box = {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  on: boolean;
};

export type NavNode = {
  id: string;
  x: number;
  y: number;
  z: number;
  links: string[];
};

export type DoorSpec = {
  id: string;
  x: number;
  z: number;
  /** Wall runs along Z (hinge swings around Y, panel extends on Z when closed). */
  along: "z" | "x";
  lock: "key" | "code" | null;
  box: Box;
  pivot: THREE.Group;
  open: number;
  target: number;
};

export type HideSpot = { id: string; x: number; y: number; z: number; label: string };

export type Level = {
  colliders: Box[];
  doors: DoorSpec[];
  nodes: NavNode[];
  hides: HideSpot[];
  planks: THREE.Mesh[];
  keyMesh: THREE.Object3D;
  hammerMesh: THREE.Object3D;
  noteMesh: THREE.Object3D;
  flash: THREE.SpotLight;
};

export const UPPER = 3.35;
export const STAIR = { x0: -1.38, x1: -0.12, z0: -4.15, z1: 4.15 };
export const SPAWN = { x: 0.62, y: 0, z: 3.35, yaw: 0 };
export const BEAR_SPAWN = { x: 4.55, y: 0, z: 2.4, yaw: Math.PI };

export function supportY(x: number, z: number, currentY: number): number {
  if (x >= STAIR.x0 && x <= STAIR.x1 && z >= STAIR.z0 && z <= STAIR.z1) {
    const t = (STAIR.z1 - z) / (STAIR.z1 - STAIR.z0);
    return Math.min(1, Math.max(0, t)) * UPPER;
  }
  if (currentY > 1.45) return UPPER;
  return 0;
}

function canvasTex(
  paint: (g: CanvasRenderingContext2D, s: number) => void,
  repeat: [number, number],
): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const g = c.getContext("2d");
  if (!g) throw new Error("canvas");
  paint(g, s);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildLevel(scene: THREE.Scene): Level {
  const colliders: Box[] = [];
  const floorTex = canvasTex((g, s) => {
    g.fillStyle = "#3a2a20";
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 === 0 ? "#4a3428" : "#32241c";
      g.fillRect(0, i * 32, s, 30);
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.beginPath();
      g.moveTo(0, i * 32 + 30);
      g.lineTo(s, i * 32 + 30);
      g.stroke();
    }
  }, [4, 4]);
  const wallTex = canvasTex((g, s) => {
    g.fillStyle = "#5c4a3e";
    g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 28) {
      g.fillStyle = x % 56 === 0 ? "#6a5648" : "#534438";
      g.fillRect(x, 0, 26, s);
    }
    g.fillStyle = "rgba(40,24,16,0.18)";
    for (let y = 0; y < s; y += 40) g.fillRect(0, y, s, 3);
  }, [2, 2]);
  const brickTex = canvasTex((g, s) => {
    g.fillStyle = "#3a2a28";
    g.fillRect(0, 0, s, s);
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 16 : 0;
      for (let x = -32; x < s; x += 32) {
        g.fillStyle = (row + x) % 64 === 0 ? "#4a3432" : "#322422";
        g.fillRect(x + off, row * 32, 30, 28);
      }
    }
  }, [2, 1]);

  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.86, metalness: 0.02 });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a1e18, roughness: 0.8 });
  const brickMat = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.92 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.95 });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0x3d2c28, roughness: 0.95 });
  const cloth2 = new THREE.MeshStandardMaterial({ color: 0x243038, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.4, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.7 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xe6d7b8, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9bb4c8,
    transparent: true,
    opacity: 0.18,
    roughness: 0.05,
    metalness: 0.1,
  });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a301c, roughness: 0.78 });
  const yardMat = new THREE.MeshStandardMaterial({ color: 0x141812, roughness: 1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a05a, roughness: 0.35, metalness: 0.7 });

  const add = (
    mat: THREE.Material,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    solid = false,
  ) => {
    const w = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.02), Math.max(h, 0.02), Math.max(d, 0.02)), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = solid;
    m.receiveShadow = true;
    scene.add(m);
    if (solid) colliders.push({ x0, y0, z0, x1, y1, z1, on: true });
    return m;
  };

  // Ground floors and yard
  add(floorMat, -8.2, -0.22, -9.9, 8.2, 0, 6.15);
  add(yardMat, -6, -0.24, 6.15, 6, 0, 11);
  add(floorMat, -7.6, -0.2, -9.9, -2.2, 0, -6);

  // Upper slabs with a stair well
  add(floorMat, -8, 3.18, -6, -1.38, 3.38, 6);
  add(floorMat, -0.12, 3.18, -6, 8, 3.38, 6);
  add(floorMat, -1.38, 3.18, -6, -0.12, 3.38, -4.15);
  add(floorMat, -1.38, 3.18, 4.15, -0.12, 3.38, 6);

  // Roof
  add(roofMat, -8.6, 6.05, -6.5, 8.6, 6.45, 6.5);
  add(trimMat, -0.4, 6.4, -1.2, 0.4, 7.3, -0.4);

  const T = 0.3;
  // South wall (front / exit) with door
  add(wallMat, -8, 0, 6, -0.75, 6.05, 6 + T, true);
  add(wallMat, 0.75, 0, 6, 8, 6.05, 6 + T, true);
  add(wallMat, -0.75, 2.5, 6, 0.75, 6.05, 6 + T, true);
  // North wall with cellar door
  add(wallMat, -8, 0, -6 - T, -5.75, 6.05, -6, true);
  add(wallMat, -4.05, 0, -6 - T, 8, 6.05, -6, true);
  add(wallMat, -5.75, 2.45, -6 - T, -4.05, 6.05, -6, true);
  // West wall, living window + upper window
  add(wallMat, -8 - T, 0, -6, -8, 6.05, 1.4, true);
  add(wallMat, -8 - T, 0, 3.3, -8, 6.05, 6, true);
  add(wallMat, -8 - T, 0, 1.4, -8, 1.05, 3.3, true);
  add(wallMat, -8 - T, 2.5, 1.4, -8, 4.15, 3.3, true);
  add(wallMat, -8 - T, 5.35, 1.4, -8, 6.05, 3.3, true);
  add(wallMat, -8 - T, 4.15, 1.4, -8, 5.35, 1.85, true);
  add(wallMat, -8 - T, 4.15, 2.85, -8, 5.35, 3.3, true);
  // East wall, kitchen escape window + upper
  add(wallMat, 8, 0, -6, 8 + T, 6.05, 2.15, true);
  add(wallMat, 8, 0, 3.85, 8 + T, 6.05, 6, true);
  add(wallMat, 8, 0, 2.15, 8 + T, 0.9, 3.85, true);
  add(wallMat, 8, 2.5, 2.15, 8 + T, 6.05, 3.85, true);

  // Glass (not solid)
  add(glass, -8.02, 1.05, 1.45, -7.96, 2.5, 3.25);
  add(glass, 7.96, 0.9, 2.2, 8.02, 2.5, 3.8);
  add(glass, -8.02, 4.2, 1.9, -7.96, 5.3, 2.8);

  // Cellar shell
  add(brickMat, -7.6, 0, -10, -2.2, 2.7, -9.7, true);
  add(brickMat, -7.6, 0, -9.7, -7.3, 2.7, -6, true);
  add(brickMat, -2.5, 0, -9.7, -2.2, 2.7, -6, true);
  add(brickMat, -7.6, 2.45, -9.7, -2.2, 2.7, -6);

  // Interior ground walls
  // West hall wall with two doors
  add(wallMat, -1.72, 0, -6, -1.42, 3.15, -3.55, true);
  add(wallMat, -1.72, 0, -2.15, -1.42, 3.15, 1.85, true);
  add(wallMat, -1.72, 0, 3.25, -1.42, 3.15, 6, true);
  add(trimMat, -1.72, 2.35, -3.55, -1.42, 3.15, -2.15, true);
  add(trimMat, -1.72, 2.35, 1.85, -1.42, 3.15, 3.25, true);
  // East hall wall
  add(wallMat, 1.42, 0, -6, 1.72, 3.15, -3.55, true);
  add(wallMat, 1.42, 0, -2.15, 1.72, 3.15, 1.85, true);
  add(wallMat, 1.42, 0, 3.25, 1.72, 3.15, 6, true);
  add(trimMat, 1.42, 2.35, -3.55, 1.72, 3.15, -2.15, true);
  add(trimMat, 1.42, 2.35, 1.85, 1.72, 3.15, 3.25, true);
  // Living / study divider
  add(wallMat, -8, 0, -0.16, -5.3, 3.15, 0.16, true);
  add(wallMat, -3.7, 0, -0.16, -1.72, 3.15, 0.16, true);
  add(trimMat, -5.3, 2.35, -0.16, -3.7, 3.15, 0.16, true);
  // Kitchen / bedroom divider
  add(wallMat, 1.72, 0, -0.16, 3.5, 3.15, 0.16, true);
  add(wallMat, 5.1, 0, -0.16, 8, 3.15, 0.16, true);
  add(trimMat, 3.5, 2.35, -0.16, 5.1, 3.15, 0.16, true);

  // Upper rail so you don't think the well is floor — visual posts only, stair handles support
  for (const z of [-3.6, -1.8, 0, 1.8, 3.6]) {
    add(trimMat, -0.18, 3.38, z, -0.08, 4.3, z + 0.1);
  }

  // Stair steps (visual)
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const zA = STAIR.z1 - t1 * (STAIR.z1 - STAIR.z0);
    const zB = STAIR.z1 - t0 * (STAIR.z1 - STAIR.z0);
    const y = t0 * UPPER;
    add(wood, STAIR.x0, y, zA, STAIR.x1, y + 0.12, zB);
  }

  // Yard fence, open at the south end of the walk so the escape reads
  add(trimMat, -3.4, 0, 6.2, -3.15, 1.1, 9.4, true);
  add(trimMat, 3.15, 0, 6.2, 3.4, 1.1, 9.4, true);
  add(trimMat, -3.4, 0, 9.5, 3.4, 1.15, 9.8, true);

  // Porch posts
  add(trimMat, -1.5, 0, 6.4, -1.25, 2.8, 6.7);
  add(trimMat, 1.25, 0, 6.4, 1.5, 2.8, 6.7);
  add(roofMat, -2.2, 2.7, 6.15, 2.2, 2.95, 8.2);

  // Dead tree
  add(trimMat, 4.5, 0, 8.2, 4.85, 2.4, 8.55);
  add(dark, 4.2, 2.1, 7.9, 5.3, 2.7, 9.0);
  add(dark, 3.9, 2.4, 8.3, 4.6, 2.9, 8.8);

  // Furniture — kept off door gaps
  // Living: sofa, table, note
  add(cloth2, -7.5, 0, 2.3, -6.3, 0.85, 4.4, true);
  add(wood, -6.7, 0.85, 2.55, -6.35, 1.15, 4.15);
  add(wood, -5.4, 0.35, 3.15, -4.15, 0.7, 4.15, true);
  const noteMesh = add(paper, -4.95, 0.7, 3.5, -4.55, 0.74, 3.9);
  add(trimMat, -7.7, 1.3, 0.5, -7.55, 2.3, 1.5); // painting

  // Study
  add(wood, -7.4, 0.7, -4.6, -5.7, 1.15, -3.3, true);
  add(trimMat, -7.55, 0, -5.5, -6.9, 2.2, -4.7, true);
  add(wood, -5.2, 0, -4.2, -4.85, 0.9, -3.7);

  // Kitchen
  add(wood, 6.3, 0, 1.9, 7.7, 0.95, 5.5, true);
  add(metal, 6.5, 0.95, 4.5, 7.5, 1.9, 5.4);
  add(wood, 3.3, 0.4, 2.6, 5.3, 0.78, 4.2, true); // table — hide
  add(wood, 3.45, 0, 2.35, 3.7, 0.4, 2.6);
  add(wood, 4.9, 0, 2.35, 5.15, 0.4, 2.6);

  // Ground bedroom
  add(clothMat, 3.1, 0.25, -5.2, 5.4, 0.7, -3.7, true);
  add(trimMat, 3.2, 0.7, -5.15, 5.3, 0.95, -4.7);
  add(wood, 6.2, 0, -5.4, 7.5, 2.1, -4.3, true);

  // Hall closet (hide) and clock
  add(wood, 0.85, 0, -5.7, 1.4, 2.3, -4.55, true);
  add(trimMat, -1.3, 0, -5.55, -0.7, 2.15, -5.15);

  // Cellar crate + shelf
  add(wood, -6.8, 0, -8.8, -5.5, 1.3, -7.6, true);
  add(wood, -4.2, 0.15, -8.6, -3.1, 0.7, -7.5, true);

  // Upper west bed + wardrobe hide
  add(clothMat, -7.2, UPPER, -4.8, -4.6, UPPER + 0.55, -2.6, true);
  add(wood, -7.55, UPPER, -1.2, -6.55, UPPER + 2.2, 0.35, true);
  // Upper east dresser (key) + crib
  add(wood, 3.4, UPPER, -4.6, 5.5, UPPER + 0.85, -3.3, true);
  add(wood, 5.8, UPPER + 0.2, -2.2, 7.3, UPPER + 0.85, -0.6, true);

  // Runner rugs
  add(cloth2, 0.15, 0.01, -3.2, 1.15, 0.04, 3.2);

  const planks: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const p = add(wood, 7.82, 1.05 + i * 0.42, 2.3, 7.98, 1.32 + i * 0.42, 3.7);
    planks.push(p);
  }

  const hammerMesh = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8), wood);
  handle.rotation.z = 0.4;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.1), metal);
  head.position.set(0.12, 0.22, 0);
  hammerMesh.add(handle, head);
  hammerMesh.position.set(-3.6, 0.85, -8.05);
  scene.add(hammerMesh);

  const keyMesh = new THREE.Group();
  const bowK = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 8, 14), gold);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), gold);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 0.1;
  keyMesh.add(bowK, shaft);
  keyMesh.position.set(4.45, UPPER + 0.9, -3.95);
  keyMesh.rotation.y = 0.4;
  scene.add(keyMesh);

  // Doors
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.75 });
  const doors: DoorSpec[] = [];
  const makeDoor = (
    id: string,
    x: number,
    z: number,
    along: "z" | "x",
    lock: "key" | "code" | null,
    gap: Box,
  ) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0, z);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(along === "z" ? 0.08 : 1.2, 2.25, along === "z" ? 1.2 : 0.08), doorMat);
    if (along === "z") panel.position.set(0.04, 1.12, 0.6);
    else panel.position.set(0.6, 1.12, 0.04);
    panel.castShadow = true;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), gold);
    knob.position.copy(panel.position);
    if (along === "z") knob.position.x = 0.1;
    else knob.position.z = 0.1;
    knob.position.y = 1.05;
    pivot.add(panel, knob);
    scene.add(pivot);
    const box: Box = { ...gap, on: true };
    colliders.push(box);
    doors.push({ id, x, z, along, lock, box, pivot, open: 0, target: 0 });
  };

  // Hall doors, hinge on the south side of each gap so they swing into rooms
  makeDoor("living", -1.57, 1.85, "z", null, { x0: -1.78, y0: 0, z0: 1.85, x1: -1.36, y1: 2.3, z1: 3.25, on: true });
  makeDoor("study", -1.57, -3.55, "z", null, { x0: -1.78, y0: 0, z0: -3.55, x1: -1.36, y1: 2.3, z1: -2.15, on: true });
  makeDoor("kitchen", 1.57, 1.85, "z", null, { x0: 1.36, y0: 0, z0: 1.85, x1: 1.78, y1: 2.3, z1: 3.25, on: true });
  makeDoor("bedroom", 1.57, -3.55, "z", null, { x0: 1.36, y0: 0, z0: -3.55, x1: 1.78, y1: 2.3, z1: -2.15, on: true });
  makeDoor("crossL", -5.3, -0.02, "x", null, { x0: -5.3, y0: 0, z0: -0.2, x1: -3.7, y1: 2.3, z1: 0.2, on: true });
  makeDoor("crossR", 3.5, -0.02, "x", null, { x0: 3.5, y0: 0, z0: -0.2, x1: 5.1, y1: 2.3, z1: 0.2, on: true });
  makeDoor("cellar", -5.75, -6.05, "x", "code", { x0: -5.75, y0: 0, z0: -6.25, x1: -4.05, y1: 2.4, z1: -5.8, on: true });
  makeDoor("front", -0.75, 6.02, "x", "key", { x0: -0.75, y0: 0, z0: 5.95, x1: 0.75, y1: 2.45, z1: 6.3, on: true });

  const nodes: NavNode[] = [
    { id: "hallS", x: 0.55, y: 0, z: 3.6, links: ["hallM", "liv", "kit", "stairB", "front"] },
    { id: "hallM", x: 0.55, y: 0, z: 0.15, links: ["hallS", "hallN"] },
    { id: "hallN", x: 0.55, y: 0, z: -3.5, links: ["hallM", "study", "bed"] },
    { id: "liv", x: -4.3, y: 0, z: 2.2, links: ["hallS", "livN"] },
    { id: "livN", x: -4.6, y: 0, z: 0.7, links: ["liv", "study"] },
    { id: "study", x: -4.6, y: 0, z: -2.8, links: ["hallN", "livN", "cellar"] },
    { id: "cellar", x: -4.9, y: 0, z: -7.8, links: ["study"] },
    { id: "kit", x: 4.4, y: 0, z: 2.0, links: ["hallS", "kitN"] },
    { id: "kitN", x: 4.6, y: 0, z: 0.8, links: ["kit", "bed"] },
    { id: "bed", x: 4.7, y: 0, z: -2.6, links: ["hallN", "kitN"] },
    { id: "front", x: 0.1, y: 0, z: 5.3, links: ["hallS", "porch"] },
    { id: "porch", x: 0.1, y: 0, z: 7.6, links: ["front"] },
    { id: "stairB", x: -0.75, y: 0.2, z: 3.5, links: ["hallS", "stairM"] },
    { id: "stairM", x: -0.75, y: 1.7, z: 0, links: ["stairB", "stairT"] },
    { id: "stairT", x: -0.75, y: UPPER, z: -3.7, links: ["stairM", "loftW", "loftE"] },
    { id: "loftW", x: -4.8, y: UPPER, z: -1.4, links: ["stairT", "loftS"] },
    { id: "loftE", x: 4.2, y: UPPER, z: -2.2, links: ["stairT", "loftS"] },
    { id: "loftS", x: 2.2, y: UPPER, z: 2.4, links: ["loftW", "loftE"] },
  ];

  const hides: HideSpot[] = [
    { id: "table", x: 4.3, y: 0, z: 3.4, label: "Под стол" },
    { id: "closet", x: 1.12, y: 0, z: -5.15, label: "В шкаф" },
    { id: "wardrobe", x: -7.05, y: UPPER, z: -0.4, label: "В гардероб" },
  ];

  // Lights
  const hemi = new THREE.HemisphereLight(0x8aa0c0, 0x3a2418, 1.15);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xc5d2ee, 6.5);
  moon.position.set(-12, 22, 14);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.near = 2;
  moon.shadow.camera.far = 50;
  moon.shadow.camera.left = -16;
  moon.shadow.camera.right = 16;
  moon.shadow.camera.top = 16;
  moon.shadow.camera.bottom = -16;
  moon.shadow.bias = -0.0006;
  scene.add(moon);

  const bulb = (x: number, y: number, z: number, intensity: number, color = 0xffb07a) => {
    const l = new THREE.PointLight(color, intensity, 8, 2);
    l.position.set(x, y, z);
    scene.add(l);
  };
  bulb(0.4, 2.5, 1.2, 70);
  bulb(-4.8, 2.4, 2.6, 55);
  bulb(-5.2, 2.3, -3.2, 40);
  bulb(4.8, 2.4, 3.2, 48);
  bulb(4.6, 2.3, -3.4, 36);
  bulb(-5, 2.2, -8, 60, 0xffe2b0);
  bulb(-4.5, UPPER + 2.1, -2, 46);
  bulb(4.2, UPPER + 2.1, -1.5, 46);
  bulb(0, 3.2, 8.4, 220, 0xffc89a);
  bulb(0.2, 2.6, 5.6, 90, 0xffb07a);

  const flash = new THREE.SpotLight(0xffe2b8, 0, 22, 0.55, 0.45, 1.2);
  flash.castShadow = false;
  scene.add(flash);
  scene.add(flash.target);

  scene.background = new THREE.Color(0x121820);
  scene.fog = new THREE.FogExp2(0x141820, 0.014);

  // Moon disc
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xf4f0e4 }),
  );
  moonMesh.position.set(-18, 16, 22);
  scene.add(moonMesh);

  return { colliders, doors, nodes, hides, planks, keyMesh, hammerMesh, noteMesh, flash };
}
