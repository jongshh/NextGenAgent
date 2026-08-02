# NextGenAgent

사용자 노출명은 **AI 선배와의 만남**입니다. 실존 인물의 인터뷰와 기록에서 검수된 경험 패턴을 찾아, 특정 인물을 사칭하지 않는 새로운 AI 선배의 대화로 재구성하는 교육·상담 프로젝트입니다.

MVP에서는 네 명의 선배 중 `길을 찾는 사람`만 활성화합니다.

| 선배 | 질문 | 상태 |
| --- | --- | --- |
| 길을 찾는 사람 | 나는 무엇을 선택해야 할까? | MVP |
| 창작하는 사람 | 계속 창작할 수 있을까? | 준비 중 |
| 생각하는 사람 | 어떻게 살아야 할까? | 준비 중 |
| 연결하는 사람 | 사람과 기술은 어떻게 연결되는가? | 준비 중 |

## 사용자 경험

- 4명의 AI 선배를 만나는 선택 허브
- 교육 공간을 배경으로 한 비주얼 노벨형 1:1 대화
- 타자 효과와 클릭 즉시 표시
- 모델이 생성하는 자연스러운 후속 선택지 3개와 자유 입력
- `Enter` 전송, `Shift+Enter` 줄바꿈, 한글 조합 중 전송 방지
- 브라우저 세션 저장, 대화 불러오기, 초기화, 실패한 질문 재시도
- 출처를 상시 노출하지 않고 `이 답변의 바탕` 서랍에서 확인

## Architecture

```text
apps/web                 React + Vite + Framer Motion
  └─ Cloudflare Static Assets
          │ /api/*
apps/worker              Cloudflare Worker
  ├─ input moderation
  ├─ local keyword search
  ├─ OpenAI Vector Store search
  ├─ Responses API structured output
  ├─ evidence ID validation
  └─ output moderation

packages/agents          4개 선배 설정과 공통 상담 정책
packages/rag             정규화 스키마, 로컬 검색, 검색 결과 병합
data/processed           PDF에서 추출한 검수용 JSON
DB                       원본 자료
Storygator               참고 자료이며 빌드에는 포함되지 않음
```

프로덕션은 Worker Static Assets를 사용해 웹 앱과 API를 한 도메인에서 제공합니다. 브라우저 번들에는 OpenAI 키나 Vector Store ID가 포함되지 않습니다.

## Storygator에서 가져온 것

- 한 장면씩 이어지는 인터랙티브 대화 구성
- 타자 효과, 후속 대화 선택지, 자연어 자유 입력
- 구조화 응답과 파싱 실패 시 대체 장면
- 세션 복구와 절제된 화면 전환
- `framer-motion`, `lucide-react` 기반 UI

세계관·캐릭터 생성, 전투와 상태 수치, 음성·BGM, 로컬 모델, 성인 모드, 게임 전용 메모리 시스템은 가져오지 않았습니다.

## Local Setup

Node.js 20 이상과 Python 3이 필요합니다.

```powershell
npm install
npm run process:interview-db
```

`apps/worker/.dev.vars.example`을 참고해 `apps/worker/.dev.vars`를 만듭니다.

```env
OPENAI_API_KEY=sk-...
OPENAI_VECTOR_STORE_ID=vs_...
OPENAI_MODEL=gpt-5.5
OPENAI_MODERATION_MODEL=omni-moderation-latest
ALLOWED_ORIGIN=http://localhost:5173
```

두 터미널에서 실행합니다.

```powershell
npm run dev:worker
npm run dev:web
```

- Web: `http://localhost:5173`
- Worker API: `http://localhost:8787`
- Health check: `http://localhost:8787/api/health`

웹은 기본적으로 `http://localhost:8787`의 Worker를 사용합니다. 다른 주소가 필요하면 빌드 전에 `VITE_WORKER_URL`을 설정합니다.

## RAG 검수 절차

1. 원본 PDF를 `DB/`에 보관합니다.
2. `npm run process:interview-db`로 정규화 청크를 생성합니다.
3. `data/processed/interview-db1.chunks.json`의 인물, 페이지, 태그와 내용을 검수합니다.
4. 각 청크의 `reviewStatus`를 지정합니다.
   - `verified`: 원 출처까지 확인되어 답변 근거로 사용 가능
   - `needs_review`: 검색에는 쓰되 직접 인용이나 확정적 경험담에는 사용하지 않음
   - `excluded`: 검색과 프롬프트에서 완전히 제외
5. 검수한 자료를 OpenAI Vector Store에 업로드합니다.
6. 대표 질문으로 검색 결과, `evidenceIds`, 최종 citation을 확인합니다.

`direct_quote` 표기만으로 원문이 검증된 것으로 간주하지 않습니다. `sourceTitle`, `sourceUrl`, `verifiedAt`까지 확인해야 `verified`로 승격합니다.

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

테스트는 구조화 응답 정규화, 선택지 보정, 제외 청크 필터, 로컬·Vector Store 검색 병합을 포함합니다. `test:e2e`는 로컬 웹과 Worker가 실행 중일 때 데스크톱·모바일 화면, 실제 응답, 선택지, 출처 서랍과 세션 복구를 검사합니다.

## Deploy

Cloudflare 로그인 후 Worker secret을 설정합니다.

```powershell
cd apps/worker
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_VECTOR_STORE_ID
cd ../..
npm run deploy
```

`OPENAI_MODEL`, `OPENAI_MODERATION_MODEL`, `ALLOWED_ORIGIN`은 Cloudflare 환경 변수로 설정할 수 있습니다. 별도 프론트 도메인에서 Worker를 호출할 때는 `ALLOWED_ORIGIN`을 그 배포 도메인으로 제한합니다.

GitHub Pages는 정적 프론트 대안으로만 지원합니다. 이 경우 `VITE_WORKER_URL`을 공개 Worker 주소로 지정하고, Worker의 `ALLOWED_ORIGIN`에 GitHub Pages Origin을 설정해야 합니다.

## Visual Assets

`apps/web/public/assets`의 배경과 초상화는 특정 실존 인물을 복제하지 않는 독자적 캐릭터입니다. 현재는 정적 자산으로 배포되며, 실시간 대화 중에는 이미지 모델을 호출하지 않습니다.
