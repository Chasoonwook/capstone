"use client"
import { useState } from "react"
import type React from "react"

import Image from "next/image"
import { Upload, Camera } from "lucide-react"
import { Button } from "@/components/ui/button"
import { API_BASE } from "@/lib/api"
import { useRouter } from "next/navigation"

type Props = {
  isLoggedIn: boolean
  selectedGenres: string[]
  onRequireLogin: () => void
}

export default function PhotoUpload({ isLoggedIn, selectedGenres, onRequireLogin }: Props) {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadedPhotoId, setUploadedPhotoId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()

  async function uploadPhotoToBackend(file: File): Promise<{ photoId: string } | null> {
    const form = new FormData()
    form.append("file", file)
    const uid = localStorage.getItem("uid")
    if (uid) form.append("userId", uid)

    const url = `${API_BASE}/api/photos/analyze`
    try {
      const res = await fetch(url, { method: "POST", body: form })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        console.error("[upload] 실패:", res.status, txt)
        return null
      }
      const json = (await res.json()) as { photoId?: string | number }
      const photoId = json?.photoId != null ? String(json.photoId) : null
      if (!photoId) {
        console.error("[upload] 응답에 photoId 없음:", json)
        return null
      }
      return { photoId }
    } catch (e) {
      console.error("[upload] 요청 오류:", e)
      return null
    }
  }

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

  const goRecommend = async () => {
    if (!isLoggedIn) {
      alert("로그인이 필요합니다.")
      onRequireLogin()
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

  return (
    <section className="max-w-lg mx-auto px-4 mb-12">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-semibold text-foreground mb-2">사진으로 음악 찾기</h2>
        <p className="text-sm text-muted-foreground">순간을 담은 사진에 어울리는 음악을 추천해드려요</p>
      </div>

      <div className="mb-6">
        <label className="cursor-pointer block">
          <input type="file" accept="image/*" onChange={handleImageSelect} className="hidden" disabled={isSubmitting} />

          {uploadedImage ? (
            <div className="relative rounded-2xl overflow-hidden bg-card border border-border shadow-sm">
              <div className="aspect-[4/3] relative">
                <Image src={uploadedImage || "/placeholder.svg"} alt="업로드된 사진" fill className="object-cover" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4" />
                  <span className="text-sm font-medium">사진이 업로드되었습니다</span>
                </div>
                {uploadedPhotoId && <p className="text-xs text-white/80 mt-1">ID: {uploadedPhotoId}</p>}
              </div>
              <button
                type="button"
                className="absolute top-3 right-3 bg-black/50 backdrop-blur-sm text-white px-3 py-1.5 rounded-full text-xs font-medium hover:bg-black/70 transition-colors"
              >
                변경
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-border bg-card hover:bg-accent/50 transition-colors">
              <div className="aspect-[4/3] flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Upload className="h-8 w-8 text-primary" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">사진 업로드</p>
                <p className="text-xs text-muted-foreground">탭하여 사진을 선택하세요</p>
              </div>
            </div>
          )}
        </label>
      </div>

      <Button
        onClick={goRecommend}
        size="lg"
        disabled={isSubmitting || (!uploadedImage && selectedGenres.length === 0)}
        className="w-full h-12 rounded-xl font-medium shadow-sm disabled:opacity-50"
      >
        {isSubmitting ? "분석 중..." : "음악 추천받기"}
      </Button>
    </section>
  )
}
