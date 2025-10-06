// components/history/DiaryStrip.tsx
"use client"
import { useRouter } from "next/navigation"
import { API_BASE } from "@/lib/api"
import { BookOpen, Edit, Calendar } from "lucide-react"
import type { Diary } from "@/types/diary"

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
    item?.created_at ?? item?.createdAt ??
    item?.updated_at ?? item?.updatedAt ??
    item?.timestamp ?? item?.date ?? null

  if (v == null) return null
  const d = typeof v === "number" ? new Date(v) : new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })

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

  if (loading) {
    return (
      <section className="mb-6 px-4">
        <div className="h-5 w-32 rounded bg-muted animate-pulse mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl p-4 border border-border">
              <div className="aspect-square rounded-lg bg-muted animate-pulse mb-3" />
              <div className="h-4 bg-muted rounded animate-pulse mb-2" />
              <div className="h-3 bg-muted rounded animate-pulse w-2/3" />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="mb-6 px-4">
        <h2 className="text-sm font-semibold text-foreground mb-4">나의 그림일기</h2>
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4 text-center">
          <p className="text-destructive text-sm">그림일기를 불러오지 못했습니다</p>
        </div>
      </section>
    )
  }

  const list = diaries ?? []
  if (list.length === 0) {
    return (
      <section className="mb-6 px-4">
        <h2 className="text-sm font-semibold text-foreground mb-4">나의 그림일기</h2>
        <div className="bg-muted/30 border border-border rounded-xl p-8 text-center">
          <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-muted-foreground text-sm mb-2">아직 작성한 그림일기가 없어요</p>
          <p className="text-muted-foreground text-xs">사진을 분석한 후 그림일기를 작성해보세요</p>
        </div>
      </section>
    )
  }

  return (
    <section className="mb-8 px-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">나의 그림일기</h2>
        <span className="text-xs text-muted-foreground">{list.length}개</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {list.map((diary) => {
          const photoId =
            diary.photo_id ?? (diary as any).photoId ?? null
          const { primary, fallback } = buildPhotoSrc(photoId)
          const title = diary.subject || diary.title || "제목 없음"
          const content = diary.content || ""
          const emotion = diary.emotion || ""
          const dateObj = extractDate(diary)
          const musicTitle = diary.music_title || ""
          const musicArtist = diary.music_artist || ""

          const preview = content.length > 50 ? content.slice(0, 50) + "..." : content

          return (
            <div
              key={`diary-${diary.id}`}
              className="group bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/30 transition-all duration-300 cursor-pointer"
              onClick={() => {
                if (photoId == null) return
                const pidEnc = encodeURIComponent(String(photoId))
                router.push(`/diary/${pidEnc}`)
              }}
            >
              <div className="relative aspect-square overflow-hidden bg-muted">
                <img
                  src={primary}
                  alt={title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
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

                {emotion && (
                  <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-primary/90 backdrop-blur-sm text-primary-foreground text-xs font-medium">
                    {emotion}
                  </div>
                )}

                {dateObj && (
                  <div className="absolute bottom-3 right-3 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm text-white text-[10px] flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {fmtDate(dateObj)}
                  </div>
                )}
              </div>

              <div className="p-4">
                <h3 className="text-sm font-semibold text-foreground mb-2 line-clamp-1 group-hover:text-primary transition-colors">
                  {title}
                </h3>

                {preview && (
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2 leading-relaxed">{preview}</p>
                )}

                {musicTitle && (
                  <div className="flex items-center gap-2 mb-3 p-2 bg-muted/50 rounded-lg">
                    <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-primary text-xs">♪</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{musicTitle}</p>
                      {musicArtist && <p className="text-[10px] text-muted-foreground truncate">{musicArtist}</p>}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (photoId == null) return
                      const pidEnc = encodeURIComponent(String(photoId))
                      router.push(`/diary/${pidEnc}`)
                    }}
                    className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    보기
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (photoId == null) return
                      const pidEnc = encodeURIComponent(String(photoId))
                      router.push(`/diary/${pidEnc}/edit`)
                    }}
                    className="flex-1 h-9 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    수정
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
