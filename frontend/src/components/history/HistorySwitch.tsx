// src/components/history/HistorySwitch.tsx
"use client";

import { useSearchParams } from "next/navigation";
import HistoryStrip from "@/components/history/HistoryStrip";
import DiaryStrip from "@/components/history/DiaryStrip";
import { useDiaries } from "@/hooks/useDiaries";

/** 유저 객체 / localStorage 에서 "정수(>=1)" user_id만 추출 */
function resolveUserId(user: any): number | null {
  const toNum = (v: unknown) => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) && n >= 1 ? n : null;
  };

  // 1) 서버/컨텍스트에서 받은 유저 객체 우선
  const fromUser =
    toNum(user?.user_id) ??
    toNum(user?.id) ??
    toNum(user?.userid) ??
    toNum(user?.username);
  if (fromUser != null) return fromUser;

  // 2) localStorage 폴백 (기존 프로젝트 키 호환)
  if (typeof window !== "undefined") {
    const uid = window.localStorage.getItem("uid") ?? "";
    if (/^[1-9]\d*$/.test(uid)) return Number(uid);

    const acc = window.localStorage.getItem("account_id") ?? "";
    if (/^[1-9]\d*$/.test(acc)) return Number(acc);
  }

  return null;
}

export default function HistorySwitch({
  user,
  history,
  loading,
  error,
}: {
  user: any;
  history: any[] | undefined;
  loading: boolean;
  error: string | null;
}) {
  const params = useSearchParams();

  // ✅ 숫자형 user_id 확정
  const uid = resolveUserId(user);

  // 일기 목록 로드 (uid 없으면 자동으로 빈 배열/비활성)
  const {
    diaries,
    loading: diariesLoading,
    error: diariesError,
  } = useDiaries(uid, { limit: 12, enabled: uid != null });

  // 기본 탭은 history
  const tab = params.get("tab") ?? "history";

  switch (tab) {
    case "history":
      return <HistoryStrip user={user} items={history} loading={loading} error={error} />;

    case "diary":
      return (
        <DiaryStrip
          user={user}
          diaries={diaries}
          loading={diariesLoading}
          error={diariesError}
        />
      );

    default:
      return (
        <section className="px-4 py-6 text-center text-sm text-muted-foreground">
          <p>아직 준비 중인 탭입니다.</p>
        </section>
      );
  }
}
