"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import PhotoUpload from "@/components/upload/PhotoUpload";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useMusics } from "@/hooks/useMusics";
import { useHistory } from "@/hooks/useHistory";
import SpotifyConnectModal from "@/components/modals/SpotifyConnectModal";

import Header from "@/components/header/Header";
import HistorySwitch from "@/components/history/HistorySwitch";

import {
  Camera,
  Home,
  SkipBack,
  Play,
  SkipForward,
  ListMusic,
  Volume2,
} from "lucide-react";
import { API_BASE } from "@/lib/api";

// Spotify 연동 상태만 구독 (추가 네트워크 호출 없음)
import { useSpotifyStatus } from "../contexts/SpotifyStatusContext";

// 자이로 기반 하이라이트 효과 제공
import GyroShine from "@/components/ui/GyroShine";

export default function Page() {
  const { user, isLoggedIn, logout } = useAuthUser();
  const router = useRouter();

  const { musics, loading: musicsLoading, error: musicsError } = useMusics();
  const { history, loading: historyLoading, error: historyError } = useHistory(isLoggedIn);

  // 선택 장르를 PhotoUpload로 전달
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // 계정 식별자 결정 (이메일 → id → uid → userId → guest 순)
  const accountId = useMemo(() => {
    const anyUser = (user ?? {}) as any;
    return (
      anyUser.email?.trim() ||
      anyUser.id?.toString()?.trim() ||
      anyUser.uid?.toString()?.trim() ||
      anyUser.userId?.toString()?.trim() ||
      "guest"
    );
  }, [user]);

  // Spotify 연결 모달 1회 노출 여부 사용자 단위 관리
  const seenKey = useMemo(
    () => `spotify_connect_prompt_seen::${accountId}`,
    [accountId],
  );

  const { status } = useSpotifyStatus();
  const isSpotifyConnected = !!status?.connected;

  const [showSpotifyModal, setShowSpotifyModal] = useState(false);

  // 추천 화면 복귀 여부에 따른 하단 내비 표시
  const [showNav, setShowNav] = useState(false);

  // 플레이어 화면 복귀 (세션 저장 마지막 경로 사용)
  const openPlayer = () => {
    const last =
      (typeof window !== "undefined" && sessionStorage.getItem("lastPlayerRoute")) ||
      "/recommend";
    router.push(last);
  };

  // 초기 마운트 시 쿼리 정리 및 Spotify 연결 모달 상태 결정
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);

    // 추천에서 복귀한 경우 처리
    if (url.searchParams.get("from") === "player") {
      setShowNav(true);
      url.searchParams.delete("from");
      window.history.replaceState({}, "", url.toString());
    } else {
      setShowNav(false);
    }

    // 모달 노출 여부 판단
    const alreadySeen = localStorage.getItem(seenKey) === "1";
    setShowSpotifyModal(isLoggedIn && !isSpotifyConnected && !alreadySeen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 최초 1회만 실행

  // Spotify 연결 상태 변경 시 모달 종료 처리
  useEffect(() => {
    if (isSpotifyConnected) {
      setShowSpotifyModal(false);
      try {
        localStorage.setItem(seenKey, "1");
      } catch {}
    }
  }, [isSpotifyConnected, seenKey]);

  return (
    <>
      <div className={`min-h-screen bg-background ${showNav ? "pb-20" : "pb-6"}`}>
        <Suspense fallback={<div className="h-14" />} >
          <Header
            user={user}
            isLoggedIn={isLoggedIn}
            onLogout={() => {
              logout();
              router.push("/login");
            }}
            musics={musics}
            loading={musicsLoading}
            error={musicsError}
          />
        </Suspense>

        <main className="max-w-lg mx-auto">
          <div className="pt-4">
            <Suspense fallback={<div className="px-4 text-sm text-muted-foreground">Loading…</div>}>
              <HistorySwitch
                user={user}
                history={history}
                loading={historyLoading}
                error={historyError}
              />
            </Suspense>
          </div>

          {/* 업로드 CTA 영역. 버튼에 GyroShine 효과 적용 */}
          <section className="px-4 pb-4">
            <div className="bg-gradient-to-br from-primary/10 via-accent/5 to-primary/10 rounded-2xl p-6 mb-6">
              <h2 className="text-xl font-bold text-foreground mb-2 text-balance">
                Turn your mood into music
              </h2>
              <p className="text-sm text-muted-foreground mb-4 text-pretty">
                Upload a photo and the AI analyzes your mood and
                <br />
                recommends music that fits.
              </p>

              <GyroShine
                className="rounded-[24px]"
                intensity={0.55}   // 하이라이트 강도 설정
                radius={240}       // 효과 범위 설정
                smooth={0.22}
                mouseFallback      // 데스크톱 환경 마우스 추적 사용
              >
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="relative w-full bg-transparent text-white rounded-[24px] py-12 px-8 font-semibold text-base sm:text-lg flex items-center justify-center gap-2 select-none"
                  style={{ textShadow: "0 1px 2px rgba(0,0,0,.35)" }}
                >
                  <Camera className="w-4 h-4" />
                  Analyze mood from photo
                </button>
              </GyroShine>
            </div>
          </section>

          {/* 무드 배지 섹션 제거됨 */}
        </main>

        {!showNav && (
          <button
            onClick={() => setShowUploadModal(true)}
            className="fixed bottom-6 right-4 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform z-40"
            aria-label="Upload photo"
          >
            <Camera className="w-6 h-6" />
          </button>
        )}
      </div>

      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 z-[9999] flex items-end sm:items-center justify-center">
          <div className="bg-background w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl p-6 animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Analyze Mood</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <PhotoUpload
              isLoggedIn={isLoggedIn}
              selectedGenres={selectedGenres}
              onRequireLogin={() => {
                setShowUploadModal(false);
                router.push("/login");
              }}
            />
          </div>
        </div>
      )}

      {/* Spotify 연결 모달 (사용자 단위 1회 노출) */}
      <SpotifyConnectModal
        open={isLoggedIn && !isSpotifyConnected && showSpotifyModal}
        onClose={() => {
          try {
            localStorage.setItem(seenKey, "1");
          } catch {}
          setShowSpotifyModal(false);
        }}
        onConnect={() => {
          try {
            localStorage.setItem(seenKey, "1");
          } catch {}
          window.location.href = `${API_BASE}/api/spotify/authorize?return=/`;
        }}
      />

      {/* 추천 화면에서 복귀한 경우에만 노출되는 하단 미니 플레이어 바 */}
      {showNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-black text-white shadow-[0_-6px_18px_rgba(0,0,0,0.3)]">
          <div className="h-[3px] w-full bg-white/10">
            <div className="h-[3px] w-1/3 bg-white/60" />
          </div>

          <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => router.push("/")}
                className="p-2 rounded-md hover:bg-white/10"
                aria-label="Home"
                title="Home"
              >
                <Home className="w-5 h-5" />
              </button>

              <button
                onClick={openPlayer}
                className="group flex items-center gap-3 min-w-0"
                title="Open player"
              >
                <div className="w-10 h-10 rounded-sm bg-white/10 overflow-hidden flex-shrink-0" />
                <div className="min-w-0 text-left">
                  <p className="text-sm font-medium truncate">Now Playing</p>
                  <p className="text-xs text-white/60 truncate">Open in player</p>
                </div>
              </button>
            </div>

            <div className="flex items-center gap-5">
              <button
                onClick={openPlayer}
                className="p-2 rounded-md hover:bg-white/10"
                aria-label="Previous"
                title="Previous"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                onClick={openPlayer}
                className="w-10 h-10 rounded-full bg-white text-black hover:bg-white/90 flex items-center justify-center"
                aria-label="Play/Pause"
                title="Open player"
              >
                <Play className="w-5 h-5 translate-x-[1px]" />
              </button>
              <button
                onClick={openPlayer}
                className="p-2 rounded-md hover:bg-white/10"
                aria-label="Next"
                title="Next"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={openPlayer}
                className="p-2 rounded-md hover:bg-white/10"
                aria-label="Queue"
                title="Queue"
              >
                <ListMusic className="w-5 h-5" />
              </button>
              <div className="hidden sm:flex items-center gap-2">
                <Volume2 className="w-5 h-5" />
                <div className="w-24 h-1.5 rounded-full bg-white/15 overflow-hidden">
                  <div className="h-1.5 w-1/2 bg-white/60" />
                </div>
              </div>
            </div>
          </div>
        </nav>
      )}
    </>
  );
}
