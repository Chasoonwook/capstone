// src/app/page.tsx
"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Upload,
  Search,
  Music,
  ChevronLeft,
  ChevronRight,
  User,
  Settings,
  LogOut,
  CreditCard,
  History as HistoryIcon,
  UserCircle,
} from "lucide-react"
import Image from "next/image"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useRouter } from "next/navigation"
import { API_BASE } from "@/lib/api"

const musicGenres = ["팝", "재즈", "운동", "휴식", "집중", "평온", "슬픔", "파티", "로맨스", "출퇴근"]

const genreColors: Record<string, string> = {
  팝: "bg-gradient-to-r from-pink-500 to-rose-500 text-white",
  재즈: "bg-gradient-to-r from-blue-500 to-indigo-500 text-white",
  운동: "bg-gradient-to-r from-orange-500 to-red-500 text-white",
  휴식: "bg-gradient-to-r from-green-500 to-emerald-500 text-white",
  집중: "bg-gradient-to-r from-purple-500 to-violet-500 text-white",
  평온: "bg-gradient-to-r from-cyan-500 to-blue-500 text-white",
  슬픔: "bg-gradient-to-r from-gray-500 to-slate-500 text-white",
  파티: "bg-gradient-to-r from-yellow-500 to-orange-500 text-white",
  로맨스: "bg-gradient-to-r from-pink-500 to-purple-500 text-white",
  출퇴근: "bg-gradient-to-r from-teal-500 to-cyan-500 text-white",
}

type UploadResp = { photo_id?: string | number }

type HistoryItem = {
  id: string | number
  title: string
  artist?: string
  image?: string | null
  playedAt?: string
  musicId?: string | number
  photoId?: string | number
  selectedFrom?: string | null
  genre?: string | null
  label?: string | null
}

type MusicItem = {
  music_id: number | string
  title: string
  artist?: string | null
  genre?: string | null
  label?: string | null
  image_url?: string | null
  created_at?: string | null
}

export default function MusicRecommendationApp() {
  // 업로드 상태
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadedPhotoId, setUploadedPhotoId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 검색/장르
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])

  // 로그인/유저
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [user, setUser] = useState<{ name?: string; email?: string; avatar?: string }>({})

  // 히스토리
  const [historyList, setHistoryList] = useState<HistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // 음악 목록 (DB에서 1회 로드) 및 상태
  const [musics, setMusics] = useState<MusicItem[]>([])
  const [musicsLoading, setMusicsLoading] = useState(false)
  const [musicsError, setMusicsError] = useState<string | null>(null)

  // 요청 폼 상태
  const [reqTitle, setReqTitle] = useState<string>("")
  const [reqArtist, setReqArtist] = useState<string>("")
  const [reqSubmitting, setReqSubmitting] = useState(false)
  const [reqDoneMsg, setReqDoneMsg] = useState<string | null>(null)
  const [reqError, setReqError] = useState<string | null>(null)

  // ✅ 특정 곡(현재 폼 값)에 대한 요청 카운트 상태
  const [reqCount, setReqCount] = useState<number | null>(null)
  const [reqCountLoading, setReqCountLoading] = useState(false)
  const countAbortRef = useRef<AbortController | null>(null)

  const router = useRouter()

  // ✅ 캐러셀 ref — 이 선언만 유지 (중복 금지)
  const historyScrollRef = useRef<HTMLDivElement | null>(null)

  // 로그인 정보 복원
  useEffect(() => {
    try {
      const token = localStorage.getItem("token")
      const name = localStorage.getItem("name") || undefined
      const email = localStorage.getItem("email") || undefined
      const avatar = (localStorage.getItem("avatar") || "/placeholder.svg?height=32&width=32") as string

      if (token && name && email) {
        setUser({ name, email, avatar })
        setIsLoggedIn(true)
      } else {
        setIsLoggedIn(false)
        setUser({})
      }
    } catch {
      setIsLoggedIn(false)
      setUser({})
    }
  }, [])

  // ✅ 백엔드 스펙에 맞춘 히스토리 불러오기: GET /api/history?user_id=123
  useEffect(() => {
    const fetchHistory = async () => {
      if (!isLoggedIn) {
        setHistoryList([])
        return
      }
      setHistoryLoading(true)
      setHistoryError(null)
      try {
        const uid = localStorage.getItem("uid")
        if (!uid) {
          setHistoryList([])
          setHistoryLoading(false)
          return
        }

        const url = `${API_BASE}/api/history?user_id=${encodeURIComponent(uid)}`
        const res = await fetch(url, { credentials: "include" })
        if (!res.ok) {
          const txt = await res.text().catch(() => "")
          throw new Error(txt || `HTTP ${res.status}`)
        }

        const rows = (await res.json()) as Array<{
          history_id: number | string
          music_id?: number | string
          photo_id?: number | string
          title: string
          artist?: string
          genre?: string | null
          label?: string | null
          selected_from?: string | null
          created_at?: string
        }>

        const mapped: HistoryItem[] = rows.map((r) => ({
          id: r.history_id,
          musicId: r.music_id,
          photoId: r.photo_id,
          title: r.title,
          artist: r.artist,
          genre: r.genre ?? null,
          label: r.label ?? null,
          selectedFrom: r.selected_from ?? null,
          playedAt: r.created_at,
          image: null, // 백엔드에서 이미지 URL을 안 주므로 플레이스홀더
        }))

        setHistoryList(mapped)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "히스토리를 불러오지 못했습니다."
        console.error("[history] load failed:", msg)
        setHistoryError("히스토리를 불러오지 못했습니다.")
        setHistoryList([])
      } finally {
        setHistoryLoading(false)
      }
    }

    fetchHistory()
  }, [isLoggedIn])

  // ✅ 음악 목록 1회 로드: GET /api/musics
  useEffect(() => {
    const fetchMusics = async () => {
      setMusicsLoading(true)
      setMusicsError(null)
      try {
        const res = await fetch(`${API_BASE}/api/musics`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as MusicItem[]
        setMusics(data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : "음악 목록을 불러오지 못했습니다."
        console.error("[musics] load failed:", msg)
        setMusicsError("음악 목록을 불러오지 못했습니다.")
      } finally {
        setMusicsLoading(false)
      }
    }

    fetchMusics()
  }, [])

  const handleLogout = () => {
    try {
      localStorage.removeItem("token")
      localStorage.removeItem("uid")
      localStorage.removeItem("email")
      localStorage.removeItem("name")
      localStorage.removeItem("avatar")
    } catch {}
    setIsLoggedIn(false)
    setUser({})
    router.push("/login")
  }

  // 업로드 → DB 저장
  async function uploadPhotoToBackend(file: File): Promise<{ photoId: string } | null> {
    const form = new FormData()
    form.append("photo", file)
    form.append("filename", file.name)

    const url = `${API_BASE}/api/photos/upload`
    try {
      const res = await fetch(url, { method: "POST", body: form })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        console.error("[upload] 실패:", res.status, txt)
        return null
      }
      const json = (await res.json()) as UploadResp
      const photoId = json?.photo_id != null ? String(json.photo_id) : null
      if (!photoId) {
        console.error("[upload] 응답에 photo_id 없음:", json)
        return null
      }
      return { photoId }
    } catch (e) {
      console.error("[upload] 요청 오류:", e)
      return null
    }
  }

  // 이미지 선택(미리보기)
  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const result = e.target?.result
      if (typeof result === "string") {
        setUploadedImage(result)
      }
    }
    reader.readAsDataURL(file)

    setSelectedFile(file)
    setUploadedPhotoId(null)
  }

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]))
  }

  // 추천 버튼
  const goRecommend = async () => {
    if (!isLoggedIn) {
      alert("로그인이 필요합니다.")
      router.push("/login")
      return
    }

    setIsSubmitting(true)
    try {
      if (selectedFile) {
        const result = await uploadPhotoToBackend(selectedFile)
        if (!result?.photoId) {
          alert("사진 업로드에 실패했습니다.")
          setIsSubmitting(false)
          return
        }
        setUploadedPhotoId(result.photoId)
        localStorage.setItem("lastPhotoId", result.photoId)
        router.push(`/recommend?photoId=${encodeURIComponent(result.photoId)}`)
        return
      }

      const genres = selectedGenres.join(",")
      if (!genres) {
        alert("사진을 업로드하거나 장르를 선택해주세요.")
        setIsSubmitting(false)
        return
      }
      router.push(`/recommend?genres=${encodeURIComponent(genres)}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  // 🔎 검색 결과 메모 (제목/가수만 매칭)
  const filteredMusics = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return musics
      .filter((m) => {
        const t = m.title?.toLowerCase() ?? ""
        const a = m.artist?.toLowerCase() ?? ""
        return t.includes(q) || a.includes(q)
      })
      .slice(0, 30)
  }, [searchQuery, musics])

  // ✅ 검색 결과 0개일 때만, 현재 입력(제목+가수)에 대한 "요청 수"를 조회
  // - reqTitle/reqArtist가 비어있으면 reqTitle에 검색어를 기본값으로 채움(사용자 입력을 덮지 않음)
  useEffect(() => {
    // 결과가 있으면 카운트 UI 숨김
    if (filteredMusics.length > 0) {
      setReqCount(null)
      setReqCountLoading(false)
      return
    }

    // 검색어가 있는데 제목 입력이 비어있으면 기본값으로 채워주기(초기 UX)
    if (searchQuery.trim() && !reqTitle) {
      setReqTitle(searchQuery.trim())
    }

    // 제목과 가수가 모두 있어야 카운트 조회
    const title = (reqTitle || "").trim()
    const artist = (reqArtist || "").trim()
    if (!title || !artist) {
      setReqCount(null)
      setReqCountLoading(false)
      return
    }

    // 이전 요청 취소
    if (countAbortRef.current) {
      countAbortRef.current.abort()
      countAbortRef.current = null
    }

    const controller = new AbortController()
    countAbortRef.current = controller
    setReqCountLoading(true)

    const t = setTimeout(async () => {
      try {
        const url =
          `${API_BASE}/api/music-requests/count?title=` +
          encodeURIComponent(title) +
          `&artist=` +
          encodeURIComponent(artist)

        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { request_count?: number }
        setReqCount(typeof data.request_count === "number" ? data.request_count : 0)
      } catch (err: unknown) {
        if ((err as { name?: string }).name === "AbortError") return
        console.error("[request-count] error:", err)
        setReqCount(null)
      } finally {
        setReqCountLoading(false)
      }
    }, 300) // 300ms 디바운스

    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [searchQuery, reqTitle, reqArtist, filteredMusics.length])

  // 🎫 노래 요청 전송
  const submitRequest = async () => {
    setReqSubmitting(true)
    setReqDoneMsg(null)
    setReqError(null)
    try {
      const title = reqTitle.trim()
      const artist = reqArtist.trim()
      if (!title || !artist) {
        setReqError("가수와 제목을 모두 입력하세요.")
        setReqSubmitting(false)
        return
      }

      const res = await fetch(`${API_BASE}/api/music-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          artist,
          // requested_by: user.email || localStorage.getItem("uid") || undefined,
        }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        throw new Error(txt || `HTTP ${res.status}`)
      }
      const saved = (await res.json()) as { request_count?: number; title: string; artist: string }

      // ✅ 동일 곡에 대한 최신 카운트 표시(서버 응답의 request_count 사용)
      setReqCount(typeof saved.request_count === "number" ? saved.request_count : (reqCount ?? 0) + 1)

      setReqDoneMsg(
        `요청이 접수되었습니다${saved.request_count ? ` (현재 ${saved.request_count}명이 요청 중)` : ""}.`
      )
      // 입력은 유지해도 되지만, 초기화가 UX에 좋다면 아래 주석 해제
      // setReqTitle("")
      // setReqArtist("")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "요청 중 오류가 발생했습니다."
      console.error("[request] create failed:", msg)
      setReqError("요청에 실패했습니다. 잠시 후 다시 시도해 주세요.")
    } finally {
      setReqSubmitting(false)
    }
  }

  // 캐러셀 스크롤
  const scrollHistory = (dir: "left" | "right") => {
    const el = historyScrollRef.current
    if (!el) return
    const step = Math.round(el.clientWidth * 0.9)
    el.scrollBy({ left: dir === "left" ? -step : step, behavior: "smooth" })
  }

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

      {/* Header */}
      <header className="bg-gradient-to-r from-white/90 via-purple-50/90 to-pink-50/90 backdrop-blur-sm border-b border-purple-100 relative z-10">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center">
                <Music className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-xl font-medium text-gray-900">Photo_Music</h1>
            </div>
            {isLoggedIn ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name || "user"} />
                      <AvatarFallback className="bg-purple-600 text-white">
                        {(user.name?.[0] || "U").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="end" forceMount>
                  <div className="flex items-center justify-start gap-2 p-2">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name || "user"} />
                      <AvatarFallback className="bg-purple-600 text-white">
                        {(user.name?.[0] || "U").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col space-y-1 leading-none">
                      <p className="font-medium">{user.name || "사용자"}</p>
                      <p className="text-xs text-muted-foreground">{user.email || ""}</p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem><UserCircle className="mr-2 h-4 w-4" /><span>내 채널</span></DropdownMenuItem>
                  <DropdownMenuItem><CreditCard className="mr-2 h-4 w-4" /><span>유료 멤버십</span></DropdownMenuItem>
                  <DropdownMenuItem><User className="mr-2 h-4 w-4" /><span>개인 정보</span></DropdownMenuItem>
                  <DropdownMenuItem><HistoryIcon className="mr-2 h-4 w-4" /><span>시청 기록</span></DropdownMenuItem>
                  <DropdownMenuItem><Settings className="mr-2 h-4 w-4" /><span>설정</span></DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>로그아웃</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button
                onClick={() => router.push("/login")}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-full px-6 shadow-md hover:shadow-lg transition-all"
              >
                로그인
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16 relative z-10">
        {/* ====== 히스토리 캐러셀 (DB 연동) ====== */}
        <section className="mb-16">
          <div className="flex items-center mb-6">
            <div className="flex items-center space-x-4">
              <Avatar className="h-12 w-12">
                <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name || "user"} />
                <AvatarFallback className="bg-purple-600 text-white">
                  {(user.name?.[0] || "U").toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-2xl font-light text-gray-900">{(user.name || "사용자")}님의 추억</h3>
                <p className="text-gray-500 font-light">최근에 들었던 음악들</p>
              </div>
            </div>
            <div className="ml-auto hidden sm:block">
              <div className="flex gap-2">
                <Button variant="ghost" className="rounded-full" onClick={() => scrollHistory("left")} aria-label="왼쪽으로 이동">
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button variant="ghost" className="rounded-full" onClick={() => scrollHistory("right")} aria-label="오른쪽으로 이동">
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>

          {historyLoading ? (
            <div className="text-center text-gray-500 py-16 border border-dashed rounded-lg bg-white/60">불러오는 중…</div>
          ) : historyError ? (
            <div className="text-center text-red-500 py-16 border border-dashed rounded-lg bg-white/60">{historyError}</div>
          ) : historyList.length === 0 ? (
            <div className="text-center text-gray-500 py-16 border border-dashed rounded-lg bg-white/60">
              아직 추억이 없습니다.
            </div>
          ) : (
            <div className="relative">
              <div className="hidden sm:block">
                <Button
                  variant="ghost"
                  className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 rounded-full shadow"
                  onClick={() => scrollHistory("left")}
                  aria-label="왼쪽으로 이동"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 rounded-full shadow"
                  onClick={() => scrollHistory("right")}
                  aria-label="오른쪽으로 이동"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>

              <div
                ref={historyScrollRef}
                className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2
                           [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {historyList.map((item) => (
                  <button
                    key={item.id}
                    className="min-w-[180px] sm:min-w-[200px] max-w-[220px] snap-start
                               bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm hover:shadow
                               transition-all p-3 text-left"
                    onClick={() => router.push(`/recommend?picked=${encodeURIComponent(String(item.musicId ?? item.id))}`)}
                    aria-label={`${item.title} 재생`}
                  >
                    <div className="relative w-full h-36 overflow-hidden rounded-xl">
                      <Image
                        src={item.image || "/placeholder.svg"}
                        alt={item.title}
                        fill
                        className="object-cover"
                        sizes="220px"
                      />
                    </div>
                    <div className="mt-3">
                      <p className="text-sm font-medium line-clamp-1">{item.title}</p>
                      {item.artist && (
                        <p className="text-xs text-gray-500 line-clamp-1">{item.artist}</p>
                      )}
                      {item.playedAt && (
                        <p className="text-[10px] text-gray-400 mt-1">{item.playedAt}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ====== 업로드 영역 ====== */}
        <section className="text-center mb-20">
          <h2 className="text-4xl font-light text-gray-900 mb-4">사진으로 음악을 찾아보세요</h2>
          <p className="text-gray-500 mb-12 text-lg font-light max-w-2xl mx-auto">
            사진을 업로드하면 그 순간에 어울리는 음악을 추천해드립니다
          </p>

          <div className="flex justify-center mb-8">
            <label className="cursor-pointer group">
              <input
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
                disabled={isSubmitting}
              />
              <div className="border-2 border-dashed border-transparent bg-gradient-to-r from-purple-200 via-pink-200 to-blue-200 p-0.5 rounded-3xl hover:from-purple-300 hover:via-pink-300 hover:to-blue-300 transition-all duration-300">
                <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-16 hover:bg-white/90 transition-all">
                  {uploadedImage ? (
                    <div className="relative">
                      <Image
                        src={uploadedImage || "/placeholder.svg"}
                        alt="업로드된 사진"
                        width={240}
                        height={160}
                        className="rounded-2xl object-cover mx-auto"
                      />
                      {uploadedPhotoId && (
                        <p className="mt-3 text-sm text-gray-500">저장됨 • Photo ID: {uploadedPhotoId}</p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:bg-purple-100 transition-colors">
                        <Upload className="h-8 w-8 text-gray-400 group-hover:text-purple-500" />
                      </div>
                      <p className="text-gray-600 font-light">사진을 업로드하세요</p>
                    </div>
                  )}
                </div>
              </div>
            </label>
          </div>

          <Button
            onClick={goRecommend}
            size="lg"
            disabled={isSubmitting || (!uploadedImage && selectedGenres.length === 0)}
            className="bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 hover:from-purple-700 hover:via-pink-700 hover:to-blue-700 text-white px-12 py-3 rounded-full font-light disabled:opacity-50 shadow-lg hover:shadow-xl transition-all"
          >
            {isSubmitting ? "처리 중..." : "음악 추천받기"}
          </Button>
        </section>

        {/* ====== 검색 (DB 연동 + 곡별 요청수) ====== */}
        <section className="mb-16">
          <div className="max-w-xl mx-auto relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
            <Input
              type="text"
              placeholder="노래 제목 또는 가수 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 pr-4 py-4 text-base border-gray-200 focus:border-purple-300 rounded-2xl bg-white/80 backdrop-blur-sm"
            />
          </div>

          <div className="max-w-2xl mx-auto mt-6">
            {musicsLoading ? (
              <div className="text-center text-gray-500 py-8 bg-white/70 rounded-xl border">음악 목록 불러오는 중…</div>
            ) : musicsError ? (
              <div className="text-center text-red-500 py-8 bg-white/70 rounded-xl border">{musicsError}</div>
            ) : searchQuery.trim().length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">검색어를 입력하면 결과가 표시됩니다.</div>
            ) : filteredMusics.length === 0 ? (
              // 결과 0개일 때: 노래 요청 폼 + 현재 '그 곡'의 요청 수만 표시
              <div className="max-w-xl mx-auto bg-white/80 rounded-2xl border p-5">
                <p className="text-sm text-gray-700 mb-4">
                  검색 결과가 없습니다. 원하시는 노래를 요청해 주세요.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    placeholder="노래 제목"
                    value={reqTitle}
                    onChange={(e) => setReqTitle(e.target.value)}
                  />
                  <Input
                    placeholder="가수 이름"
                    value={reqArtist}
                    onChange={(e) => setReqArtist(e.target.value)}
                  />
                </div>

                {/* 현재 곡의 요청수 안내 (이 곡만) */}
                <div className="mt-3 text-xs text-gray-600">
                  {reqCountLoading ? (
                    <span>요청 수 확인 중…</span>
                  ) : reqTitle.trim() && reqArtist.trim() ? (
                    typeof reqCount === "number" ? (
                      reqCount > 0 ? (
                        <span>현재 <b>{reqCount}</b>명이 요청 중이에요.</span>
                      ) : (
                        <span>아직 요청이 없습니다. 첫 요청을 남겨보세요!</span>
                      )
                    ) : (
                      <span>요청 수를 불러오지 못했습니다.</span>
                    )
                  ) : (
                    <span>제목과 가수를 입력하면 현재 요청 수를 보여드려요.</span>
                  )}
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <Button onClick={submitRequest} disabled={reqSubmitting}>
                    {reqSubmitting ? "요청 중…" : "노래 요청 보내기"}
                  </Button>
                  {reqDoneMsg && <span className="text-sm text-green-600">{reqDoneMsg}</span>}
                  {reqError && <span className="text-sm text-red-600">{reqError}</span>}
                </div>

                <p className="mt-3 text-xs text-gray-500">
                  요청은 관리자 검토 후 음악 목록에 추가됩니다.
                </p>
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {filteredMusics.map((m) => (
                  <li
                    key={m.music_id}
                    className="bg-white/80 rounded-xl border p-3 flex items-center justify-between gap-3 hover:shadow-sm transition"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{m.title}</p>
                      <p className="text-xs text-gray-500 truncate">{m.artist || "Unknown"}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        // 다음 단계: 상세/재생/추천 연동
                        console.log("[pick] music", m.music_id)
                      }}
                    >
                      선택
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 기분 선택 */}
        <section className="mb-4">
          <h3 className="text-xl font-light text-gray-900 mb-8 text-center">오늘의 기분</h3>
          <div className="flex flex-wrap justify-center gap-3 max-w-2xl mx-auto">
            {musicGenres.map((genre) => (
              <Badge
                key={genre}
                variant={selectedGenres.includes(genre) ? "default" : "outline"}
                className={`cursor-pointer px-6 py-2 text-sm rounded-full font-light transition-all ${
                  selectedGenres.includes(genre)
                    ? genreColors[genre] || "bg-purple-600 text-white"
                    : "border-gray-200 text-gray-600 hover:border-purple-300 hover:text-purple-600 bg-white/80"
                }`}
                onClick={() => toggleGenre(genre)}
              >
                {genre}
              </Badge>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
