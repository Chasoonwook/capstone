"use client"

import type React from "react"
import { useState } from "react"
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

const musicGenres = [
  "팝/재즈",
  "온동",
  "잠잠한",
  "휴식",
  "에너지 충전",
  "집중",
  "평온한 기분",
  "슬픔",
  "파티",
  "로맨스",
  "출퇴근길",
]

const sampleRecommendations = [
  { id: 1, title: "Sunset Dreams", artist: "Chill Vibes", genre: "팝/재즈", duration: "3:24", image: "/placeholder.svg?height=60&width=60" },
  { id: 2, title: "Morning Coffee", artist: "Acoustic Soul", genre: "휴식", duration: "4:12", image: "/placeholder.svg?height=60&width=60" },
  { id: 3, title: "City Lights", artist: "Urban Beats", genre: "에너지 충전", duration: "3:45", image: "/placeholder.svg?height=60&width=60" },
  { id: 4, title: "Peaceful Mind", artist: "Meditation Music", genre: "평온한 기분", duration: "5:30", image: "/placeholder.svg?height=60&width=60" },
]

const viewStyles = [
  { id: "cd", name: "CD 플레이어" },
  { id: "instagram", name: "인스타그램" },
  { id: "default", name: "기본 뷰" },
]

export default function MusicRecommendationApp() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [showRecommendations, setShowRecommendations] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [user, setUser] = useState({ name: "진영", email: "almond-v6w@gmail.com", avatar: "/placeholder.svg?height=32&width=32" })
  const [showImmersiveView, setShowImmersiveView] = useState(false)
  const [currentSong, setCurrentSong] = useState(sampleRecommendations[0])
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(180)
  const [currentViewIndex, setCurrentViewIndex] = useState(0)

  const router = useRouter()

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => setUploadedImage(e.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]))
  }

  const generateRecommendations = () => {
    setShowRecommendations(true)
    if (uploadedImage) {
      setTimeout(() => {
        setShowImmersiveView(true)
        setCurrentSong(sampleRecommendations[0])
        setIsPlaying(true)
      }, 500)
    }
  }

  const togglePlay = () => setIsPlaying(!isPlaying)
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

  // CD 뷰
  const CDPlayerView = () => (
    <div className="flex-1 flex justify-center items-center">
      <div className="relative">
        <div className={`relative w-80 h-80 ${isPlaying ? "animate-spin" : ""}`} style={{ animationDuration: "3s" }}>
          <div className="w-full h-full rounded-full bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 shadow-2xl border-4 border-gray-300">
            <div className="w-full h-full rounded-full overflow-hidden border-8 border-gray-800 relative">
              <Image src={uploadedImage || "/placeholder.svg"} alt="Current mood" width={320} height={320} className="w-full h-full object-cover" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  // Instagram 뷰 (수정)
  const InstagramView = () => (
    <div className="flex-1 flex justify-center items-center">
      <div className="relative w-full max-w-2xl">
        <div className="rounded-3xl overflow-hidden shadow-2xl relative">
          <Image src={uploadedImage || "/placeholder.svg"} alt="Current mood" width={800} height={1000} className="w-full h-[700px] object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20"></div>

          {/* 음악 플레이어 오버레이 (작고 중앙 정렬) */}
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 w-[80%] bg-black/60 backdrop-blur-md rounded-xl p-3">
            <div className="text-center mb-2">
              <h4 className="text-white text-lg font-semibold truncate">{currentSong.title}</h4>
              <p className="text-white/70 text-sm">{currentSong.artist}</p>
            </div>
            <div className="flex items-center justify-between text-white text-xs mb-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <div className="w-full bg-white/30 rounded-full h-1 mb-3">
              <div className="bg-purple-400 h-1 rounded-full" style={{ width: `${(currentTime / duration) * 100}%` }} />
            </div>
            <div className="flex items-center justify-center space-x-6">
              <Button variant="ghost" size="sm" onClick={playPreviousSong} className="text-white hover:bg-white/20 rounded-full p-1.5">
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={togglePlay} className="text-white hover:bg-white/20 rounded-full p-2 bg-purple-600">
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={playNextSong} className="text-white hover:bg-white/20 rounded-full p-1.5">
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const DefaultView = () => (
    <div className="flex-1 flex justify-center">
      <div className="relative animate-pulse-glow">
        <Image src={uploadedImage || "/placeholder.svg"} alt="Current mood" width={400} height={400} className="rounded-2xl shadow-2xl object-cover" />
      </div>
    </div>
  )

  // 오른쪽 플레이어 & 추천 리스트
  const renderPlayerAndPlaylist = () => (
    <>
      <div className="text-center mb-8">
        <h2 className="text-4xl font-bold text-white mb-2">{currentSong.title}</h2>
        <p className="text-xl text-gray-300 mb-4">{currentSong.artist}</p>
        <Badge className="bg-purple-600 text-white px-4 py-1">{currentSong.genre}</Badge>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between text-white text-sm mb-2">
          <span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span>
        </div>
        <div className="w-full bg-gray-600 rounded-full h-2">
          <div className="bg-purple-500 h-2 rounded-full" style={{ width: `${(currentTime / duration) * 100}%` }} />
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
            </div>
          ))}
        </div>
      </div>
    </>
  )

  // 뷰 렌더링
  const renderCurrentView = () => {
    switch (viewStyles[currentViewIndex].id) {
      case "cd":
        return (
          <>
            <CDPlayerView />
            <div className="flex-1 ml-12 h-full flex flex-col justify-center">{renderPlayerAndPlaylist()}</div>
          </>
        )
      case "instagram":
        return <InstagramView /> // 음악 플레이어는 이미지 내부
      default:
        return (
          <>
            <DefaultView />
            <div className="flex-1 ml-12 h-full flex flex-col justify-center">{renderPlayerAndPlaylist()}</div>
          </>
        )
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Music className="h-8 w-8 text-purple-600" />
            <h1 className="text-2xl font-bold text-gray-900">뮤직 추천 시스템</h1>
          </div>
          {isLoggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className="bg-purple-600 text-white">{user.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" align="end">
                <DropdownMenuItem><UserCircle className="mr-2 h-4 w-4" />내 채널</DropdownMenuItem>
                <DropdownMenuItem><Settings className="mr-2 h-4 w-4" />설정</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setIsLoggedIn(false)}><LogOut className="mr-2 h-4 w-4" />로그아웃</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button onClick={() => router.push("/login")} className="bg-purple-600 hover:bg-purple-700 text-white">로그인</Button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* 이미지 업로드 */}
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold mb-4 text-gray-900">사진으로 음악을 찾아보세요</h2>
          <div className="flex justify-center mb-6">
            <label className="cursor-pointer">
              <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              <div className="border-2 border-dashed border-purple-300 rounded-lg p-8 bg-purple-50 hover:border-purple-400">
                {uploadedImage ? (
                  <Image src={uploadedImage} alt="Uploaded" width={300} height={200} className="rounded-lg" />
                ) : (
                  <div className="text-center">
                    <Upload className="h-12 w-12 text-purple-400 mx-auto mb-4" />
                    <p className="text-purple-600 font-medium">사진을 업로드하세요</p>
                  </div>
                )}
              </div>
            </label>
          </div>
        </div>
        {/* 검색창 */}
        <div className="max-w-2xl mx-auto mb-8 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
          <Input
            type="text"
            placeholder="노래 검색창 - 원하는 곡을 검색해보세요"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 py-3 text-lg border-2 border-purple-200 focus:border-purple-400 rounded-full bg-white"
          />
        </div>

        {/* 장르 선택 */}
        <div className="mb-8 text-center">
          <h3 className="text-xl font-semibold mb-4 text-gray-900">오늘의 기분을 선택해주세요</h3>
          <div className="flex flex-wrap justify-center gap-3">
            {musicGenres.map((genre) => (
              <Badge
                key={genre}
                variant={selectedGenres.includes(genre) ? "default" : "outline"}
                className={`cursor-pointer px-4 py-2 text-sm rounded-full transition-all ${
                  selectedGenres.includes(genre)
                    ? "bg-purple-600 text-white"
                    : "border-purple-300 text-purple-600 hover:bg-purple-50"
                }`}
                onClick={() => toggleGenre(genre)}
              >
                {genre}
              </Badge>
            ))}
          </div>
        </div>

        {/* 추천 버튼 */}
        <div className="text-center mb-8">
          <Button onClick={generateRecommendations} size="lg" className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-full text-lg">
            <Music className="h-5 w-5 mr-2" />
            음악 추천받기
          </Button>
        </div>

        {/* 추천 리스트 */}
        {showRecommendations && (
          <div className="mt-12">
            <h3 className="text-2xl font-bold mb-6 text-center text-gray-900">당신을 위한 추천 음악</h3>
            <div className="grid gap-4 max-w-3xl mx-auto">
              {sampleRecommendations.map((song) => (
                <Card key={song.id}>
                  <CardContent className="p-4 flex items-center space-x-4">
                    <Image src={song.image} alt={song.title} width={60} height={60} className="rounded-lg" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{song.title}</h4>
                      <p className="text-gray-600">{song.artist}</p>
                    </div>
                    <Button size="sm" variant="outline" className="rounded-full"><Play className="h-4 w-4" /></Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Immersive Music View */}
{showImmersiveView && uploadedImage && (
  <div className="fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center">
    <div className="absolute inset-0 bg-cover bg-center filter blur-sm" style={{ backgroundImage: `url(${uploadedImage})` }} />

    {/* 닫기 & 재추천 버튼 그룹 */}
    <div className="absolute top-6 right-6 z-10 flex space-x-3">
      {/* 재추천 버튼 */}
      <button
        onClick={() => {
          const randomIndex = Math.floor(Math.random() * sampleRecommendations.length);
          setCurrentSong(sampleRecommendations[randomIndex]);
          setIsPlaying(true);
        }}
        className="bg-white/20 hover:bg-white/30 rounded-full p-3 shadow-lg transition-all"
        title="음악 다시 추천받기"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>

      {/* 닫기 버튼 */}
      <button
        onClick={closeImmersiveView}
        className="bg-white rounded-full p-3 shadow-lg hover:bg-purple-600 transition-all"
      >
        <X className="h-6 w-6 text-purple-700 hover:text-white" />
      </button>
    </div>

    <button onClick={prevView} className="absolute left-6 top-1/2 transform -translate-y-1/2 z-10 bg-white/20 hover:bg-white/40 rounded-full p-3">
      <ChevronLeft className="h-6 w-6 text-white" />
    </button>
    <button onClick={nextView} className="absolute right-6 top-1/2 transform -translate-y-1/2 z-10 bg-white/20 hover:bg-white/40 rounded-full p-3">
      <ChevronRight className="h-6 w-6 text-white" />
    </button>

    <div className="relative z-10 w-full max-w-6xl mx-auto px-6 flex items-center justify-between h-full">
      {renderCurrentView()}
    </div>
  </div>
)}

    </div>
  )
}
