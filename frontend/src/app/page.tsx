"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import UserHeader from "@/components/header/UserHeader"
import HistoryCarousel from "@/components/history/HistoryCarousel"
import PhotoUpload from "@/components/upload/PhotoUpload"
import SearchAndRequest from "@/components/search/SearchAndRequest"
import MoodBadges from "@/components/mood/MoodBadges"
import { useAuthUser } from "@/hooks/useAuthUser"
import { useMusics } from "@/hooks/useMusics"
import { useHistory } from "@/hooks/useHistory"

export default function Page() {
  const { user, isLoggedIn, logout } = useAuthUser()
  const router = useRouter()
  const { musics, loading: musicsLoading, error: musicsError } = useMusics()
  const { history, loading: historyLoading, error: historyError } = useHistory(isLoggedIn)
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]))
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

      <UserHeader
        user={user}
        isLoggedIn={isLoggedIn}
        onLogout={() => {
          logout()
          router.push("/login")
        }}
      />

      <main className="max-w-5xl mx-auto px-6 py-16 relative z-10">
        <HistoryCarousel user={user} items={history} loading={historyLoading} error={historyError} />

        <PhotoUpload
          isLoggedIn={isLoggedIn}
          selectedGenres={selectedGenres}
          onRequireLogin={() => router.push("/login")}
        />

        <SearchAndRequest musics={musics} loading={musicsLoading} error={musicsError} />

        <MoodBadges selected={selectedGenres} onToggle={toggleGenre} />
      </main>
    </div>
  )
}
