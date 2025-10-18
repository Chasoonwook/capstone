"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { User, LogOut, LogIn, CheckCircle2, PlugZap, History, Settings, Heart } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { API_BASE, authHeaders } from "@/lib/api";
import SpotifyConnectModal from "@/components/modals/SpotifyConnectModal";

// ✅ 컨텍스트: 상태 구독 + 수동 새로고침 전용 (자동 호출 없음)
import { useSpotifyStatus } from "@/contexts/SpotifyStatusContext";

interface UserHeaderProps {
  user: any;
  isLoggedIn: boolean;
  onLogout: () => void;
  embedded?: boolean;
  musics?: any[];
  loading?: boolean;
  error?: string | null;
  selectedGenres?: string[] | string | null;
}

export default function UserHeader({
  user,
  isLoggedIn,
  onLogout,
  embedded = false,
  selectedGenres = [],
}: UserHeaderProps) {
  const router = useRouter();
  const { status, refresh } = useSpotifyStatus();

  const Wrapper: React.ElementType = embedded ? "div" : "header";
  const wrapperCls = embedded
    ? "max-w-5xl mx-auto flex items-center justify-between px-4 py-3"
    : "sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border";

  const displayName =
    (user?.name && String(user.name).trim()) ||
    (user?.email && String(user.email).split("@")[0]) ||
    "Guest";

  // ─────────────────────────────────────────────────────────
  // Spotify 연결 상태: 컨텍스트에서만 읽고, 갱신은 refresh()로만
  // ─────────────────────────────────────────────────────────
  const isSpotifyConnected = !!status?.connected;
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);

  // 계정별 “한 번만” 띄우기 키
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
  const seenKey = useMemo(() => `spotify_connect_prompt_seen::${accountId}`, [accountId]);

  // 최초 1회 강제 갱신 (Provider는 lazy라 자동 호출 안 함)
  useEffect(() => {
    let alive = true;
    (async () => {
      await refresh(true); // 서버 레이트리밋 방지: 내부 30초 쿨다운 있음
      if (!alive) return;

      const already = typeof window !== "undefined" && localStorage.getItem(seenKey) === "1";
      setShowSpotifyModal(isLoggedIn && !isSpotifyConnected && !already);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenKey, isLoggedIn]); // 상태 변화는 컨텍스트로 반영됨

  // 창에 포커스가 돌아오면 가끔만 재조회(최소 30초 간격)
  const lastFocusRef = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRef.current < 30_000) return; // 30초 쿨다운
      lastFocusRef.current = now;
      refresh(); // 내부에도 쿨다운 있으므로 안전
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // 연결 완료되면 모달 닫고 ‘본 것으로’ 처리
  useEffect(() => {
    if (isSpotifyConnected) {
      setShowSpotifyModal(false);
      try {
        localStorage.setItem(seenKey, "1");
      } catch {}
    }
  }, [isSpotifyConnected, seenKey]);

  // ─────────────────────────────────────────────────────────
  // 선호 장르 표시(기존 로직 유지)
  // ─────────────────────────────────────────────────────────
  const normalize = (v: any): string[] => {
    try {
      if (Array.isArray(v)) return v.map(String);
      if (typeof v === "string") {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      }
    } catch {}
    return [];
  };

  const uid =
    typeof window !== "undefined" ? localStorage.getItem("uid") || undefined : undefined;
  const localKey = uid ? `preferred_genres::${uid}` : undefined;

  const initialGenres = useMemo(() => {
    const fromUser = normalize(user?.preferred_genres);
    if (fromUser.length) return fromUser;

    const fromProp = normalize(selectedGenres);
    if (fromProp.length) return fromProp;

    if (typeof window !== "undefined" && localKey) {
      try {
        const v = localStorage.getItem(localKey);
        const fromLocal = normalize(v);
        if (fromLocal.length) return fromLocal;
      } catch {}
    }
    return [];
  }, [user?.preferred_genres, selectedGenres, localKey]);

  const [genres, setGenres] = useState<string[]>(initialGenres);
  const [menuOpen, setMenuOpen] = useState(false);
  const [genresLoaded, setGenresLoaded] = useState<boolean>(initialGenres.length > 0);

  useEffect(() => {
    const n = normalize(user?.preferred_genres);
    if (n.length) {
      setGenres(n);
      setGenresLoaded(true);
      if (localKey) try { localStorage.setItem(localKey, JSON.stringify(n)); } catch {}
      return;
    }
    const p = normalize(selectedGenres);
    if (p.length) {
      setGenres(p);
      setGenresLoaded(true);
      if (localKey) try { localStorage.setItem(localKey, JSON.stringify(p)); } catch {}
    }
  }, [user?.preferred_genres, selectedGenres, localKey]);

  useEffect(() => {
    if (!menuOpen || genresLoaded || !isLoggedIn) return;
    if (localKey) {
      try {
        const v = localStorage.getItem(localKey);
        const fromLocal = normalize(v);
        if (fromLocal.length) {
          setGenres(fromLocal);
          setGenresLoaded(true);
          return;
        }
      } catch {}
    }
    const headers = new Headers(authHeaders() as HeadersInit);
    if (uid) headers.set("X-User-Id", uid);
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/users/me`, { headers, cache: "no-store" });
        if (!r.ok) {
          setGenresLoaded(true);
          return;
        }
        const me = await r.json();
        const fromDb = normalize(me?.preferred_genres);
        setGenres(fromDb);
        setGenresLoaded(true);
        if (localKey) try { localStorage.setItem(localKey, JSON.stringify(fromDb)); } catch {}
      } catch {
        setGenresLoaded(true);
      }
    })();
  }, [menuOpen, genresLoaded, isLoggedIn, uid, localKey]);

  // ─────────────────────────────────────────────────────────
  // Spotify 연결 버튼: 백엔드 로그인 엔드포인트로 이동
  // ─────────────────────────────────────────────────────────
  const handleSpotifyConnect = () => {
    setShowSpotifyModal(false);
    if (typeof window === "undefined") return;

    const { pathname, search, hash } = window.location;
    const returnTo = `${pathname}${search || ""}${hash || ""}`;
    const qs = new URLSearchParams({ return: returnTo }).toString();

    // 서버에서 /login 또는 /authorize 처리
    window.location.href = `${API_BASE}/api/spotify/login?${qs}`;
  };

  function RightPart() {
    if (!isLoggedIn) {
      return (
        <button
          onClick={() => router.push("/login")}
          className={
            embedded
              ? "flex items-center gap-2 px-4 py-1.5 rounded-full bg-white text-black hover:bg-white/90 transition-colors"
              : "flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          }
        >
          <LogIn className="w-4 h-4" />
          <span className="text-sm font-medium">로그인</span>
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className={`h-auto px-3 py-1.5 gap-2 rounded-full ${
                embedded ? "text-white hover:bg-white/20" : "text-primary hover:bg-primary/20"
              }`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <User className={`w-4 h-4 ${embedded ? "text-white" : "text-primary"}`} />
              <span
                className={`text-sm font-medium ${
                  embedded ? "hidden sm:inline text-white" : "hidden sm:inline text-primary"
                }`}
              >
                {displayName}
              </span>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" sideOffset={8} className="w-80">
            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
              로그인 계정
            </DropdownMenuLabel>
            <div className="px-2 pb-3">
              <div className="text-sm font-semibold leading-none">{displayName}</div>
              {user?.email && <div className="text-xs text-muted-foreground mt-1.5">{user.email}</div>}
            </div>

            <DropdownMenuSeparator />

            <div className="px-2 py-3">
              <div className="flex items-center gap-2 mb-2">
                {isSpotifyConnected ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-semibold">스포티파이 연동됨</span>
                  </>
                ) : (
                  <>
                    <PlugZap className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">스포티파이 연동</span>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                {isSpotifyConnected
                  ? "전체 재생을 바로 이용할 수 있어요."
                  : "계정을 연결하면 전체 듣기, 재생목록 연동이 가능해요."}
              </p>
              {!isSpotifyConnected && (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowSpotifyModal(true);
                  }}
                >
                  스포티파이 연결하기
                </Button>
              )}
            </div>

            <DropdownMenuSeparator />

            <div className="px-2 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Heart className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">관심 장르</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {genres.length ? (
                  genres.map((g) => (
                    <Badge
                      key={g}
                      variant="secondary"
                      className="text-xs cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                      onClick={() => router.push("/onboarding/genres?edit=1")}
                    >
                      {g}
                    </Badge>
                  ))
                ) : (
                  <button
                    onClick={() => router.push("/onboarding/genres?edit=1")}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                  >
                    장르를 선택해주세요
                  </button>
                )}
              </div>
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => router.push("/history")} className="cursor-pointer">
              <History className="mr-2 h-4 w-4" />
              <span>내 기록 보기</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/account")} className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              <span>계정 설정</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={onLogout}
              className="cursor-pointer text-red-600 focus:text-red-700"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>로그아웃</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <Wrapper className={wrapperCls}>
      {!embedded && (
        <div className="flex items-center justify-between h-14 px-4 w-full">
          <div className="flex items-center justify-between w-full">
            <h1 className="text-lg font-bold text-foreground">MoodTune</h1>
            <RightPart />
          </div>
        </div>
      )}
      {embedded && (
        <>
          <h1
            className="text-xl font-bold leading-none cursor-pointer"
            onClick={() => router.push("/")}
          >
            MoodTune
          </h1>
          <RightPart />
        </>
      )}

      {/* 🔒 한 번만 뜨는 스포티파이 연결 모달 */}
      <SpotifyConnectModal
        open={isLoggedIn && !isSpotifyConnected && showSpotifyModal}
        onClose={() => {
          try { localStorage.setItem(seenKey, "1"); } catch {}
          setShowSpotifyModal(false);
        }}
        onConnect={handleSpotifyConnect}
      />
    </Wrapper>
  );
}
