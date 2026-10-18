import { Component, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bvh, Clone, Edges, Html, useGLTF } from '@react-three/drei';
import { Quaternion, Vector3, type Group, type Mesh, type Object3D } from 'three';
import type { AssetSpec, SceneObject, Vec3 } from '@house/contracts';
import { castsShadow, effectiveDimsOf } from '@house/scene-engine';
import { EDITOR_POLICY } from '../config/editorPolicy';
import { applyObjectTransform, relativeTransform } from '../lib/convert';
import { hover, useEditor } from '../state/store';
import { categoryColor, humanCategory } from './categoryColors';
import { fitToBox } from './fit';
import { makeGhost, makeVariant, prepareModel } from './prepareModel';
import { driven, registry } from './registry';

const DRACO = EDITOR_POLICY.dracoDecoderPath;

/** Preload every GLB referenced by the scene (each URL is fetched once and cached by useGLTF). */
export function preloadAssets(urls: Iterable<string>) {
  for (const url of urls) useGLTF.preload(url, DRACO, true);
}

/** Owned clone (ghost / variant): dispose its private materials on unmount. */
function OwnedClone({ make, shadow }: { make: () => { object: Object3D; materials: { dispose(): void }[] }; shadow: boolean }) {
  const made = useMemo(make, [make]);
  useEffect(() => {
    made.object.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) { m.castShadow = shadow; m.receiveShadow = true; }
    });
  }, [made, shadow]);
  useEffect(() => () => made.materials.forEach((m) => m.dispose()), [made]);
  return <primitive object={made.object} />;
}

// ---------------------------------------------------------------- model
export function AssetModel({ asset, url, obj, shadow = true }: { asset: AssetSpec; url: string; obj: SceneObject; shadow?: boolean }) {
  const gltf = useGLTF(url, DRACO, true);
  const prepared = useMemo(() => prepareModel(gltf.scene, asset, url), [gltf.scene, asset, url]);
  const fit = useMemo(() => fitToBox(prepared.size, obj.dimensionsM, EDITOR_POLICY.maxNonUniformScale), [prepared.size, obj.dimensionsM]);
  useEffect(() => {
    if (fit.uniform) {
      console.warn(`[fit] ${obj.displayName}: model ${asset.title} is ${(fit.distortion * 100).toFixed(0)}% off-proportion for its box; scaled uniformly to fit inside.`);
    }
  }, [fit, obj.displayName, asset.title]);
  const ghost = obj.renovationDecision === 'remove';
  const lampOffKey = obj.lightOn === false ? (asset.light?.emissiveMaterials ?? []).join('|') : '';
  const overrides = obj.materialOverrides;
  const makeGhostFn = useMemo(() => () => makeGhost(prepared.root), [prepared.root]);
  const makeVariantFn = useMemo(
    () => () => makeVariant(prepared.root, overrides, lampOffKey ? lampOffKey.split('|') : []),
    [prepared.root, overrides, lampOffKey],
  );
  return (
    <group scale={fit.scale}>
      {ghost ? <OwnedClone make={makeGhostFn} shadow={false} />
        : overrides || lampOffKey ? <OwnedClone make={makeVariantFn} shadow={shadow} />
          : <Clone object={prepared.root} castShadow={shadow} receiveShadow />}
    </group>
  );
}

/** Light emitted by lamps / lanterns / pendants (cheap point lights; shadows capped scene-wide). */
function AssetLight({ asset, obj, castShadow }: { asset: AssetSpec; obj: SceneObject; castShadow: boolean }) {
  const preset = useEditor((s) => s.workingScene?.lightingPreset ?? 'day');
  const l = asset.light;
  if (!l || obj.lightOn === false) return null;
  const [w, h, d] = obj.dimensionsM;
  const pos: Vec3 = [l.position[0] * w, l.position[1] * h, l.position[2] * d];
  const boost = preset === 'evening' ? 1.6 : preset === 'golden' ? 1 : 0.6;
  return (
    <pointLight
      position={pos}
      color={l.color}
      intensity={l.intensity * boost}
      distance={l.distanceM ?? 4}
      decay={2}
      castShadow={castShadow}
      shadow-mapSize={[512, 512]}
      shadow-bias={-0.002}
    />
  );
}

// ---------------------------------------------------------------- placeholder
export function Placeholder({ obj, reason }: { obj: SceneObject; reason: 'unmatched' | 'missing' | 'loading' | 'error' }) {
  const [w, h, d] = obj.dimensionsM;
  const color = categoryColor(obj.category);
  const ghost = obj.renovationDecision === 'remove';
  const label = reason === 'loading' ? null
    : reason === 'unmatched' ? `Approximate · ${humanCategory(obj.category)}`
      : `Model unavailable · ${humanCategory(obj.category)}`;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow={!ghost && reason !== 'loading'} receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.85} transparent opacity={reason === 'loading' ? 0.25 : ghost ? 0.25 : 0.9} />
        <Edges color="#f4efe6" threshold={15} />
      </mesh>
      {reason !== 'loading' && (
        <mesh position={[0, h * 0.5, d / 2 + 0.002]}>
          <planeGeometry args={[w * 0.3, Math.min(0.06, h * 0.2)]} />
          <meshBasicMaterial color="#f4efe6" />
        </mesh>
      )}
      {label && (
        <Html position={[0, h + 0.12, 0]} center distanceFactor={7} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="proxy-label">{label}</div>
        </Html>
      )}
    </group>
  );
}

class InstanceBoundary extends Component<{ fallback: ReactNode; name: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.warn(`[asset] ${this.props.name}: failed to load model, showing placeholder.`, err);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Decor tilt: rotate the model about its centre in 90° steps, re-based so it still sits at y = 0. */
function TiltFrame({ obj, children }: { obj: SceneObject; children: ReactNode }) {
  const t = obj.tilt;
  if (!t || (t.x === 0 && t.z === 0)) return <>{children}</>;
  const h = obj.dimensionsM[1];
  const eh = effectiveDimsOf(obj)[1];
  return (
    <group position={[0, eh / 2, 0]} rotation={[(t.x * Math.PI) / 2, 0, (t.z * Math.PI) / 2, 'ZXY']}>
      <group position={[0, -h / 2, 0]}>{children}</group>
    </group>
  );
}

// ---------------------------------------------------------------- instance node
/** Ease rate (1/s) for undo, discard, resolver and settle motion. */
const GLIDE_RATE = 20;

type Tree = Map<string, SceneObject[]>;
type NodeProps = { obj: SceneObject; parent?: SceneObject; tree: Tree; shadowLamps: Set<string> };
const NO_KIDS: SceneObject[] = [];

/** True when the subtree under `id` is identical (same object identities) in both trees. */
function sameSubtree(id: string, a: Tree, b: Tree): boolean {
  const ka = a.get(id) ?? NO_KIDS;
  const kb = b.get(id) ?? NO_KIDS;
  if (ka.length !== kb.length) return false;
  return ka.every((x, i) => x === kb[i] && sameSubtree(x.id, a, b));
}

/**
 * Root `<group userData={{ objectId }}>` per furniture instance. Things resting on it render inside
 * its group with a relative transform, so dragging it carries them live; stored transforms stay
 * in room coordinates. Memoised on the object, its parent and its subtree's identities, so a
 * commit re-renders only what changed.
 */
export const SceneObjectNode = memo(function SceneObjectNode({ obj, parent, tree, shadowLamps }: NodeProps) {
  const ref = useRef<Group>(null);
  const catalog = useEditor((s) => s.catalog);
  const asset = obj.assetId ? catalog?.get(obj.assetId) : undefined;
  const url = obj.assetId ? catalog?.resolveUrl(obj.assetId) ?? null : null;
  const shadow = castsShadow(obj.category, asset);

  // Mount at the stored transform; afterwards ease toward it (see Glide).
  const target = useRef<{ p: Vector3; q: Quaternion } | null>(null);
  useLayoutEffect(() => {
    const t = parent ? relativeTransform(obj.transform, parent.transform) : obj.transform;
    const next = { p: new Vector3(...t.position), q: new Quaternion(...t.rotation) };
    if (!target.current && ref.current) applyObjectTransform(ref.current, obj, parent);
    target.current = next;
  }, [obj, parent]);
  useFrame((state, delta) => {
    const g = ref.current;
    const t = target.current;
    if (!g || !t || driven.has(obj.id)) return;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * GLIDE_RATE);
    const far = g.position.distanceToSquared(t.p) > 1e-8 || g.quaternion.angleTo(t.q) > 1e-4;
    if (!far) {
      if (!g.position.equals(t.p) || !g.quaternion.equals(t.q)) { g.position.copy(t.p); g.quaternion.copy(t.q); }
      return;
    }
    g.position.lerp(t.p, k);
    g.quaternion.slerp(t.q, k);
    state.invalidate();
  });

  useEffect(() => {
    registry.set(obj.id, ref.current);
    return () => registry.set(obj.id, null);
  }, [obj.id]);

  let body: ReactNode;
  if (!obj.assetId) body = <Placeholder obj={obj} reason="unmatched" />;
  else if (!asset || !url) body = <Placeholder obj={obj} reason="missing" />;
  else {
    body = (
      <InstanceBoundary key={url} name={obj.displayName} fallback={<Placeholder obj={obj} reason="error" />}>
        <Suspense fallback={<Placeholder obj={obj} reason="loading" />}>
          <AssetModel asset={asset} url={url} obj={obj} shadow={shadow} />
        </Suspense>
      </InstanceBoundary>
    );
  }

  return (
    <group
      ref={ref}
      name={`object:${obj.id}`}
      userData={{ objectId: obj.id }}
      onPointerOver={(e) => {
        e.stopPropagation();
        let o: Object3D | null = e.object;
        while (o && !o.userData.objectId) o = o.parent;
        hover((o?.userData.objectId as string) ?? null);
      }}
      onPointerOut={() => hover(null)}
    >
      <TiltFrame obj={obj}>{body}</TiltFrame>
      {asset?.light && <AssetLight asset={asset} obj={obj} castShadow={shadowLamps.has(obj.id)} />}
      {(tree.get(obj.id) ?? NO_KIDS).map((c) => (
        <SceneObjectNode key={c.id} obj={c} parent={obj} tree={tree} shadowLamps={shadowLamps} />
      ))}
    </group>
  );
}, (a, b) => a.obj === b.obj && a.parent === b.parent && sameSubtree(a.obj.id, a.tree, b.tree)
  && a.shadowLamps.has(a.obj.id) === b.shadowLamps.has(b.obj.id));

/** Renders the working scene's objects as a support tree. */
export function SceneObjects() {
  const objects = useEditor((s) => s.workingScene?.objects);
  const catalog = useEditor((s) => s.catalog);
  const preset = useEditor((s) => s.workingScene?.lightingPreset);
  const { roots, tree, shadowLamps } = useMemo(() => {
    const ids = new Set(objects?.map((o) => o.id));
    const tree: Tree = new Map();
    const roots: SceneObject[] = [];
    const lamps: string[] = [];
    for (const o of objects ?? []) {
      const pid = o.placement?.parentId;
      if (pid && ids.has(pid)) {
        const list = tree.get(pid) ?? [];
        list.push(o);
        tree.set(pid, list);
      } else roots.push(o);
      const a = o.assetId ? catalog?.get(o.assetId) : undefined;
      if (a?.light && o.lightOn !== false) lamps.push(o.id);
    }
    // Shadow budget: only the first few lit lamps cast shadows (the sun always does).
    const budget = preset === 'evening' ? Math.max(EDITOR_POLICY.maxLampShadows, EDITOR_POLICY.eveningLampShadows) : EDITOR_POLICY.maxLampShadows;
    return { roots, tree, shadowLamps: new Set(lamps.sort().slice(0, budget)) };
  }, [objects, catalog, preset]);

  useEffect(() => {
    if (!catalog || !objects) return;
    const urls = new Set<string>();
    for (const o of objects) {
      const u = o.assetId ? catalog.resolveUrl(o.assetId) : null;
      if (u) urls.add(u);
    }
    preloadAssets(urls);
  }, [catalog, objects]);

  // BVH-accelerated raycasts (hover, picking) — without it every pointer move tests every triangle.
  return (
    <Bvh firstHitOnly>
      <group name="scene-objects">
        {roots.map((o) => <SceneObjectNode key={o.id} obj={o} tree={tree} shadowLamps={shadowLamps} />)}
      </group>
    </Bvh>
  );
}
