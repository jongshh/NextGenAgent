# NextGenAgent

사용자 노출명은 **AI 선배와의 만남**입니다. 실존 인물의 인터뷰와 기록에서 검수된 경험 패턴을 찾아, 특정 인물을 사칭하지 않는 새로운 AI 선배의 대화로 재구성하는 교육·상담 프로젝트입니다.

현재 버전에서는 네 명의 선배가 모두 독립된 데이터 컬렉션과 대화 세션으로 활성화되어 있습니다.

| 선배 | 질문 | 상태 |
| --- | --- | --- |
| 길을 찾는 사람 | 나는 무엇을 선택해야 할까? | 활성화 |
| 창작하는 사람 | 계속 창작할 수 있을까? | 활성화 |
| 생각하는 사람 | 어떻게 살아야 할까? | 활성화 |
| 용기있는 사람 | 두려워도 한 걸음 나아갈 수 있을까? | 활성화 |

## 사용자 경험

- 4명의 AI 선배를 만나는 선택 허브
- 버전 A 비주얼 노벨형 화면과 버전 B DM형 누적 대화 화면
- 답변을 문장 단위로 차례로 보여주고 클릭하면 즉시 전체 표시
- 모델이 생성하는 자연스러운 후속 선택지 3개와 자유 입력
- `Enter` 전송, `Shift+Enter` 줄바꿈, 한글 조합 중 전송 방지
- 브라우저 세션 저장, 대화 불러오기, 초기화, 실패한 질문 재시도
- 로컬 기록 우선 복구와 참여 ID 기반 Supabase 기기 간 동기화
- WebRTC 기반 실시간 음성 대화, 끼어들기, 실시간 자막과 push-to-talk
- 현자별 독립 음성 및 개발자 전용 `/developer/voices` 설정 패널
- 출처를 상시 노출하지 않고 `이 답변의 바탕` 서랍에서 확인

허브의 `버전 A / 버전 B` 컨트롤로 대화 화면을 바꿀 수 있습니다. 두 버전은 동일한 세션을 공유하며 선택한 화면은 브라우저에 저장됩니다. 버전 B에서는 사용자는 오른쪽, 선배는 왼쪽에 표시되고 선배 답변은 문장별 말풍선으로 이어집니다.

## Architecture

```text
apps/web                 React + Vite + Framer Motion
  └─ Cloudflare Static Assets
          │ /api/*
apps/worker              Cloudflare Worker
  ├─ same-origin API와 비밀 프록시
  ├─ input moderation
  ├─ local keyword search
  ├─ OpenAI Vector Store search
  ├─ Responses API structured output
  ├─ GPT-Live WebRTC 세션과 client delegation
  ├─ evidence ID validation
  └─ output moderation
          │ shared proxy secret
supabase
  ├─ session-api         참여 ID 해시 기반 세션 저장
  ├─ openai-proxy        OpenAI API key와 Vector Store ID 보관
  ├─ voice-profile-api   현자별 음성 설정 저장
  └─ Postgres            private participant_sessions / mentor_voice_profiles

packages/agents          4개 선배 설정과 공통 상담 정책
packages/rag             정규화 스키마, 로컬 검색, 검색 결과 병합
apps/hue-companion       현장 PC 전용 Hue Bridge 제어 및 웹/API 프록시
data/processed           PDF에서 추출한 검수용 JSON
DB/*.pdf                 4개 역할별 PDF, 총 24명
DB/old                   이전 자료 (자동 처리 제외)
Storygator               참고 자료이며 빌드에는 포함되지 않음
```

프로덕션은 Worker Static Assets를 사용해 웹 앱과 API를 한 도메인에서 제공합니다. 브라우저 번들 및 Cloudflare Worker에는 OpenAI 키나 Vector Store ID를 두지 않고 Supabase Secret으로 관리합니다.

## Storygator에서 가져온 것

- 한 장면씩 이어지는 인터랙티브 대화 구성
- 문장별 대화 호흡, 후속 대화 선택지, 자연어 자유 입력
- 구조화 응답과 파싱 실패 시 대체 장면
- 세션 복구와 절제된 화면 전환
- `framer-motion`, `lucide-react` 기반 UI

세계관·캐릭터 생성, 전투와 상태 수치, 음성·BGM, 로컬 모델, 성인 모드, 게임 전용 메모리 시스템은 가져오지 않았습니다.

## Local Setup

Windows에서는 `start_program.bat`가 공식 실행 진입점입니다. Node.js 22 이상과 Python 3.10 이상을 확인하고, 없으면 공식 배포본을 사용자 범위로 준비합니다. PowerShell 5.1 이상과 인터넷 연결이 필요합니다.

최초 실행에서 `apps/worker/.dev.vars`의 누락 항목을 추가합니다. `OPENAI_API_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`를 입력하고 다시 실행하세요. 기존 프록시 비밀값이 있으면 `NEXTGEN_PROXY_SECRET`에 입력합니다. 개발자 암호와 서명 비밀값은 미설정 시 자동 생성되며 암호는 이 파일에서 확인할 수 있습니다. 관리 토큰과 DB 암호는 로컬 설치·원격 배포에만 사용됩니다.

```powershell
./start_program.bat
./start_program.bat -Check
./start_program.bat -Stop
./start_program.bat -Mode Web
./start_program.bat -SyncDb
./start_program.bat -RedeploySupabase
./start_program.bat -RegisterHue
```

기본 실행은 패키지 준비 → 변경 DB 추출·벡터 업로드 → Supabase 마이그레이션·비밀 설정·함수 배포·연결 검증 → 웹 빌드 → 로컬 서버 시작 순서입니다. 대화 화면과 `/developer`를 `http://127.0.0.1:4173`에서 엽니다. 서버는 숨김으로 실행되며 출력은 `logs/`, 실행 기록과 설치 상태는 Git에서 제외되는 `.local/`에 저장합니다. 같은 프로젝트·버전의 서버만 재사용합니다. 이전 버전이 포트를 점유하면 `-Stop` 후 재실행하세요.

`-Check`는 설치·업로드·배포 없이 설정, 자료 해시, 벡터 스토어 접근, Hue 연결과 포트를 진단합니다. `-Mode Web`은 자동 Hue 효과를 비활성화하고 동일한 빌드 웹을 제공합니다. Hue 장비가 없어도 기본 모드에서 웹·음성을 사용할 수 있습니다. Supabase 프로젝트 자체 생성과 Cloudflare 공개 배포는 자동 실행에 포함되지 않습니다.

아래는 실행기를 사용하지 않는 수동 개발 절차입니다. Python에 `scripts/requirements.txt`를 설치한 뒤 실행합니다.

```powershell
npm install
npm run process:interview-db
npm run upload:vector-store
```

`apps/worker/.dev.vars.example`을 참고해 `apps/worker/.dev.vars`를 만듭니다.

```env
OPENAI_MODEL=gpt-5.5
OPENAI_MODERATION_MODEL=omni-moderation-latest
ALLOWED_ORIGIN=http://localhost:5173
SUPABASE_FUNCTIONS_URL=https://wfyghzowxusawsztprqh.supabase.co/functions/v1
NEXTGEN_PROXY_SECRET=<Supabase와 Cloudflare에 등록한 동일한 값>
OPENAI_LIVE_MODEL=gpt-live-1
VOICE_ENABLED=true
VOICE_ADMIN_PASSWORD=<개발자 패널 공용 암호>
VOICE_ADMIN_SESSION_SECRET=<32자 이상의 임의 문자열>
```

두 터미널에서 실행합니다.

```powershell
npm run dev:worker
npm run dev:web
```

- Web: `http://localhost:5173`
- Worker API: `http://localhost:8787`
- Health check: `http://localhost:8787/api/health`

Philips Hue는 `/developer`의 조명 등록·제어 탭에서 관리합니다. Bridge 자동 검색 또는 사설 IP 입력 → 링크 버튼 인증 → 전구 위치 식별 → 네 선배에 서로 다른 컬러 전구 지정 → 저장 순서입니다. 전구 상태와 현재 효과를 확인하고 ON/OFF·밝기·색상 변경, 효과 미리보기와 원상 복원을 할 수 있습니다. Bridge 키는 현장 PC에만 저장됩니다. `setup-hue.bat`도 같은 통합 실행기의 조명 탭을 엽니다.

`start-test-web.bat`와 `start-voice-test.bat`는 통합 실행기의 웹 전용 모드를 호출하는 호환 진입점입니다.

음성 기능만 빠르게 확인하려면 `start-voice-test.bat`를 더블클릭합니다. `.dev.vars`의 음성 필수 설정을 검사한 뒤 로컬 Worker와 웹을 실행하고, 일반 대화 화면과 `/developer/voices`를 함께 엽니다. 키나 암호 값은 화면에 출력하지 않습니다.

음성과 실제 Hue 조명을 함께 확인하려면 `start_program.bat`를 실행합니다. 음성을 기다리거나 사용자가 말할 때는 현자의 기본 색상, 답변을 준비하거나 현자가 말할 때는 감정 색상 흐름으로 전환됩니다. 답변이 끝나면 현자의 듣기 색상으로 돌아오고, 음성 세션 종료나 조명 효과 OFF에서 세션 시작 전 상태로 복원됩니다.

GPT Live 음성 세션에서는 마이크와 재생 음량에 따라 프로필의 최소·최대 밝기 범위에서 촛불처럼 변화합니다. 무음에는 낮은 밝기로 흔들리고, 말소리가 커질수록 밝아집니다. 출력 음성이 재생되면 그 음량을 우선 사용하며 음소거한 마이크는 반영하지 않습니다. 현장 Companion에 전달하는 값은 음량 숫자뿐입니다. 갱신은 최대 약 초당 5회이며 오래된 표본은 버립니다. 수동 전구 제어는 해당 자동 효과를 중지합니다.

`/developer/lights`의 **현자별 대화 조명 프로필**에서 기본 색상, 최소·최대 밝기, 음량 반응 강도, 촛불 흔들림, 색상 순환 주기(3–30초)를 저장합니다. 듣기에는 현자의 기본 색상을 사용하고 답변에는 기본 색상과 감정 팔레트를 설정 비중으로 혼합합니다. 감정별 세 색상은 부드럽게 보간하며 마지막에서 처음으로 반복됩니다. 프로필은 현장 Hue 설정 파일에 함께 저장되고 현재 효과에 재시작 없이 적용됩니다. 기존 설정은 현자별 기본 프로필로 자동 보완됩니다. **저장·색상 흐름 미리보기**는 편집 내용을 저장한 후 8초 동안 재생하고 원래 상태를 복원합니다.

`/developer/prompts`에서는 공통 시스템 지침, 현자별 성격·기본 말투, 텍스트 답변·근거·감정 태그·선택지 지침, GPT Live·미리 듣기·인식 방식·응답 대기 지침을 편집합니다. 선택된 목소리는 유지되며, 음성 설정 탭의 말투 지침도 함께 사용됩니다. 저장 시 호칭을 ‘현자’로 통일합니다. **전체 프롬프트 저장**은 Supabase에 버전과 함께 저장하며 다음 텍스트 답변과 새 음성 세션부터 적용됩니다. 동시에 다른 창에서 수정한 경우 덮어쓰지 않고 재조회 안내를 표시합니다. **기본값을 편집기에 불러오기**는 저장 전까지 실제 설정을 변경하지 않습니다. 구조화된 응답 검증, 인증, 검색 근거 검증과 안전 검사는 서버에서 계속 수행합니다.

웹은 기본적으로 `http://localhost:8787`의 Worker를 사용합니다. 다른 주소가 필요하면 빌드 전에 `VITE_WORKER_URL`을 설정합니다.

## RAG 검수 절차

1. 원본 PDF를 `DB/`에 보관합니다.
2. `npm run process:interview-db`로 정규화 청크를 생성합니다.
3. `.local/candidate/dream-mentor.chunks.json`의 인물, 에이전트, 페이지, 태그와 내용을 검수합니다. 각 PDF와 역할은 `packages/rag/sources.json`에 명시합니다.
4. 각 청크의 `reviewStatus`를 지정합니다.
   - `verified`: 원 출처까지 확인되어 답변 근거로 사용 가능
   - `needs_review`: 검색에는 쓰되 직접 인용이나 확정적 경험담에는 사용하지 않음
   - `excluded`: 검색과 프롬프트에서 완전히 제외
5. `npm run upload:vector-store`로 네 PDF를 기존 하나의 OpenAI Vector Store에 업로드합니다. 동일 버전·해시의 완료 파일은 건너뜁니다. 네 파일 모두 인덱싱이 완료된 뒤 로컬 활성 묶음을 원자적으로 교체하고, Supabase 초기화에서 원격 활성 버전을 적용합니다. 이전 첨부는 보존하되 `agent_id`·`db_version` 필터로 검색에서 제외합니다.
6. 대표 질문으로 검색 결과, `evidenceIds`, 최종 citation을 확인합니다.

`direct_quote` 표기만으로 원문이 검증된 것으로 간주하지 않습니다. `sourceTitle`, `sourceUrl`, `verifiedAt`까지 확인해야 `verified`로 승격합니다.

현재 자동 추출 결과는 총 257개 청크입니다. 기존 검수 내용은 역할·인물·내용이 동일한 경우에만 승계합니다.

| agentId | 인물 | 청크 |
| --- | ---: | ---: |
| `pathfinder` | 5명 | 41 |
| `creator` | 7명 | 107 |
| `thinker` | 7명 | 74 |
| `connector` (용기있는 사람) | 5명 | 35 |

Worker는 로컬 검색 전에 `agentIds`를 필터링하고, Vector Store 결과도 해당 역할의 로컬 청크와 일치할 때만 병합합니다. 따라서 다른 현자의 인물이 citation에 섞이지 않습니다.

## API Contract

`POST /api/chat`

```json
{
  "agentId": "pathfinder",
  "sessionId": "browser-session-id",
  "messages": [
    { "role": "user", "content": "곧 졸업인데 무엇을 준비해야 할까요?" }
  ]
}
```

응답은 호환용 `message`와 신규 `scene`을 함께 반환합니다. `scene`에는 대화문, 감정·초상화 상태, 선택지 3개가 포함됩니다. 사용된 `evidenceIds`는 Worker가 실제 검색 결과와 대조한 뒤 citation으로 확정합니다.

### 실시간 음성

대화 화면에서 `음성 대화 시작`을 누르면 브라우저가 마이크 권한을 요청하고 GPT-Live와 WebRTC로 연결됩니다. 현자의 실제 답변은 기존 `/api/chat`에 client delegation하므로 텍스트 대화와 동일한 RAG·안전 검사·감정 태그를 사용합니다. 기본은 자연스러운 연속 대화이며 `현자님` 호출 방식과 누르는 동안 말하기도 선택할 수 있습니다.

음성은 API로 실시간 전송되지만 녹음 파일로 저장하지 않습니다. 텍스트 자막과 대화 기록만 기존 세션에 저장됩니다. 현자별 voice와 말하기 지침은 `/developer/voices`에서 변경하며 변경 내용은 새 음성 세션부터 적용됩니다.

## Safety

입력 검사, 시스템 정책, 출력 검사, 안전 대체 응답의 네 단계를 적용합니다. 자해·학대·의료·법률 등 고위험 질문에서는 인물형 회고를 멈추고 안전한 안내로 전환합니다. 교육 환경에 맞지 않는 성적·폭력적·차별적 표현은 차단하거나 중립적으로 전환합니다.

이 서비스는 교육적 성찰을 돕는 도구이며 전문 의료·법률·위기 상담을 대신하지 않습니다.

## Test

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

테스트는 구조화 응답 정규화, 선택지 보정, 제외 청크 필터, 로컬·Vector Store 검색 병합과 음성 API의 Origin 차단, 기능 플래그, 관리자 쿠키, 장기 API 키 비노출 계약을 포함합니다. `test:e2e`는 로컬 웹과 Worker가 실행 중일 때 데스크톱·모바일 화면, 실제 응답, 선택지, 출처 서랍과 세션 복구를 검사합니다.

## Deploy

현재 공개 서비스: [https://nextgenagent-worker.jsindustriests.workers.dev](https://nextgenagent-worker.jsindustriests.workers.dev)

연결된 Supabase 프로젝트는 `NextGenAgent` (`wfyghzowxusawsztprqh`, 서울 리전)입니다.

Supabase 프로젝트를 CLI로 연결하고 DB와 Edge Function을 먼저 배포합니다.

```powershell
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
npx supabase secrets set --env-file supabase/.env
npx supabase functions deploy session-api
npx supabase functions deploy openai-proxy
npx supabase functions deploy voice-profile-api
```

Cloudflare Worker에는 Supabase Function URL과 양쪽이 공유하는 프록시 Secret을 설정합니다. 음성 관리자 패널을 위해 `VOICE_ADMIN_PASSWORD`, `VOICE_ADMIN_SESSION_SECRET`도 Wrangler Secret으로 등록한 뒤 `npm run deploy`를 실행합니다. 자세한 시연·배포·장애 대응 절차는 [시연 및 운영 매뉴얼](docs/DEMO_MANUAL.md)에 정리되어 있습니다.

GitHub Pages는 정적 프론트 대안으로만 지원합니다. 이 경우 `VITE_WORKER_URL`을 공개 Worker 주소로 지정하고, Worker의 `ALLOWED_ORIGIN`에 GitHub Pages Origin을 설정해야 합니다.

## Visual Assets

`apps/web/public/assets`의 네 현자는 얼굴·연령·인종을 특정하지 않는 익명 실루엣 일러스트입니다. 역할별로 길, 창작 매체, 사유의 원, 사람과 도구의 연결을 상징하는 형태와 보조색만 다르게 사용합니다. 현재는 정적 자산으로 배포되며 실시간 대화 중에는 이미지 모델을 호출하지 않습니다.
