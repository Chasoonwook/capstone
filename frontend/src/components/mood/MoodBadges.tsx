"use client"
import { Badge } from "@/components/ui/badge"

const musicGenres = ["팝", "재즈", "운동", "휴식", "집중", "평온", "슬픔", "파티", "로맨스", "출퇴근"]

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

type Props = {
  selected: string[]
  onToggle: (genre: string) => void
}

export default function MoodBadges({ selected, onToggle }: Props) {
  return (
    <section className="mb-4">
      <h3 className="text-xl font-light text-gray-900 mb-8 text-center">오늘의 기분</h3>
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
