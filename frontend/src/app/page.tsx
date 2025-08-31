"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Upload,
  Search,
  Music,
  Heart,
  Play,
  X,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
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
import { User, Settings, LogOut, CreditCard, History, UserCircle } from "lucide-react"
import { useRouter } from "next/navigation"

const musicGenres = ["팝", "재즈", "운동", "휴식", "집중", "평온", "슬픔", "파티", "로맨스", "출퇴근"]

const sampleRecommendations = [
  { id: 1, title: "Sunset Dreams", artist: "Chill Vibes", genre: "팝", duration: "3:24", image: "/placeholder.svg?height=60&width=60" },
  { id: 2, title: "Morning Coffee", artist: "Acoustic Soul", genre: "휴식", duration: "4:12", image: "/placeholder.svg?height=60&width=60" },
  { id: 3, title: "City Lights", artist: "Urban Beats", genre: "집중", duration: "3:45", image: "/placeholder.svg?height=60&width=60" },
  { id: 4, title: "Peaceful Mind", artist: "Meditation Music", genre: "평온", duration: "5:30", image: "/placeholder.svg?height=60&width=60" },
]

const viewStyles = [
  { id: "cd", name: "CD 플레이어", description: "클래식한 CD 플레이어 스타일" },
  { id: "vinyl", name: "비닐 레코드", description: "빈티지 레코드 플레이어" },
  { id: "cassette", name: "카세트 테이프", description: "레트로 카세트 플레이어" },
  { id: "digital", name: "디지털", description: "모던 디지털 플레이어" },
  { id: "radio", name: "라디오", description: "클래식 라디오 스타일" },
  { id: "instagram", name: "인스타그램", description: "소셜 미디어 스타일 플레이어" },
]

// ✅ 색감 추가: 장르/메모리 그라디언트 팔레트
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

export default function MusicRecommendationApp() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [uploadedPhotoId, setUploadedPhotoId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [showRecommendations, setShowRecommendations] = useState(false)

  // 로그인 상태/유저
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [user, setUser] = useState({
    name: "진영", // 초기값(스토리지 복원 시 덮어씀)
    email: "almond-v6w@gmail.com",
    avatar: "/placeholder.svg?height=32&width=32",
  })

  const [showImmersiveView, setShowImmersiveView] = useState(false)
  const [currentSong, setCurrentSong] = useState(sampleRecommendations[0])
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(180)
  const [currentViewIndex, setCurrentViewIndex] = useState(0)
  const [recommendations, setRecommendations] = useState(sampleRecommendations)

  const router = useRouter()
  const [isUploading, setIsUploading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  // ✅ 로그인 정보 복원
  useEffect(() => {
    try {
      const token = localStorage.getItem("token")
      const name = localStorage.getItem("name")
      const email = localStorage.getItem("email")
      const avatar = localStorage.getItem("avatar") || "/placeholder.svg?height=32&width=32"

      if (token && name && email) {
        setUser((prev) => ({ ...prev, name, email, avatar: prev.avatar || avatar }))
        setIsLoggedIn(true)
      } else {
        setIsLoggedIn(false)
      }
    } catch {
      setIsLoggedIn(false)
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
    router.push("/login")
  }

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setIsUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = (e) => {
        setUploadedImage(e.target?.result as string)
        setUploadedPhotoId("12345")
        setIsUploading(false)
      }
      reader.readAsDataURL(file)
    } catch {
      setIsUploading(false)
    }
  }

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]))
  }

  const generateRecommendations = async () => {
    if (!uploadedImage && selectedGenres.length === 0) return
    setIsGenerating(true)
    setTimeout(() => {
      setShowRecommendations(true)
      setIsGenerating(false)
      if (uploadedImage) {
        setTimeout(() => {
          setShowImmersiveView(true)
          setCurrentSong(sampleRecommendations[0])
          setIsPlaying(true)
        }, 500)
      }
    }, 2000)
  }

  const togglePlay = () => setIsPlaying((v) => !v)

  const playNextSong = () => {
    const currentIndex = sampleRecommendations.findIndex((song) => song.id === currentSong.id)
    const nextIndex = (currentIndex + 1) % sampleRecommendations.length
    setCurrentSong(sampleRecommendations[nextIndex])
    setCurrentTime(0)
  }

  const playPreviousSong = () => {
    const currentIndex = sampleRecommendations.findIndex((song) => song.id === currentSong.id)
    const prevIndex = currentIndex === 0 ? sampleRecommendations.length - 1 : currentIndex - 1
    setCurrentSong(sampleRecommendations[prevIndex])
    setCurrentTime(0)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const closeImmersiveView = () => {
    setShowImmersiveView(false)
    setIsPlaying(false)
  }

  const nextView = () => setCurrentViewIndex((prev) => (prev + 1) % viewStyles.length)
  const prevView = () => setCurrentViewIndex((prev) => (prev - 1 + viewStyles.length) % viewStyles.length)
  const goToView = (index: number) => setCurrentViewIndex(index)

  // ----- 뷰 컴포넌트들 (기존과 동일) -----
  const CDPlayerView = () => (
    <div className="flex-1 flex justify-center items-center">
      <div className="relative">
        <div className={`relative w-80 h-80 ${isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: "3s" }}>
          <div className="w-full h-full rounded-full bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 shadow-2xl border-4 border-gray-300">
            <div className="w-full h-full rounded-full overflow-hidden border-8 border-gray-800 relative">
              <Image src={uploadedImage || "/placeholder.svg"} alt="Current mood" width={320} height={320} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-black/20 rounded-full" />
            </div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-gray-800 rounded-full shadow-inner border-2 border-gray-600">
              <div className="w-full h-full rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center">
                <div className="w-4 h-4 bg-black rounded-full"></div>
              </div>
            </div>
            <div className="absolute inset-4 rounded-full border border-gray-400/30"></div>
            <div className="absolute inset-8 rounded-full border border-gray-400/20"></div>
            <div className="absolute inset-12 rounded-full border border-gray-400/10"></div>
          </div>
        </div>
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-72 h-8 bg-black/20 rounded-full blur-xl"></div>
      </div>
    </div>
  )

  const VinylRecordView = () => (
    <div className="flex-1 flex justify-center items-center">
      <div className="relative">
        <div className={`relative w-96 h-96 ${isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: "2s" }}>
          <div className="w-full h-full rounded-full bg-gradient-to-br from-gray-900 via-black to-gray-800 shadow-2xl">
            <div className="w-full h-full rounded-full overflow-hidden relative">
              <Image src={uploadedImage || "/placeholder.svg"} alt="Current mood" width={384} height={384} className="w-full h-full object-cover opacity-80" />
              <div className="absolute inset-0 bg-gradient-to-br from-transparent via-black/40 to-black/60 rounded-full" />
              {[...Array(12)].map((_, i) => (
                <div key={i} className="absolute rounded-full border border-gray-600/20" style={{ inset: `${i * 8 + 20}px` }} />
              ))}
            </div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-red-600 rounded-full shadow-inner border-2 border-red-700 flex items-center justify-center">
              <div className="text-white text-xs font-bold text-center">
                <div>STEREO</div>
                <div className="w-3 h-3 bg-black rounded-full mx-auto mt-1"></div>
              </div>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-80 h-10 bg-black/30 rounded-full blur-xl"></div>
      </div>
    </div>
  )

  const CassetteView = () => (
    <div className="flex-1 flex justify-center items-center">
      <div className="relative">
        <div className="w-96 h-64 bg-gradient-to-br from-gray-800 via-gray-700 to-gray-900 rounded-lg shadow-2xl border-2 border-gray-600">
          <div className="w-full h-full p-4 relative">
            <div className="w-full h-20 bg-white rounded-sm mb-4 overflow-hidden">
              <Image src={uploadedImage || "/placeholder.svg"} alt="Current mood" width={352} height={80} className="w-full h-full object-cover" />
            </div>
            <div className="flex justify-between items-center px-8">
              <div className={`w-16 h-16 bg-gray-900 rounded-full border-4 border-gray-600 flex items-center justify-center ${isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: "1s" }}>
                <div className="w-8 h-8 bg-gray-700 rounded-full"><div className="w-full h-full rounded-full bg-gradient-to-br from-gray-600 to-gray-800"></div></div>
              </div>
              <div className="flex-1 mx-4 h-1 bg-brown-600 relative"><div className="absolute inset-0 bg-gradient-to-r from-brown-700 to-brown-500"></div></div>
              <div className={`w-16 h-16 bg-gray-900 rounded-full border-4 border-gray-600 flex items-center justify-center ${isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: "1.2s" }}>
                <div className="w-8 h-8 bg-gray-700 rounded-full"><div className="w-full h-full rounded-full bg-gradient-to-br from-gray-600 to-gray-800"></div></div>
              </div>
            </div>
            <div className="mt-4 text-center">
              <div className="text-white text-sm font-mono">SIDE A</div>
              <div className="text-gray-400 text-xs mt-1">90 MIN</div>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-80 h-6 bg-black/20 rounded-full blur-lg"></div>
      </div>
    </div>
  )

  const DigitalView = () => (
    <div className="flex-1 flex justify-center items-center">
      <div className="relative">
        <div className="w-80 h-80 bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 rounded-3xl shadow-2xl border border-purple-500/30 overflow-hidden">
          <div className="w-full h-full p-6 relative">
            <div className="w-full h-48 rounded-2xl overflow-hidden mb-4 relative">
              <Image src={uploadedImage || "/placeholder.svg"} alt="Current mood" width={320} height={192} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-purple-900/50 to-transparent"></div>
              {isPlaying && (
                <div className="absolute bottom-4 left-4 flex space-x-1">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="w-2 rounded-full animate-pulse bg-purple-400" style={{ height: `${Math.random() * 20 + 10}px`, animationDelay: `${i * 0.1}s` }} />
                  ))}
                </div>
              )}
            </div>
            <div className="text-center">
              <div className="text-purple-300 text-lg font-mono mb-2">NOW PLAYING</div>
              <div className="text-white text-sm font-light">Digital Stream Quality</div>
              <div className="text-purple-400 text-xs mt-2">320 kbps • 44.1 kHz</div>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-72 h-8 bg-purple-500/20 rounded-full blur-xl"></div>
      </div>
    </div>
  )

  const RadioView = () => (
    <div className="flex-1 flex justify-center items-center">
      <div className="relative">
        <div className="w-96 h-72 bg-gradient-to-br from-amber-800 via-yellow-700 to-orange-800 rounded-2xl shadow-2xl border-4 border-amber-600">
          <div className="w-full h-full p-6 relative">
            <div className="w-full h-32 bg-amber-900 rounded-lg mb-4 relative overflow-hidden">
              <Image src={uploadedImage || "/placeholder.svg"} alt="Current mood" width={352} height={128} className="w-full h-full object-cover opacity-60" />
              <div className="absolute inset-0 bg-amber-900/70"></div>
              <div className="absolute inset-2 grid grid-cols-12 gap-1">
                {[...Array(60)].map((_, i) => <div key={i} className="w-2 h-2 bg-amber-700 rounded-full" />)}
              </div>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex space-x-2">
                <div className="w-8 h-8 bg-amber-600 rounded-full border-2 border-amber-500"></div>
                <div className="w-8 h-8 bg-amber-600 rounded-full border-2 border-amber-500"></div>
              </div>
              <div className="flex-1 mx-4 h-8 bg-black rounded-lg flex items-center justify-center">
                <div className="text-green-400 text-sm font-mono">FM 107.5</div>
                {isPlaying && <div className="ml-2 w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>}
              </div>
              <div className="w-12 h-8 bg-amber-600 rounded-lg border-2 border-amber-500"></div>
            </div>
            <div className="text-center mt-4">
              <div className="text-amber-200 text-xs">VINTAGE RADIO</div>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-80 h-6 bg-amber-500/20 rounded-full blur-lg"></div>
      </div>
    </div>
  )

  const InstagramView = () => (
    <div className="flex-1 flex justify-center items-center relative">
      <div className="relative w-full h-full max-w-md mx-auto">
        <div className="w-full h-full rounded-3xl overflow-hidden shadow-2xl relative">
          <Image src={uploadedImage || "/placeholder.svg"} alt="Current mood" width={400} height={600} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20"></div>
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <div className="bg-black/20 backdrop-blur-sm rounded-2xl p-3 max-h-80 overflow-y-auto w-16">
              <div className="space-y-3">
                {sampleRecommendations.map((song, index) => (
                  <div key={song.id} onClick={() => setCurrentSong(song)} className={`relative cursor-pointer transition-all ${currentSong.id === song.id ? "scale-110" : "hover:scale-105"}`}>
                    <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/50">
                      <Image src={song.image || "/placeholder.svg"} alt={song.title} width={40} height={40} className="w-full h-full object-cover" />
                    </div>
                    {currentSong.id === song.id && <div className="absolute -inset-1 rounded-full border-2 border-white animate-pulse"></div>}
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-purple-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                      {index + 1}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
            <div className="bg-black/40 backdrop-blur-sm rounded-2xl p-3 w-80">
              <div className="mb-3 text-center">
                <h3 className="text-white font-medium text-base truncate">{currentSong.title}</h3>
                <p className="text-white/70 text-xs truncate">{currentSong.artist}</p>
                <Badge className="bg-white/20 text-white border-white/30 backdrop-blur-sm mt-1 text-xs px-2 py-0.5">{currentSong.genre}</Badge>
              </div>
              <div className="mb-3">
                <div className="flex items-center justify-between text-white text-xs mb-1">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                <div className="w-full bg-white/20 rounded-full h-0.5">
                  <div className="bg-white h-0.5 rounded-full transition-all duration-300" style={{ width: `${(currentTime / duration) * 100}%` }} />
                </div>
              </div>
              <div className="flex items-center justify-center space-x-4">
                <Button variant="ghost" size="sm" onClick={playPreviousSong} className="text-white hover:bg-white/20 rounded-full p-1.5">
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={togglePlay} className="text-white hover:bg-white/20 rounded-full p-2 bg-white/20">
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={playNextSong} className="text-white hover:bg-white/20 rounded-full p-1.5">
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          {isPlaying && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <div className="animate-ping">
                <Heart className="h-8 w-8 text-white/50 fill-current" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  const renderCurrentView = () => {
    switch (viewStyles[currentViewIndex].id) {
      case "cd": return <CDPlayerView />
      case "vinyl": return <VinylRecordView />
      case "cassette": return <CassetteView />
      case "digital": return <DigitalView />
      case "radio": return <RadioView />
      case "instagram": return <InstagramView />
      default: return <CDPlayerView />
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 via-pink-100 to-blue-100 relative overflow-hidden">
      {/* ✅ 배경 색감 요소들 */}
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

      {/* Header (그라디언트 배경/버튼) */}
      <header className="bg-gradient-to-r from-white/90 via-purple-50/90 to-pink-50/90 backdrop-blur-sm border-b border-purple-100 relative z-10">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center">
                <Music className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-xl font-medium text-gray-900">Music</h1>
            </div>
            {isLoggedIn ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name} />
                      <AvatarFallback className="bg-purple-600 text-white">{user.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="end" forceMount>
                  <div className="flex items-center justify-start gap-2 p-2">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name} />
                      <AvatarFallback className="bg-purple-600 text-white">{user.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col space-y-1 leading-none">
                      <p className="font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
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
        {/* 업로드 영역(그라디언트 보더) */}
        <div className="text-center mb-20">
          <h2 className="text-4xl font-light text-gray-900 mb-4">사진으로 음악을 찾아보세요</h2>
          <p className="text-gray-500 mb-12 text-lg font-light max-w-2xl mx-auto">
            사진을 업로드하면 그 순간에 어울리는 음악을 추천해드립니다
          </p>

          <div className="flex justify-center mb-8">
            <label className="cursor-pointer group">
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={isUploading} />
              <div className="border-2 border-dashed border-transparent bg-gradient-to-r from-purple-200 via-pink-200 to-blue-200 p-0.5 rounded-3xl hover:from-purple-300 hover:via-pink-300 hover:to-blue-300 transition-all duration-300">
                <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-16 hover:bg-white/90 transition-all">
                  {isUploading ? (
                    <div className="text-center">
                      <div className="animate-spin h-8 w-8 border-2 border-purple-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                      <p className="text-gray-600 font-light">업로드 중...</p>
                    </div>
                  ) : uploadedImage ? (
                    <div className="relative">
                      <Image src={uploadedImage || "/placeholder.svg"} alt="업로드된 사진" width={240} height={160} className="rounded-2xl object-cover mx-auto" />
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
            onClick={generateRecommendations}
            size="lg"
            disabled={isGenerating || (!uploadedImage && selectedGenres.length === 0)}
            className="bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 hover:from-purple-700 hover:via-pink-700 hover:to-blue-700 text-white px-12 py-3 rounded-full font-light disabled:opacity-50 shadow-lg hover:shadow-xl transition-all"
          >
            {isGenerating ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-3"></div>
                분석 중...
              </>
            ) : (
              "음악 추천받기"
            )}
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

        {/* 기분 선택(장르 뱃지 색상 적용) */}
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

        {/* 사용자 추억 히스토리(카드 오버레이 색감) */}
        <div className="mb-16">
          <div className="flex items-center mb-10">
            <div className="flex items-center space-x-4">
              <Avatar className="h-12 w-12">
                <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.name} />
                <AvatarFallback className="bg-purple-600 text-white">{user.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-2xl font-light text-gray-900">{user.name}님의 추억</h3>
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
              <div key={item.id} className="group cursor-pointer">
                <div className="relative mb-3">
                  <Image src={item.image || "/placeholder.svg"} alt={item.title} width={150} height={150} className="w-full aspect-square object-cover rounded-2xl transition-all duration-300 group-hover:scale-105" />
                  <div className={`absolute inset-0 bg-gradient-to-br ${memoryColors[index % memoryColors.length]} group-hover:opacity-80 opacity-0 rounded-2xl transition-all flex items-center justify-center`}>
                    <Button
                      size="sm"
                      className="opacity-0 group-hover:opacity-100 transition-all bg-white text-purple-600 hover:bg-gray-50 rounded-full p-3 shadow-lg"
                      onClick={() => {
                        setCurrentSong({
                          id: item.id,
                          title: item.title,
                          artist: item.artist,
                          genre: "추억",
                          duration: "3:24",
                          image: item.image,
                        })
                      }}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
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

        {/* 추천 리스트 */}
        {showRecommendations && (
          <div className="mt-16">
            <h3 className="text-2xl font-light mb-8 text-center text-gray-900">추천 음악</h3>
            <div className="grid gap-3 max-w-2xl mx-auto">
              {recommendations.map((song) => (
                <Card key={song.id} className="hover:shadow-sm transition-shadow border-gray-100">
                  <CardContent className="p-4 flex items-center space-x-4">
                    <Image src={song.image || "/placeholder.svg"} alt={song.title} width={48} height={48} className="rounded-xl" />
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900 text-sm">{song.title}</h4>
                      <p className="text-gray-500 text-sm font-light">{song.artist}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="rounded-full text-gray-400 hover:text-purple-600" onClick={() => setCurrentSong(song)}>
                      <Play className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Immersive View (색감 그대로) */}
      {showImmersiveView && uploadedImage && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center">
          <div className="absolute inset-0 bg-cover bg-center filter blur-sm" style={{ backgroundImage: `url(${uploadedImage})` }} />
          <div className="absolute inset-0 bg-black bg-opacity-40" />
          <div className="absolute top-6 right-6 z-10 flex space-x-3">
            <button
              onClick={() => {
                setCurrentSong(sampleRecommendations[Math.floor(Math.random() * sampleRecommendations.length)])
                setIsPlaying(true)
              }}
              className="bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full p-3 text-white transition-all"
              title="음악 다시 추천받기"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button onClick={closeImmersiveView} className="bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full p-3 text-white transition-all">
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10">
            <div className="bg-black/30 backdrop-blur-sm rounded-full px-6 py-3">
              <div className="flex items-center space-x-4">
                <span className="text-white text-sm font-medium">{viewStyles[currentViewIndex].name}</span>
                <div className="flex space-x-2">
                  {viewStyles.map((_, index) => (
                    <button key={index} onClick={() => goToView(index)} className={`w-2 h-2 rounded-full transition-all ${index === currentViewIndex ? "bg-white" : "bg-white/40"}`} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <button onClick={prevView} className="absolute left-6 top-1/2 -translate-y-1/2 z-10 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full p-3 text-white transition-all">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button onClick={nextView} className="absolute right-6 top-1/2 -translate-y-1/2 z-10 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full p-3 text-white transition-all">
            <ChevronRight className="h-6 w-6" />
          </button>

          <div className="relative z-10 w-full max-w-6xl mx-auto px-6 flex items-center justify-between h-full">
            {renderCurrentView()}

            {viewStyles[currentViewIndex].id !== "instagram" && (
              <div className="flex-1 ml-12 h-full flex flex-col justify-center">
                <div className="text-center mb-8">
                  <h2 className="text-4xl font-bold text-white mb-2">{currentSong.title}</h2>
                  <p className="text-xl text-gray-300 mb-4">{currentSong.artist}</p>
                  <Badge className="bg-purple-600 text-white px-4 py-1">{currentSong.genre}</Badge>
                  <p className="text-sm text-gray-400 mt-2">{viewStyles[currentViewIndex].description}</p>
                </div>

                <div className="mb-8">
                  <div className="flex items-center justify-between text-white text-sm mb-2">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                  <div className="w-full bg-gray-600 rounded-full h-2">
                    <div className="bg-purple-500 h-2 rounded-full transition-all duration-300" style={{ width: `${(currentTime / duration) * 100}%` }} />
                  </div>
                </div>

                <div className="flex items-center justify-center space-x-6 mb-8">
                  <Button variant="ghost" size="lg" onClick={playPreviousSong} className="text-white hover:bg-white/20 rounded-full p-3">
                    <SkipBack className="h-6 w-6" />
                  </Button>
                  <Button variant="ghost" size="lg" onClick={togglePlay} className="text-white hover:bg-white/20 rounded-full p-4 bg-purple-600 hover:bg-purple-700">
                    {isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8" />}
                  </Button>
                  <Button variant="ghost" size="lg" onClick={playNextSong} className="text-white hover:bg-white/20 rounded-full p-3">
                    <SkipForward className="h-6 w-6" />
                  </Button>
                </div>

                <div className="bg-black/30 backdrop-blur-sm rounded-2xl p-6 max-h-80 overflow-y-auto">
                  <h3 className="text-white text-lg font-semibold mb-4">추천 플레이리스트</h3>
                  <div className="space-y-3">
                    {sampleRecommendations.map((song) => (
                      <div
                        key={song.id}
                        onClick={() => setCurrentSong(song)}
                        className={`flex items-center space-x-3 p-3 rounded-lg cursor-pointer transition-all ${
                          currentSong.id === song.id ? "bg-purple-600/50 text-white" : "text-gray-300 hover:bg-white/10"
                        }`}
                      >
                        <Image src={song.image || "/placeholder.svg"} alt={song.title} width={40} height={40} className="rounded-lg" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{song.title}</p>
                          <p className="text-sm opacity-70 truncate">{song.artist}</p>
                        </div>
                        <span className="text-sm opacity-70">{song.duration}</span>
                        {currentSong.id === song.id && isPlaying && (
                          <div className="flex space-x-1">
                            <div className="w-1 h-4 bg-purple-400 animate-pulse"></div>
                            <div className="w-1 h-4 bg-purple-400 animate-pulse" style={{ animationDelay: "0.2s" }}></div>
                            <div className="w-1 h-4 bg-purple-400 animate-pulse" style={{ animationDelay: "0.4s" }}></div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
