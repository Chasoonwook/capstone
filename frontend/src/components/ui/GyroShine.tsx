"use client";

import { useEffect, useRef } from "react";

export default function GyroShine({
  children,
  className = "",
  intensity = 0.35,
  radius = 200,
  smooth = 0.18,
}: {
  children: React.ReactNode;
  className?: string;
  intensity?: number;
  radius?: number;
  smooth?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const state = useRef({ x: 50, y: 50, tx: 50, ty: 50, raf: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const norm = (v: number, a: number, b: number) =>
      Math.max(a, Math.min(b, v));

    const askIOS = async () => {
    try {
        const anyWin = window as any;
        const Ori = anyWin.DeviceOrientationEvent;
        const Mot = anyWin.DeviceMotionEvent;

        // iOS 13+ 일부는 Orientation, 일부는 Motion에만 붙어있을 수 있음
        if (Ori && typeof Ori.requestPermission === "function") {
        await Ori.requestPermission();
        return;
        }
        if (Mot && typeof Mot.requestPermission === "function") {
        await Mot.requestPermission();
        return;
        }
        // 둘 다 없으면 아무 것도 안 함 (안드로이드/데스크탑 등)
    } catch {
        // 무시
    }
    };
    const onTapOnce = () => {
      askIOS();
      window.removeEventListener("click", onTapOnce);
      window.removeEventListener("touchend", onTapOnce);
    };
    window.addEventListener("click", onTapOnce, { passive: true });
    window.addEventListener("touchend", onTapOnce, { passive: true });

    const onOrient = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma ?? 0;
      const beta = e.beta ?? 0;
      const range = 30;
      state.current.tx = 50 + norm(gamma / 45, -1, 1) * range;
      state.current.ty = 50 + norm(beta / 90, -1, 1) * range;
    };

    const onPointer = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      state.current.tx = norm(((ev.clientX - r.left) / r.width) * 100, 0, 100);
      state.current.ty = norm(((ev.clientY - r.top) / r.height) * 100, 0, 100);
    };

    const loop = () => {
      const s = state.current;
      s.x += (s.tx - s.x) * smooth;
      s.y += (s.ty - s.y) * smooth;
      el.style.setProperty("--gx", `${s.x}%`);
      el.style.setProperty("--gy", `${s.y}%`);
      s.raf = requestAnimationFrame(loop);
    };
    state.current.raf = requestAnimationFrame(loop);

    window.addEventListener("deviceorientation", onOrient, true);
    el.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      el.removeEventListener("pointermove", onPointer);
      window.removeEventListener("click", onTapOnce);
      window.removeEventListener("touchend", onTapOnce);
      cancelAnimationFrame(state.current.raf);
    };
  }, [smooth]);

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden ${className}`}
      style={
        {
          "--shineRadius": `${radius}px`,
          "--shineAlpha": intensity.toString(),
        } as React.CSSProperties
      }
    >
      <div className="relative z-10">{children}</div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20"
        style={{
          background: `
            conic-gradient(
              from 0deg at var(--gx,50%) var(--gy,50%),
              #ffd1ff, #a1c4fd, #c2ffd8, #fbc2eb, #ffd1ff
            ),
            radial-gradient(
              circle at var(--gx,50%) var(--gy,50%),
              rgba(255,255,255,calc(var(--shineAlpha,0.35)*0.95)) 0%,
              rgba(255,255,255,calc(var(--shineAlpha,0.35)*0.55)) 20%,
              rgba(255,255,255,0) var(--shineRadius,200px)
            )
          `,
          mixBlendMode: "screen" as any,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 rounded-[999px]"
        style={{
          boxShadow:
            "inset 0 0 18px rgba(255,255,255,0.25), inset 0 0 4px rgba(255,255,255,0.9)",
        }}
      />
    </div>
  );
}
