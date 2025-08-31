// src/app/page.tsx
"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Upload, Search, Music, Play } from "lucide-react"
import Image from "next/image"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { User, Settings, LogOut, CreditCard, History, UserCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { API_BASE } from "@/lib/api" // DB 업로드에 사용

const musicGenres = ["팝", "재즈", "운동", "휴식", "집중", "평온", "슬픔", "파티", "로맨스", "출퇴근"]

// 색감 팔레트
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

const memoryColors = [
  "from-pink-400/20 to-purple-500/20",
  "from-blue-400/20 to-cyan-500/20",
  "from-green-400/20 to-emerald-500/20",
  "from-yellow-400/20 to-orange-500/20",
  "from-purple-400/20 to-indigo-500/20",
  "from-red-400/20 to-pink-500/20",
]

// 서버 응답 타입(멀터 업로드 형식)
type UploadResp = { photo_id?: string | number }

/**
 * ⚠️ 라우팅 전제
 * - /app/recommend/RecommendClient.tsx: 클라이언트 컴포넌트
 * - /app/recommend/page.tsx: 아래처럼 RecommendClient를 렌더링
 *   export default function Page() { return <RecommendClient/> }
 */
export default function MusicRecommendationApp() {
  // 프리뷰 & 업로드 상태
  const [uploadedImage, setUploadedImage] = useState<string | null>(null) // 미리보기
  const [selectedFile, setSelectedFile] = useState<File | null>(null)     // ✅ 실제 업로드할 파일 (버튼 눌렀을 때 업로드)
  const [uploadedPhotoId, setUploadedPhotoId] = useState<string | null>(null) // 업로드 성공 시 저장
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false) // 추천 버튼 처리 중

  // 검색/장르
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])

  // 로그인 상태/유저 (초기값은 빈 객체)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [user, setUser] = useState<{ name?: string; email?: string; avatar?: string }>({})

  const router = useRouter()

  // 로그인 정보 복원 (하드코딩 제거)
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

  /* -------------------------
   * 업로드 → DB 저장 (버튼 클릭 시 호출)
   *  - multer.single("photo")
   *  - POST `${API_BASE}/api/photos/upload`
   *  - 응답 { photo_id }
   * ------------------------- */
  async function uploadPhotoToBackend(file: File): Promise<{ photoId: string } | null> {
    const form = new FormData()
    form.append("photo", file)         // ✅ 필드명: photo
    form.append("filename", file.name) // 선택 메타데이터

    const url = `${API_BASE}/api/photos/upload`
    try {
      const res = await fetch(url, { method: "POST", body: form }) // Content-Type 자동 설정
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

  /* -------------------------
   * 이미지 선택: 미리보기만 (DB 저장 X)
   * ------------------------- */
  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // 1) 미리보기만
    const reader = new FileReader()
    reader.onload = (e) => setUploadedImage(e.target?.result as string)
    reader.readAsDataURL(file)

    // 2) 파일 보관 (추천 버튼에서 업로드)
    setSelectedFile(file)
    setUploadedPhotoId(null)
  }

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]))
  }

  /* -------------------------
   * "음악 추천받기" 버튼:
   *  - 이미지가 있으면 지금 업로드 → 성공 시 /recommend 로 이동
   *  - 이미지가 없고 장르만 있으면 장르 쿼리로 /recommend 이동
   * ------------------------- */
  const goRecommend = async () => {
    if (!isLoggedIn) {
      alert("로그인이 필요합니다.")
      router.push("/login")
      return
    }

    setIsSubmitting(true)

    try {
      if (selectedFile) {
        // 1) 파일 업로드
        const result = await uploadPhotoToBackend(selectedFile)
        if (!result?.photoId) {
          alert("사진 업로드에 실패했습니다.")
          setIsSubmitting(false)
          return
        }
        setUploadedPhotoId(result.photoId)
        localStorage.setItem("lastPhotoId", result.photoId)

        // 2) 업로드 성공 → RecommendClient로 (recommend/page.tsx가 RecommendClient 렌더링)
        router.push(`/recommend?photoId=${encodeURIComponent(result.photoId)}`)
        return
      }

      // 파일이 없으면 장르로만 이동
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 via-pink-100 to-blue-100 relative overflow-hidden">
      {/* 배경 색감 요소 */}
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
              {/* 프로젝트명 */}
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
                  <DropdownMenuItem><History className="mr-2 h-4 w-4" /><span>시청 기록</span></DropdownMenuItem>
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
        {/* 업로드 영역 */}
        <div className="text-center mb-20">
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
                disabled={isUploading || isSubmitting}
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
                      <p className="text-gray-600 font-light">사진을 업로드하세요 (버튼 클릭 시 저장됩니다)</p>
                    </div>
                  )}
                </div>
              </div>
            </label>
          </div>

          {/* /recommend로 이동 (photoId/genres 전달) — 클릭 시 업로드 수행 */}
          <Button
            onClick={goRecommend}
            size="lg"
            disabled={isSubmitting || (!uploadedImage && selectedGenres.length === 0)}
            className="bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 hover:from-purple-700 hover:via-pink-700 hover:to-blue-700 text-white px-12 py-3 rounded-full font-light disabled:opacity-50 shadow-lg hover:shadow-xl transition-all"
          >
            {isSubmitting ? "처리 중..." : "음악 추천받기"}
          </Button>
        </div>

        {/* 검색 */}
        <div className="mb-16">
          <div className="max-w-xl mx-auto relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
            <Input
              type="text"
              placeholder="노래 제목, 아티스트명 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 pr-4 py-4 text-base border-gray-200 focus:border-purple-300 rounded-2xl bg-white/80 backdrop-blur-sm"
            />
          </div>
        </div>

        {/* 기분 선택 */}
        <div className="mb-20">
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
        </div>

        {/* 사용자 추억 히스토리(표시용) */}
        <div className="mb-16">
          <div className="flex items-center mb-10">
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
            <div className="ml-auto">
              <Button variant="ghost" className="text-gray-500 hover:text-purple-600 font-light">
                전체보기
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {[
              { id: 1, title: "인생영화", artist: "pH-1", image: "/placeholder.svg?height=150&width=150&text=인생영화" },
              { id: 2, title: "숲이넘기기엔", artist: "도우카", image: "/placeholder.svg?height=150&width=150&text=숲이넘기기엔" },
              { id: 3, title: "오포닝", artist: "고주잠자리", image: "/placeholder.svg?height=150&width=150&text=오포닝" },
              { id: 4, title: "넌 떠올리는 중이야", artist: "PATEKO", image: "/placeholder.svg?height=150&width=150&text=넌떠올리는중이야" },
              { id: 5, title: "작은 봄", artist: "고주잠자리", image: "/placeholder.svg?height=150&width=150&text=작은봄" },
              { id: 6, title: "Love Me Again", artist: "Jayci yucca", image: "/placeholder.svg?height=150&width=150&text=LoveMeAgain" },
            ].map((item, index) => (
              <div key={item.id} className="group cursor-default">
                <div className="relative mb-3">
                  <Image
                    src={item.image || "/placeholder.svg"}
                    alt={item.title}
                    width={150}
                    height={150}
                    className="w-full aspect-square object-cover rounded-2xl transition-all duration-300"
                  />
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${memoryColors[index % memoryColors.length]} opacity-0 group-hover:opacity-80 rounded-2xl transition-all flex items-center justify-center`}
                  >
                    <div className="bg-white text-purple-600 rounded-full p-3 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="h-4 w-4" />
                    </div>
                  </div>
                </div>
                <div className="text-center px-2">
                  <h4 className="font-medium text-gray-900 text-sm truncate mb-1">{item.title}</h4>
                  <p className="text-xs text-gray-500 truncate font-light">{item.artist}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
