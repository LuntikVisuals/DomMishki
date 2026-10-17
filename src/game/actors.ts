import * as THREE from "three";

export type HumanRig = {
  root: THREE.Group;
  rig: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
};

export type BearRig = {
  root: THREE.Group;
  rig: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  jaw: THREE.Group;
  head: THREE.Group;
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadows = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

export type SurvivorLook = "hood" | "coat" | "cap";
export type GrandmaLook = "shawl" | "coat" | "braid";

export function createSurvivor(look: SurvivorLook = "hood"): HumanRig {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0b090, roughness: 0.62 });
  const cloth = new THREE.MeshStandardMaterial({
    color: look === "coat" ? 0x6a4634 : look === "cap" ? 0x1d4a3a : 0x243044,
    roughness: 0.86,
  });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.9 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.55 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9c2b2, roughness: 0.35, metalness: 0.6 });

  const legGeo = new THREE.BoxGeometry(0.15, 0.78, 0.16);
  const shoeGeo = new THREE.BoxGeometry(0.16, 0.08, 0.26);
  const makeLeg = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.86, 0);
    const leg = mesh(legGeo, pants);
    leg.position.y = -0.39;
    const foot = mesh(shoeGeo, shoe);
    foot.position.set(0, -0.78, 0.04);
    pivot.add(leg, foot);
    return pivot;
  };
  const legL = makeLeg(-0.11);
  const legR = makeLeg(0.11);
  rig.add(legL, legR);

  const torso = mesh(new THREE.BoxGeometry(0.44, 0.52, 0.24), cloth);
  torso.position.y = 1.16;
  rig.add(torso);
  const hairMat = new THREE.MeshStandardMaterial({ color: look === "coat" ? 0x1a120e : 0x2a2118, roughness: 0.78 });
  if (look === "hood") {
    const hood = mesh(new THREE.SphereGeometry(0.175, 16, 12), cloth);
    hood.position.set(0, 1.58, -0.02);
    hood.scale.set(1.05, 1.08, 1.12);
    rig.add(hood);
  } else if (look === "cap") {
    const cap = mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.08, 12), cloth);
    cap.position.set(0, 1.72, 0.01);
    const brim = mesh(new THREE.BoxGeometry(0.2, 0.03, 0.14), cloth);
    brim.position.set(0, 1.68, 0.12);
    const hair = mesh(new THREE.SphereGeometry(0.12, 10, 8), hairMat);
    hair.position.set(0, 1.6, -0.05);
    rig.add(cap, brim, hair);
  } else {
    const hair = mesh(new THREE.SphereGeometry(0.145, 12, 10), hairMat);
    hair.position.set(0, 1.64, -0.02);
    hair.scale.set(1, 1.2, 1);
    const hem = mesh(new THREE.BoxGeometry(0.5, 0.34, 0.28), cloth);
    hem.position.y = 0.78;
    rig.add(hair, hem);
  }
  const face = mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
  face.position.set(0, 1.56, 0.06);
  face.scale.z = 0.85;
  rig.add(face);

  const armGeo = new THREE.BoxGeometry(0.12, 0.5, 0.12);
  const makeArm = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.36, 0);
    const arm = mesh(armGeo, cloth);
    arm.position.y = -0.26;
    pivot.add(arm);
    return pivot;
  };
  const armL = makeArm(-0.3);
  const armR = makeArm(0.3);
  const lamp = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.18, 10), metal, false);
  lamp.rotation.x = Math.PI / 2;
  lamp.position.set(0, -0.48, 0.12);
  armR.add(lamp);
  rig.add(armL, armR);

  return { root, rig, legL, legR, armL, armR };
}

export function animateHuman(h: HumanRig, phase: number, speed: number, crouch: boolean) {
  const amp = Math.min(1, speed / 2.4) * 0.65;
  h.legL.rotation.x = Math.sin(phase) * amp;
  h.legR.rotation.x = Math.sin(phase + Math.PI) * amp;
  h.armL.rotation.x = Math.sin(phase + Math.PI) * amp * 0.7;
  h.armR.rotation.x = Math.sin(phase) * amp * 0.45 + 0.5;
  h.rig.position.y = crouch ? -0.28 : Math.sin(phase * 2) * 0.025 * Math.min(1, speed);
  h.rig.scale.y = crouch ? 0.78 : 1;
}

export function createGrandma(look: GrandmaLook): HumanRig {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);
  rig.rotation.x = 0.16;
  const skin = new THREE.MeshStandardMaterial({ color: 0xd2ad92, roughness: 0.74 });
  const cloth = new THREE.MeshStandardMaterial({
    color: look === "coat" ? 0x241c22 : look === "braid" ? 0x5a3034 : 0x3a2434,
    roughness: 0.9,
  });
  const apron = new THREE.MeshStandardMaterial({ color: look === "shawl" ? 0x7c3030 : 0x3a342c, roughness: 0.86 });
  const hair = new THREE.MeshStandardMaterial({ color: 0xc9c6be, roughness: 0.7 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x14110f, roughness: 0.55 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.72 });

  const legGeo = new THREE.BoxGeometry(0.16, 0.7, 0.16);
  const shoeGeo = new THREE.BoxGeometry(0.17, 0.08, 0.26);
  const makeLeg = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.78, 0);
    const leg = mesh(legGeo, cloth);
    leg.position.y = -0.35;
    const foot = mesh(shoeGeo, shoe);
    foot.position.set(0, -0.7, 0.04);
    pivot.add(leg, foot);
    return pivot;
  };
  const legL = makeLeg(-0.12);
  const legR = makeLeg(0.12);
  rig.add(legL, legR);

  const torso = mesh(new THREE.BoxGeometry(0.5, 0.58, 0.3), cloth);
  torso.position.y = 1.12;
  const skirt = mesh(new THREE.BoxGeometry(0.58, 0.42, 0.36), cloth);
  skirt.position.y = 0.72;
  const bib = mesh(new THREE.BoxGeometry(0.28, 0.36, 0.08), apron);
  bib.position.set(0, 1.12, 0.16);
  rig.add(torso, skirt, bib);

  const face = mesh(new THREE.SphereGeometry(0.15, 16, 12), skin);
  face.position.set(0, 1.58, 0.08);
  face.scale.z = 0.82;
  rig.add(face);

  if (look === "braid") {
    const braid = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.55, 8), hair);
    braid.position.set(0.12, 1.28, -0.08);
    braid.rotation.x = 0.4;
    const bun = mesh(new THREE.SphereGeometry(0.12, 10, 8), hair);
    bun.position.set(0, 1.74, -0.02);
    rig.add(braid, bun);
  } else {
    const scarf = mesh(new THREE.SphereGeometry(0.2, 12, 10), cloth);
    scarf.position.set(0, 1.62, -0.02);
    scarf.scale.set(1.15, 0.9, 1.2);
    const knot = mesh(new THREE.BoxGeometry(0.1, 0.08, 0.08), apron);
    knot.position.set(0, 1.42, 0.16);
    rig.add(scarf, knot);
  }

  const armGeo = new THREE.BoxGeometry(0.13, 0.48, 0.13);
  const makeArm = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.32, 0.02);
    const arm = mesh(armGeo, cloth);
    arm.position.y = -0.26;
    pivot.add(arm);
    return pivot;
  };
  const armL = makeArm(-0.34);
  const armR = makeArm(0.34);
  const cane = mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.15, 8), wood);
  cane.position.set(0, -0.7, 0.08);
  armR.add(cane);
  rig.add(armL, armR);

  return { root, rig, legL, legR, armL, armR };
}

export function createBear(): BearRig {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);
  const fur = new THREE.MeshStandardMaterial({ color: 0x6b3e22, roughness: 0.72 });
  const furDark = new THREE.MeshStandardMaterial({ color: 0x3d2414, roughness: 0.8 });
  const muzzle = new THREE.MeshStandardMaterial({ color: 0xe4c4a0, roughness: 0.62 });
  const hat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.42, metalness: 0.18 });
  const bow = new THREE.MeshStandardMaterial({ color: 0x7a2420, roughness: 0.48 });
  const eye = new THREE.MeshStandardMaterial({
    color: 0xd7ecff,
    emissive: 0x8fd0ff,
    emissiveIntensity: 1.1,
    roughness: 0.28,
  });
  const tooth = new THREE.MeshStandardMaterial({ color: 0xf6f1e8, roughness: 0.35 });

  const body = mesh(new THREE.SphereGeometry(0.58, 22, 16), fur);
  body.scale.set(1.08, 1.22, 0.9);
  body.position.y = 1.02;
  rig.add(body);
  const belly = mesh(new THREE.SphereGeometry(0.36, 16, 12), muzzle);
  belly.position.set(0, 0.92, 0.26);
  belly.scale.set(0.85, 1.05, 0.55);
  rig.add(belly);

  const makeHip = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.58, 0);
    const leg = mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.5, 10), furDark);
    leg.position.y = -0.26;
    const paw = mesh(new THREE.SphereGeometry(0.14, 10, 8), furDark);
    paw.scale.set(1.1, 0.55, 1.35);
    paw.position.set(0, -0.5, 0.06);
    pivot.add(leg, paw);
    return pivot;
  };
  const hipL = makeHip(-0.22);
  const hipR = makeHip(0.22);
  rig.add(hipL, hipR);

  const makeArm = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.28, 0.05);
    const arm = mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.62, 10), fur);
    arm.position.y = -0.32;
    const paw = mesh(new THREE.SphereGeometry(0.13, 10, 8), furDark);
    paw.position.set(0, -0.66, 0.04);
    pivot.add(arm, paw);
    return pivot;
  };
  const armL = makeArm(-0.62);
  const armR = makeArm(0.62);
  rig.add(armL, armR);

  const head = new THREE.Group();
  head.position.set(0, 1.7, 0.02);
  const skull = mesh(new THREE.SphereGeometry(0.4, 20, 16), fur);
  head.add(skull);
  const earGeo = new THREE.SphereGeometry(0.15, 12, 10);
  const earL = mesh(earGeo, fur);
  earL.position.set(-0.26, 0.3, 0);
  earL.scale.set(1, 1.2, 0.65);
  const earR = earL.clone();
  earR.position.x = 0.26;
  const inL = mesh(new THREE.SphereGeometry(0.08, 10, 8), bow, false);
  inL.position.set(-0.26, 0.3, 0.06);
  const inR = inL.clone();
  inR.position.x = 0.26;
  head.add(earL, earR, inL, inR);

  const snout = mesh(new THREE.SphereGeometry(0.2, 14, 12), muzzle);
  snout.position.set(0, -0.04, 0.3);
  snout.scale.set(1.15, 0.72, 1.15);
  head.add(snout);
  const nose = mesh(new THREE.SphereGeometry(0.065, 10, 8), furDark, false);
  nose.position.set(0, 0.02, 0.48);
  head.add(nose);

  const jaw = new THREE.Group();
  jaw.position.set(0, -0.14, 0.22);
  const jawMesh = mesh(new THREE.SphereGeometry(0.15, 12, 10), muzzle);
  jawMesh.scale.set(1.15, 0.42, 1.1);
  jawMesh.position.set(0, -0.02, 0.1);
  jaw.add(jawMesh);
  for (const sx of [-0.06, -0.02, 0.02, 0.06]) {
    const t = mesh(new THREE.BoxGeometry(0.025, 0.05, 0.025), tooth, false);
    t.position.set(sx, 0.04, 0.2);
    jaw.add(t);
  }
  head.add(jaw);

  const eyeGeo = new THREE.SphereGeometry(0.065, 12, 10);
  const eyeL = mesh(eyeGeo, eye, false);
  eyeL.position.set(-0.14, 0.05, 0.32);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.14;
  const pupil = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.4 });
  const pL = mesh(new THREE.SphereGeometry(0.028, 8, 8), pupil, false);
  pL.position.set(-0.14, 0.05, 0.375);
  const pR = pL.clone();
  pR.position.x = 0.14;
  head.add(eyeL, eyeR, pL, pR);

  const brim = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.045, 20), hat);
  brim.position.y = 0.38;
  const crown = mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.4, 16), hat);
  crown.position.y = 0.58;
  const band = mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.07, 16), bow, false);
  band.position.y = 0.44;
  head.add(brim, crown, band);
  rig.add(head);

  const tie = new THREE.Group();
  tie.position.set(0, 1.38, 0.32);
  const wingGeo = new THREE.BoxGeometry(0.16, 0.11, 0.05);
  const wL = mesh(wingGeo, bow, false);
  wL.position.x = -0.09;
  wL.rotation.z = 0.45;
  const wR = mesh(wingGeo, bow, false);
  wR.position.x = 0.09;
  wR.rotation.z = -0.45;
  const knot = mesh(new THREE.BoxGeometry(0.055, 0.07, 0.06), furDark, false);
  tie.add(wL, wR, knot);
  rig.add(tie);

  return { root, rig, hipL, hipR, armL, armR, jaw, head };
}

export function animateBear(b: BearRig, phase: number, speed: number, chasing: boolean, time: number) {
  const amp = Math.min(1, speed / 2.2) * 0.55;
  b.hipL.rotation.x = Math.sin(phase) * amp;
  b.hipR.rotation.x = Math.sin(phase + Math.PI) * amp;
  b.armL.rotation.x = Math.sin(phase + Math.PI) * amp * 0.8;
  b.armR.rotation.x = Math.sin(phase) * amp * 0.8;
  b.rig.position.y = Math.abs(Math.sin(phase)) * 0.04 * Math.min(1, speed);
  b.jaw.rotation.x = chasing ? 0.42 + Math.sin(time * 10) * 0.08 : Math.sin(time * 1.6) * 0.04;
  b.head.rotation.y = Math.sin(time * 1.3) * (chasing ? 0.04 : 0.12);
  b.head.rotation.x = chasing ? 0.12 : 0;
}
