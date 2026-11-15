import * as THREE from 'three';
import type { BodyLandmarks, Vec3 } from './bodyMeshData';

/**
 * POSE RELAJADA del cuerpo 3D.
 * La malla de MakeHuman viene en "pose A" (brazos abiertos ~41° y antebrazos adelantados), que se ve rígida.
 * Como no tiene esqueleto, la deformamos por código con dos articulaciones por brazo:
 *  1) hombro: el brazo baja hasta `abductionDeg` respecto a la vertical;
 *  2) codo: el antebrazo se estira hasta quedar con `elbowFlexDeg` de flexión natural.
 * Cada vértice se mueve con un peso suave (mezcla en la axila y en el codo) para que la piel no se rompa.
 * Los puntos de referencia (codo, muñeca) se transforman igual, así huesos y músculos siguen a la piel.
 */
export const RELAXED_POSE = { abductionDeg: 11, elbowFlexDeg: 16 } as const;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface Joint {
  pivot: THREE.Vector3;
  rot: THREE.Quaternion;
}

interface SidePose {
  shoulder: THREE.Vector3;
  elbow: THREE.Vector3;
  armDir: THREE.Vector3;
  foreDir: THREE.Vector3;
  armLen: number;
  armR: number;
  sh: Joint;
  el: Joint; // pivote ya en la posición posada del codo
}

function sidePose(L: BodyLandmarks, s: 1 | -1): SidePose {
  const v = (p: Vec3) => new THREE.Vector3(p[0] * s, p[1], p[2]);
  const shoulder = v(L.shoulder);
  const elbow = v(L.elbow);
  const wrist = v(L.wrist);
  const upper = elbow.clone().sub(shoulder);
  const fore = wrist.clone().sub(elbow);

  // 1) Hombro: rotación en el plano frontal (eje Z) para acercar el brazo al cuerpo.
  const current = Math.atan2(Math.abs(upper.x), -upper.y);
  const delta = current - THREE.MathUtils.degToRad(RELAXED_POSE.abductionDeg);
  const shRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s * delta);

  // 2) Codo: reducir la flexión (antebrazo hacia la línea del brazo) alrededor del eje de flexión.
  const flex = upper.angleTo(fore);
  const axis = new THREE.Vector3().crossVectors(upper, fore).normalize();
  const elRot = new THREE.Quaternion().setFromAxisAngle(axis, -(flex - THREE.MathUtils.degToRad(RELAXED_POSE.elbowFlexDeg)));
  // El eje del codo gira con el brazo.
  const elRotPosed = shRot.clone().multiply(elRot).multiply(shRot.clone().invert());
  const elbowPosed = shoulder.clone().add(upper.clone().applyQuaternion(shRot));

  return {
    shoulder,
    elbow,
    armDir: upper.clone().normalize(),
    foreDir: fore.clone().normalize(),
    armLen: upper.length(),
    armR: L.armR,
    sh: { pivot: shoulder, rot: shRot },
    el: { pivot: elbowPosed, rot: elRotPosed },
  };
}

/** Pesos de un vértice (en la pose original): cuánto lo mueve el hombro y cuánto el codo. */
function weights(p: THREE.Vector3, sp: SidePose) {
  const rel = p.clone().sub(sp.shoulder);
  const along = rel.dot(sp.armDir);
  // Distancia al "hueso" del brazo: segmento hombro→codo y, desde el codo, el antebrazo + mano.
  const t = Math.min(Math.max(along, 0), sp.armLen);
  const dUpper = rel.clone().addScaledVector(sp.armDir, -t).length();
  const relE = p.clone().sub(sp.elbow);
  const fromElbow = relE.dot(sp.foreDir);
  const dFore = relE.clone().addScaledVector(sp.foreDir, -Math.max(fromElbow, 0)).length();
  // Solo vértices del brazo: cerca del hueso y más allá de la axila (no el costado del torso).
  // En antebrazo y mano la tolerancia es mayor (pulgar y dedos se separan del eje; ahí el torso queda lejos).
  const inUpper = 1 - smooth(sp.armR * 1.9, sp.armR * 2.5, dUpper);
  const inFore = fromElbow > 0.02 ? 1 - smooth(sp.armR * 3.5, sp.armR * 4.5, dFore) : 1 - smooth(sp.armR * 1.9, sp.armR * 2.5, dFore);
  const inArm = Math.max(inUpper, inFore);
  const pastShoulder = smooth(-0.035, 0.065, along);
  const wShoulder = inArm * pastShoulder;
  // Antebrazo y mano: más allá del codo.
  const wElbow = along > sp.armLen * 0.6 ? wShoulder * smooth(-0.035, 0.035, fromElbow) : 0;
  return { wShoulder, wElbow };
}

const tmp = new THREE.Vector3();
function applyJoint(p: THREE.Vector3, j: Joint, w: number, isNormal = false) {
  if (w <= 0) return p;
  tmp.copy(p);
  if (!isNormal) tmp.sub(j.pivot);
  tmp.applyQuaternion(j.rot);
  if (!isNormal) tmp.add(j.pivot);
  return p.lerp(tmp, w);
}

/** Deforma posiciones y normales (in place) a la pose relajada. */
export function poseMesh(pos: Float32Array, nor: Float32Array, L: BodyLandmarks) {
  const sides = { 1: sidePose(L, 1), [-1]: sidePose(L, -1) } as Record<1 | -1, SidePose>;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    p.set(pos[i]!, pos[i + 1]!, pos[i + 2]!);
    const sp = sides[p.x >= 0 ? 1 : -1];
    const { wShoulder, wElbow } = weights(p, sp);
    if (wShoulder <= 0) continue;
    n.set(nor[i]!, nor[i + 1]!, nor[i + 2]!);
    applyJoint(p, sp.sh, wShoulder);
    applyJoint(n, sp.sh, wShoulder, true);
    applyJoint(p, sp.el, wElbow);
    applyJoint(n, sp.el, wElbow, true);
    n.normalize();
    pos[i] = p.x;
    pos[i + 1] = p.y;
    pos[i + 2] = p.z;
    nor[i] = n.x;
    nor[i + 1] = n.y;
    nor[i + 2] = n.z;
  }
}

/** Puntos de referencia en la pose relajada (lado izquierdo, x > 0, como en BODY_LANDMARKS). */
export function poseLandmarks(L: BodyLandmarks): BodyLandmarks {
  const sp = sidePose(L, 1);
  const elbow = sp.shoulder.clone().add(new THREE.Vector3(...L.elbow).sub(sp.shoulder).applyQuaternion(sp.sh.rot));
  const wrist0 = new THREE.Vector3(...L.wrist).sub(sp.shoulder).applyQuaternion(sp.sh.rot).add(sp.shoulder);
  const wrist = wrist0.sub(sp.el.pivot).applyQuaternion(sp.el.rot).add(sp.el.pivot);
  return { ...L, elbow: [elbow.x, elbow.y, elbow.z], wrist: [wrist.x, wrist.y, wrist.z] };
}
