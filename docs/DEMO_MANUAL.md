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

프로젝트 루트의 `start_program.bat`를 실행합니다. 실행 환경, 패키지, 네 PDF의 벡터 동기화, Supabase 초기화와 로컬 서버를 순서대로 준비합니다. 최초 실행에서 안내된 `.dev.vars`의 OpenAI 키·Supabase 프로젝트 ID·관리 토큰·DB 암호를 입력하고 다시 실행합니다. 개발자 암호는 `VOICE_ADMIN_PASSWORD`에 있습니다.

음성 기능을 집중적으로 확인할 때는 `start-voice-test.bat`를 더블클릭합니다. 실행기는 실제 키 값을 출력하지 않고 `OPENAI_API_KEY`, `VOICE_ENABLED`, 관리자 암호와 서명 Secret의 설정 여부만 검사합니다. 검사가 끝나면 대화 화면과 `/developer/voices`가 함께 열립니다.

기본 실행은 음성과 Hue를 함께 지원하며 `http://127.0.0.1:4173`과 `/developer`를 엽니다. `-Mode Web`은 자동 Hue 효과 없이 실행합니다. `start-test-web.bat`, `start-voice-test.bat`, `setup-hue.bat`는 통합 실행기의 호환 호출입니다.

```powershell
./start_program.bat -Check            # 읽기 전용 진단
./start_program.bat -Stop             # 이 실행기가 시작한 서버만 종료
./start_program.bat -SyncDb           # 추출·인덱싱 재확인
./start_program.bat -RedeploySupabase # 원격 배포 강제 재확인
./start_program.bat -RegisterHue      # 개발자 조명 탭 열기
```

서버는 숨김으로 실행하며 `logs/worker.err.log`, `logs/companion.err.log`에서 실패 원인을 확인합니다. 다른 프로그램이 포트를 점유하면 종료하지 않습니다. 재실행 시 코드 버전이 다르면 이전 서버를 `-Stop`으로 종료하세요. 자격 증명 값은 로그에 출력하지 않습니다.

- 배포 주소를 노트북과 모바일 데이터 환경에서 각각 한 번 엽니다.
- 새 ID로 대화를 시작하고 질문을 한 번 보냅니다.
- 시크릿 창 또는 다른 기기에서 같은 ID를 입력해 대화가 복구되는지 확인합니다.
- 네 명의 선배 카드가 모두 활성화되어 있는지 확인합니다.
- `이 답변의 바탕` 서랍에 근거 문단이 표시되는지 확인합니다.
- 시연용 ID는 짧고 추측하기 어려운 값으로 미리 정합니다. 예: `dream-8k27`.

## Philips Hue 피지컬 인터랙션

Hue 연동은 Bridge와 같은 로컬 네트워크에 있는 현장 PC에서만 동작합니다. 공개 배포 주소를 직접 열면 대화는 정상 동작하지만 전구는 제어하지 않습니다.

최초 한 번 다음 명령을 실행합니다.

Windows에서는 `setup-hue.bat` 또는 `start_program.bat -RegisterHue`로 개발자 조명 탭을 엽니다. 로그인 후 Bridge를 검색하거나 IP를 입력하고, 연결·버튼 인증을 누른 뒤 45초 안에 Bridge의 링크 버튼을 누릅니다. 위치 식별로 실제 전구를 확인하고 네 선배에 서로 다른 컬러 전구를 지정해 저장합니다. 기존 CLI 등록은 아래 명령으로도 사용할 수 있습니다.

```powershell
npm run hue:setup
```

1. 검색된 Hue Bridge를 선택합니다. 자동 검색이 실패하면 Hue 앱에 표시되는 Bridge 로컬 IP를 입력합니다.
2. 안내가 나오면 Bridge 가운데의 링크 버튼만 누릅니다. 설치 프로그램이 1초 간격으로 버튼 입력을 감지해 자동으로 다음 단계로 넘어갑니다.
3. 검색된 컬러 전구 중 서로 다른 네 개를 네 명의 선배에 지정합니다.
4. 지정할 때 해당 전구가 노란색으로 잠시 켜졌다가 이전 상태로 복원되는지 확인합니다.

설정에는 Bridge application key가 포함되며 `apps/hue-companion/.local/config.json`에 저장됩니다. 이 경로는 Git에서 제외되어 있습니다. 설정 파일을 공유하거나 커밋하지 않습니다.

현장 시연은 다음 명령으로 시작하고 출력된 `http://127.0.0.1:4173` 주소를 이 PC에서 엽니다.

```powershell
npm run demo:hue
```

개발자 조명 탭은 Bridge·전구 연결 상태, 현재 밝기·색상, 진행 중인 효과와 최근 오류를 3초 간격으로 확인합니다. 수동 ON/OFF·밝기·색상 적용은 해당 전구의 자동 효과를 중지합니다. 전구별 또는 전체 `정지·복원`으로 조작 전 상태를 복원합니다. 조명 설정은 재시작 없이 적용되며, 연결되지 않은 전구의 기존 지정도 확인할 수 있습니다. 영구 제어 이력은 저장하지 않습니다.

화면 오른쪽 아래 상태는 다음 의미입니다.

- `조명 연결됨`: Bridge와 지정된 전구에 접근 가능
- `조명 오프라인`: Bridge 또는 전구에 접근할 수 없지만 텍스트 대화는 계속 가능
- `조명 효과 꺼짐`: 사용자가 조명 토글을 끈 상태

텍스트 응답은 효과가 끝나면 직전 상태로 복원합니다. 음성 대화에서는 듣기·생각하기·답변 단계 사이를 원래 상태로 되돌아가지 않고 부드럽게 전환하며, 답변 종료 후 마지막 감정 색을 유지합니다. 음성 세션 종료, 조명 효과 OFF, 프로그램 정상 종료 시에는 세션 시작 전 상태로 복원을 시도합니다.

빠른 스트로브는 사용하지 않지만 빛 변화에 민감한 사용자는 불편함, 두통 또는 어지러움을 느낄 수 있습니다. 불편함이 생기면 즉시 화면의 스마트 조명 토글을 끄고 조명 효과 사용을 중단합니다.

시연 전에는 네 전구의 전원이 켜져 있는지 확인하고, 각 선배에게 한 번씩 질문해 올바른 전구가 반응하는지 확인합니다. 실제 장비 최종 점검에서는 20회 연속 응답과 꺼져 있던 전구의 상태 복원도 확인합니다.

## 저장 방식

- 1순위: 브라우저 `localStorage`
- 2순위: 참여 ID로 찾는 Supabase 세션
- 브라우저에 정상 기록이 있으면 로그인 화면을 표시하지 않습니다.
- 로컬 기록이 없거나 손상된 경우에만 참여 ID 입력 화면을 표시합니다.
- 서버에는 참여 ID 원문 대신 SHA-256 해시만 저장합니다.
- 로그인 계정이 아니므로 여러 기기에서 동시에 수정하면 마지막 저장 내용이 우선합니다.

## Supabase 최초 연결

통합 실행기는 `.dev.vars`의 `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`로 연결하고 미적용 마이그레이션, 함수 비밀 설정, `session-api`, `openai-proxy`, `voice-profile-api`를 배포합니다. 변경이 없으면 배포를 생략하고 연결만 검증합니다. 진단용 `diag-<project-ref>` 참여 ID에 빈 세션을 저장·조회하고 음성 프로필과 벡터 프록시도 확인합니다.

`OPENAI_API_KEY`, `OPENAI_VECTOR_STORE_ID`, `OPENAI_DB_VERSION`, `NEXTGEN_PROXY_SECRET`만 함수 비밀값으로 전송합니다. Supabase 관리 토큰·DB 암호는 Worker와 브라우저에 전달하지 않습니다. 새 자료 버전의 공개 서비스 적용은 별도의 Cloudflare 배포가 필요합니다. 이전 공개 Worker의 필터 없는 검색은 보존된 예전 자료(`source=dream-mentor-db`)만 검색하는 호환 경로를 사용합니다. 새 Worker를 배포하면 선배·자료 버전 필터로 새 자료를 검색합니다.

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
npx supabase functions deploy voice-profile-api
```

## 실시간 음성 대화

음성 대화는 Chrome 또는 Edge의 최신 버전에서 HTTPS 배포 주소나 localhost로 접속해 테스트합니다. 대화 화면에서 `음성 대화 시작`을 누르고 마이크 권한을 허용합니다.

1. `음성 연결됨`이 표시되면 자연스럽게 말합니다.
2. 사용자 자막이 나타나고 기존 현자 답변이 화면과 합성 음성으로 한 번씩 출력되는지 확인합니다.
3. 음성을 기다리거나 사용자가 말할 때 따뜻한 듣기 조명으로 바뀌는지 확인합니다.
4. 답변을 준비하는 동안 보라색 호흡 조명으로 바뀌는지 확인합니다.
5. 현자가 말할 때 감정 태그 색으로 바뀌고, 답변이 끝난 뒤에도 그 색을 유지하는지 확인합니다.
6. 현자의 말에 끼어들면 듣기 조명으로 전환되고, 음성 세션을 종료하면 세션 시작 전 상태로 복원되는지 확인합니다.
7. `현자님 호출`에서는 “현자님, 진로가 고민돼요”처럼 말하고, 접두사가 없는 주변 대화에는 답하지 않는지 확인합니다.
8. `누르는 동안 말하기`에서는 화면 버튼 또는 Space 키를 누른 동안만 말합니다.

원본 음성은 저장하지 않으며 자막과 텍스트 대화만 세션에 남습니다. 음성 연결이 실패해도 텍스트 입력은 계속 사용할 수 있습니다.

현자별 음성은 `/developer/voices`에서 조절합니다. Worker에 다음 Secret을 등록해야 합니다.

```powershell
cd apps/worker
npx wrangler secret put VOICE_ADMIN_PASSWORD
npx wrangler secret put VOICE_ADMIN_SESSION_SECRET
```

관리자 패널에서 voice, 모델, 말하기 지침, 기본 인식 방식, 응답 민감도를 수정하고 미리 듣기 후 저장합니다. 설정 변경은 이미 재생 중인 세션을 바꾸지 않으며 새 음성 세션부터 적용됩니다. 사용자가 듣는 목소리는 AI 합성 음성임을 현장에서 안내합니다.

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

Hue 시연을 포함한다면 추가로 `npm run hue:setup` 설정이 존재하는지 확인하고 `npm run demo:hue` 실행 후 상태가 `조명 연결됨`인지 확인합니다.

배포 주소의 `/api/health`에서 `ok: true`, `supabaseProxy: true`를 확인합니다.
# 현자 프롬프트 편집

개발자 로그인 후 `/developer/prompts` 또는 **프롬프트** 탭을 엽니다. 네 현자의 현재 목소리를 확인하고 **성격·대화 방식**, **목소리에 맞춘 기본 말투**를 편집합니다. 공통 시스템 프롬프트 아래 펼침 영역에서 답변, GPT Live, 미리 듣기, 인식 방식과 응답 대기 지침도 수정할 수 있습니다.

**전체 프롬프트 저장** 후 다음 텍스트 답변부터 적용됩니다. 음성 대화는 종료하고 다시 시작해야 새 지침이 적용됩니다. 설정은 Supabase에 저장되며 재실행 후 유지됩니다. 저장 충돌 안내가 나오면 편집 내용을 복사해 둔 뒤 **저장된 프롬프트 다시 불러오기**를 누릅니다. 기본값 버튼은 편집기만 변경하므로 저장 전까지 실제 대화는 바뀌지 않습니다.

