"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import type { Song } from "../types";

type Props = {
  items: Song[];
  currentId: string | number | null;
  uploadedImage: string | null;
  onClickItem: (song: Song) => void;
};

export default function RecommendationList({
  items,
  currentId,
  uploadedImage,
  onClickItem,
}: Props) {
  return (
    <div className="space-y-2">
      {items.map((song) => {
        const cover = song.image ?? uploadedImage ?? "/placeholder.svg";
        const active = currentId === song.id;
        return (
          <div
            key={song.id}
            onClick={() => onClickItem(song)}
            className={`flex items-center p-3 rounded-xl cursor-pointer transition-all duration-200 hover:bg-white/10 ${
              active ? "bg-gradient-to-r from-purple-500/30 to-pink-500/30 border border-purple-400/50" : ""
            }`}
          >
            {cover ? (
              <Image
                src={cover}
                alt={song.title ?? "album cover"}
                width={48}
                height={48}
                sizes="48px"
                className="rounded-lg mr-3 border border-white/10 flex-shrink-0 !w-12 !h-12"
                style={{ width: 48, height: 48 }}
                unoptimized={typeof cover === "string" && cover.startsWith("data:")}
              />
            ) : (
              <div className="w-12 h-12 rounded-lg mr-3 bg-gray-300/40" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium truncate text-sm">{song.title}</p>
              <p className="text-slate-300 text-xs truncate">{song.artist}</p>
            </div>
            <div className="flex-shrink-0 ml-2">
              <Badge variant="secondary" className="bg-white/10 text-slate-300 text-xs px-2 py-0.5 border-0">
                {song.genre}
              </Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}
