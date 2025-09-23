// src/app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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

/* 히스토리 아이템에서 날짜 후보를 꺼내 파싱 */
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

/* 날짜 포맷 */
const fmtDateBadge = (d: Date) =>
  d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });

/* 이미지가 확실히 뜨는 히스토리 스트립 */
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
  if (loading) {
    return (
      <section className="mt-6">
        <div className="h-6 w-40 rounded bg-black/10 animate-pulse mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white/60 shadow-sm p-4">
              <div className="aspect-square rounded-xl bg-black/10 animate-pulse" />
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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        {list.map((it, idx) => {
          const pid = it.photo_id ?? it.photoId ?? it.id;
          const { primary, fallback } = buildPhotoSrc(pid);
          const title = it.title_snapshot ?? it.title ?? "제목 없음";
          const artist = it.artist_snapshot ?? it.artist ?? "Various";
          const dateObj = extractDate(it);
          const badge = dateObj ? fmtDateBadge(dateObj) : null;

          return (
            <div
              key={`${pid}-${idx}`}
              className="rounded-2xl bg-white/70 shadow-sm p-4 hover:shadow-md transition"
            >
              <div className="relative aspect-square rounded-xl overflow-hidden bg-black/5">
                <img
                  src={primary}
                  alt={title}
                  className="w-full h-full object-cover"
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
                />
                {badge && (
                  <span
                    className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/60 text-white text-[11px] leading-5 shadow-sm"
                    title={dateObj!.toLocaleString()}
                  >
                    {badge}
                  </span>
                )}
              </div>

              <div className="mt-3">
                <div className="text-slate-900 font-medium truncate">{title}</div>
                <div className="text-slate-500 text-sm truncate">{artist}</div>
              </div>
            </div>
          );
        })}
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

  // 계정 식별자
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
