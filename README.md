# Travelries 🌍

**사진 한 장으로 여행을 기록하는 AI 여행 앨범.**
사진을 올리면 EXIF/GPS로 지도와 여행 일정을 자동으로 만들고, 얼굴 인식으로 "누구와 함께했는지"까지 정리합니다. 여행은 AI 다이어리로 요약되고, 친구와 피드·공동 앨범·공개 링크로 공유할 수 있습니다.

> 캡스톤디자인 4팀 · Next.js + Supabase + FastAPI · PWA

## 주요 기능

| 영역 | 기능 |
| --- | --- |
| 📸 업로드 | 한 장/여러 장 일괄 업로드, EXIF·GPS 추출, 역지오코딩, 주변 장소(POI) |
| 🙂 얼굴 인식 | 브라우저(MediaPipe + face-api.js) 또는 서버(InsightFace ArcFace), 여러 명 중 저장할 얼굴 선택 |
| 👥 인물 | 같은 사람 자동 묶기, 수동 합치기, 이름 지정, 친구 계정 연결 → 게시물 태그 제안 |
| 🗺️ 지도 | 사진 핀 · 이동 경로 · 히트맵 · 시/도 지역 보기 |
| 🧳 앨범 | 월별 보기, 날짜 간격 + GPS로 여행 자동 구분, "이 사람과 함께한 여행" |
| ✨ AI | 여행 AI 다이어리, 랜드마크 인식 (Gemini, 결과 캐시) |
| 🔗 공유 | 사진/여행 전체 공개 링크(로그인 불필요), 스토리 카드, Year in Review |
| 💬 소셜 | 팔로우, 피드, 좋아요, 댓글/답글, 리포스트, 태그, 게시물 보내기, 실시간 알림 |
| 🤝 공동 앨범 | 초대 코드로 참여, 역할(owner/contributor/viewer), 반응·댓글 |
| 🧹 정리 | 비슷한 사진·흐린 사진 찾아서 정리 |

## 기술 구조

```text
Next.js 16 (App Router, React 19, Tailwind v4)  ── Vercel
   │  ├─ 브라우저 얼굴 인식: MediaPipe BlazeFace + face-api.js
   │  └─ Supabase JS: Auth · Postgres(RLS) · Storage · Realtime
   │
   └─(선택) FastAPI 백엔드  ── /analyze /nearby-places /generate-diary /recognize-landmark
          ├─ InsightFace buffalo_l (SCRFD + ArcFace 512-d)
          └─ Gemini API (무료 티어, 모델 폴백 체인)
```

- **데이터**: 개인 사진은 `photos` 테이블 하나(지도/얼굴 플래그), 이미지는 Storage `user-photos` 버킷.
- **권한**: 모든 테이블에 RLS. 다른 사용자에게 알림을 보내는 동작은 `SECURITY DEFINER` RPC/트리거로 처리.
- **백엔드는 선택 사항**: 없으면 얼굴 인식은 브라우저에서 동작하고, AI 다이어리/랜드마크만 비활성화됩니다.

자세한 설계와 규칙은 [CLAUDE.md](CLAUDE.md)를 참고하세요.

## 로컬 실행

### 1. 프론트엔드

```bash
npm install
bash _scripts/download-models.sh   # 브라우저 얼굴 인식 모델 (~33MB, 최초 1회)
npm run dev                        # http://localhost:3000
```

`.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000   # 선택, 기본값 동일
```

> ⚠️ 프로젝트 폴더 경로에 한글이나 괄호가 있으면 개발 서버가 파일 변경을 감지하지 못합니다(자동 새로고침 안 됨). 영문 경로에 두거나, 수정 후 개발 서버를 재시작하세요.

### 2. 백엔드 (선택)

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload          # http://localhost:8000
```

`backend/.env`:

```dotenv
GOOGLE_API_KEY=...                 # aistudio.google.com/apikey (무료)
ALLOWED_ORIGINS=https://your-app.vercel.app   # 배포 시 CORS 허용 주소
```

### 3. 데이터베이스

`supabase/migrations/`의 SQL을 **번호 순서대로** Supabase SQL Editor에서 실행합니다(모두 재실행 안전).
초기 테이블(`photos`, `profiles`, `notifications`, `collab_*`, `shares`)은 대시보드에서 만들어져 마이그레이션 파일이 없습니다. 현재 스키마·권한은 [`supabase/audit/rls_audit.sql`](supabase/audit/rls_audit.sql)(읽기 전용)으로 확인할 수 있습니다.

## 휴대폰에서 테스트

**방법 A: 배포 사이트 (가장 간단)**
휴대폰 브라우저로 Vercel 주소를 엽니다. HTTPS라서 위치·카메라가 모두 동작하고, 공유 → "홈 화면에 추가"로 앱처럼 설치할 수 있습니다(PWA). 단, 백엔드를 배포하기 전에는 AI 다이어리와 랜드마크 인식이 동작하지 않습니다.

**방법 B: 같은 Wi-Fi에서 로컬 서버 (백엔드 포함 전체 기능)**

```bash
npm run dev                                                    # 프론트엔드 (모든 네트워크 주소에서 접속 가능)
cd backend && uvicorn main:app --reload --host 0.0.0.0         # 백엔드: --host 0.0.0.0 필수
ipconfig getifaddr en0                                         # Mac의 Wi-Fi IP 확인 (예: 192.168.0.12)
```

휴대폰을 **같은 Wi-Fi**에 연결하고 `http://<Mac IP>:3000`을 엽니다. 백엔드 주소는 자동으로 `http://<Mac IP>:8000`이 됩니다.

- 접속이 안 되면 macOS 설정 → 네트워크 → 방화벽에서 Node/Python의 들어오는 연결을 허용하세요.
- HTTPS가 아니어서 "현재 위치 사용" 버튼은 휴대폰에서 동작하지 않습니다(사진 GPS와 지도 검색은 정상).
- 레이아웃만 빠르게 볼 때는 Mac Chrome 개발자도구의 기기 모드(⌘⇧M)도 쓸 수 있습니다.

## 명령어

```bash
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npx tsc --noEmit # 타입 체크
npm test         # 단위 테스트 (vitest) — 얼굴 매칭/군집화, 여행 구분, 사진 정리 로직
```

## 테스트 · QA

- 단위 테스트: `lib/*.test.ts` (27개)
- 실사용 체크리스트(두 계정, 모바일, 권한): [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md)

## 배포

- **프론트엔드**: GitHub `main`에 push하면 Vercel이 자동 배포합니다.
- **백엔드**: 별도 호스팅이 필요합니다(Render, Railway 등). 배포 후 Vercel 환경변수 `NEXT_PUBLIC_BACKEND_URL`과 백엔드 `ALLOWED_ORIGINS`를 설정하세요. InsightFace 모델(~200MB) 때문에 메모리가 적은 무료 플랜에서는 AI(Gemini) 기능만 쓰고 얼굴 인식은 브라우저 모드로 두는 구성을 권장합니다.
