"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { API_BASE, authHeaders } from "@/lib/api";
import { Check } from "lucide-react";
import Image from "next/image";

const GENRES = [
  { id: "BGM",   name: "BGM",     image: "/genres/BGM.png",                 description: "배경음악, 카페음악" },
  { id: "클래식", name: "클래식",  image: "/genres/Classical.png",           description: "오케스트라, 피아노" },
  { id: "밴드",  name: "밴드",    image: "/genres/Band.png",                description: "록, 인디, 밴드음악" },
  { id: "힙합",  name: "힙합",    image: "/genres/Hip-hop.png",             description: "랩, 힙합, R&B" },
  { id: "pop",   name: "Pop",     image: "/genres/POP.png",                 description: "팝송, 댄스팝" },
  { id: "jpop",  name: "J-Pop",   image: "/genres/J-POP.png",               description: "일본 팝, 애니송" },
  { id: "트로트", name: "트로트",  image: "/genres/Trot.png",                description: "한국 전통가요" },
  { id: "동요",  name: "동요",    image: "/genres/Children's song.png",     description: "어린이 음악" },
  { id: "kpop",  name: "K-Pop",   image: "/genres/K-POP.png",               description: "한국 아이돌, 케이팝" },
];

export default function OnboardingGenresPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editMode = useMemo(() => searchParams.get("edit") === "1", [searchParams]);

  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // 로그인/초기값 프리필 (+ 편집 모드면 완료여부와 상관없이 진입)
  useEffect(() => {
    const uid = localStorage.getItem("uid");
    if (!uid) {
      router.replace("/login");
      return;
    }

    const localKey = `preferred_genres::${uid}`;

    (async () => {
      try {
        // 1) API로 시도 (쿠키 포함)
        const r = await fetch(`${API_BASE}/api/users/me`, {
          headers: { "X-User-Id": uid, ...(authHeaders?.() as HeadersInit) },
          cache: "no-store",
          credentials: "include", // ★ 추가
        });

        if (r.status === 401) {
          router.replace("/login");
          return;
        }

        if (r.ok) {
          const me = await r.json();

          // 편집 모드가 아니라면, 이미 완료한 경우 홈으로
          if (!editMode && me?.genre_setup_complete) {
            document.cookie = "onboardingDone=1; path=/; max-age=31536000";
            router.replace("/");
            return;
          }

          // 저장된 선호장르 프리필
          if (Array.isArray(me?.preferred_genres)) {
            setSelected(me.preferred_genres);
            // 로컬 캐시 갱신
            try { localStorage.setItem(localKey, JSON.stringify(me.preferred_genres)) } catch {}
          }
        } else {
          // 2) API 실패 시 로컬 캐시 폴백
          try {
            const cached = localStorage.getItem(localKey);
            if (cached) {
              const arr = JSON.parse(cached);
              if (Array.isArray(arr)) setSelected(arr);
            }
          } catch {}
        }
      } catch (e) {
        console.error("load me error", e);
        // 3) 에러여도 로컬 캐시 폴백
        try {
          const cached = localStorage.getItem(`preferred_genres::${uid}`);
          if (cached) {
            const arr = JSON.parse(cached);
            if (Array.isArray(arr)) setSelected(arr);
          }
        } catch {}
      } finally {
        setLoading(false);
      }
    })();
  }, [router, editMode]);

  const toggle = (g: string) =>
    setSelected((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : prev.length >= 3 ? prev : [...prev, g]
    );

  const save = async () => {
    if (selected.length < 2 || selected.length > 3) {
      alert("선호 장르는 2~3개 선택해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const uid = localStorage.getItem("uid") || "";
      const localKey = `preferred_genres::${uid}`;

      // 1) 장르 업데이트 (DB의 users.preferred_genres 갱신)
      const r1 = await fetch(`${API_BASE}/api/users/me/genres`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-User-Id": uid, ...(authHeaders?.() as HeadersInit) },
        body: JSON.stringify({ genres: selected }),
        credentials: "include", // ★ 추가
      });
      if (r1.status === 401) {
        router.replace("/login");
        return;
      }
      if (!r1.ok) {
        alert((await r1.text().catch(() => "")) || "장르 저장 실패");
        return;
      }

      // 2) 온보딩 완료 플래그는 첫 설정 때만 필요 (편집 모드에서는 생략 가능)
      if (!editMode) {
        const r2 = await fetch(`${API_BASE}/api/users/me/onboarding`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-User-Id": uid, ...(authHeaders?.() as HeadersInit) },
          body: JSON.stringify({ genre_setup_complete: true }),
          credentials: "include", // ★ 추가
        });
        if (!r2.ok) {
          alert((await r2.text().catch(() => "")) || "온보딩 완료 처리 실패");
          return;
        }
        document.cookie = "onboardingDone=1; path=/; max-age=31536000";
      }

      // 저장 성공 시 로컬 캐시도 갱신
      try { localStorage.setItem(localKey, JSON.stringify(selected)) } catch {}

      alert(editMode ? "선호 장르가 업데이트되었습니다!" : "선호 장르가 저장되었습니다!");
      // 편집 모드는 이전 페이지로, 아니면 홈으로
      if (editMode && window.history.length > 1) {
        router.back();
      } else {
        router.replace("/");
      }
    } catch (e) {
      console.error(e);
      alert("서버와 통신 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-600">
        불러오는 중…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            {editMode ? "관심 장르 수정" : "음악 취향을 알려주세요"}
          </h1>
          <p className="text-lg text-gray-600 mb-2">
            {editMode ? "선호 장르를 변경해 보세요" : "당신만의 음악 경험을 위해 선호하는 장르를 선택해주세요"}
          </p>
          <p className="text-sm text-purple-600 font-medium">2~3개의 장르를 선택하세요 ({selected.length}/3)</p>
        </div>

        <div className="grid grid-cols-3 gap-6 mb-12 max-w-4xl mx-auto">
          {GENRES.map((genre) => {
            const isSelected = selected.includes(genre.id);
            return (
              <div
                key={genre.id}
                onClick={() => toggle(genre.id)}
                className={`relative cursor-pointer group transition-all duration-300 transform hover:scale-105 ${
                  isSelected ? "ring-4 ring-purple-500 ring-offset-2" : ""
                }`}
              >
                <div className="bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow duration-300">
                  <div className="relative h-48 overflow-hidden">
                    <Image
                      src={genre.image || "/placeholder.svg"}
                      alt={genre.name}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-110"
                      priority={false}
                    />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-all duration-300" />
                    {isSelected && (
                      <div className="absolute top-3 right-3 bg-purple-600 text-white rounded-full p-2 shadow-lg">
                        <Check size={16} />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-lg text-gray-800 mb-1">{genre.name}</h3>
                    <p className="text-sm text-gray-600">{genre.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-center">
          <Button
            onClick={save}
            disabled={saving || selected.length < 2}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-12 py-3 text-lg font-semibold rounded-full shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "저장 중..." : editMode ? "변경 사항 저장" : "음악 여행 시작하기"}
          </Button>
        </div>
      </div>
    </div>
  );
}
