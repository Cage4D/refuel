"use client";

import { useEffect, useRef } from "react";

const INTERACTIVE = "a, button, [role='button'], label, summary, select, input, textarea";

/**
 * Themed cursor: a bone dot that tracks the pointer exactly, and a rim ring that
 * eases after it. Over links and buttons the ring grows and turns ember.
 * Only on fine pointers (mouse/trackpad); touch devices keep their native behaviour.
 * With reduced motion the ring follows without easing.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!matchMedia("(pointer: fine)").matches) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    root.classList.add("has-cursor");

    let x = -100, y = -100, rx = x, ry = y, raf = 0;
    const place = (el: HTMLElement | null, px: number, py: number) => {
      if (el) el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    };
    const tick = () => {
      rx += (x - rx) * 0.2;
      ry += (y - ry) * 0.2;
      place(ring.current, rx, ry);
      raf = Math.abs(x - rx) + Math.abs(y - ry) > 0.1 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      root.classList.add("cursor-on");
      place(dot.current, x, y);
      if (reduce) place(ring.current, x, y);
      else if (!raf) raf = requestAnimationFrame(tick);
      const t = e.target as Element | null;
      root.classList.toggle("cursor-hover", !!t?.closest?.(INTERACTIVE));
    };
    const onLeave = () => root.classList.remove("cursor-on");
    const onDown = () => root.classList.add("cursor-down");
    const onUp = () => root.classList.remove("cursor-down");

    addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    addEventListener("pointerdown", onDown);
    addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      removeEventListener("pointerdown", onDown);
      removeEventListener("pointerup", onUp);
      root.classList.remove("has-cursor", "cursor-on", "cursor-hover", "cursor-down");
    };
  }, []);

  return (
    <>
      <div ref={ring} className="cursor-ring" aria-hidden="true" />
      <div ref={dot} className="cursor-dot" aria-hidden="true" />
    </>
  );
}
