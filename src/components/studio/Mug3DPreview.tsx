"use client";

// Real-time 3D drinkware preview — "so customers can see the design they picked on the actual
// product," not just the flat wrap schematic. Every shape is procedural geometry (cylinders, a
// partial-torus handle), not an imported 3D model — same reasoning as the Designs panel's icon
// library (assetProviders.ts's "CORE BUSINESS DECISION": no paid/unverified-license asset
// source). The one thing this DOES load dynamically is the customer's own design, rasterized from
// their live DesignObjectRecord[] via renderDesignToCanvas and applied as a texture on a partial
// cylinder "decal" wrapped around the body — this is what makes it a live preview of THIS design,
// not a generic render. All drinkware kinds (mug/tumbler/water-bottle/pint-glass) share the same
// "mug-wrap" print area/texture (see DrinkwareConfigurator's comment), but they're visibly
// different vessels — rendering every kind as a mug handle-and-all was misleading customers
// designing a tumbler or bottle into thinking that's what they were buying. Each kind below gets
// its own silhouette/material while reusing the same decal-texture plumbing.
import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import type { DesignObjectRecord } from "@/lib/studio/types";
import type { DrinkwareVesselKind } from "@/lib/studio/drinkwareCustomization";
import { renderDesignToCanvas } from "@/lib/studio/renderDesignToCanvas";
import { PRINT_AREAS } from "@/lib/studio/printAreas";

const WALL_THICKNESS = 0.07;

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

// Three.js's CylinderGeometry places theta=0 at local (0, y, radius) — i.e. +Z, not +X — and
// sweeps as x = radius*sin(theta), z = radius*cos(theta). Every angle below is defined in that
// SAME convention and derived from it (polarXZ), rather than hand-placed by eye, specifically
// because mismatching the handle's hardcoded position against the decal geometry's own theta=0
// was the actual bug here (confirmed empirically: the two were 90° apart, which silently pointed
// the default camera at the blank gap instead of the design).
function polarXZ(angleDeg: number, radius: number): [number, number] {
  const rad = degToRad(angleDeg);
  return [radius * Math.sin(rad), radius * Math.cos(rad)];
}

const HANDLE_ANGLE_DEG = 90; // local +X, where the handle mesh's own position prop puts it

interface VesselParams {
  radiusTop: number;
  radiusBottom: number;
  height: number;
  hasHandle: boolean;
  hasCap: boolean;
  /** Cap/neck is narrower than the body (bottle), vs. a flush lid the same width (tumbler). */
  neckRadius?: number;
  bodyColor: string;
  capColor?: string;
  metalness: number;
  roughness: number;
  transparent?: boolean;
  opacity?: number;
  /** Open top shows an inner wall + rim ring (mug, glass); capped vessels don't need either. */
  openTop: boolean;
  /** Tumbler-style push-on lids are translucent plastic, not solid metal/paint like a bottle's
   *  screw cap — set on the cap material only when true, so bottle caps stay fully opaque. */
  capTransparent?: boolean;
  capOpacity?: number;
  /** A thin straw poking out of the lid (skinny tumblers) — rendered as a slim cylinder offset
   *  from centre, so the silhouette reads as a straw tumbler rather than a plain cup. */
  hasStraw?: boolean;
}

const VESSEL_PARAMS: Record<DrinkwareVesselKind, VesselParams> = {
  mug: {
    radiusTop: 1.15, radiusBottom: 1.15, height: 2.3, hasHandle: true, hasCap: false,
    bodyColor: "#FAFAF7", metalness: 0.04, roughness: 0.35, openTop: true,
  },
  "travel-mug": {
    // Tapered insulated travel mug — narrower at the base to fit a cup holder, solid flip lid
    // (opaque dark plastic, not the clear push-on lid a tumbler has).
    radiusTop: 0.95, radiusBottom: 0.74, height: 2.7, hasHandle: false, hasCap: true,
    bodyColor: "#C9CDD1", capColor: "#2F2F33", metalness: 0.7, roughness: 0.32, openTop: false,
  },
  tumbler: {
    // Insulated steel tumbler — tapers slightly narrower at the base, brushed-metal finish, clear
    // push-on plastic lid (capTransparent) rather than a solid-color cap like a bottle's screw top.
    radiusTop: 0.95, radiusBottom: 0.82, height: 3.0, hasHandle: false, hasCap: true,
    bodyColor: "#C9CDD1", capColor: "#E7E9EA", metalness: 0.75, roughness: 0.3, openTop: false,
    capTransparent: true, capOpacity: 0.55,
  },
  "skinny-tumbler": {
    // Tall, slim tumbler with a clear push-on lid and a straw — the silhouette that actually tells
    // a customer "this is a skinny tumbler, not a regular one."
    radiusTop: 0.6, radiusBottom: 0.5, height: 3.8, hasHandle: false, hasCap: true,
    bodyColor: "#C9CDD1", capColor: "#E7E9EA", metalness: 0.72, roughness: 0.3, openTop: false,
    capTransparent: true, capOpacity: 0.55, hasStraw: true,
  },
  glass: {
    // Classic shaker pint — wider at the rim, narrower at the base, glass material, open top.
    radiusTop: 1.05, radiusBottom: 0.78, height: 2.6, hasHandle: false, hasCap: false,
    bodyColor: "#EAF3F5", metalness: 0, roughness: 0.05, transparent: true, opacity: 0.4, openTop: true,
  },
  bottle: {
    // Narrow insulated bottle body with a distinct narrower neck + screw cap.
    radiusTop: 0.72, radiusBottom: 0.72, height: 3.1, hasHandle: false, hasCap: true, neckRadius: 0.3,
    bodyColor: "#D7DADD", capColor: "#3A3A3E", metalness: 0.55, roughness: 0.3, openTop: false,
  },
};

/** Design wrap placement: full circumference for anything without a handle, minus a small seam
 *  gap for realism; the mug carves out a gap centered on the handle so the decal never overlaps
 *  it. Centered on a single reference angle either way, so the geometry and the default camera
 *  (which looks at `center`) always agree — same fix as the original mug handle/decal mismatch. */
function designGeometryFor(hasHandle: boolean) {
  const center = hasHandle ? HANDLE_ANGLE_DEG + 180 : 0;
  const gapHalf = hasHandle ? 30 : 3;
  const arc = 360 - gapHalf * 2;
  const start = center - arc / 2;
  return { start, arc, center };
}

function VesselModel({ kind, texture }: { kind: DrinkwareVesselKind; texture: THREE.CanvasTexture | null }) {
  const p = VESSEL_PARAMS[kind];
  const { start, arc } = designGeometryFor(p.hasHandle);
  const decalRadius = Math.max(p.radiusTop, p.radiusBottom) + 0.006;
  const material = (
    <meshStandardMaterial
      color={p.bodyColor}
      roughness={p.roughness}
      metalness={p.metalness}
      transparent={p.transparent}
      opacity={p.transparent ? p.opacity : 1}
      side={THREE.DoubleSide}
    />
  );

  return (
    <group rotation={[0, 0, 0]}>
      {/* Outer body */}
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[p.radiusTop, p.radiusBottom, p.height, 64, 1, true]} />
        {material}
      </mesh>
      {p.openTop && (
        <>
          {/* Inner wall — visible looking down into an open vessel, keeps it from reading as a hollow shell */}
          <mesh position={[0, p.height * 0.01, 0]}>
            <cylinderGeometry
              args={[p.radiusTop - WALL_THICKNESS, p.radiusBottom - WALL_THICKNESS, p.height * 0.97, 64, 1, true]}
            />
            <meshStandardMaterial
              color={p.transparent ? p.bodyColor : "#EDEAE2"}
              roughness={0.55}
              transparent={p.transparent}
              opacity={p.transparent ? (p.opacity ?? 1) * 0.8 : 1}
              side={THREE.BackSide}
            />
          </mesh>
          {/* Rim ring — caps the open-top wall edge so it doesn't read as paper-thin */}
          <mesh position={[0, p.height / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[p.radiusTop - WALL_THICKNESS, p.radiusTop, 64]} />
            <meshStandardMaterial color={p.bodyColor} roughness={0.3} transparent={p.transparent} opacity={p.transparent ? p.opacity : 1} side={THREE.DoubleSide} />
          </mesh>
        </>
      )}
      {p.hasCap && !p.neckRadius && (
        // Tumbler-style flush lid — a short cap cylinder sitting directly on the body's rim, plus
        // a small raised spout off-center (where you'd actually sip from) so it doesn't read as a
        // plain disc from the three-quarter camera angle.
        <group>
          <mesh position={[0, p.height / 2 + 0.12, 0]} castShadow>
            <cylinderGeometry args={[p.radiusTop * 0.98, p.radiusTop, 0.24, 64]} />
            <meshStandardMaterial
              color={p.capColor}
              roughness={p.capTransparent ? 0.15 : 0.4}
              metalness={p.capTransparent ? 0 : 0.3}
              transparent={p.capTransparent}
              opacity={p.capTransparent ? p.capOpacity : 1}
            />
          </mesh>
          <mesh position={[p.radiusTop * 0.4, p.height / 2 + 0.27, 0]} castShadow>
            <cylinderGeometry args={[0.16, 0.18, 0.14, 24]} />
            <meshStandardMaterial
              color={p.capColor}
              roughness={p.capTransparent ? 0.15 : 0.4}
              metalness={p.capTransparent ? 0 : 0.3}
              transparent={p.capTransparent}
              opacity={p.capTransparent ? p.capOpacity : 1}
            />
          </mesh>
        </group>
      )}
      {p.hasCap && p.neckRadius && (
        // Bottle-style neck + screw cap, narrower than the body.
        <group>
          <mesh position={[0, p.height / 2 + 0.18, 0]}>
            <cylinderGeometry args={[p.neckRadius, p.radiusTop * 0.85, 0.36, 48]} />
            <meshStandardMaterial color={p.bodyColor} roughness={p.roughness} metalness={p.metalness} />
          </mesh>
          <mesh position={[0, p.height / 2 + 0.42, 0]} castShadow>
            <cylinderGeometry args={[p.neckRadius + 0.03, p.neckRadius + 0.03, 0.3, 48]} />
            <meshStandardMaterial color={p.capColor} roughness={0.4} metalness={0.3} />
          </mesh>
        </group>
      )}
      {/* Straw — a slim cylinder poking up out of the lid, offset from centre (skinny tumblers) */}
      {p.hasStraw && (
        <mesh position={[p.radiusTop * 0.4, p.height / 2 + 0.75, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.055, 1.5, 16]} />
          <meshStandardMaterial color="#E7E9EA" roughness={0.25} metalness={0.1} transparent opacity={0.85} />
        </mesh>
      )}
      {/* Bottom */}
      <mesh position={[0, -p.height / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[p.radiusBottom, 64]} />
        <meshStandardMaterial color={p.bodyColor} roughness={p.roughness} transparent={p.transparent} opacity={p.transparent ? p.opacity : 1} />
      </mesh>
      {/* Design wrap — a thin decal cylinder just outside the body, textured with the live design */}
      {texture && (
        <mesh>
          <cylinderGeometry
            args={[decalRadius, decalRadius, p.height * 0.68, 64, 1, true, degToRad(start), degToRad(arc)]}
          />
          {/* toneMapped={false} — a printed design decal shouldn't respond to the scene's filmic
              tone-mapping curve, which otherwise compresses/brightens mid-tones and can wash out
              lighter design elements (same fix applied to Flat3DPreview's decal planes). */}
          <meshStandardMaterial map={texture} roughness={0.42} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}
      {/* Handle — a partial torus, attached on the +X side (mug only) */}
      {p.hasHandle && (
        <mesh position={[p.radiusTop + 0.3, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <torusGeometry args={[0.44, 0.115, 16, 48, Math.PI * 1.35]} />
          <meshStandardMaterial color={p.bodyColor} roughness={p.roughness} />
        </mesh>
      )}
    </group>
  );
}

function LoadingSpinnerOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-canvas/60">
      <div className="size-8 animate-spin rounded-full border-2 border-sand border-t-ink-950" />
    </div>
  );
}

/** `objects` is the live `sides["mug-wrap"]` array — re-rasterized to a fresh texture whenever it
 *  changes, so rotating the preview always shows the customer's current edits, not a stale
 *  snapshot. `kind` picks which vessel silhouette to render — defaults to "mug" for any caller
 *  that predates the multi-vessel fix, but every real caller now passes the project's actual
 *  drinkware kind (see StudioClient). */
export function Mug3DPreview({ objects, kind = "mug" }: { objects: DesignObjectRecord[]; kind?: DrinkwareVesselKind }) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [loading, setLoading] = useState(true);
  const printArea = PRINT_AREAS["mug-wrap"];
  // Real 8in x 3.3in wrap aspect, rendered at a fixed pixel density — matches the decal cylinder's
  // own height*circumference-arc aspect closely enough that the texture doesn't look stretched.
  const boxW = 1024;
  const boxH = Math.round(boxW * (printArea.heightIn / printArea.widthIn));

  useEffect(() => {
    let cancelled = false;
    // Loading starts true (useState default) for the first render; a re-run from here on only
    // happens when `objects` changes (a live edit), which regenerates fast enough not to need the
    // spinner again — and re-asserting it synchronously in the effect body is what React's
    // set-state-in-effect rule flags (same fix as StickerConfigurator's shape-change handler).
    renderDesignToCanvas(objects, boxW, boxH, "#FAFAF7").then((canvas) => {
      if (cancelled) return;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      // Anisotropic filtering — see the matching comment in Flat3DPreview.tsx. A curved decal
      // wrap is an oblique view by definition almost everywhere except dead-center, so fine
      // design text benefits here too, not just on the flat-piece preview.
      tex.anisotropy = 16;
      tex.needsUpdate = true;
      setTexture((prev) => {
        prev?.dispose();
        return tex;
      });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(objects)]);

  useEffect(() => () => texture?.dispose(), [texture]);

  const vessel = VESSEL_PARAMS[kind];

  // Faces the design's actual center angle (diametrically opposite the handle on a mug, dead
  // ahead on anything without one) — see designGeometryFor's comment for why that distinction
  // was the real bug here. A small extra rotation off dead-center gives a more natural
  // three-quarter product-shot angle rather than a flat, perfectly head-on view. Camera distance
  // scales with the vessel's own height so taller tumblers/bottles don't render cropped.
  const { center } = useMemo(() => designGeometryFor(vessel.hasHandle), [vessel.hasHandle]);
  const cameraPosition = useMemo<[number, number, number]>(() => {
    const distance = 7.2 * (vessel.height / 2.3);
    const [x, z] = polarXZ(center - 18, distance);
    return [x, 0.35 * (vessel.height / 2.3), z];
  }, [center, vessel.height]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-3xl bg-canvas">
      {loading && <LoadingSpinnerOverlay />}
      <Canvas shadows camera={{ position: cameraPosition, fov: 32 }} dpr={[1, 2]}>
        <ambientLight intensity={0.65} />
        <directionalLight position={[3, 4, 3]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-3, 2, -2]} intensity={0.35} />
        <VesselModel kind={kind} texture={texture} />
        <ContactShadows position={[0, -vessel.height / 2 - 0.01, 0]} opacity={0.35} scale={6} blur={2.2} far={2} />
        <Environment preset="apartment" environmentIntensity={0.5} />
        <OrbitControls
          enablePan={false}
          minDistance={4}
          maxDistance={14}
          minPolarAngle={Math.PI / 3.2}
          maxPolarAngle={Math.PI / 1.7}
          autoRotate
          autoRotateSpeed={1.2}
        />
      </Canvas>
    </div>
  );
}
