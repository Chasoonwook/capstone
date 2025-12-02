// src/app/recommend/components/Views.tsx
"use client";

import Image from "next/image";
import React from "react";
import { Button } from "@/components/ui/button";

type BaseProps = {
  rightPane: React.ReactNode;
};

type PhotoProps = BaseProps & {
  uploadedImage: string | null;
  isLandscape: boolean | null;
  onSaveAndEdit: () => void;
  saveEnabled: boolean;
};

export function PhotoPlayerView({
  uploadedImage,
  isLandscape,
  rightPane,
  onSaveAndEdit,
  saveEnabled,
}: PhotoProps) {
  // 폭/높이 클래스를 래퍼 단위로 일원화 구성
  const widthClass = isLandscape ? "w-[44rem]" : "w-[36rem]";
  const heightClass = isLandscape ? "h-[28rem]" : "h-[36rem]";

  return (
    <div className="flex items-center justify-between w-full h-full px-8">
      <div className="flex items-center justify-center flex-1">
        <div className="flex flex-col items-center">
          {uploadedImage ? (
            <div className={`${widthClass} max-w-[90vw]`}>
              <div
                className={`${heightClass} max-h-[80vh] rounded-3xl shadow-2xl border border-white/20 overflow-hidden relative`}
              >
                <Image
                  src={uploadedImage}
                  alt="uploaded photo"
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="(max-width: 640px) 90vw, (max-width: 1024px) 70vw, 44rem"
                />
              </div>

              {/* 사진 하단 저장 버튼 배치 */}
              <Button
                type="button"
                disabled={!saveEnabled}
                onClick={onSaveAndEdit}
                className="mt-4 w-full h-10 border text-white bg-pink-500/70 hover:bg-pink-500 border-white/25 rounded-lg disabled:opacity-60"
                title="저장 및 편집"
              >
                저장 및 편집
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-slate-300">
              {/* 업로드 미존재 상태 표시 */}
              <div className="w-[20rem] h-[14rem] max-w-[90vw] rounded-2xl border border-dashed border-white/20 bg-black/20 flex items-center justify-center">
                <span className="text-sm">이미지가 없습니다</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {rightPane}
    </div>
  );
}

export function CdPlayerView({ rightPane }: BaseProps) {
  return (
    <div className="flex items-center justify-between w-full h-full px-8">
      <div className="flex items-center justify-center flex-1">
        <div className="relative">
          <div className="relative w-80 h-80">
            {/* 디스크 표현 요소 구성 */}
            <div className="w-full h-full rounded-full bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 shadow-2xl border-4 border-slate-300 relative" />
          </div>
        </div>
      </div>
      {rightPane}
    </div>
  );
}

export function InstagramView() {
  return (
    <div className="flex-1 flex items-center justify-center w-full h-full">
      {/* 준비 상태 표시 */}
      <div className="text-slate-300">Instagram View (준비 중)</div>
    </div>
  );
}

export function DefaultView() {
  return (
    <div className="flex-1 flex justify-center items-center">
      {/* 준비 상태 표시 */}
      <div className="text-slate-300">Default View (준비 중)</div>
    </div>
  );
}
