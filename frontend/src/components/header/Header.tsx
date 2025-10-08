'use client';

import UserHeader from '@/components/header/UserHeader';
import SearchAndRequest from '@/components/search/SearchAndRequest';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type HeaderProps = {
  user: any;
  isLoggedIn: boolean;
  onLogout: () => void;
  musics?: any[];
  loading?: boolean;
  error?: string | null;
};

const TABS = [
  { key: 'history',  label: '추억' },
  { key: 'diary',   label: '일기' },
  { key: 'chart', label: '인기 차트' },
];

export default function Header({
  user,
  isLoggedIn,
  onLogout,
  musics,
  loading,
  error,
}: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const active = params.get('tab') ?? 'recommend';

  const setTab = (key: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    // ✅ 단 하나의 sticky header만 사용
    <header className="sticky top-0 z-40 bg-black text-white shadow">
      {/* 1) 로고/계정 (embedded 모드로 한 줄) */}
      <UserHeader user={user} isLoggedIn={isLoggedIn} onLogout={onLogout} embedded />

      {/* 2) 검색창 */}
      <div className="max-w-5xl mx-auto px-4 pb-3">
        <SearchAndRequest
          size="wide"
          musics={musics}
          loading={loading}
          error={error}
          noOuterMargin
        />
      </div>

      {/* 3) 탭 네비게이션 */}
      <nav className="max-w-5xl mx-auto px-2">
        <ul className="flex gap-1 overflow-x-auto pb-2">
          {TABS.map(({ key, label }) => {
            const selected = active === key;
            return (
              <li key={key}>
                <button
                  onClick={() => setTab(key)}
                  className={[
                    'px-4 py-2 rounded-full text-sm transition',
                    selected ? 'bg-white text-black shadow'
                             : 'text-neutral-200 hover:bg-neutral-800',
                  ].join(' ')}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 탭 아래 구분선 */}
      <div className="h-px w-full bg-neutral-800" />
    </header>
  );
}
