"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import UserHeader from "@/components/header/UserHeader";
import PhotoUpload from "@/components/upload/PhotoUpload";
import SearchAndRequest from "@/components/search/SearchAndRequest";
import MoodBadges from "@/components/mood/MoodBadges";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useMusics } from "@/hooks/useMusics";
import { useHistory } from "@/hooks/useHistory";
import SpotifyConnectModal from "@/components/modals/SpotifyConnectModal";
import { API_BASE } from "@/lib/api";

/* 이미지 URL 빌더 + 폴백 */
const buildPhotoSrc = (photoId: string | number) => {
  const id = encodeURIComponent(String(photoId));
  return {
    primary: `${API_BASE}/api/photos/${id}/binary`,
    fallback: `${API_BASE}/photos/${id}/binary`,
  };
};

function extractDate(item: any): Date | null {
  const v =
    item?.created_at ??
    item?.createdAt ??
    item?.history_created_at ??
    item?.saved_at ??
    item?.analyzed_at ??
    item?.updated_at ??
    item?.timestamp ??
    item?.date ??
    item?.time ??
    null;

  if (v == null) return null;
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

const fmtDateBadge = (d: Date) =>
  d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });

/* ================== 캐러셀 ================== */
function HistoryStrip({
  user,
  items,
  loading,
  error,
}: {
  user: any;
  items: any[] | undefined;
  loading: boolean;
  error: string | null;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [sideGap, setSideGap] = useState(0);

  // rAF 스케줄러 상태
  const rafIdRef = useRef<number | null>(null);
  const lastLeftRef = useRef(0);
  const lastTsRef = useRef(0);
  const runningRef = useRef(false);

  const computeActive = () => {
    const track = trackRef.current;
    if (!track) return 0;
    const cards = Array.from(track.querySelectorAll<HTMLElement>("[data-card-idx]"));
    if (!cards.length) return 0;

    const center = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    cards.forEach((el, i) => {
      const c = el.offsetLeft + el.offsetWidth / 2;
      const dist = Math.abs(c - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  };

  const ensureRafLoop = () => {
    const track = trackRef.current;
    if (!track || runningRef.current) return;

    runningRef.current = true;
    const tick = () => {
      const t = trackRef.current;
      if (!t) {
        runningRef.current = false;
        return;
      }
      const now = performance.now();
      const left = t.scrollLeft;

      const idx = computeActive();
      setActive((p) => (p === idx ? p : idx));

      if (left !== lastLeftRef.current) {
        lastLeftRef.current = left;
        lastTsRef.current = now;
      }
      if (now - lastTsRef.current < 120) {
        rafIdRef.current = requestAnimationFrame(tick);
      } else {
        runningRef.current = false;
        rafIdRef.current = null;
      }
    };

    lastLeftRef.current = track.scrollLeft;
    lastTsRef.current = performance.now();
    rafIdRef.current = requestAnimationFrame(tick);
  };

  const measureSideGap = () => {
    const track = trackRef.current;
    if (!track) return;
    const first = track.querySelector<HTMLElement>("[data-card-idx='0']");
    if (!first) {
      setSideGap(0);
      return;
    }
    const gap = Math.max(0, (track.clientWidth - first.offsetWidth) / 2);
    setSideGap(gap);
  };

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const onScroll = () => ensureRafLoop();
    const onResize = () => {
      measureSideGap();
      setActive(computeActive());
    };

    track.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    measureSideGap();
    requestAnimationFrame(() => {
      setActive(computeActive());
      centerTo(active, false);
    });

    return () => {
      track.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      runningRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const imgs = Array.from(track.querySelectorAll("img"));
    const onLoad = () => {
      measureSideGap();
      setActive(computeActive());
    };
    imgs.forEach((img) => img.addEventListener("load", onLoad, { once: true }));

    return () => imgs.forEach((img) => img.removeEventListener("load", onLoad));
  }, [items?.length]);

  const centerTo = (idx: number, smooth = true) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>(`[data-card-idx="${idx}"]`);
    if (!card) return;
    const left = card.offsetLeft + card.offsetWidth / 2 - track.clientWidth / 2;
    track.scrollTo({ left, behavior: smooth ? "smooth" : ("instant" as any) });
    ensureRafLoop();
  };

  if (loading) {
    return (
      <section className="mt-6">
        <div className="h-6 w-40 rounded bg-black/10 animate-pulse mb-4" />
        <div className="flex gap-5 overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="w-[300px] shrink-0 rounded-2xl bg-white/60 shadow-sm p-4">
              <div className="aspect-[4/5] rounded-xl bg-black/10 animate-pulse" />
              <div className="h-4 w-2/3 bg-black/10 rounded mt-3 animate-pulse" />
              <div className="h-3 w-1/2 bg-black/10 rounded mt-2 animate-pulse" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mt-6">
        <h2 className="text-xl font-semibold text-slate-800 mb-2">
          {user?.name ?? "내"} 추억
        </h2>
        <div className="text-red-600 text-sm">히스토리를 불러오지 못했습니다: {error}</div>
      </section>
    );
  }

  const list = items ?? [];
  if (list.length === 0) {
    return (
      <section className="mt-6">
        <h2 className="text-xl font-semibold text-slate-800 mb-2">
          {user?.name ?? "내"} 추억
        </h2>
        <div className="text-slate-500 text-sm">아직 저장된 추억이 없어요.</div>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-800">
            {user?.name ?? "내"}님의 추억
          </h2>
          <p className="text-slate-500 text-sm">최근에 들었던 음악들</p>
        </div>

        <div className="hidden sm:flex gap-2">
          <button
            type="button"
            onClick={() => centerTo(Math.max(0, active - 1))}
            className="h-9 px-3 rounded-lg bg-white/80 shadow border border-white/60 hover:bg-white transition"
            aria-label="이전"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => centerTo(Math.min(list.length - 1, active + 1))}
            className="h-9 px-3 rounded-lg bg-white/80 shadow border border-white/60 hover:bg-white transition"
            aria-label="다음"
          >
            ›
          </button>
        </div>
      </div>

      {/* 캐러셀 + 인디케이터 */}
      <div className="relative pb-8">
        <div
          ref={trackRef}
          className={[
            "relative -mx-6 px-6 overflow-x-auto snap-x snap-mandatory",
            "[scrollbar-width:none]",
            "[ms-overflow-style:none]",
            "[&::-webkit-scrollbar]:hidden",
            "[&::-webkit-scrollbar]:w-0",
            "[&::-webkit-scrollbar]:h-0",
          ].join(" ")}
        >
          <div className="flex gap-5 py-2">
            {/* 좌측 스페이서 */}
            <div className="shrink-0" style={{ width: sideGap }} aria-hidden />

            {list.map((it, idx) => {
              const pid = it.photo_id ?? it.photoId ?? it.id;
              const { primary, fallback } = buildPhotoSrc(pid);
              const title = it.title_snapshot ?? it.title ?? "제목 없음";
              const artist = it.artist_snapshot ?? it.artist ?? "Various";
              const dateObj = extractDate(it);
              const badge = dateObj ? fmtDateBadge(dateObj) : null;

              const isActive = idx === active;
              const isNeighbor = Math.abs(idx - active) === 1;

              return (
                <div
                  key={`${pid}-${idx}`}
                  data-card-idx={idx}
                  className="snap-center shrink-0 w-[36%] sm:w-[34%] md:w-[30%] lg:w-[26%]"
                  onClick={() => centerTo(idx)}
                  role="button"
                  aria-label={`${title} 카드`}
                >
                  <div
                    className={[
                      "rounded-2xl bg-white/80 border border-white/70 p-3.5 transition-all duration-300 ease-out will-change-transform",
                      isActive
                        ? "-translate-y-2 scale-100 opacity-100 shadow-xl ring-1 ring-sky-200/60"
                        : isNeighbor
                        ? "translate-y-0 scale-[0.90] opacity-85 shadow-sm"
                        : "translate-y-0 scale-[0.84] opacity-70 shadow-sm",
                    ].join(" ")}
                  >
                    <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-black/5">
                      <img
                        src={primary}
                        alt={title}
                        className={[
                          "w-full h-full object-cover transition",
                          isActive ? "blur-0" : "blur-[0.4px]",
                        ].join(" ")}
                        crossOrigin="anonymous"
                        onError={(e) => {
                          const img = e.currentTarget as HTMLImageElement;
                          if (!(img as any).__fb) {
                            (img as any).__fb = true;
                            img.src = fallback;
                          } else {
                            img.src = "/placeholder.svg";
                          }
                        }}
                        onLoad={() => {
                          measureSideGap();
                          setActive(computeActive());
                        }}
                      />
                      {badge && (
                        <span
                          className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/60 text-white text-[11px] leading-5 shadow-sm"
                          title={dateObj!.toLocaleString()}
                        >
                          {badge}
                        </span>
                      )}
                      {isActive && (
                        <div className="pointer-events-none absolute -top-2 left-4 right-4 h-2 bg-gradient-to-r from-fuchsia-400/60 via-sky-400/60 to-emerald-400/60 blur opacity-70" />
                      )}
                    </div>

                    <div className="mt-3">
                      <div className="text-slate-900 font-semibold truncate">{title}</div>
                      <div className="text-slate-500 text-sm truncate">{artist}</div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 우측 스페이서 */}
            <div className="shrink-0" style={{ width: sideGap }} aria-hidden />
          </div>
        </div>

        {/* 인디케이터 (하단 고정) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
          <div className="pointer-events-auto rounded-full bg-white/70 backdrop-blur px-3 py-1 shadow border border-white/60">
            <div className="flex items-center gap-2">
              {list.map((_, i) => (
                <button
                  key={i}
                  aria-label={`인덱스 ${i + 1}`}
                  onClick={() => centerTo(i)}
                  className={[
                    "h-2 rounded-full transition-all",
                    i === active ? "w-6 bg-slate-800" : "w-2.5 bg-slate-400/70 hover:bg-slate-500/80",
                  ].join(" ")}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Page() {
  const { user, isLoggedIn, logout } = useAuthUser();
  const router = useRouter();
  const { musics, loading: musicsLoading, error: musicsError } = useMusics();
  const { history, loading: historyLoading, error: historyError } = useHistory(isLoggedIn);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  const accountId = useMemo(() => {
    const anyUser = (user ?? {}) as {
      email?: string | null;
      id?: string | null;
      uid?: string | null;
      userId?: string | null;
      name?: string | null;
    };
    return (
      (anyUser.email?.trim() || null) ??
      (anyUser.id?.trim() || null) ??
      (anyUser.uid?.trim() || null) ??
      (anyUser.userId?.trim() || null) ??
      "guest"
    );
  }, [user]);

  const dismissKey = useMemo(
    () => `spotify_connect_modal_dismissed_until::${accountId}`,
    [accountId]
  );

  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        const token = localStorage.getItem("spotify_access_token");
        const dismissedUntil = Number(localStorage.getItem(dismissKey) || "0");
        const now = Date.now();
        const connected = !!(token && token.trim());
        setIsSpotifyConnected(connected);
        setShowSpotifyModal(isLoggedIn ? !connected && now > dismissedUntil : false);
      } catch {
        setIsSpotifyConnected(false);
        setShowSpotifyModal(isLoggedIn);
      }
    };
    read();

    const onStorage = (e: StorageEvent) => {
      try {
        if (e.key === "spotify_access_token") {
          const connected = !!(e.newValue && e.newValue.trim());
          setIsSpotifyConnected(connected);
          if (connected) setShowSpotifyModal(false);
        }
        if (e.key === dismissKey) {
          const now = Date.now();
          const dismissedUntil = Number(localStorage.getItem(dismissKey) || "0");
          setShowSpotifyModal(isLoggedIn && !isSpotifyConnected && now > dismissedUntil);
        }
      } catch {}
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [dismissKey, isLoggedIn, isSpotifyConnected]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 via-pink-100 to-blue-100 relative overflow-hidden">
      {/* 배경 */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-200/50 to-pink-200/50"></div>
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fillRule='evenodd'%3E%3Cg fill='%23a855f7' fillOpacity='0.3'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        ></div>
        <div className="absolute top-20 left-20 w-32 h-32 bg-gradient-to-br from-pink-300 to-purple-400 rounded-full opacity-20 blur-3xl"></div>
        <div className="absolute top-40 right-32 w-24 h-24 bg-gradient-to-br from-blue-300 to-cyan-400 rounded-full opacity-25 blur-2xl"></div>
        <div className="absolute bottom-32 left-1/3 w-40 h-40 bg-gradient-to-br from-yellow-300 to-orange-400 rounded-full opacity-15 blur-3xl"></div>
        <div className="absolute bottom-20 right-20 w-28 h-28 bg-gradient-to-br from-green-300 to-emerald-400 rounded-full opacity-20 blur-2xl"></div>
      </div>

      <UserHeader
        user={user}
        isLoggedIn={isLoggedIn}
        onLogout={() => {
          logout();
          router.push("/login");
        }}
      />

      <main className="max-w-5xl mx-auto px-6 py-16 relative z-10">
        <HistoryStrip user={user} items={history} loading={historyLoading} error={historyError} />

        <PhotoUpload
          isLoggedIn={isLoggedIn}
          selectedGenres={selectedGenres}
          onRequireLogin={() => router.push("/login")}
        />

        <SearchAndRequest musics={musics} loading={musicsLoading} error={musicsError} />

        <MoodBadges selected={selectedGenres} onToggle={toggleGenre} />
      </main>

      <SpotifyConnectModal
        open={isLoggedIn && !isSpotifyConnected && showSpotifyModal}
        onClose={() => {
          try {
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
            const expireAt = Date.now() + sevenDaysMs;
            localStorage.setItem(dismissKey, String(expireAt));
          } catch {}
          setShowSpotifyModal(false);
        }}
        onConnect={() => {
          window.location.href = "/account/spotify";
        }}
      />
    </div>
  );
}
