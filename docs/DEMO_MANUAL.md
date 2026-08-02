# NextGenAgent 시연 및 운영 매뉴얼

공개 시연 주소: [https://nextgenagent-worker.jsindustriests.workers.dev](https://nextgenagent-worker.jsindustriests.workers.dev)

Supabase 프로젝트: `NextGenAgent` (`wfyghzowxusawsztprqh`, 서울 리전)

## 참여자 사용법

1. 배포된 주소를 모바일 또는 노트북 브라우저에서 엽니다.
2. 이 브라우저에 대화 기록이 있으면 마지막 대화가 바로 열립니다.
3. 기록이 없는 새 기기에서는 `참여 ID`를 입력합니다.
4. 이전에 사용한 ID라면 저장된 대화를 불러오고, 처음 만든 ID라면 새 세션을 시작합니다.
5. 허브에서 `버전 A` 또는 `버전 B`를 선택합니다.
6. 네 명의 선배 중 한 명을 선택하고 선택지 또는 자유 입력으로 대화합니다.

선배의 답변은 실제 대화처럼 문장 단위로 차례로 나타납니다. 기다리지 않고 전체 답변을 보려면 대화 상자를 한 번 누릅니다.

- 버전 A: 초상화와 최신 답변에 집중하는 비주얼 노벨형 화면
- 버전 B: 선배는 왼쪽, 사용자는 오른쪽에 전체 기록이 쌓이는 DM형 화면
- 두 버전은 같은 대화 기록을 사용하므로 시연 중 자유롭게 비교할 수 있습니다.

참여 ID에는 이름, 학번, 전화번호, 이메일 등 개인정보를 사용하지 않습니다. 비밀번호가 없는 체험용 복구 방식이므로 ID를 아는 사람은 같은 기록을 열 수 있습니다.

## 시연 전 점검

- 배포 주소를 노트북과 모바일 데이터 환경에서 각각 한 번 엽니다.
- 새 ID로 대화를 시작하고 질문을 한 번 보냅니다.
- 시크릿 창 또는 다른 기기에서 같은 ID를 입력해 대화가 복구되는지 확인합니다.
- 네 명의 선배 카드가 모두 활성화되어 있는지 확인합니다.
- `이 답변의 바탕` 서랍에 근거 문단이 표시되는지 확인합니다.
- 시연용 ID는 짧고 추측하기 어려운 값으로 미리 정합니다. 예: `dream-8k27`.

## 저장 방식

- 1순위: 브라우저 `localStorage`
- 2순위: 참여 ID로 찾는 Supabase 세션
- 브라우저에 정상 기록이 있으면 로그인 화면을 표시하지 않습니다.
- 로컬 기록이 없거나 손상된 경우에만 참여 ID 입력 화면을 표시합니다.
- 서버에는 참여 ID 원문 대신 SHA-256 해시만 저장합니다.
- 로그인 계정이 아니므로 여러 기기에서 동시에 수정하면 마지막 저장 내용이 우선합니다.

## Supabase 최초 연결

전용 Supabase 프로젝트를 만든 뒤 프로젝트 루트에서 실행합니다.

```powershell
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

Supabase Dashboard의 Project Settings에서 프로젝트 URL을 확인합니다. Edge Function URL은 다음 형식입니다.

```text
https://<PROJECT_REF>.supabase.co/functions/v1
```

`supabase/.env` 파일을 만들고 아래 값을 넣습니다. 이 파일은 Git에서 제외됩니다.

```env
OPENAI_API_KEY=sk-...
OPENAI_VECTOR_STORE_ID=vs_...
NEXTGEN_PROXY_SECRET=<충분히 긴 임의 문자열>
```

그다음 Secret과 Edge Function을 배포합니다.

```powershell
npx supabase secrets set --env-file supabase/.env
npx supabase functions deploy session-api
npx supabase functions deploy openai-proxy
```

## Cloudflare 연결 및 배포

Cloudflare Worker에는 OpenAI 키를 넣지 않습니다. `apps/worker/wrangler.toml`의 `SUPABASE_FUNCTIONS_URL`을 확인하고 공유 Secret만 등록합니다.

```powershell
cd apps/worker
npx wrangler secret put NEXTGEN_PROXY_SECRET
cd ../..
npm run deploy
```

- `NEXTGEN_PROXY_SECRET`: Supabase에 설정한 값과 정확히 같아야 합니다.
- `SUPABASE_FUNCTIONS_URL`: 현재 `https://wfyghzowxusawsztprqh.supabase.co/functions/v1`
- 실제 배포 도메인이 정해지면 Worker의 `ALLOWED_ORIGIN`을 그 Origin으로 제한합니다.

## 문제 해결

### 참여 ID 입력 후 넘어가지 않음

브라우저 네트워크 연결과 `/api/session/load` 응답을 확인합니다. Supabase Function이 배포됐는지, Worker와 Supabase의 `NEXTGEN_PROXY_SECRET`이 같은지도 확인합니다.

### 대화 기록은 열리지만 답변이 오지 않음

Supabase의 `OPENAI_API_KEY`, `OPENAI_VECTOR_STORE_ID` Secret과 `openai-proxy` Function 로그를 확인합니다.

### 같은 ID인데 대화가 없음

첫 기기에서 질문을 최소 한 번 보낸 뒤 다른 기기에서 다시 접속합니다. 두 기기에서 동시에 대화를 수정하지 않습니다.

### 시연 직전 긴급 확인

```powershell
npm run typecheck
npm test
npm run build
```

배포 주소의 `/api/health`에서 `ok: true`, `supabaseProxy: true`를 확인합니다.
