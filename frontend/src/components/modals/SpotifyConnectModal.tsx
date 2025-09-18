"use client";

import { Button } from "@/components/ui/button";
import { X, Link } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;     // "나중에" 클릭 시 호출 (여기서 7일 유예 저장은 부모가 처리)
  onConnect?: () => void;  // 즉시 연동 이동
};

export default function SpotifyConnectModal({ open, onClose, onConnect }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      {/* Modal */}
      <div className="relative mt-16 w-[92%] max-w-md rounded-2xl border border-white/15 bg-white/90 shadow-2xl">
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-2 text-slate-600 hover:bg-slate-100"
          aria-label="닫기"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="px-6 pt-6 pb-5">
          <div className="mb-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-green-100">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-green-600" fill="currentColor">
                <path d="M12 1a11 11 0 1 0 0 22A11 11 0 0 0 12 1Zm4.93 15.31a.75.75 0 0 1-1.03.27 12.6 12.6 0 0 0-7.8-1.24.75.75 0 1 1-.29-1.48 14.1 14.1 0 0 1 8.73 1.4.75.75 0 0 1 .39 1.05Zm1.37-3.13a.9.9 0 0 1-1.24.32 15.9 15.9 0 0 0-10.12-1.45.9.9 0 1 1-.38-1.76 17.7 17.7 0 0 1 11.23 1.62c.43.22.6.75.35 1.27Zm.17-3.36a1.05 1.05 0 0 1-1.44.38 18.3 18.3 0 0 0-13.01-1.63 1.05 1.05 0 1 1-.49-2.04A20.4 20.4 0 0 1 18 8.06c.52.27.74.92.44 1.76Z"/>
              </svg>
            </div>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-gray-900">전체 듣기를 사용하려면</h3>
          <p className="mb-5 text-sm text-gray-700">
            Spotify 계정을 연동해 주세요. 지금 연동하지 않아도 괜찮아요 — 필요할 때는 오른쪽 위 사용자 메뉴에서 언제든지 연동할 수 있어요.
          </p>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              type="button"
              onClick={onClose}
              className="text-gray-700 hover:bg-gray-100"
            >
              나중에
            </Button>
            <Button
              type="button"
              onClick={onConnect}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <Link className="mr-2 h-4 w-4" />
              지금 연동
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
