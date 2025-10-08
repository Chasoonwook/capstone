"use client"

import React, { useEffect, useMemo, useState } from "react"
import { User, LogOut, LogIn, CheckCircle2, PlugZap, History, Settings, Heart } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { API_BASE, authHeaders } from "@/lib/api"
import SpotifyConnectModal from "@/components/modals/SpotifyConnectModal"

interface UserHeaderProps {
  user: any
  isLoggedIn: boolean
  onLogout: () => void
  embedded?: boolean
  selectedGenres?: string[] | string | null
}

export default function UserHeader({
  user,
  isLoggedIn,
  onLogout,
  embedded = false,
  selectedGenres = [],
}: UserHeaderProps) {
  const router = useRouter()

  const Wrapper: React.ElementType = embedded ? "div" : "header"
  const wrapperCls = embedded
    ? "max-w-5xl mx-auto flex items-center justify-between px-4 py-3"
    : "sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border"

  const displayName =
    (user?.name && String(user.name).trim()) || (user?.email && String(user.email).split("@")[0]) || "Guest"

  // ▼▼▼▼▼ [수정됨] 스포티파이 연결 상태 확인 로직 변경 ▼▼▼▼▼
  const [isSpotifyConnected, setIsSpotifyConnected] = useState(false)
  const [showSpotifyModal, setShowSpotifyModal] = useState(false)

  useEffect(() => {
    const checkConnection = () => {
      try {
        const expiresAt = Number(localStorage.getItem("spotify_token_expires_at") || "0");
        const accessToken = localStorage.getItem("spotify_access_token");
        setIsSpotifyConnected(!!accessToken && Date.now() < expiresAt);
      } catch {
        setIsSpotifyConnected(false);
      }
    };
    checkConnection();
    // 다른 탭이나 창에서 상태가 변경될 수 있으므로, 다시 활성화될 때마다 체크
    window.addEventListener('focus', checkConnection);
    return () => {
      window.removeEventListener('focus', checkConnection);
    };
  }, []);
  // ▲▲▲▲▲ [수정됨] 여기까지 ▲▲▲▲▲

  // --- 장르 관련 로직 (수정 없음) ---
  const normalize = (v: any): string[] => {
    try {
      if (Array.isArray(v)) return v.map(String)
      if (typeof v === 'string') {
        const parsed = JSON.parse(v)
        return Array.isArray(parsed) ? parsed.map(String) : []
      }
    } catch {}
    return []
  }
  const uid = typeof window !== "undefined" ? (localStorage.getItem("uid") || undefined) : undefined
  const localKey = uid ? `preferred_genres::${uid}` : undefined
  const initialGenres = useMemo(() => {
    const fromUser = normalize(user?.preferred_genres); if (fromUser.length) return fromUser;
    const fromProp = normalize(selectedGenres); if (fromProp.length) return fromProp;
    if (typeof window !== "undefined" && localKey) {
      try { const v = localStorage.getItem(localKey); const fromLocal = normalize(v); if (fromLocal.length) return fromLocal; } catch {}
    }
    return []
  }, [user?.preferred_genres, selectedGenres, localKey]);
  const [genres, setGenres] = useState<string[]>(initialGenres);
  const [menuOpen, setMenuOpen] = useState(false);
  const [genresLoaded, setGenresLoaded] = useState<boolean>(initialGenres.length > 0);
  useEffect(() => {
    const n = normalize(user?.preferred_genres); if (n.length) { setGenres(n); setGenresLoaded(true); if (localKey) try { localStorage.setItem(localKey, JSON.stringify(n)) } catch {} return; }
    const p = normalize(selectedGenres); if (p.length) { setGenres(p); setGenresLoaded(true); if (localKey) try { localStorage.setItem(localKey, JSON.stringify(p)) } catch {} }
  }, [user?.preferred_genres, selectedGenres, localKey]);
  useEffect(() => {
    if (!menuOpen || genresLoaded || !isLoggedIn) return;
    if (localKey) { try { const v = localStorage.getItem(localKey); const fromLocal = normalize(v); if (fromLocal.length) { setGenres(fromLocal); setGenresLoaded(true); return; } } catch {} }
    const headers = new Headers(authHeaders?.() as HeadersInit); if (uid) headers.set("X-User-Id", uid);
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/users/me`, { headers, cache: "no-store", credentials: "include" });
        if (!r.ok) { setGenresLoaded(true); return; }
        const me = await r.json();
        const fromDb = normalize(me?.preferred_genres); setGenres(fromDb); setGenresLoaded(true);
        if (localKey) try { localStorage.setItem(localKey, JSON.stringify(fromDb)) } catch {}
      } catch (e) { setGenresLoaded(true); }
    })()
  }, [menuOpen, genresLoaded, isLoggedIn, uid, localKey]);
  // --- 장르 관련 로직 끝 ---

  const handleSpotifyConnect = () => {
    setShowSpotifyModal(false)
    const returnTo = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search || ""}` : "/"
    const qs = new URLSearchParams({ return: returnTo }).toString()
    window.location.href = `${API_BASE}/api/spotify/authorize?${qs}`
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
          <h1 className="text-xl font-bold leading-none cursor-pointer" onClick={() => router.push("/")}>
            MoodTune
          </h1>
          <RightPart />
        </>
      )}

      <SpotifyConnectModal
        open={showSpotifyModal}
        onClose={() => setShowSpotifyModal(false)}
        onConnect={handleSpotifyConnect}
      />
    </Wrapper>
  )

  function RightPart() {
    if (!isLoggedIn) {
      return (
        <button
          onClick={() => router.push("/login")}
          className={ embedded ? "flex items-center gap-2 px-4 py-1.5 rounded-full bg-white text-black hover:bg-white/90 transition-colors" : "flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors" }
        >
          <LogIn className="w-4 h-4" />
          <span className="text-sm font-medium">로그인</span>
        </button>
      )
    }

    return (
      <div className="flex items-center gap-2">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" className={`h-auto px-3 py-1.5 gap-2 rounded-full ${ embedded ? "text-white hover:bg-white/20" : "text-primary hover:bg-primary/20" }`} aria-haspopup="menu" aria-expanded={menuOpen} >
              <User className={`w-4 h-4 ${embedded ? "text-white" : "text-primary"}`} />
              <span className={`text-sm font-medium ${ embedded ? "hidden sm:inline text-white" : "hidden sm:inline text-primary" }`}>
                {displayName}
              </span>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" sideOffset={8} className="w-80">
            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">로그인 계정</DropdownMenuLabel>
            <div className="px-2 pb-3">
              <div className="text-sm font-semibold leading-none">{displayName}</div>
              {user?.email && <div className="text-xs text-muted-foreground mt-1.5">{user.email}</div>}
            </div>
            <DropdownMenuSeparator />
            <div className="px-2 py-3">
              <div className="flex items-center gap-2 mb-2">
                {isSpotifyConnected ? (
                  <><CheckCircle2 className="h-4 w-4 text-green-600" /><span className="text-sm font-semibold">스포티파이 연동됨</span></>
                ) : (
                  <><PlugZap className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-semibold">스포티파이 연동</span></>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                {isSpotifyConnected ? "전체 재생을 바로 이용할 수 있어요." : "계정을 연결하면 전체 듣기, 재생목록 연동이 가능해요."}
              </p>
              {!isSpotifyConnected && (
                <Button size="sm" className="w-full" onClick={() => { setMenuOpen(false); setShowSpotifyModal(true); }} >
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
                    <Badge key={g} variant="secondary" className="text-xs cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors" onClick={() => router.push("/onboarding/genres?edit=1")} >
                      {g}
                    </Badge>
                  ))
                ) : (
                  <button onClick={() => router.push("/onboarding/genres?edit=1")} className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" >
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
            <DropdownMenuItem onClick={onLogout} className="cursor-pointer text-red-600 focus:text-red-700">
              <LogOut className="mr-2 h-4 w-4" />
              <span>로그아웃</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }
}