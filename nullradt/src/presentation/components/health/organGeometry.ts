import * as THREE from 'three';

/**
 * Geometrías procedurales de órganos con silueta anatómica reconocible (sin modelos externos).
 * Unidades en metros; cada función devuelve la pieza centrada en su origen local.
 * Convención del cuerpo: +Y arriba, +Z hacia delante, +X = lado IZQUIERDO del astronauta.
 */

type V = THREE.Vector3;
const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------- utilidades ----------

/** Ruido suave determinista (suma de senos) para pliegues y textura orgánica. */
function wave(x: number, y: number, z: number, f: number) {
  return (
    Math.sin(x * f + Math.sin(y * f * 0.7) * 1.7) * Math.sin(y * f * 1.13 + Math.sin(z * f * 0.6) * 1.9) +
    0.6 * Math.sin(z * f * 1.31 + Math.sin(x * f * 0.9) * 1.3) * Math.sin(x * f * 0.77 + y * f * 0.41)
  );
}

/** Esfera unitaria deformada: `fn` recibe la dirección unitaria y devuelve la posición final. */
export function deformSphere(wSeg: number, hSeg: number, fn: (u: V) => V) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  g.deleteAttribute('uv');
  const p = g.attributes.position as THREE.BufferAttribute;
  const u = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    u.fromBufferAttribute(p, i).normalize();
    const out = fn(u.clone());
    p.setXYZ(i, out.x, out.y, out.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Tubo de radio variable a lo largo de una curva (vasos, tráquea, estómago, músculos). Extremos cerrados. */
export function varTube(points: V[], radius: (t: number, angle: number) => number, tubular = 32, radial = 12) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const N = frames.normals[i]!;
    const B = frames.binormals[i]!;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const r = radius(t, a);
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      pos.push(P.x + cx * N.x + cy * B.x, P.y + cx * N.y + cy * B.y, P.z + cx * N.z + cy * B.z);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // Tapas: un vértice central por extremo.
  for (const [ring, t, flip] of [
    [0, 0, true],
    [tubular, 1, false],
  ] as const) {
    const c = pos.length / 3;
    curve.getPointAt(t, P);
    pos.push(P.x, P.y, P.z);
    for (let j = 0; j < radial; j++) {
      const a = ring * (radial + 1) + j;
      if (flip) idx.push(c, a, a + 1);
      else idx.push(c, a + 1, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Une geometrías indexadas (posición + normal) en una sola, para menos mallas y un solo material. */
export function merge(geos: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0 : (() => {
      const c = g0.clone();
      const n = c.attributes.position!.count;
      c.setIndex(Array.from({ length: n }, (_, i) => i));
      return c;
    })();
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

const tx = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------- encéfalo ----------

/** Encéfalo: dos hemisferios con circunvoluciones, cisura entre ellos, cerebelo con láminas y tronco. */
export function brainGeometry() {
  const hemi = (s: number) => {
    const g = deformSphere(60, 44, (u) => {
      // Elipsoide alargado (frontal → occipital) con la cara medial aplanada y lóbulo temporal.
      let x = u.x * 0.036;
      let y = u.y * 0.047;
      const z = u.z * 0.081;
      if (u.x * s < 0) x *= 0.9 * (1 - 0.25 * Math.pow(Math.abs(u.x), 3)); // cara medial casi plana (cisura)
      if (u.y < 0) y *= 0.8 + 0.2 * Math.abs(u.z); // base más plana, temporal hacia abajo
      if (u.y < -0.2 && u.z > -0.2 && u.z < 0.55) y -= 0.008 * (u.x * s > 0 ? 1 : 0); // lóbulo temporal
      const p = vec(x, y, z);
      // Circunvoluciones: desplazamiento a lo largo de la normal.
      const g2 = wave(p.x * 1.1 + s * 3, p.y, p.z, 150) * 0.0024 + wave(p.x, p.y + 1, p.z, 300) * 0.0007;
      const fold = u.x * s < -0.6 ? 0.2 : 1; // la cara medial casi lisa
      return p.add(u.clone().multiplyScalar(g2 * fold));
    });
    return tx(g, s * 0.031, 0, 0);
  };
  const cerebellum = deformSphere(36, 24, (u) => {
    const p = vec(u.x * 0.046, u.y * 0.022, u.z * 0.03);
    if (Math.abs(u.x) < 0.12) p.y -= 0.004; // vermis
    return p.add(u.clone().multiplyScalar(Math.sin(p.y * 900) * 0.0012));
  });
  tx(cerebellum, 0, -0.034, -0.055);
  const stem = varTube([vec(0, -0.012, -0.012), vec(0, -0.045, -0.026), vec(0, -0.085, -0.032)], (t) => 0.0095 - t * 0.002, 12, 10);
  return merge([hemi(1), hemi(-1), cerebellum, stem]);
}

// ---------- ojos ----------

/** Globo ocular con córnea abombada y nervio óptico hacia el quiasma (`toChiasm` en coordenadas locales). */
export function eyeGeometry(toChiasm: V) {
  const globe = new THREE.SphereGeometry(0.0118, 18, 14);
  globe.deleteAttribute('uv');
  const cornea = new THREE.SphereGeometry(0.0062, 14, 10);
  cornea.deleteAttribute('uv');
  tx(cornea, 0, 0, 0.0085);
  const nerve = varTube([vec(0, 0, -0.01), vec(toChiasm.x * 0.45, toChiasm.y * 0.4, -0.022), toChiasm], () => 0.0021, 14, 6);
  return merge([globe, cornea, nerve]);
}

// ---------- corazón y grandes vasos ----------

/** Corazón: ventrículos cónicos con el ápex hacia abajo-izquierda, aurículas, aorta, tronco pulmonar y venas cavas. */
export function heartGeometry() {
  const vshape = (u: V) => {
    const p = vec(u.x * 0.04, u.y * 0.05, u.z * 0.034);
    // Se afina hacia el ápex (abajo) y queda redondeado en la base.
    const k = u.y < 0 ? 1 - 0.62 * Math.pow(-u.y, 1.3) : 1;
    p.x *= k;
    p.z *= k;
    if (u.y < -0.75) p.y -= 0.006 * (1 + u.y); // ápex redondeado
    // Surco interventricular anterior (línea diagonal en la cara frontal).
    const groove = Math.exp(-Math.pow((u.x + u.y * 0.35 - 0.08) / 0.09, 2)) * (u.z > 0 ? 1 : 0.3);
    return p.add(u.clone().multiplyScalar(-0.0025 * groove));
  };
  const ventricles = deformSphere(40, 30, vshape);
  // Arteria coronaria descendente anterior: sigue el surco sobre la superficie.
  const corPts = [
    [-0.25, 0.75, 0.62],
    [0.02, 0.35, 0.94],
    [0.18, -0.1, 0.98],
    [0.3, -0.5, 0.82],
    [0.32, -0.82, 0.48],
  ].map(([x, y, z]) => vshape(vec(x!, y!, z!).normalize()).multiplyScalar(1.03));
  const cor = varTube(corPts, () => 0.0016, 28, 5);
  // Rotación anatómica: ápex hacia la izquierda (+X), abajo y adelante.
  for (const g of [ventricles, cor]) g.rotateZ(0.62).rotateX(-0.35);
  const atrium = (x: number, r: number, z: number) => {
    const g = deformSphere(20, 14, (u) => vec(u.x * r * 1.05, u.y * r * 0.85, u.z * r * 0.9));
    return tx(g, x, 0.036, z);
  };
  const ra = atrium(-0.026, 0.025, -0.006); // aurícula derecha
  const la = atrium(0.018, 0.022, -0.02); // aurícula izquierda (atrás)
  const auricle = tx(deformSphere(12, 8, (u) => vec(u.x * 0.014, u.y * 0.007, u.z * 0.01)), 0.028, 0.044, 0.018);
  // Aorta: asciende, se arquea hacia atrás-izquierda y desciende junto a la columna.
  const aorta = varTube(
    [vec(0.002, 0.03, 0.006), vec(-0.004, 0.075, 0.0), vec(0.01, 0.1, -0.025), vec(0.025, 0.088, -0.055), vec(0.024, 0.04, -0.066), vec(0.02, -0.06, -0.066), vec(0.016, -0.17, -0.06)],
    (t) => (t < 0.3 ? 0.0125 : 0.0105 - t * 0.002),
    48,
    12,
  );
  // Ramas del arco (tronco braquiocefálico, carótida y subclavia izquierdas).
  const branches = [
    [vec(0.0, 0.098, -0.018), vec(-0.012, 0.13, -0.012), vec(-0.02, 0.16, -0.008)],
    [vec(0.012, 0.102, -0.03), vec(0.014, 0.135, -0.025), vec(0.016, 0.165, -0.02)],
    [vec(0.022, 0.097, -0.042), vec(0.035, 0.125, -0.04), vec(0.06, 0.135, -0.04)],
  ].map((pts) => varTube(pts, (t) => 0.005 - t * 0.0012, 12, 8));
  // Tronco pulmonar: sale por delante y se divide hacia ambos pulmones.
  const pulm = varTube([vec(0.006, 0.03, 0.026), vec(0.012, 0.062, 0.02), vec(0.016, 0.075, 0.0)], () => 0.0105, 16, 10);
  const pulmL = varTube([vec(0.016, 0.075, 0.0), vec(0.04, 0.078, -0.01), vec(0.065, 0.07, -0.015)], (t) => 0.0075 - t * 0.002, 14, 8);
  const pulmR = varTube([vec(0.014, 0.075, 0.0), vec(-0.02, 0.07, -0.012), vec(-0.06, 0.065, -0.015)], (t) => 0.0075 - t * 0.002, 14, 8);
  // Venas cavas superior e inferior (lado derecho).
  const svc = varTube([vec(-0.03, 0.05, -0.006), vec(-0.03, 0.1, -0.008), vec(-0.026, 0.15, -0.01)], () => 0.0085, 14, 10);
  const ivc = varTube([vec(-0.028, 0.02, -0.012), vec(-0.026, -0.03, -0.02), vec(-0.02, -0.12, -0.03)], () => 0.0095, 14, 10);
  // Arterias coronarias (relieve sobre la superficie).
  return merge([ventricles, ra, la, auricle, aorta, ...branches, pulm, pulmL, pulmR, svc, ivc, cor]);
}

// ---------- pulmones y vía aérea ----------

/**
 * Pulmón (s = +1 izquierdo, −1 derecho): cono con vértice arriba, base cóncava sobre el diafragma,
 * cara medial aplanada, cisuras entre lóbulos (el izquierdo con escotadura cardiaca).
 */
export function lungGeometry(s: 1 | -1, height: number, width: number, depth: number) {
  return deformSphere(38, 34, (u) => {
    const yn = u.y;
    // Ancho: estrecho en el vértice, ancho en la base.
    const w = 0.36 + 0.64 * Math.sqrt(smooth(1.02, -0.35, yn));
    let x = u.x * width * w;
    let z = u.z * depth * w;
    // Vértice redondeado (cúpula pleural), no puntiagudo.
    let y = yn * height * (yn > 0.45 ? 1 - 0.45 * (yn - 0.45) : 1);
    // Cara medial plana (hacia el mediastino).
    if (u.x * s < 0) x *= 0.42;
    // Base cóncava (cúpula del diafragma), más alta en el derecho por el hígado.
    if (yn < -0.35) {
      const r2 = Math.min(1, (u.x * u.x + u.z * u.z) * 1.6);
      y += (1 - r2) * height * 0.32 * smooth(-0.35, -1, yn);
    }
    // Escotadura cardiaca del pulmón izquierdo (cara medial anterior inferior).
    if (s === 1 && u.x < 0.1 && u.z > 0.15 && yn < 0.15 && yn > -0.85) {
      const k = Math.exp(-Math.pow((yn + 0.38) / 0.3, 2)) * smooth(0.15, 0.6, u.z);
      x += k * width * 0.45;
      z -= k * depth * 0.25;
    }
    const p = vec(x, y, z);
    // Cisura oblicua (y horizontal en el derecho): surcos finos que separan lóbulos.
    const oblique = Math.exp(-Math.pow((yn + u.z * 0.75 - 0.05) / 0.06, 2));
    const horizontal = s === -1 ? Math.exp(-Math.pow((yn - 0.12) / 0.05, 2)) * smooth(-0.2, 0.3, u.z) : 0;
    const dn = -(oblique + horizontal) * 0.0035 + wave(p.x, p.y, p.z, 260) * 0.0006;
    return p.add(u.clone().multiplyScalar(dn));
  });
}

/** Tráquea con anillos de cartílago, bronquios principales y ramas lobares (árbol bronquial). */
export function airwayGeometry(top: V, carina: V, lungL: V, lungR: V) {
  const len = top.distanceTo(carina);
  const trachea = varTube([top, top.clone().lerp(carina, 0.5), carina], (t) => 0.0085 + 0.0012 * Math.max(0, Math.sin(t * len * 520)), 40, 10);
  const parts = [trachea];
  for (const [target, steep] of [
    [lungL, 0.55],
    [lungR, 0.35],
  ] as const) {
    const mid = carina.clone().lerp(target, 0.5);
    mid.y = carina.y - Math.abs(target.x - carina.x) * steep;
    const end = mid.clone().lerp(target, 0.6);
    parts.push(varTube([carina, mid, end], (t) => 0.0065 - t * 0.0015, 16, 8));
    // Ramas lobares y segmentarias.
    for (const [dy, dz] of [
      [0.05, 0.01],
      [-0.03, 0.025],
      [-0.07, -0.02],
    ]) {
      const tip = end.clone().add(vec((target.x - carina.x) * 0.35, dy, dz));
      const fork = tip.clone().add(vec((target.x - carina.x) * 0.25, dy * 0.5, dz * 1.5 + 0.01));
      parts.push(varTube([end, tip, fork], (t) => 0.004 - t * 0.0025, 10, 6));
    }
  }
  return merge(parts);
}

// ---------- abdomen (contexto, sin sistema propio) ----------

/** Hígado: lóbulo derecho voluminoso que se afina hacia la izquierda, cara inferior plana. */
export function liverGeometry() {
  return deformSphere(36, 26, (u) => {
    const right = smooth(0.9, -0.6, u.x); // 1 en el lado derecho (−X)
    const x = u.x * 0.105;
    let y = u.y * 0.06 * (0.45 + 0.55 * right);
    const z = u.z * 0.075 * (0.55 + 0.45 * right);
    if (u.y < 0) y *= 0.45; // cara visceral plana
    return vec(x, y, z).add(u.clone().multiplyScalar(wave(x, y, z, 120) * 0.0012));
  });
}

/** Estómago en forma de J: del esófago (arriba, a la izquierda) al píloro (a la derecha). */
export function stomachGeometry() {
  return varTube(
    [vec(-0.01, 0.07, -0.01), vec(0.01, 0.05, 0.0), vec(0.045, 0.02, 0.01), vec(0.055, -0.025, 0.02), vec(0.03, -0.055, 0.03), vec(-0.01, -0.05, 0.03), vec(-0.035, -0.03, 0.02)],
    (t) => 0.008 + 0.03 * Math.sin(Math.min(1, t * 1.25) * Math.PI) * (t < 0.15 ? t / 0.15 : 1) * (t > 0.85 ? 0.6 : 1),
    48,
    14,
  );
}

/** Riñón (forma de frijol) con el uréter que baja hacia la pelvis. */
export function kidneyGeometry(s: 1 | -1, ureterDrop: number) {
  const bean = deformSphere(24, 18, (u) => {
    const p = vec(u.x * 0.027, u.y * 0.052, u.z * 0.02);
    // Hilio: hendidura en la cara medial.
    if (u.x * s < 0) p.x *= 1 - 0.55 * Math.exp(-Math.pow(u.y / 0.45, 2));
    return p;
  });
  const ureter = varTube([vec(-s * 0.012, -0.01, 0.0), vec(-s * 0.02, -ureterDrop * 0.5, 0.01), vec(-s * 0.03, -ureterDrop, 0.025)], () => 0.0022, 16, 6);
  return merge([bean, ureter]);
}

/** Intestinos: marco del colon con haustras y asas del intestino delgado en el centro. */
export function intestineGeometry(halfW: number, top: number, bottom: number) {
  const h = top - bottom;
  const colonPts = [
    vec(-halfW * 0.75, bottom + h * 0.12, 0.0),
    vec(-halfW * 0.85, bottom + h * 0.55, 0.0),
    vec(-halfW * 0.75, top, 0.01),
    vec(0, top - h * 0.08, 0.035),
    vec(halfW * 0.75, top + h * 0.03, 0.01),
    vec(halfW * 0.85, bottom + h * 0.5, 0.0),
    vec(halfW * 0.6, bottom + h * 0.05, 0.01),
    vec(halfW * 0.1, bottom - h * 0.05, 0.0),
  ];
  const colon = varTube(colonPts, (t) => 0.017 + 0.0035 * Math.sin(t * 180), 110, 8);
  // Intestino delgado: curva tipo Lissajous que llena el centro del abdomen.
  const small: V[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    small.push(vec(Math.sin(a * 3) * halfW * 0.52, bottom + h * 0.45 + Math.sin(a * 4 + 0.6) * h * 0.3, 0.02 + Math.cos(a * 5) * 0.025));
  }
  const ileum = varTube(small, () => 0.0095, 200, 6);
  return merge([colon, ileum]);
}

// ---------- sistema inmune ----------

/** Bazo: frijol aplanado con muescas en el borde. */
export function spleenGeometry() {
  return deformSphere(24, 18, (u) => {
    const p = vec(u.x * 0.022, u.y * 0.055, u.z * 0.034);
    if (u.x < 0) p.x *= 0.5; // cara visceral cóncava
    p.y += Math.sin(u.z * 9) * 0.002 * (u.z > 0.4 ? 1 : 0); // muescas del borde anterior
    return p;
  });
}

/** Timo: dos lóbulos alargados unidos en la parte inferior. */
export function thymusGeometry() {
  const lobe = (s: number) =>
    tx(
      deformSphere(16, 12, (u) => {
        const p = vec(u.x * 0.011, u.y * 0.028, u.z * 0.007);
        if (u.y > 0) p.x *= 1 - 0.5 * u.y;
        return p;
      }),
      s * 0.009,
      0,
      0,
    ).rotateZ(-s * 0.12);
  return merge([lobe(1), lobe(-1)]);
}

/** Cadena de ganglios linfáticos unidos por un vaso linfático fino. */
export function lymphChain(points: V[], nodeR = 0.0075) {
  const parts: THREE.BufferGeometry[] = [varTube(points, () => 0.0014, Math.max(12, points.length * 8), 5)];
  for (const p of points) {
    const n = deformSphere(8, 6, (u) => vec(u.x * nodeR * 1.3, u.y * nodeR, u.z * nodeR * 0.9));
    parts.push(tx(n, p.x, p.y, p.z));
  }
  return merge(parts);
}

// ---------- músculos ----------

/** Vientre muscular fusiforme entre a y b (radio máximo `r`, más ancho en `peak`), aplanado en `flat`. */
export function muscleBelly(a: V, b: V, r: number, peak = 0.5, flat = 1, bow: V = vec(0, 0, 0)) {
  const mid = a.clone().lerp(b, 0.5).add(bow);
  return varTube(
    [a, mid, b],
    (t, ang) => {
      const shape = Math.pow(Math.sin(Math.PI * Math.pow(t, Math.log(0.5) / Math.log(peak))), 0.55);
      const ell = Math.sqrt(Math.cos(ang) ** 2 + (Math.sin(ang) * flat) ** 2);
      return Math.max(0.0012, r * shape * ell);
    },
    16,
    10,
  );
}

/**
 * Pectoral mayor: abanico plano que se curva sobre el tórax y se estrecha hacia el húmero,
 * con estrías de fibras. s = +1 izquierdo, −1 derecho.
 */
export function pectoralGeometry(s: 1 | -1) {
  return deformSphere(30, 22, (u) => {
    const lat = smooth(-0.1, 1, u.x * s); // 1 hacia el hombro
    let x = u.x * 0.062;
    let y = u.y * 0.047 * (1 - 0.62 * lat);
    let z = u.z * 0.011 * (1 - 0.35 * lat);
    y += lat * 0.022; // la inserción sube hacia la axila
    z -= x * x * 5.5; // se curva siguiendo el tórax
    x *= 1;
    const fib = Math.sin((u.y * 0.8 - u.x * s * 0.6) * 46) * 0.0007;
    return vec(x, y, z + (u.z > 0 ? fib : 0));
  });
}

/** Segmento del recto abdominal ("cuadro" del abdomen): bloque redondeado y plano. */
export function absBlock(w: number, h: number) {
  return deformSphere(16, 12, (u) => {
    const sx = Math.sign(u.x) * Math.pow(Math.abs(u.x), 0.6);
    const sy = Math.sign(u.y) * Math.pow(Math.abs(u.y), 0.6);
    return vec(sx * w, sy * h, u.z * 0.008);
  });
}
