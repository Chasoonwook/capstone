"use client"

import { useSearchParams } from "next/navigation"
import HistoryStrip from "@/components/history/HistoryStrip"

export default function HistorySwitch({
  user,
  history,
  loading,
  error,
}: {
  user: any
  history: any[] | undefined
  loading: boolean
  error: string | null
}) {
  const params = useSearchParams()
  // 첫 진입 시 히스토리(콘텐츠) 탭을 기본으로
  const tab = params.get("tab") ?? "history"

  switch (tab) {
    case "history":
      return (
        <HistoryStrip
          user={user}
          items={history}
          loading={loading}
          error={error}
        />
      )

    case "diary":
      return (
        <section className="px-4 py-6 text-center text-sm text-gray-500">
          <p>그림일기 여기에 넣을 예정</p>
        </section>
      )

    default:
      return (
        <section className="px-4 py-6 text-center text-sm text-gray-400">
          <p>아직 준비 중인 탭입니다.</p>
        </section>
      )
  }
}
