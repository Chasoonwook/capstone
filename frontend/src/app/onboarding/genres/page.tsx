"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { API_BASE, authHeaders } from "@/lib/api"
import { Check, Music2 } from "lucide-react"
import Image from "next/image"

const GENRES = [
  { id: "BGM", name: "BGM", image: "/genres/BGM.png", description: "배경음악, 카페음악" },
  { id: "클래식", name: "클래식", image: "/genres/Classical.png", description: "오케스트라, 피아노" },
  { id: "밴드", name: "밴드", image: "/genres/Band.png", description: "록, 인디, 밴드음악" },
  { id: "힙합", name: "힙합", image: "/genres/Hip-hop.png", description: "랩, 힙합, R&B" },
  { id: "pop", name: "Pop", image: "/genres/POP.png", description: "팝송, 댄스팝" },
  { id: "jpop", name: "J-Pop", image: "/genres/J-POP.png", description: "일본 팝, 애니송" },
  { id: "트로트", name: "트로트", image: "/genres/Trot.png", description: "한국 전통가요" },
  { id: "동요", name: "동요", image: "/genres/Children's song.png", description: "어린이 음악" },
  { id: "kpop", name: "K-Pop", image: "/genres/K-POP.png", description: "한국 아이돌, 케이팝" },
]

// 내부 클라이언트 컴포넌트: useSearchParams 등 훅 사용
function Inner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editMode = useMemo(() => searchParams.get("edit") === "1", [searchParams])

  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  // 로그인/초기값 프리필 (+ 편집 모드면 완료여부와 상관없이 진입)
  useEffect(() => {
    const uid = localStorage.getItem("uid")
    if (!uid) {
      router.replace("/login")
      return
    }

    const localKey = `preferred_genres::${uid}`
    ;(async () => {
      try {
        // 1) API로 시도 (쿠키 포함)
        const r = await fetch(`${API_BASE}/api/users/me`, {
          headers: { "X-User-Id": uid, ...(authHeaders?.() as HeadersInit) },
          cache: "no-store",
          credentials: "include",
        })

        if (r.status === 401) {
          router.replace("/login")
          return
        }

        if (r.ok) {
          const me = await r.json()

          // 편집 모드가 아니라면, 이미 완료한 경우 홈으로
          if (!editMode && me?.genre_setup_complete) {
            document.cookie = "onboardingDone=1; path=/; max-age=31536000"
            router.replace("/")
            return
          }

          // 저장된 선호장르 프리필
          if (Array.isArray(me?.preferred_genres)) {
            setSelected(me.preferred_genres)
            try {
              localStorage.setItem(localKey, JSON.stringify(me.preferred_genres))
            } catch {}
          }
        } else {
          // 2) API 실패 시 로컬 캐시 폴백
          try {
            const cached = localStorage.getItem(localKey)
            if (cached) {
              const arr = JSON.parse(cached)
              if (Array.isArray(arr)) setSelected(arr)
            }
          } catch {}
        }
      } catch (e) {
        console.error("load me error", e)
        // 3) 에러여도 로컬 캐시 폴백
        try {
          const cached = localStorage.getItem(localKey)
          if (cached) {
            const arr = JSON.parse(cached)
            if (Array.isArray(arr)) setSelected(arr)
          }
        } catch {}
      } finally {
        setLoading(false)
      }
    })()
  }, [router, editMode])

  const toggle = (g: string) =>
    setSelected((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : prev.length >= 3 ? prev : [...prev, g]))

  const save = async () => {
    if (selected.length < 2 || selected.length > 3) {
      alert("선호 장르는 2~3개 선택해 주세요.")
      return
    }
    setSaving(true)
    try {
      const uid = localStorage.getItem("uid") || ""
      const localKey = `preferred_genres::${uid}`

      // 1) 장르 업데이트
      const r1 = await fetch(`${API_BASE}/api/users/me/genres`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": uid,
          ...(authHeaders?.() as HeadersInit),
        },
        body: JSON.stringify({ genres: selected }),
        credentials: "include",
      })
      if (r1.status === 401) {
        router.replace("/login")
        return
      }
      if (!r1.ok) {
        alert((await r1.text().catch(() => "")) || "장르 저장 실패")
        return
      }

      // 2) 온보딩 완료 플래그 (편집 모드가 아닐 때만)
      if (!editMode) {
        const r2 = await fetch(`${API_BASE}/api/users/me/onboarding`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-User-Id": uid,
            ...(authHeaders?.() as HeadersInit),
          },
          body: JSON.stringify({ genre_setup_complete: true }),
          credentials: "include",
        })
        if (!r2.ok) {
          alert((await r2.text().catch(() => "")) || "온보딩 완료 처리 실패")
          return
        }
        document.cookie = "onboardingDone=1; path=/; max-age=31536000"
      }

      // 로컬 캐시 갱신
      try {
        localStorage.setItem(localKey, JSON.stringify(selected))
      } catch {}

      alert(editMode ? "선호 장르가 업데이트되었습니다!" : "선호 장르가 저장되었습니다!")
      if (editMode && window.history.length > 1) {
        router.back()
      } else {
        router.replace("/")
      }
    } catch (e) {
      console.error(e)
      alert("서버와 통신 중 오류가 발생했습니다.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground animate-pulse">불러오는 중…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5 pointer-events-none" />

      <div className="relative py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-6">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-4 animate-pulse">
              <Music2 className="w-10 h-10 text-primary" />
            </div>
            <h1 className="text-5xl font-bold text-foreground mb-4 tracking-tight">
              {editMode ? "관심 장르 수정" : "음악 취향을 알려주세요"}
            </h1>
            <p className="text-xl text-muted-foreground mb-3 max-w-2xl mx-auto leading-relaxed">
              {editMode ? "선호 장르를 변경해 보세요" : "당신만의 음악 경험을 위해 선호하는 장르를 선택해주세요"}
            </p>
            <div className="inline-flex items-center gap-2 px-6 py-3 bg-card rounded-full border border-border shadow-sm">
              <span className="text-sm text-muted-foreground">선택된 장르:</span>
              <span className="text-lg font-bold text-foreground">{selected.length}</span>
              <span className="text-sm text-muted-foreground">/ 3</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12 max-w-4xl mx-auto">
            {GENRES.map((genre, index) => {
              const isSelected = selected.includes(genre.id)
              return (
                <div
                  key={genre.id}
                  onClick={() => toggle(genre.id)}
                  className="relative cursor-pointer group"
                  style={{
                    animation: `fadeInUp 0.5s ease-out ${index * 0.05}s both`,
                  }}
                >
                  <div
                    className={`
                      relative bg-card rounded-2xl overflow-hidden
                      border-2 transition-all duration-300
                      ${isSelected
                        ? "border-primary shadow-xl shadow-primary/20 scale-[1.02]"
                        : "border-border shadow-lg hover:shadow-xl hover:scale-[1.02] hover:border-primary/50"
                      }
                    `}
                  >
                    {/* Image container 크기 축소 */}
                    <div className="relative h-40 sm:h-44 md:h-48 overflow-hidden">
                      <Image
                        src={genre.image || "/placeholder.svg"}
                        alt={genre.name}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-110"
                        priority={index < 6}
                      />
                      <div
                        className={`
                          absolute inset-0 transition-all duration-300
                          ${isSelected
                            ? "bg-gradient-to-t from-primary/60 via-primary/20 to-transparent"
                            : "bg-gradient-to-t from-black/40 via-black/10 to-transparent group-hover:from-black/60"
                          }
                        `}
                      />
                      {isSelected && (
                        <div className="absolute top-3 right-3 bg-primary text-primary-foreground rounded-full p-2.5 shadow-xl animate-in zoom-in duration-300">
                          <Check size={18} strokeWidth={3} />
                        </div>
                      )}
                    </div>

                    {/* 카드 콘텐츠 패딩/글자 크기 축소 */}
                    <div className="p-4 space-y-1.5">
                      <h3 className="font-bold text-lg text-card-foreground tracking-tight">{genre.name}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">{genre.description}</p>
                    </div>

                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="text-center">
            <Button
              onClick={save}
              disabled={saving || selected.length < 2}
              size="lg"
              className={`
                px-16 py-7 text-lg font-bold rounded-full
                bg-primary text-primary-foreground
                shadow-2xl shadow-primary/30
                transition-all duration-300
                hover:shadow-3xl hover:shadow-primary/40 hover:scale-105
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                ${saving ? "animate-pulse" : ""}
              `}
            >
              {saving ? (
                <span className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-foreground border-t-transparent" />
                  저장 중...
                </span>
              ) : editMode ? (
                "변경 사항 저장"
              ) : (
                "음악 여행 시작하기"
              )}
            </Button>

            {selected.length < 2 && (
              <p className="text-sm text-muted-foreground mt-4 animate-pulse">최소 2개의 장르를 선택해주세요</p>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}

// 페이지 컴포넌트: Suspense 경계로 감싸서 CSR bailout 오류 방지
export default function OnboardingGenresPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  )
}
