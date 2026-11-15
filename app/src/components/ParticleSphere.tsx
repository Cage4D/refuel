"use client";

// Refuel hero: a perfectly circular particle sphere (the "tank").
// Dots below the fill line are full brightness; the line's height = live contract float / FLOAT_FULL.
// Needs: pnpm add three@0.160.0 && pnpm add -D @types/three@0.160.0
// Load it with next/dynamic({ ssr: false }) so three.js never runs on the server.

import { useEffect, useRef } from "react";
import * as THREE from "three";

type Props = {
  /** 0..1 — floatBalance / FLOAT_FULL. Animates smoothly when it changes. */
  fill: number;
  /** Increment to fire the success stream toward `streamTarget`. */
  burstKey?: number;
  /** Screen-space element the success stream flies to (the BTC balance). */
  streamTarget?: React.RefObject<HTMLElement | null>;
  className?: string;
};

const BONE = new THREE.Color("#ecece6");
const EMBER = new THREE.Color("#f7931a");

export default function ParticleSphere({ fill, burstKey = 0, streamTarget, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fillRef = useRef(fill);
  const burstRef = useRef<(() => void) | null>(null);

  fillRef.current = fill;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    } catch {
      canvas.dataset.fallback = "true"; // CSS shows /particle-sphere.png instead
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    camera.position.set(0, 0, 4.4);

    // ---- geometry: thick Fibonacci shell + bright polar caps. No displacement: a clean circle.
    const small = canvas.clientWidth < 600;
    const N = small ? 11000 : 22000;
    const POLE = small ? 1200 : 2400;
    const pos = new Float32Array((N + POLE) * 3);
    const rnd = new Float32Array(N + POLE);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      const shell = 1 - Math.pow(Math.random(), 4) * 0.1;
      const j = 0.012;
      pos.set(
        [
          Math.cos(th) * r * shell + (Math.random() - 0.5) * j,
          y * shell + (Math.random() - 0.5) * j,
          Math.sin(th) * r * shell + (Math.random() - 0.5) * j,
        ],
        i * 3,
      );
      rnd[i] = Math.random();
    }
    for (let k = 0; k < POLE; k++) {
      const i = N + k;
      const s = k % 2 ? 1 : -1;
      const u = Math.random() * 2 * Math.PI;
      const v = Math.acos(1 - Math.random() * 0.12);
      const shell = 1 - Math.random() * 0.05;
      pos.set([Math.sin(v) * Math.cos(u) * shell, s * Math.cos(v) * shell, Math.sin(v) * Math.sin(u) * shell], i * 3);
      rnd[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));

    const uniforms = {
      uSize: { value: small ? 6.5 : 9.0 },
      uPR: { value: renderer.getPixelRatio() },
      uFill: { value: fillRef.current },
      uBone: { value: BONE },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aRand;
        uniform float uSize, uPR, uFill;
        varying float vA;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * uPR * (0.55 + aRand * 0.9) / -mv.z;
          float depth = smoothstep(-5.4, -3.4, mv.z);
          float tank = (position.y * 0.5 + 0.5) < uFill ? 1.0 : 0.42;
          vA = mix(0.22, 1.0, depth) * tank * (0.65 + aRand * 0.35);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uBone; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(uBone, smoothstep(0.5, 0.05, d) * vA);
        }`,
    });
    const points = new THREE.Points(geo, mat);
    points.rotation.x = 0.32;
    scene.add(points);

    // ---- success stream: 220 sprites that fly from the sphere's limb to the BTC balance, bone -> ember
    const STREAM = 220;
    const sPos = new Float32Array(STREAM * 3);
    const sCol = new Float32Array(STREAM * 3);
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
    sGeo.setAttribute("color", new THREE.BufferAttribute(sCol, 3));
    const sMat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const stream = new THREE.Points(sGeo, sMat);
    scene.add(stream);
    let burstStart = -1;
    const starts: THREE.Vector3[] = [];
    let target = new THREE.Vector3(3, -2, 0);
    burstRef.current = () => {
      if (reduce) return;
      starts.length = 0;
      for (let i = 0; i < STREAM; i++) {
        const a = Math.random() * Math.PI * 2;
        starts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0.2).multiplyScalar(0.95));
      }
      // project the target element's centre into world space at z = 0
      const el = streamTarget?.current;
      if (el) {
        const c = canvas.getBoundingClientRect();
        const t = el.getBoundingClientRect();
        const ndc = new THREE.Vector3(((t.left + t.width / 2 - c.left) / c.width) * 2 - 1, -((t.top + t.height / 2 - c.top) / c.height) * 2 + 1, 0.5);
        ndc.unproject(camera);
        const dir = ndc.sub(camera.position).normalize();
        target = camera.position.clone().add(dir.multiplyScalar(-camera.position.z / dir.z));
      }
      burstStart = clock.getElapsedTime();
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let mx = 0, my = 0;
    const onMove = (e: PointerEvent) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; };
    addEventListener("pointermove", onMove);

    // pause when off-screen
    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting;
      if (visible && !was && !reduce) raf = requestAnimationFrame(frame);
    });
    io.observe(canvas);

    const clock = new THREE.Clock();
    let raf = 0;
    const frame = () => {
      const t = clock.getElapsedTime();
      uniforms.uFill.value += (fillRef.current - uniforms.uFill.value) * 0.05; // ease to the live level
      points.rotation.y = t * 0.06;
      points.rotation.x = 0.32 + my * 0.08;
      points.rotation.z = mx * 0.05;

      if (burstStart >= 0) {
        const p = Math.min((t - burstStart) / 1.4, 1);
        for (let i = 0; i < STREAM; i++) {
          const delay = (i / STREAM) * 0.35;
          const q = Math.min(Math.max((p - delay) / (1 - delay), 0), 1);
          const e = q * q * (3 - 2 * q);
          const v = starts[i].clone().lerp(target, e);
          v.y += Math.sin(e * Math.PI) * 0.4; // arc
          sPos.set([v.x, v.y, v.z], i * 3);
          const c = BONE.clone().lerp(EMBER, e);
          sCol.set([c.r, c.g, c.b], i * 3);
        }
        sGeo.attributes.position.needsUpdate = true;
        sGeo.attributes.color.needsUpdate = true;
        sMat.opacity = p < 1 ? 1 : 0;
        if (p >= 1) burstStart = -1;
      }

      renderer.render(scene, camera);
      if (!reduce && visible) raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      removeEventListener("pointermove", onMove);
      geo.dispose(); mat.dispose(); sGeo.dispose(); sMat.dispose(); renderer.dispose();
    };
  }, [streamTarget]);

  useEffect(() => { if (burstKey > 0) burstRef.current?.(); }, [burstKey]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
