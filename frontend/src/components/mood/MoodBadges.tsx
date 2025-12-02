// src/components/mood/MoodBadges.tsx
"use client"
import { Badge } from "@/components/ui/badge"

const musicGenres = ["Pop", "Jazz", "Workout", "Relax", "Focus", "Calm", "Sadness", "Party", "Romance", "Commute"]

const genreColors: Record<string, string> = {
  // '팝' -> 'Pop'
  Pop: "bg-gradient-to-r from-pink-500 to-rose-500 text-white",
  // '재즈' -> 'Jazz'
  Jazz: "bg-gradient-to-r from-blue-500 to-indigo-500 text-white",
  // '운동' -> 'Workout'
  Workout: "bg-gradient-to-r from-orange-500 to-red-500 text-white",
  // '휴식' -> 'Relax'
  Relax: "bg-gradient-to-r from-green-500 to-emerald-500 text-white",
  // '집중' -> 'Focus'
  Focus: "bg-gradient-to-r from-purple-500 to-violet-500 text-white",
  // '평온' -> 'Calm'
  Calm: "bg-gradient-to-r from-cyan-500 to-blue-500 text-white",
  // '슬픔' -> 'Sadness'
  Sadness: "bg-gradient-to-r from-gray-500 to-slate-500 text-white",
  // '파티' -> 'Party'
  Party: "bg-gradient-to-r from-yellow-500 to-orange-500 text-white",
  // '로맨스' -> 'Romance'
  Romance: "bg-gradient-to-r from-pink-500 to-purple-500 text-white",
  // '출퇴근' -> 'Commute'
  Commute: "bg-gradient-to-r from-teal-500 to-cyan-500 text-white",
}

type Props = {
  selected: string[]
  onToggle: (genre: string) => void
}

export default function MoodBadges({ selected, onToggle }: Props) {
  return (
    <section className="mb-4">
      {/* 섹션 제목: 오늘의 기분 */}
      <h3 className="text-xl font-light text-gray-900 mb-8 text-center">Today's Mood</h3>
      {/* 뱃지 컨테이너 및 중앙 정렬 */}
      <div className="flex flex-wrap justify-center gap-3 max-w-2xl mx-auto">
        {musicGenres.map((genre) => (
          <Badge
            key={genre}
            variant={selected.includes(genre) ? "default" : "outline"}
            className={`cursor-pointer px-6 py-2 text-sm rounded-full font-light transition-all ${
              selected.includes(genre)
                ? genreColors[genre] || "bg-purple-600 text-white"
                : "border-gray-200 text-gray-600 hover:border-purple-300 hover:text-purple-600 bg-white/80"
            }`}
            onClick={() => onToggle(genre)}
          >
            {genre}
          </Badge>
        ))}
      </div>
    </section>
  )
}