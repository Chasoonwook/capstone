"use client"
import { useState } from "react"
import type React from "react"

import Image from "next/image"
import { Upload, Camera, Sparkles, CheckCircle2 } from "lucide-react"
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
  const [isImageLoading, setIsImageLoading] = useState(false)
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
        console.error("[upload] Failed:", res.status, txt)
        return null
      }
      const json = (await res.json()) as { photoId?: string | number }
      const photoId = json?.photoId != null ? String(json.photoId) : null
      if (!photoId) {
        console.error("[upload] No photoId in response:", json)
        return null
      }
      return { photoId }
    } catch (e) {
      console.error("[upload] Request error:", e)
      return null
    }
  }

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsImageLoading(true)
    const reader = new FileReader()
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const result = e.target?.result
      if (typeof result === "string") {
        setUploadedImage(result)
        setIsImageLoading(false)
      }
    }
    reader.readAsDataURL(file)

    setSelectedFile(file)
    setUploadedPhotoId(null)
  }

  const goRecommend = async () => {
    if (!isLoggedIn) {
      alert("Login is required.")
      onRequireLogin()
      return
    }
    setIsSubmitting(true)
    try {
      if (selectedFile) {
        const result = await uploadPhotoToBackend(selectedFile)
        if (!result?.photoId) {
          alert("Photo upload failed.")
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
        alert("Please upload a photo or select genres.")
        setIsSubmitting(false)
        return
      }
      router.push(`/recommend?genres=${encodeURIComponent(genres)}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="max-w-2xl mx-auto">
      <div className="text-center mb-8 md:mb-10">
        <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground mb-3 text-balance">
          Find Music by Photo
        </h2>
        <p className="text-sm md:text-base text-muted-foreground text-pretty max-w-xl mx-auto">
          Get music recommendations that fit the moment captured in your photo
        </p>
      </div>

      <div className="mb-8 md:mb-10">
        <label className="cursor-pointer block group">
          <input
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
            disabled={isSubmitting || isImageLoading}
          />

          {uploadedImage ? (
            <div className="relative rounded-2xl md:rounded-3xl overflow-hidden bg-card border-2 border-border shadow-xl hover:shadow-2xl transition-all duration-500 hover:scale-[1.02]">
              <div className="aspect-[4/3] relative">
                <Image
                  src={uploadedImage || "/placeholder.svg"}
                  alt="Uploaded photo"
                  fill
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-90 group-hover:opacity-100 transition-opacity duration-300" />
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 text-white">
                <div className="flex items-center gap-3 mb-2 animate-in slide-in-from-bottom duration-500">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 backdrop-blur-sm flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-green-400 animate-pulse" />
                  </div>
                  <div>
                    <p className="text-base md:text-lg font-semibold">Photo uploaded successfully</p>
                    {uploadedPhotoId && (
                      <p className="text-xs md:text-sm text-white/70 mt-0.5">ID: {uploadedPhotoId}</p>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="absolute top-4 right-4 md:top-6 md:right-6 bg-black/60 backdrop-blur-md text-white px-4 py-2 md:px-5 md:py-2.5 rounded-xl text-sm font-semibold hover:bg-black/80 transition-all duration-300 hover:scale-105 active:scale-95 border border-white/10"
              >
                Change Photo
              </button>

              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 pointer-events-none" />
            </div>
          ) : (
            <div className="rounded-2xl md:rounded-3xl border-2 border-dashed border-border bg-card hover:bg-accent/50 hover:border-primary/50 transition-all duration-300 hover:scale-[1.02] relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              <div className="aspect-[4/3] flex flex-col items-center justify-center p-8 md:p-12 text-center relative z-10">
                <div className="relative mb-6 md:mb-8">
                  <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-primary/10 flex items-center justify-center transition-all duration-300 group-hover:bg-primary/20 group-hover:scale-110">
                    <Upload className="w-10 h-10 md:w-12 md:h-12 text-primary transition-transform duration-300 group-hover:translate-y-[-4px]" />
                  </div>
                  <div
                    className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping"
                    style={{ animationDuration: "2s" }}
                  />
                </div>

                <div className="space-y-2 md:space-y-3">
                  <p className="text-base md:text-lg font-semibold text-foreground flex items-center gap-2 justify-center">
                    <Camera className="w-5 h-5" />
                    Upload Your Photo
                  </p>
                  <p className="text-sm md:text-base text-muted-foreground max-w-xs mx-auto">
                    {isImageLoading ? "Loading image..." : "Tap or click to select a photo from your device"}
                  </p>
                </div>

                <div className="mt-6 md:mt-8 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="px-3 py-1 rounded-full bg-muted">JPG</span>
                  <span className="px-3 py-1 rounded-full bg-muted">PNG</span>
                  <span className="px-3 py-1 rounded-full bg-muted">WEBP</span>
                </div>
              </div>
            </div>
          )}
        </label>
      </div>

      <Button
        onClick={goRecommend}
        size="lg"
        disabled={isSubmitting || isImageLoading || (!uploadedImage && selectedGenres.length === 0)}
        className="w-full h-14 md:h-16 rounded-xl md:rounded-2xl font-bold text-base md:text-lg shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group"
      >
        <span className="absolute inset-0 bg-gradient-to-r from-primary via-primary/80 to-primary opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <span className="relative flex items-center gap-3">
          {isSubmitting ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Analyzing your photo...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
              Get Recommendations
            </>
          )}
        </span>
      </Button>
    </section>
  )
}
