import * as THREE from 'three';
import type { BodySystemId } from '@/domain/entities/HealthIndicator';
import type { BodyModel } from '@/presentation/store/settingsStore';
import { BODY_LANDMARKS, BODY_MESH, type BodyMeshData, type Vec3 } from './bodyMeshData';
import { poseLandmarks, poseMesh } from './bodyPose';
import {
  airwayGeometry,
  brainGeometry,
  eyeGeometry,
  heartGeometry,
  intestineGeometry,
  kidneyGeometry,
  liverGeometry,
  lungGeometry,
  lymphChain,
  merge,
  muscleBelly,
  pectoralGeometry,
  absBlock,
  spleenGeometry,
  stomachGeometry,
  thymusGeometry,
} from './organGeometry';

/**
 * Escena del cuerpo 3D: piel translúcida tipo "vidrio" (malla base de MakeHuman, CC0, importada con
 * scripts/import-makehuman.py) + esqueleto y órganos de los 7 sistemas, coloreables por estado.
 */

export interface OrganMesh {
  system: BodySystemId;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** Opacidad sin selección (p. ej. el cráneo es más tenue para dejar ver el cerebro). */
  baseOpacity: number;
}

// ---------- decodificación de la malla ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const t = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** Base64 → bytes (sin depender de atob). */
function decodeBase64(s: string): ArrayBuffer {
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length * 3) / 4 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (LOOKUP[s.charCodeAt(i)]! << 18) | (LOOKUP[s.charCodeAt(i + 1)]! << 12) | (LOOKUP[s.charCodeAt(i + 2)]! << 6) | LOOKUP[s.charCodeAt(i + 3)]!;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out.buffer;
}

const geometryCache = new Map<BodyModel, THREE.BufferGeometry>();

function skinGeometry(model: BodyModel): THREE.BufferGeometry {
  const cached = geometryCache.get(model);
  if (cached) return cached;
  const d: BodyMeshData = BODY_MESH[model];
  const q = new Uint16Array(decodeBase64(d.position));
  const n = new Int8Array(decodeBase64(d.normal));
  const pos = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) {
    const a = i % 3;
    pos[i] = d.min[a]! + (q[i]! / 65535) * (d.max[a]! - d.min[a]!);
  }
  const nor = new Float32Array(n.length);
  for (let i = 0; i < n.length; i++) nor[i] = n[i]! / 127;
  // Pose relajada (la malla original viene en pose A, rígida).
  poseMesh(pos, nor, BODY_LANDMARKS[model]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(decodeBase64(d.index)), 1));
  geo.computeBoundingSphere();
  geometryCache.set(model, geo);
  return geo;
}

// ---------- material de la piel: borde brillante (fresnel) + brillo especular suave ----------
function glassMaterial(side: THREE.Side, alpha: number, dark: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRim: { value: new THREE.Color('#4ADD82') },
      uBase: { value: new THREE.Color(dark ? '#1E4A31' : '#2F6B48') },
      uAlpha: { value: alpha },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uRim;
      uniform vec3 uBase;
      uniform float uAlpha;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        float f = pow(1.0 - abs(dot(n, v)), 2.4);
        vec3 l = normalize(vec3(0.45, 0.65, 0.6));
        float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0);
        vec3 c = mix(uBase, uRim, f) + vec3(spec * 0.45);
        gl_FragColor = vec4(c, clamp(uAlpha * (0.1 + 0.9 * f) + spec * 0.3, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    side,
  });
}

// ---------- utilidades ----------
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const mirrorX = (p: Vec3, s: number): Vec3 => [p[0] * s, p[1], p[2]];
const lerp3 = (a: Vec3, b: Vec3, t: number, off: Vec3 = [0, 0, 0]): Vec3 => [
  a[0] + (b[0] - a[0]) * t + off[0],
  a[1] + (b[1] - a[1]) * t + off[1],
  a[2] + (b[2] - a[2]) * t + off[2],
];

/** Construye el cuerpo completo para el modelo dado. Todo se ubica con los puntos medidos en la malla. */
export function buildBody(model: BodyModel, dark: boolean) {
  const L = poseLandmarks(BODY_LANDMARKS[model]);
  const root = new THREE.Group();
  if (model === 'female') root.scale.setScalar(0.95);
  const organs: OrganMesh[] = [];

  const part = (system: BodySystemId, geo: THREE.BufferGeometry, pos: Vec3, opts: { scale?: Vec3; rot?: Vec3; opacity?: number } = {}) => {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05, transparent: true, emissiveIntensity: 0.25 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    if (opts.scale) m.scale.set(...opts.scale);
    if (opts.rot) m.rotation.set(...opts.rot);
    m.userData.systemId = system;
    m.renderOrder = 2;
    root.add(m);
    organs.push({ system, mesh: m, baseOpacity: opts.opacity ?? 0.92 });
    return m;
  };

  /** Ubica una pieza alargada a lo largo del segmento a→b. */
  const along = (m: THREE.Mesh, a: Vec3, b: Vec3, t = 0.5) => {
    const va = v3(a);
    const dir = v3(b).sub(va);
    m.position.copy(va).addScaledVector(dir, t);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    return m;
  };
  const dist = (a: Vec3, b: Vec3) => v3(a).distanceTo(v3(b));

  /** Hueso cilíndrico entre dos puntos con epífisis redondeadas. */
  const bone = (a: Vec3, b: Vec3, r: number, opacity = 0.8) => {
    along(part('skeletal', new THREE.CylinderGeometry(r * 0.9, r, dist(a, b), 8), [0, 0, 0], { opacity }), a, b);
    part('skeletal', new THREE.SphereGeometry(r * 1.35, 8, 6), a, { opacity });
    part('skeletal', new THREE.SphereGeometry(r * 1.25, 8, 6), b, { opacity });
  };

  /** Vientres musculares (en coordenadas del cuerpo); se unen en una sola malla al final. */
  const muscles: THREE.BufferGeometry[] = [];
  /** Músculo fusiforme del punto `ta` al `tb` del segmento a→b, desplazado `off`. */
  const muscle = (a: Vec3, b: Vec3, ta: number, tb: number, r: number, off: Vec3, peak = 0.5, flat = 0.85) => {
    const o = v3(off);
    const pa = v3(lerp3(a, b, ta)).add(o);
    const pb = v3(lerp3(a, b, tb)).add(o);
    muscles.push(muscleBelly(pa, pb, r, peak, flat));
  };

  /** Órganos sin sistema propio en la app (hígado, estómago, riñones, intestinos): contexto, color neutro, no seleccionables. */
  const neutral = (geo: THREE.BufferGeometry, pos: Vec3, color: string, opacity = 0.38) => {
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, transparent: true, opacity, depthWrite: false }),
    );
    m.position.set(...pos);
    m.renderOrder = 2;
    m.raycast = () => {};
    root.add(m);
    return m;
  };

  // ----- Piel de vidrio: cara trasera tenue + cara frontal con borde brillante -----
  const geo = skinGeometry(model);
  const back = new THREE.Mesh(geo, glassMaterial(THREE.BackSide, 0.35, dark));
  const front = new THREE.Mesh(geo, glassMaterial(THREE.FrontSide, 0.85, dark));
  back.renderOrder = 1;
  front.renderOrder = 3;
  for (const m of [back, front]) {
    m.raycast = () => {}; // los toques atraviesan la piel y seleccionan órganos
    root.add(m);
  }

  // Medidas derivadas de la malla
  const pelvis = L.spine[0]!;
  const heart = L.spine[3]!;
  const upperChest = L.spine[4]!;
  const neck = L.neck;
  const chestZ = (L.chestFrontZ + L.chestBackZ) / 2;
  const chestDepth = L.chestFrontZ - L.chestBackZ;
  const skull: Vec3 = [0, L.eye[1] + 0.03, L.head[2]];

  // ----- Cráneo y mandíbula -----
  part('skeletal', new THREE.SphereGeometry(0.082, 20, 16), skull, { scale: [0.86, 1.02, 1.08], opacity: 0.22 });
  part('skeletal', new THREE.SphereGeometry(0.05, 14, 10), [0, L.jaw[1] + 0.025, L.jaw[2] - 0.05], { scale: [0.9, 0.45, 0.9], opacity: 0.35 });

  // ----- Columna: vértebras sobre una curva por los puntos medidos -----
  const spineCurve = new THREE.CatmullRomCurve3(L.spine.map((p) => new THREE.Vector3(p[0], p[1], p[2] - 0.012)));
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    const p = spineCurve.getPointAt(t);
    const r = 0.017 - t * 0.006;
    const m = part('skeletal', new THREE.CylinderGeometry(r, r * 1.05, 0.016, 8), [p.x, p.y, p.z], { opacity: 0.85 });
    m.quaternion.setFromUnitVectors(UP, spineCurve.getTangentAt(t));
  }

  // ----- Caja torácica: arcos desde la columna hasta el esternón -----
  const ribTop = L.clavicle[1] - 0.035;
  const ribStep = (ribTop - heart[1] + 0.06) / 10;
  for (let i = 0; i < 10; i++) {
    const y = ribTop - i * ribStep;
    const k = Math.sin(((i + 2) / 13) * Math.PI);
    const rx = L.chestHalfW * 0.82 * (0.6 + 0.4 * k);
    const rz = (chestDepth / 2) * 0.8 * (0.75 + 0.25 * k);
    for (const s of [1, -1]) {
      const pts: THREE.Vector3[] = [];
      for (let j = 0; j <= 14; j++) {
        const th = -Math.PI / 2 + (j / 14) * Math.PI * 0.9;
        pts.push(new THREE.Vector3(s * rx * Math.cos(th), y - 0.035 * (j / 14), chestZ + rz * Math.sin(th)));
      }
      part('skeletal', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.0055, 5), [0, 0, 0], { opacity: 0.75 });
    }
  }
  part('skeletal', new THREE.BoxGeometry(0.024, 0.16, 0.01), [0, ribTop - 0.09, chestZ + (chestDepth / 2) * 0.8], { opacity: 0.8 });

  // Clavículas y escápulas
  for (const s of [1, -1]) {
    const sh = mirrorX(L.shoulder, s);
    bone([s * 0.022, L.clavicle[1], L.clavicle[2] + 0.04], [sh[0] - s * 0.015, sh[1] + 0.025, sh[2]], 0.0075);
    part('skeletal', new THREE.SphereGeometry(0.06, 12, 8), [s * (L.shoulder[0] - 0.08), sh[1] - 0.07, L.chestBackZ + 0.025], { scale: [0.9, 1.1, 0.15], opacity: 0.45 });
  }

  // Pelvis: anillo + alas ilíacas
  part('skeletal', new THREE.TorusGeometry(L.hip[0] * 0.85, 0.02, 10, 28), [0, L.hip[1] + 0.02, pelvis[2] + 0.01], { scale: [1, 0.55, 0.62], rot: [Math.PI / 2.4, 0, 0] });
  for (const s of [1, -1]) {
    part('skeletal', new THREE.SphereGeometry(0.06, 14, 10), [s * L.hip[0] * 0.85, L.hip[1] + 0.08, pelvis[2] - 0.005], { scale: [1, 0.85, 0.3], rot: [0, s * 0.5, s * -0.25] });
  }

  // ----- Extremidades (pose relajada: ver bodyPose.ts) -----
  for (const s of [1, -1]) {
    const sh = mirrorX(L.shoulder, s), el = mirrorX(L.elbow, s), wr = mirrorX(L.wrist, s);
    const hip = mirrorX(L.hip, s), kn = mirrorX(L.knee, s), an = mirrorX(L.ankle, s), toe = mirrorX(L.toe, s);
    // Brazo: húmero, radio y cúbito, mano
    bone(sh, el, 0.011);
    bone(lerp3(el, el, 0, [0, 0, 0.008]), lerp3(wr, wr, 0, [0, 0.006, 0.008]), 0.0068);
    bone(lerp3(el, el, 0, [0, 0, -0.008]), lerp3(wr, wr, 0, [0, -0.006, -0.006]), 0.006);
    const hand = v3(wr).add(v3(wr).sub(v3(el)).normalize().multiplyScalar(0.07));
    along(part('skeletal', new THREE.BoxGeometry(0.045, 0.08, 0.012), [0, 0, 0], { opacity: 0.55 }), wr, [hand.x, hand.y, hand.z]);
    // Pierna: fémur, rótula, tibia, peroné y pie
    bone(lerp3(hip, hip, 0, [s * 0.008, 0.01, 0]), kn, 0.0145);
    part('skeletal', new THREE.SphereGeometry(0.017, 10, 8), lerp3(kn, kn, 0, [0, 0.005, 0.045]), { scale: [1, 1.1, 0.6] });
    bone(lerp3(kn, kn, 0, [0, -0.02, 0]), an, 0.011);
    bone(lerp3(kn, kn, 0, [s * 0.025, -0.03, -0.01]), lerp3(an, an, 0, [s * 0.022, 0.01, -0.005]), 0.0055);
    bone(lerp3(an, an, 0, [0, -0.03, -0.035]), toe, 0.009);
    // Músculos fusiformes que siguen cada segmento.
    const ar = L.armR;
    const lr = L.legR;
    // Deltoides (3 haces sobre el hombro)
    muscle(lerp3(sh, sh, 0, [-s * 0.035, 0.03, 0]), el, 0.0, 0.42, ar * 0.42, [0, 0, 0.022], 0.35);
    muscle(lerp3(sh, sh, 0, [s * 0.005, 0.035, 0]), el, 0.0, 0.45, ar * 0.45, [s * 0.012, 0, 0], 0.35);
    muscle(lerp3(sh, sh, 0, [-s * 0.03, 0.03, -0.01]), el, 0.0, 0.42, ar * 0.42, [0, 0, -0.022], 0.35);
    // Bíceps (2 cabezas) y tríceps
    muscle(sh, el, 0.22, 0.95, ar * 0.38, [0, 0, 0.02], 0.6);
    muscle(sh, el, 0.25, 0.95, ar * 0.32, [-s * 0.012, 0, 0.016], 0.62);
    muscle(sh, el, 0.18, 0.92, ar * 0.45, [0, 0, -0.022], 0.45);
    // Antebrazo: flexores y extensores
    muscle(el, wr, 0.02, 0.8, ar * 0.4, [0, 0.004, 0.014], 0.28);
    muscle(el, wr, 0.0, 0.75, ar * 0.38, [0, -0.004, -0.012], 0.25);
    // Muslo: recto femoral, vasto lateral, vasto medial, isquiotibiales
    muscle(hip, kn, 0.1, 0.95, lr * 0.36, [0, 0, 0.045], 0.5, 0.8);
    muscle(hip, kn, 0.12, 0.92, lr * 0.4, [s * 0.035, 0, 0.012], 0.5, 0.75);
    muscle(hip, kn, 0.4, 0.98, lr * 0.36, [-s * 0.03, 0, 0.022], 0.78, 0.85);
    muscle(hip, kn, 0.12, 0.92, lr * 0.42, [0, 0, -0.035], 0.5, 0.85);
    // Pantorrilla: gemelos (2 cabezas) y tibial anterior
    muscle(kn, an, 0.04, 0.62, lr * 0.33, [s * 0.016, 0, -0.032], 0.3);
    muscle(kn, an, 0.04, 0.6, lr * 0.31, [-s * 0.016, 0, -0.032], 0.3);
    muscle(kn, an, 0.08, 0.8, lr * 0.2, [s * 0.012, 0, 0.022], 0.35);
  }

  // ----- Encéfalo (hemisferios con circunvoluciones, cerebelo y tronco) y ojos con nervio óptico -----
  part('brain', brainGeometry(), [0, skull[1] + 0.006, skull[2] - 0.006], { scale: [0.93, 0.93, 0.93] });
  for (const s of [1, -1]) {
    const e = mirrorX(L.eye, s);
    part('eyes', eyeGeometry(new THREE.Vector3(-e[0], -0.006, -0.05)), e);
  }

  // ----- Pulmones con lóbulos, árbol bronquial y corazón con grandes vasos -----
  const lungTop = ribTop + 0.012;
  const lungBottom = heart[1] - 0.025;
  const lungY = (lungTop + lungBottom) / 2;
  const lungH = (lungTop - lungBottom) / 2;
  for (const s of [1, -1] as const) {
    part('respiratory', lungGeometry(s, lungH, L.chestHalfW * 0.44, chestDepth * 0.42), [s * L.chestHalfW * 0.5, lungY, chestZ - 0.004], { opacity: 0.62 });
  }
  const carina = new THREE.Vector3(0, lungY + lungH * 0.38, chestZ + 0.005);
  part(
    'respiratory',
    airwayGeometry(
      new THREE.Vector3(0, neck[1] + 0.035, neck[2] + 0.035),
      carina,
      new THREE.Vector3(L.chestHalfW * 0.5, lungY + lungH * 0.1, chestZ - 0.01),
      new THREE.Vector3(-L.chestHalfW * 0.5, lungY + lungH * 0.12, chestZ - 0.01),
    ),
    [0, 0, 0],
    { opacity: 0.9 },
  );
  part('cardiovascular', heartGeometry(), [0.012, lungY - lungH * 0.28, chestZ + 0.03], { opacity: 0.95 });

  // ----- Abdomen (contexto anatómico) -----
  const abdomenTop = heart[1] - 0.02;
  neutral(liverGeometry(), [-0.03, abdomenTop - 0.03, chestZ + 0.015], '#A86A5C');
  neutral(stomachGeometry(), [0.04, abdomenTop - 0.06, chestZ + 0.005], '#C99A86');
  for (const s of [1, -1] as const) neutral(kidneyGeometry(s, 0.13), [s * 0.055, L.spine[2]![1] - 0.01, L.chestBackZ + 0.045], '#9C5D55', 0.42);
  neutral(intestineGeometry(L.hip[0] * 0.95, abdomenTop - 0.11, L.hip[1] + 0.01), [0, 0, chestZ + 0.01], '#C9A08C', 0.3);

  // Pectorales (abanico sobre el tórax) y recto abdominal (4 cuadros por lado)
  for (const s of [1, -1] as const) {
    const pec = pectoralGeometry(s);
    pec.rotateZ(-s * 0.12).translate(s * 0.068, ribTop - 0.07, L.chestFrontZ - 0.024);
    muscles.push(pec);
    const absTop = heart[1] + 0.025;
    const absBottom = L.hip[1] + 0.005;
    const zTop = L.chestFrontZ - 0.032;
    const zBottom = pelvis[2] + 0.085;
    const rows = 4;
    for (let i = 0; i < rows; i++) {
      const t0 = i / rows;
      const t1 = (i + 1) / rows;
      const h = ((absTop - absBottom) / rows) * 0.46;
      const tm = (t0 + t1) / 2;
      const blk = absBlock(0.017 - i * 0.001, h);
      blk.translate(s * (0.026 - i * 0.002), absTop - (absTop - absBottom) * tm, zTop + (zBottom - zTop) * tm);
      muscles.push(blk);
    }
  }
  part('muscular', merge(muscles), [0, 0, 0], { opacity: model === 'male' ? 0.62 : 0.55 });

  // ----- Sistema inmune: bazo, timo, ganglios y vasos linfáticos -----
  part('immune', spleenGeometry(), [0.088, abdomenTop - 0.015, chestZ - 0.045], { rot: [0, -0.5, 0.25] });
  part('immune', thymusGeometry(), [0, L.clavicle[1] - 0.045, L.chestFrontZ - 0.04], { opacity: 0.85 });
  const nodeZ = (L.jaw[2] + neck[2]) / 2 - 0.02;
  const chains: THREE.BufferGeometry[] = [];
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const s of [1, -1]) {
    // Cervicales
    chains.push(lymphChain([P(s * 0.045, L.jaw[1] - 0.005, nodeZ), P(s * 0.05, L.jaw[1] - 0.04, nodeZ - 0.01), P(s * 0.052, neck[1] + 0.01, neck[2] + 0.005), P(s * 0.05, L.clavicle[1] + 0.005, L.clavicle[2] + 0.02)], 0.0065));
    // Axilares
    const ax = mirrorX(L.shoulder, s);
    chains.push(lymphChain([P(s * 0.05, L.clavicle[1] + 0.005, L.clavicle[2] + 0.02), P(ax[0] - s * 0.05, ax[1] - 0.05, ax[2]), P(ax[0] - s * 0.04, ax[1] - 0.085, ax[2] - 0.01), P(ax[0] - s * 0.055, ax[1] - 0.115, ax[2] + 0.005)], 0.0075));
    // Inguinales
    const hp = mirrorX(L.hip, s);
    chains.push(lymphChain([P(s * 0.03, pelvis[1] + 0.06, pelvis[2] + 0.02), P(hp[0] * 0.75, hp[1] + 0.005, hp[2] + 0.06), P(hp[0] * 0.95, hp[1] - 0.025, hp[2] + 0.065), P(hp[0] * 0.9, hp[1] - 0.06, hp[2] + 0.06)], 0.0075));
  }
  // Conducto torácico: sube junto a la columna hasta el cuello (lado izquierdo).
  chains.push(
    lymphChain(
      [
        P(0.008, pelvis[1] + 0.08, L.spine[1]![2] + 0.03),
        P(0.01, heart[1], L.spine[3]![2] + 0.035),
        P(0.012, upperChest[1], L.spine[4]![2] + 0.03),
        P(0.05, L.clavicle[1] + 0.005, L.clavicle[2] + 0.02),
      ],
      0.004,
    ),
  );
  part('immune', merge(chains), [0, 0, 0]);

  return { root, organs };
}

/** Libera geometrías y materiales (la malla de la piel queda en caché y no se libera). */
export function disposeBody(obj: THREE.Object3D) {
  const shared = new Set(geometryCache.values());
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (!shared.has(o.geometry)) o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
    }
  });
}
