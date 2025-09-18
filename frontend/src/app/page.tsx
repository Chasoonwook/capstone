"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import UserHeader from "@/components/header/UserHeader";
import HistoryCarousel from "@/components/history/HistoryCarousel";
import PhotoUpload from "@/components/upload/PhotoUpload";
import SearchAndRequest from "@/components/search/SearchAndRequest";
import MoodBadges from "@/components/mood/MoodBadges";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useMusics } from "@/hooks/useMusics";
import { useHistory } from "@/hooks/useHistory";
import SpotifyConnectModal from "@/components/modals/SpotifyConnectModal";

export default function Page() {
  const { user, isLoggedIn, logout } = useAuthUser();
  const router = useRouter();
  const { musics, loading: musicsLoading, error: musicsError } = useMusics();
  const { history, loading: historyLoading, error: historyError } = useHistory(isLoggedIn);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  /**
   * 계정 식별자: email > id > uid > userId > "guest"
   * - user 타입에 id/uid가 없을 수 있으므로 안전하게 any 캐스팅 후 접근
   */
  const accountId = useMemo(() => {
    const anyUser = (user ?? {}) as {
      email?: string | null;
      id?: string | null;
      uid?: string | null;
      userId?: string | null;
    };
    return (
      (anyUser.email?.trim() || null) ??
      (anyUser.id?.trim() || null) ??
      (anyUser.uid?.trim() || null) ??
      (anyUser.userId?.trim() || null) ??
      "guest"
    );
  }, [user]);

  // 계정별 DISMISS 키(prefix + accountId)
  const dismissKey = useMemo(
    () => `spotify_connect_modal_dismissed_until::${accountId}`,
    [accountId]
  );

  // Spotify 연결 상태 (localStorage 기준)
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);

  // 팝업 노출 상태
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);

  useEffect(() => {
    // 계정이 바뀌면(로그인/로그아웃/다른 계정) 다시 평가
    const read = () => {
      try {
        const token = localStorage.getItem("spotify_access_token");
        const dismissedUntil = Number(localStorage.getItem(dismissKey) || "0");
        const now = Date.now();
        const connected = !!(token && token.trim());
        setIsSpotifyConnected(connected);

        // 계정별: 로그인 상태에서만 노출 관리
        if (isLoggedIn) {
          setShowSpotifyModal(!connected && now > dismissedUntil);
        } else {
          setShowSpotifyModal(false);
        }
      } catch {
        setIsSpotifyConnected(false);
        setShowSpotifyModal(isLoggedIn); // 실패 시 로그인돼 있으면 일단 보여줌
      }
    };

    read();

    // 스토리지 동기화: 토큰/해당 계정의 dismiss 키만 관찰
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
          // 유예가 끝났으면 (다른 탭에서 key 제거/만료 변경 시) 다시 표시
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
        {/* 배너 없음 — 모달만 */}
        <HistoryCarousel user={user} items={history} loading={historyLoading} error={historyError} />

        <PhotoUpload
          isLoggedIn={isLoggedIn}
          selectedGenres={selectedGenres}
          onRequireLogin={() => router.push("/login")}
        />

        <SearchAndRequest musics={musics} loading={musicsLoading} error={musicsError} />

        <MoodBadges selected={selectedGenres} onToggle={toggleGenre} />
      </main>

      {/* 계정별 7일 유예 팝업 */}
      <SpotifyConnectModal
        open={isLoggedIn && !isSpotifyConnected && showSpotifyModal}
        onClose={() => {
          try {
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
            const expireAt = Date.now() + sevenDaysMs; // 7일 후
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
