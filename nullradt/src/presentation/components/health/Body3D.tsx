import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';
import type { BodySystemId, HealthStatus } from '@/domain/entities/HealthIndicator';
import type { BodyModel } from '@/presentation/store/settingsStore';
import { buildBody, disposeBody, type OrganMesh } from './bodyScene';

/**
 * Cuerpo 3D holográfico: piel de vidrio verde con borde brillante (malla anatómica generada offline),
 * esqueleto y órganos de los 7 sistemas coloreados por estado. Girar = arrastrar, zoom = pellizcar, seleccionar = tocar.
 * Three.js directo sobre expo-gl (sin React Three Fiber: menos capas y compatible con Expo Go).
 */

const STATUS_HEX: Record<HealthStatus, string> = { normal: '#4ADD82', caution: '#DE7C49', critical: '#DE5149', unevaluated: '#8A968F' };

export interface Body3DProps {
  model: BodyModel;
  statuses: Record<BodySystemId, HealthStatus>;
  selected: BodySystemId | null;
  onSelect: (id: BodySystemId) => void;
  dark: boolean;
  height: number;
}

interface SceneState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  body: { root: THREE.Group; organs: OrganMesh[] } | null;
  bodyKey: string;
}

export function Body3D({ model, statuses, selected, onSelect, dark, height }: Body3DProps) {
  const rotation = useRef({ y: 0.4, x: 0, auto: true });
  const zoom = useRef(3.4);
  const start = useRef({ y: 0, x: 0, zoom: 3.4 });
  const [size, setSize] = useState({ w: 1, h: height });
  const sceneRef = useRef<SceneState | null>(null);
  const frame = useRef<number | null>(null);
  // Props más recientes, leídas por el bucle de render sin recrear el contexto GL.
  const props = useRef({ model, statuses, selected, dark });
  useEffect(() => {
    props.current = { model, statuses, selected, dark };
  }, [model, statuses, selected, dark]);

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
      if (sceneRef.current?.body) disposeBody(sceneRef.current.body.root);
      sceneRef.current = null;
    },
    [],
  );

  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    // Canvas mínimo para que Three.js acepte el contexto de expo-gl.
    const canvas = {
      width: w,
      height: h,
      style: {},
      clientWidth: w,
      clientHeight: h,
      addEventListener: () => {},
      removeEventListener: () => {},
      getContext: () => gl,
    } as unknown as HTMLCanvasElement;

    // expo-gl expone su contexto como instancia de `WebGLRenderingContext` y Three.js (r163+) lo rechaza como WebGL 1,
    // aunque el contexto nativo (GLES 3) implementa la API de WebGL 2. Se oculta el global solo durante la creación.
    const g = globalThis as { WebGLRenderingContext?: unknown };
    const savedCtor = g.WebGLRenderingContext;
    g.WebGLRenderingContext = undefined;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, context: gl as unknown as WebGL2RenderingContext, antialias: false });
    } finally {
      g.WebGLRenderingContext = savedCtor;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 20);
    camera.position.set(0, 1.0, 3.4);
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(2, 3, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x82e6a8, 0.5);
    rim.position.set(-2, 1, -2);
    scene.add(rim);
    // Plataforma: dos anillos finos
    for (const [r1, r2, op] of [
      [0.3, 0.315, 0.55],
      [0.4, 0.405, 0.25],
    ] as const) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r1, r2, 64), new THREE.MeshBasicMaterial({ color: '#4ADD82', transparent: true, opacity: op }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.005;
      scene.add(ring);
    }

    const state: SceneState = { scene, camera, body: null, bodyKey: '' };
    sceneRef.current = state;
    let last = performance.now();
    let elapsed = 0;
    const color = new THREE.Color();

    const render = () => {
      if (sceneRef.current !== state) return;
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      elapsed += dt;
      const t = elapsed;
      const cur = props.current;

      // Reconstruye el maniquí si cambió el modelo o el tema.
      const bodyKey = `${cur.model}-${cur.dark}`;
      if (bodyKey !== state.bodyKey) {
        const prevRot = state.body?.root.rotation.clone();
        if (state.body) {
          scene.remove(state.body.root);
          disposeBody(state.body.root);
        }
        state.body = buildBody(cur.model, cur.dark);
        if (prevRot) state.body.root.rotation.copy(prevRot);
        scene.add(state.body.root);
        state.bodyKey = bodyKey;
        ambient.intensity = cur.dark ? 0.7 : 0.9;
      }

      // Color por estado, atenuado si hay otra selección y pulso en seleccionado/críticos.
      for (const { system, mesh, baseOpacity } of state.body!.organs) {
        const status = cur.statuses[system] ?? 'unevaluated';
        const active = cur.selected === system;
        color.set(STATUS_HEX[status]);
        mesh.material.color.copy(color);
        mesh.material.emissive.copy(color);
        mesh.material.opacity = cur.selected && !active ? Math.min(0.16, baseOpacity) : baseOpacity;
        mesh.material.depthWrite = mesh.material.opacity > 0.5;
        mesh.material.emissiveIntensity = active || status === 'critical' ? 0.55 + 0.45 * Math.sin(t * 3) : 0.25;
      }

      const g = state.body!.root;
      if (rotation.current.auto) rotation.current.y += dt * 0.35;
      g.rotation.y += (rotation.current.y - g.rotation.y) * Math.min(1, dt * 8);
      g.rotation.x += (rotation.current.x - g.rotation.x) * Math.min(1, dt * 8);
      camera.position.z += (zoom.current - camera.position.z) * Math.min(1, dt * 8);
      camera.lookAt(0, 0.92, 0);

      renderer.render(scene, camera);
      gl.endFrameEXP();
      frame.current = requestAnimationFrame(render);
    };
    render();
  }, []);

  const pick = useCallback(
    (x: number, y: number) => {
      const state = sceneRef.current;
      if (!state) return;
      const ndc = new THREE.Vector2((x / size.w) * 2 - 1, -(y / size.h) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, state.camera);
      const hit = ray.intersectObjects(state.scene.children, true).find((h) => h.object.userData?.systemId);
      if (hit) onSelect(hit.object.userData.systemId as BodySystemId);
    },
    [onSelect, size],
  );

  const pan = usePanGesture({
    runOnJS: true,
    minDistance: 6,
    onBegin: () => {
      rotation.current.auto = false;
      start.current.y = rotation.current.y;
      start.current.x = rotation.current.x;
    },
    onUpdate: (e) => {
      rotation.current.y = start.current.y + e.translationX * 0.012;
      rotation.current.x = Math.max(-0.5, Math.min(0.5, start.current.x + e.translationY * 0.004));
    },
  });
  const pinch = usePinchGesture({
    runOnJS: true,
    onBegin: () => {
      start.current.zoom = zoom.current;
    },
    onUpdate: (e) => {
      zoom.current = Math.max(1.6, Math.min(4.6, start.current.zoom / e.scale));
    },
  });
  const tap = useTapGesture({
    runOnJS: true,
    onDeactivate: (e) => {
      rotation.current.auto = false;
      pick(e.x, e.y);
    },
  });
  const gesture = useSimultaneousGestures(pan, pinch, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        style={[styles.wrap, { height }]}
        onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({ wrap: { width: '100%', overflow: 'hidden' } });
