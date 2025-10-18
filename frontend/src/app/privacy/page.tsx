// src/app/privacy/page.tsx
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "개인정보처리방침 | 사진 감성 분석 기반 음악 추천 서비스",
  description: "3번째 프로젝트(사진 감성 분석 기반 음악 추천 서비스) 개인정보처리방침",
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">개인정보처리방침</h1>
          <p className="text-sm text-muted-foreground mt-1">최종 수정일: 2025년 10월 18일</p>
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <h2>제1조 (수집하는 개인정보 항목)</h2>
          <ul>
            <li><strong>필수항목</strong>: 이름, 이메일, 비밀번호, 성별, 전화번호</li>
            <li><strong>선택항목</strong>: 프로필 사진, 선호 장르, 감성 피드백 데이터</li>
            <li><strong>자동수집항목</strong>: IP 주소, 기기정보, 접속로그, 이용기록</li>
          </ul>

          <h2>제2조 (개인정보의 수집 및 이용목적)</h2>
          <ol>
            <li>회원가입 및 본인확인</li>
            <li>서비스 제공(사진 분석, 음악 추천 등)</li>
            <li>맞춤형 음악 추천 및 통계 분석</li>
            <li>이용자 문의 및 민원 처리</li>
            <li>불법 이용 방지 및 보안 강화</li>
          </ol>

          <h2>제3조 (개인정보의 보유 및 이용기간)</h2>
          <ol>
            <li>회원 탈퇴 시까지 또는 관련 법령에서 정한 기간 동안 보관합니다.</li>
            <li>서비스 개선 및 통계 분석을 위한 비식별화된 데이터는 별도 보관할 수 있습니다.</li>
          </ol>

          <h2>제4조 (개인정보의 제3자 제공)</h2>
          <p>회사는 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다. 다만, 다음의 경우는 예외로 합니다.</p>
          <ol>
            <li>법령에 의거하여 수사기관의 요청이 있는 경우</li>
            <li>서비스 제공을 위해 불가피하게 외부 AI 서버 또는 음악 API(예: Spotify, Deezer 등)에 한정 제공하는 경우</li>
          </ol>

          <h2>제5조 (개인정보의 처리 위탁)</h2>
          <p>회사는 서비스 운영을 위해 필요한 경우 일부 업무를 외부에 위탁할 수 있으며, 그 내역은 홈페이지 또는 앱 내에서 고지합니다.</p>

          <h2>제6조 (이용자 및 법정대리인의 권리)</h2>
          <p>이용자는 언제든지 자신의 개인정보를 열람, 수정, 삭제 요청할 수 있습니다. 14세 미만 아동의 경우 법정대리인의 동의를 얻어야 합니다.</p>

          <h2>제7조 (개인정보의 파기절차 및 방법)</h2>
          <ol>
            <li>보유기간이 경과한 개인정보는 지체 없이 파기합니다.</li>
            <li>전자적 파일 형태는 복구 불가능한 방법으로 삭제하며, 문서 형태는 분쇄 또는 소각합니다.</li>
          </ol>

          <h2>제8조 (개인정보의 보호조치)</h2>
          <ul>
            <li>암호화 저장 (비밀번호, 토큰 등)</li>
            <li>접근통제 및 권한관리</li>
            <li>보안프로토콜(HTTPS) 적용</li>
            <li>정기적인 보안 점검</li>
          </ul>

          <h2>제9조 (쿠키의 사용)</h2>
          <p>
            본 서비스는 로그인 상태 유지 및 추천 정확도 향상을 위해 쿠키를 사용할 수 있습니다.
            이용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있습니다.
          </p>

          <h2>제10조 (개인정보보호책임자)</h2>
          <ul>
            <li>이름: 차순욱</li>
            <li>이메일: support@photo-mood-music.com</li>
            <li>담당 업무: 개인정보 보호 및 이용자 문의 처리</li>
          </ul>
        </div>

        <div className="mt-10">
          <Link href="/register" className="text-primary hover:opacity-80">
            ← 회원가입으로 돌아가기
          </Link>
        </div>
      </div>
    </main>
  )
}
