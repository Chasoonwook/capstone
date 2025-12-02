"use client"
import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { API_BASE } from "@/lib/api"
import { BookOpen, Calendar, ChevronLeft, ChevronRight } from "lucide-react"
import type { Diary } from "@/types/diary"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const buildPhotoSrc = (photoId: string | number | null | undefined) => {
  if (photoId === null || photoId === undefined) {
    return { primary: "/placeholder.svg", fallback: "/placeholder.svg" }
  }
  const id = encodeURIComponent(String(photoId))
  return {
    primary: `${API_BASE}/api/photos/${id}/binary`,
    fallback: `${API_BASE}/photos/${id}/binary`,
  }
}

function extractDate(item: any): Date | null {
  const v =
    item?.diary_at ??
    item?.created_at ??
    item?.createdAt ??
    item?.updated_at ??
    item?.updatedAt ??
    item?.timestamp ??
    item?.date ??
    null

  if (v == null) return null
  const d = typeof v === "number" ? new Date(v) : new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

// 날짜 표시 포맷 영어화
const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })

const fmtDateKey = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export default function DiaryStrip({
  user,
  diaries,
  loading,
  error,
}: {
  user: any
  diaries: Diary[] | undefined
  loading: boolean
  error: string | null
}) {
  const router = useRouter()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDiaries, setSelectedDiaries] = useState<Diary[]>([])

  const diariesByDate = useMemo(() => {
    const map = new Map<string, Diary[]>()
    if (!diaries) return map

    diaries.forEach((diary) => {
      const dateObj = extractDate(diary)
      if (dateObj) {
        const key = fmtDateKey(dateObj)
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(diary)
      }
    })
    return map
  }, [diaries])

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startDayOfWeek = firstDay.getDay()

  const calendarDays = useMemo(() => {
    const days: (number | null)[] = []
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null)
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i)
    }
    return days
  }, [startDayOfWeek, daysInMonth])

  const goToPrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
    setModalOpen(false)
  }

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
    setModalOpen(false)
  }

  if (loading) {
    return (
      <section className="mb-6 px-4">
        <div className="h-5 w-32 rounded bg-muted animate-pulse mb-4" />
        <div className="bg-card rounded-xl p-4 border border-border">
          <div className="h-64 bg-muted animate-pulse rounded-lg" />
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="mb-6 px-4">
        <h2 className="text-sm font-semibold text-foreground mb-4">My Photo Diary</h2>
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center">
          <p className="text-destructive text-sm">Failed to load photo diaries</p>
        </div>
      </section>
    )
  }

  const list = diaries ?? []
  if (list.length === 0) {
    return (
      <section className="mb-6 px-4">
        <h2 className="text-sm font-semibold text-foreground mb-4">My Photo Diary</h2>
        <div className="bg-muted/30 border border-border rounded-xl p-8 text-center">
          <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-muted-foreground text-sm mb-2">No diary entries yet</p>
          <p className="text-muted-foreground text-xs">Analyze a photo and write a diary entry</p>
        </div>
      </section>
    )
  }

  return (
    <section className="mb-8 px-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">My Photo Diary</h2>
        <span className="text-xs text-muted-foreground">{list.length} items</span>
      </div>

      {/* Calendar */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
        {/* Calendar Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={goToPrevMonth}
            className="w-9 h-9 rounded-lg hover:bg-muted/50 flex items-center justify-center transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-5 h-5 text-foreground" />
          </button>
          <h3 className="text-base font-bold text-foreground">
            {year} Year {month + 1} Month
          </h3>
          <button
            onClick={goToNextMonth}
            className="w-9 h-9 rounded-lg hover:bg-muted/50 flex items-center justify-center transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="w-5 h-5 text-foreground" />
          </button>
        </div>

        {/* Day Labels */}
        <div className="grid grid-cols-7 gap-2 mb-3">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
            <div
              key={day}
              className={`text-center text-sm font-medium py-2 ${
                i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-muted-foreground"
              }`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days */}
        <div className="grid grid-cols-7 gap-2">
          {calendarDays.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} className="aspect-[4/5]" />
            }

            const dateKey = fmtDateKey(new Date(year, month, day))
            const dayDiaries = diariesByDate.get(dateKey) || []
            const hasDiary = dayDiaries.length > 0
            const dayOfWeek = (startDayOfWeek + day - 1) % 7

            // Get first diary's photo for thumbnail
            const firstDiary = dayDiaries[0]
            const photoId = firstDiary?.photo_id ?? (firstDiary as any)?.photoId ?? null
            const { primary, fallback } = buildPhotoSrc(photoId)

            return (
              <button
                key={day}
                onClick={() => {
                  if (hasDiary) {
                    setSelectedDiaries(dayDiaries)
                    setModalOpen(true)
                  }
                }}
                disabled={!hasDiary}
                className={`
                  aspect-[4/5] rounded-2xl text-sm font-medium transition-all relative overflow-hidden
                  ${hasDiary ? "cursor-pointer hover:ring-2 hover:ring-primary/50 hover:shadow-md" : "cursor-default bg-muted/20"}
                `}
              >
                {hasDiary ? (
                  <>
                    {/* Diary Photo Background */}
                    <img
                      src={primary || "/placeholder.svg"}
                      alt={`${day} Diary`}
                      className="absolute inset-0 w-full h-full object-cover"
                      crossOrigin="anonymous"
                      onError={(e) => {
                        const img = e.currentTarget as HTMLImageElement
                        if (!(img as any).__fb) {
                          ;(img as any).__fb = true
                          img.src = fallback
                        } else {
                          img.src = "/placeholder.svg"
                        }
                      }}
                    />
                    {/* Overlay for better text visibility */}
                    <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/20 to-black/40" />

                    {/* Date Number */}
                    <div className="absolute top-2 left-2 z-10">
                      <span
                        className={`text-base md:text-lg font-bold drop-shadow-lg ${
                          dayOfWeek === 0 ? "text-red-400" : dayOfWeek === 6 ? "text-blue-400" : "text-white"
                        }`}
                      >
                        {day}
                      </span>
                    </div>

                    {/* Diary Count Badge (if multiple diaries) */}
                    {dayDiaries.length > 1 && (
                      <div className="absolute top-2 right-2 z-10 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-lg">
                        {dayDiaries.length}
                      </div>
                    )}

                    {/* Diary Indicator Dot */}
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
                      <div className="w-1.5 h-1.5 rounded-full bg-white shadow-lg" />
                    </div>
                  </>
                ) : (
                  <span
                    className={`
                      ${dayOfWeek === 0 ? "text-red-500/60" : dayOfWeek === 6 ? "text-blue-500/60" : "text-muted-foreground/60"}
                    `}
                  >
                    {day}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Modal for displaying diary details */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
                <span className="text-lg font-bold">Photo Diary</span>
            </DialogTitle>
            </DialogHeader>

          <div className="space-y-4 mt-4">
            {selectedDiaries.map((diary) => {
              const photoId = diary.photo_id ?? (diary as any).photoId ?? null
              const { primary, fallback } = buildPhotoSrc(photoId)
              const title = diary.subject || diary.title || "Untitled"
              const content = diary.content || ""
              const emotion = diary.emotion || ""
              const dateObj = extractDate(diary)
              const musicTitle = diary.music_title || ""
              const musicArtist = diary.music_artist || ""

              return (
                <div
                  key={`modal-diary-${diary.id}`}
                  className="bg-card border border-border rounded-2xl overflow-hidden shadow-lg"
                >
                  {/* Photo */}
                  <div className="relative aspect-square overflow-hidden bg-muted">
                    <img
                      src={primary || "/placeholder.svg"}
                      alt={title}
                      className="w-full h-full object-cover"
                      crossOrigin="anonymous"
                      onError={(e) => {
                        const img = e.currentTarget as HTMLImageElement
                        if (!(img as any).__fb) {
                          ;(img as any).__fb = true
                          img.src = fallback
                        } else {
                          img.src = "/placeholder.svg"
                        }
                      }}
                    />

                    {/* Date Badge */}
                    {dateObj && (
                      <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-lg bg-black/80 backdrop-blur-sm text-white text-xs font-medium flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {fmtDate(dateObj)}
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="p-5 space-y-4">
                    {/* Emotion Indicators */}
                    {emotion && (
                      <div className="flex gap-2">
                        <div className="w-3 h-3 rounded-full bg-primary/20 border-2 border-primary" />
                        <div className="w-3 h-3 rounded-full bg-muted border-2 border-border" />
                      </div>
                    )}

                    {/* Music Info */}
                    {musicTitle && (
                      <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-xl">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-primary text-sm">Music</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{musicTitle}</p>
                          {musicArtist && <p className="text-xs text-muted-foreground truncate">{musicArtist}</p>}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex">
                      <button
                        onClick={() => {
                          if (photoId == null) return
                          const pidEnc = encodeURIComponent(String(photoId))
                          router.push(`/diary/${pidEnc}`)
                        }}
                        className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                      >
                        <BookOpen className="w-4 h-4" />
                        Open
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}