"use client";

import { useEffect, useRef } from "react";

type Props = {
  children: React.ReactNode;
  className?: string;
  /** 반짝 강도(0~1) */
  intensity?: number;
  /** 하이라이트 반경(px) */
  radius?: number;
  /** 추적 부드러움(0~1, 클수록 관성 큼) */
  smooth?: number;
  /** 데스크톱에서 마우스 추적 활성화 */
  mouseFallback?: boolean;
};

export default function GyroShine({
  children,
  className = "",
  intensity = 0.55,     // 더 선명하게
  radius = 240,
  smooth = 0.22,
  mouseFallback = true,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const s = useRef({ x: 50, y: 50, tx: 50, ty: 50, raf: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    // iOS 권한 (터치 1회 후 요청)
    const askIOS = async () => {
      try {
        // @ts-ignore
        const Ori = window.DeviceOrientationEvent;
        // @ts-ignore
        const Mot = window.DeviceMotionEvent;
        // @ts-ignore
        if (Ori?.requestPermission) await Ori.requestPermission();
        // @ts-ignore
        else if (Mot?.requestPermission) await Mot.requestPermission();
      } catch {}
    };
    const onTapOnce = () => {
      askIOS();
      window.removeEventListener("click", onTapOnce);
      window.removeEventListener("touchend", onTapOnce);
    };
    window.addEventListener("click", onTapOnce, { passive: true });
    window.addEventListener("touchend", onTapOnce, { passive: true });

    const onOrient = (e: DeviceOrientationEvent) => {
      const gamma = e.gamma ?? 0; // 좌/우
      const beta = e.beta ?? 0;   // 상/하
      s.current.tx = 50 + clamp(gamma / 45, -1, 1) * 32;
      s.current.ty = 50 - clamp(beta / 45, -1, 1) * 28; // 위쪽에서 비추는 느낌
    };

    const onPointer = (ev: PointerEvent) => {
      if (!mouseFallback) return;
      const r = el.getBoundingClientRect();
      s.current.tx = clamp(((ev.clientX - r.left) / r.width) * 100, 0, 100);
      s.current.ty = clamp(((ev.clientY - r.top) / r.height) * 100, 0, 100);
    };

    const loop = () => {
      const st = s.current;
      st.x += (st.tx - st.x) * smooth;
      st.y += (st.ty - st.y) * smooth;
      el.style.setProperty("--gx", `${st.x}%`);
      el.style.setProperty("--gy", `${st.y}%`);
      st.raf = requestAnimationFrame(loop);
    };
    s.current.raf = requestAnimationFrame(loop);

    window.addEventListener("deviceorientation", onOrient, true);
    el.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      el.removeEventListener("pointermove", onPointer);
      window.removeEventListener("click", onTapOnce);
      window.removeEventListener("touchend", onTapOnce);
      cancelAnimationFrame(s.current.raf);
    };
  }, [smooth, mouseFallback]);

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-[24px] ${className}`}
      style={
        {
          "--shineRadius": `${radius}px`,
          "--shineAlpha": intensity.toString(),
        } as React.CSSProperties
      }
    >
      {/* 0) 버튼 바탕: 블루 계열(영상 톤) */}
      <div
        aria-hidden
        className="absolute inset-0 z-[1] rounded-[24px]"
        style={{
          background:
            "linear-gradient(180deg, #2e6ff3 0%, #5da1ff 45%, #3f79ff 100%)",
        }}
      />

      {/* 1) 외곽 네온 보더(보라 라인) */}
      <div
        aria-hidden
        className="absolute inset-0 z-[20] rounded-[24px] pointer-events-none"
        style={{
          background:
            "linear-gradient(#0000,#0000) padding-box, linear-gradient(120deg, #8c4aff, #7abbff) border-box",
          border: "3px solid transparent",
          filter:
            "drop-shadow(0 2px 12px rgba(122,171,255,.55)) drop-shadow(0 0 16px rgba(140,74,255,.35))",
        }}
      />

      {/* 2) 상/하 글로스(고정, 깜빡임 없음) */}
      <div
        aria-hidden
        className="absolute inset-0 z-[25] rounded-[24px] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, rgba(255,255,255,.78), rgba(255,255,255,0) 42%), linear-gradient(to top, rgba(255,255,255,.35), rgba(255,255,255,0) 58%)",
          mixBlendMode: "screen" as any,
        }}
      />

      {/* 3) 자이로 하이라이트: 고채도 무지개 + 약간의 색 농도 보정 */}
      <div
        aria-hidden
        className="absolute inset-0 z-[30] pointer-events-none"
        style={{
          background: `
            radial-gradient(
              circle at var(--gx,50%) var(--gy,50%),
              rgba(255,255,255, calc(var(--shineAlpha,0.55) * 1.0)) 0%,
              rgba(255,255,255, calc(var(--shineAlpha,0.55) * 0.75)) 12%,
              rgba(255,255,255,0) var(--shineRadius,240px)
            ),
            conic-gradient(
              from 0deg at var(--gx,50%) var(--gy,50%),
              #fff1 0deg,
              #ffe14c 50deg,
              #b6ff30 110deg,
              #39e7ff 170deg,
              #a783ff 230deg,
              #ffd2f0 290deg,
              #fff1 360deg
            )
          `,
          mixBlendMode: "screen" as any,
          filter: "saturate(1.65) contrast(1.12)", // ← 색감 더 쨍하게
        }}
      />

      {/* 4) 안쪽 유리감(입체) */}
      <div
        aria-hidden
        className="absolute inset-0 z-[40] rounded-[24px] pointer-events-none"
        style={{
          boxShadow:
            "inset 0 0 22px rgba(255,255,255,0.26), inset 0 0 7px rgba(255,255,255,0.96)",
        }}
      />

      {/* 콘텐츠(텍스트/아이콘) — 투명 배경 유지 */}
      <div className="relative z-[60]">{children}</div>
    </div>
  );
}
