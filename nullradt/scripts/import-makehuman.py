"""
Importa la malla base de MakeHuman (CC0) y genera src/presentation/components/health/bodyMeshData.ts.

Fuente: https://github.com/makehumancommunity/makehuman (makehuman/data/3dobjs/base.obj y
data/targets/macrodetails/*.target). Los assets de MakeHuman fueron liberados como CC0 en
septiembre de 2020 (ver el encabezado de cada archivo y LICENSE.md del repositorio).

Uso (descargar antes los archivos a una carpeta):
  python -I scripts/import-makehuman.py <carpeta_descargas> [--preview <carpeta>]

La carpeta debe contener: base.obj, {african,asian,caucasian}-{female,male}.target
(= data/targets/macrodetails/<etnia>-<sexo>-young.target) y male-muscle.target
(= universal-male-young-maxmuscle-averageweight.target).
Solo usa la biblioteca estándar (+ Pillow para la vista previa opcional).
"""
import base64
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'presentation', 'components', 'health', 'bodyMeshData.ts')
HEIGHT = 1.74  # m (el modelo femenino se escala ×0.95 en la escena → ≈1.65 m)


def read_obj(path):
    verts, groups, cur = [], {}, None
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.startswith('v '):
                _, x, y, z = line.split()[:4]
                verts.append([float(x), float(y), float(z)])
            elif line.startswith('g '):
                cur = line.split(None, 1)[1].strip()
                groups.setdefault(cur, [])
            elif line.startswith('f ') and cur is not None:
                groups[cur].append([int(p.split('/')[0]) - 1 for p in line.split()[1:]])
    return verts, groups


def read_target(path):
    offs = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            if not line.strip() or line.startswith('#'):
                continue
            i, dx, dy, dz = line.split()
            offs[int(i)] = (float(dx), float(dy), float(dz))
    return offs


def apply(verts, targets):
    out = [v[:] for v in verts]
    for offs, w in targets:
        for i, (dx, dy, dz) in offs.items():
            out[i][0] += dx * w
            out[i][1] += dy * w
            out[i][2] += dz * w
    return out


def centroid(verts, faces):
    idx = sorted({i for f in faces for i in f})
    n = len(idx)
    return [sum(verts[i][a] for i in idx) / n for a in range(3)]


def build(src, sex, base_verts, groups):
    targets = [(read_target(os.path.join(src, f'{e}-{sex}.target')), 1 / 3) for e in ('african', 'asian', 'caucasian')]
    if sex == 'male':
        targets.append((read_target(os.path.join(src, 'male-muscle.target')), 0.3))
    verts = apply(base_verts, targets)

    # Solo el grupo "body" (sin ayudantes de ropa, dientes, lengua, pestañas ni articulaciones).
    faces = groups['body']
    used = sorted({i for f in faces for i in f})
    remap = {old: new for new, old in enumerate(used)}
    pos = [verts[i][:] for i in used]

    ys = [p[1] for p in pos]
    ymin, ymax = min(ys), max(ys)
    s = HEIGHT / (ymax - ymin)
    cx = sum(p[0] for p in pos) / len(pos)
    spine = centroid(verts, groups['joint-spine-2'])
    cz = spine[2]

    def tf(p):
        return [(p[0] - cx) * s, (p[1] - ymin) * s, (p[2] - cz) * s]

    pos = [tf(p) for p in pos]
    tris = []
    for f in faces:
        g = [remap[i] for i in f]
        for k in range(1, len(g) - 1):
            tris.append((g[0], g[k], g[k + 1]))

    # Normales suaves (promedio ponderado por área).
    nor = [[0.0, 0.0, 0.0] for _ in pos]
    for a, b, c in tris:
        pa, pb, pc = pos[a], pos[b], pos[c]
        u = [pb[i] - pa[i] for i in range(3)]
        v = [pc[i] - pa[i] for i in range(3)]
        n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        for i in (a, b, c):
            for k in range(3):
                nor[i][k] += n[k]
    for n in nor:
        l = math.sqrt(sum(x * x for x in n)) or 1
        for k in range(3):
            n[k] /= l

    J = lambda name: [round(x, 4) for x in tf(centroid(verts, groups[name]))]
    side = 'l' if J('joint-l-shoulder')[0] > 0 else 'r'
    L = lambda name: J(f'joint-{side}-{name}')
    lm = {
        'shoulder': L('shoulder'),
        'elbow': L('elbow'),
        'wrist': L('hand'),
        'hip': L('upper-leg'),
        'knee': L('knee'),
        'ankle': L('ankle'),
        'toe': L('toe-3-1'),
        'clavicle': L('clavicle'),
        'eye': L('eye'),
        'head': J('joint-head-2'),
        'neck': J('joint-neck'),
        'jaw': J('joint-jaw'),
        'spine': [J('joint-pelvis'), J('joint-spine-4'), J('joint-spine-3'), J('joint-spine-2'), J('joint-spine-1'), J('joint-neck')],
        'headTop': round(max(p[1] for p in pos), 4),
    }

    def radius(a, b):
        a, b = lm[a], lm[b]
        d = [b[i] - a[i] for i in range(3)]
        dd = sum(x * x for x in d)
        rs = []
        for p in pos:
            t = sum((p[i] - a[i]) * d[i] for i in range(3)) / dd
            if 0.4 < t < 0.6:
                q = [a[i] + d[i] * t - p[i] for i in range(3)]
                r = math.sqrt(sum(x * x for x in q))
                if r < 0.12:
                    rs.append(r)
        rs.sort()
        return round(rs[len(rs) // 2], 4)

    lm['armR'] = radius('shoulder', 'elbow')
    lm['legR'] = radius('hip', 'knee')

    # Profundidad del tórax a la altura del corazón (para costillas/órganos).
    hy = lm['spine'][3][1]
    band = [p for p in pos if abs(p[1] - hy) < 0.02 and abs(p[0]) < 0.05]
    lm['chestFrontZ'] = round(max(p[2] for p in band), 4)
    lm['chestBackZ'] = round(min(p[2] for p in band), 4)
    band = [p for p in pos if abs(p[1] - hy) < 0.02 and abs(p[2]) < 0.06 and abs(p[0]) < lm['shoulder'][0]]
    lm['chestHalfW'] = round(max(abs(p[0]) for p in band), 4)

    return pos, nor, tris, lm


def encode(pos, nor, tris):
    n = len(pos)
    if n > 65535:
        raise SystemExit(f'Demasiados vértices: {n}')
    bmin = [min(p[a] for p in pos) for a in range(3)]
    bmax = [max(p[a] for p in pos) for a in range(3)]
    q = bytearray()
    for p in pos:
        for a in range(3):
            q += struct.pack('<H', round((p[a] - bmin[a]) / (bmax[a] - bmin[a]) * 65535))
    nb = bytearray()
    for v in nor:
        for a in range(3):
            nb += struct.pack('<b', max(-127, min(127, round(v[a] * 127))))
    ib = bytearray()
    for t in tris:
        ib += struct.pack('<HHH', *t)
    b64 = lambda b: base64.b64encode(bytes(b)).decode('ascii')
    return {
        'min': [round(x, 5) for x in bmin],
        'max': [round(x, 5) for x in bmax],
        'vertexCount': n,
        'position': b64(q),
        'normal': b64(nb),
        'index': b64(ib),
    }


def preview(pos, nor, tris, lm, path, yaw):
    """Rasterizador por software: piel con borde brillante (fresnel) + huesos principales."""
    from PIL import Image, ImageDraw

    W, H = 360, 720
    sc = H / 1.9
    cy, sy = math.cos(yaw), math.sin(yaw)
    rot = lambda p: (p[0] * cy + p[2] * sy, p[1], -p[0] * sy + p[2] * cy)
    proj = lambda p: (W / 2 + p[0] * sc, H - 20 - p[1] * sc)
    P = [rot(p) for p in pos]
    N = [rot(n) for n in nor]
    zbuf = [-1e9] * (W * H)
    img = [20] * (W * H)
    for a, b, c in tris:
        pa, pb, pc = proj(P[a]), proj(P[b]), proj(P[c])
        x0, x1 = int(max(0, min(pa[0], pb[0], pc[0]))), int(min(W - 1, max(pa[0], pb[0], pc[0]) + 1))
        y0, y1 = int(max(0, min(pa[1], pb[1], pc[1]))), int(min(H - 1, max(pa[1], pb[1], pc[1]) + 1))
        den = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1])
        if abs(den) < 1e-9:
            continue
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                w0 = ((pb[1] - pc[1]) * (x - pc[0]) + (pc[0] - pb[0]) * (y - pc[1])) / den
                w1 = ((pc[1] - pa[1]) * (x - pc[0]) + (pa[0] - pc[0]) * (y - pc[1])) / den
                w2 = 1 - w0 - w1
                if w0 < 0 or w1 < 0 or w2 < 0:
                    continue
                z = w0 * P[a][2] + w1 * P[b][2] + w2 * P[c][2]
                k = y * W + x
                if z > zbuf[k]:
                    zbuf[k] = z
                    nz = w0 * N[a][2] + w1 * N[b][2] + w2 * N[c][2]
                    rim = (1 - min(1, abs(nz))) ** 2.2
                    img[k] = int(45 + 210 * rim)
    im = Image.new('L', (W, H))
    im.putdata(img)
    im = im.convert('RGB')
    d = ImageDraw.Draw(im)
    for s in (1, -1):
        m = lambda p: rot([p[0] * s, p[1], p[2]])
        chain = [lm['shoulder'], lm['elbow'], lm['wrist']]
        leg = [lm['hip'], lm['knee'], lm['ankle'], lm['toe']]
        for seq in (chain, leg, [lm['clavicle'], lm['shoulder']]):
            d.line([proj(m(p)) for p in seq], fill=(74, 221, 130), width=3)
    d.line([proj(rot(p)) for p in lm['spine']], fill=(222, 124, 73), width=3)
    e = proj(rot(lm['eye']))
    d.ellipse([e[0] - 3, e[1] - 3, e[0] + 3, e[1] + 3], outline=(222, 81, 73))
    im.save(path)


def main():
    src = sys.argv[1]
    prev = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    base_verts, groups = read_obj(os.path.join(src, 'base.obj'))
    meshes, lms = {}, {}
    for model in ('male', 'female'):
        pos, nor, tris, lm = build(src, model, base_verts, groups)
        print(model, len(pos), 'vértices', len(tris), 'triángulos')
        print(json.dumps(lm))
        meshes[model] = encode(pos, nor, tris)
        lms[model] = lm
        if prev:
            os.makedirs(prev, exist_ok=True)
            preview(pos, nor, tris, lm, os.path.join(prev, f'{model}-front.png'), 0)
            preview(pos, nor, tris, lm, os.path.join(prev, f'{model}-side.png'), math.pi / 2)

    header = """/* eslint-disable */
// ARCHIVO GENERADO por scripts/import-makehuman.py — no editar a mano.
// Malla base de MakeHuman (https://github.com/makehumancommunity/makehuman), assets liberados como CC0 (2020).
// Copyright original: Data Collection AB, Joel Palmius, Jonas Hauquier. CC0: sin restricciones de uso.
// Piel translúcida: posiciones Uint16 cuantizadas en [min, max], normales Int8, índices Uint16 (triángulos).

export type Vec3 = [number, number, number];

export interface BodyMeshData {
  min: Vec3;
  max: Vec3;
  vertexCount: number;
  position: string;
  normal: string;
  index: string;
}

/** Puntos de referencia medidos en la malla (lado izquierdo del cuerpo, x > 0). */
export interface BodyLandmarks {
  shoulder: Vec3;
  elbow: Vec3;
  wrist: Vec3;
  hip: Vec3;
  knee: Vec3;
  ankle: Vec3;
  toe: Vec3;
  clavicle: Vec3;
  eye: Vec3;
  head: Vec3;
  neck: Vec3;
  jaw: Vec3;
  /** Columna de la pelvis al cuello. */
  spine: Vec3[];
  headTop: number;
  armR: number;
  legR: number;
  chestFrontZ: number;
  chestBackZ: number;
  chestHalfW: number;
}
"""
    body = (
        header
        + f"\nexport const BODY_LANDMARKS: Record<'male' | 'female', BodyLandmarks> = {json.dumps(lms)};\n"
        + f"\nexport const BODY_MESH: Record<'male' | 'female', BodyMeshData> = {json.dumps(meshes)};\n"
    )
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(body)
    print('Escrito', OUT, len(body) // 1024, 'KB')


if __name__ == '__main__':
    main()
