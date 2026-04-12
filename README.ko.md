# codex-exec-remote

> **터미널에서 Codex app-server 세션에 명령을 보내세요.**
>
> 기본 `codex exec`는 실행 중인 `codex app-server`에 연결할 수 없습니다. 이 도구는 됩니다.

- [Releases](https://github.com/professional-ALFIE/codex-exec-remote/releases)
- [English](./README.md)

> ⚠️ **풀 권한 모드.** `codex-exec-remote`는 모든 서버 요청(명령 실행, 파일 변경 등)을 자동 승인합니다 — `codex --dangerously-bypass-approvals-and-sandbox exec --skip-git-repo-check`와 동일합니다. 같은 수준의 주의가 필요합니다.

## 빠른 시작

### 원라이너 설치

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/codex-exec-remote/master/install.sh | bash
```

### 첫 실행

```bash
# 1. app-server 시작 (codex-exec-remote가 자동으로 실행)
codex-exec-remote

# 2. 다른 터미널에서 프롬프트 전송
codex-exec-remote start "hello"
```

---

## 왜 필요한가요?

### `codex exec`는 app-server를 지원하지 않습니다

`codex exec`는 로컬에서 일회성 프롬프트를 실행합니다. 실행 중인 `codex app-server`에 **연결할 수 없습니다** — 원격 연결 없음, 멀티 클라이언트 동기화 없음.

`codex-exec-remote`가 그 빈틈을 채웁니다:

| | `codex exec` | `codex-exec-remote` |
|---|---|---|
| 원격 app-server 연결 | ✗ | ✓ |
| 원격 thread 이어쓰기 | ✗ | ✓ (`resume`) |
| 서버에 새 thread 생성 | ✗ | ✓ (`start`) |
| 멀티 클라이언트 세션 동기화 | ✗ | ✓ |
| app-server 실행 | ✗ | ✓ (기본 모드) |
| ThreadEvent JSONL 출력 | ✓ | ✓ (`--json`) |

### 다른 에이전트에서 사용

Claude Code, Antigravity, 또는 아무 CLI 에이전트에서 작업 중일 때:

```bash
codex-exec-remote start "이 모듈 리팩토링해"
codex-exec-remote resume --last "이어서"
```

메인 에이전트는 본 작업에 집중하고, **Codex가 app-server를 통해 서브 작업을 처리합니다.**

---

## 뭘 하는 건가요?

| 명령 | 효과 |
|------|------|
| `codex-exec-remote` | 풀 권한 모드로 app-server **실행** (`ws://127.0.0.1:4501`) |
| `codex-exec-remote start "hello"` | 서버에 **새 thread** 생성, turn 전송, 응답 출력 |
| `codex-exec-remote resume <id> "hello"` | 기존 thread **이어쓰기** |
| `codex-exec-remote resume --last "hello"` | 가장 최근 thread **이어쓰기** |

---

## 설치

### 원라이너

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/codex-exec-remote/master/install.sh | bash
```

하는 일:
- `~/.codex-exec-remote/source` 아래에 레포를 clone 또는 업데이트
- `bun install`로 의존성 설치
- `bun build --compile`로 단일 바이너리 컴파일
- 컴파일된 바이너리를 `~/.codex-exec-remote/runtime` 아래에 복사
- 기본 noninteractive `bash -c` `PATH`에 들어 있는 첫 writable 절대경로 디렉터리(보통 `/usr/local/bin`)에 `codex-exec-remote`와 `cer` launcher 설치. `.`나 `./bin` 같은 relative PATH 엔트리는 자동 선택에서 제외
- 현재 `codex` 절대경로를 `CODEX_EXEC_REMOTE_DEFAULT_CODEX_BIN`으로 기록해서 clean shell에서도 plain `cer`가 `codex app-server`를 실행할 수 있게 구성
- `env -i HOME="$HOME" /bin/bash -c` 안에서 `cer --help`와 `codex-exec-remote --help`를 검증하고, 기록된 `codex` 바이너리로 `app-server --help`가 실행되는지도 확인

**필수:** macOS 또는 Linux, [Codex CLI](https://github.com/openai/codex) 설치, Git, [Bun](https://bun.sh)

> **업데이트?** 같은 명령을 다시 실행하면 됩니다.
>
> **launcher 디렉터리를 직접 고르고 싶다면?** 설치 전에 `CODEX_EXEC_REMOTE_BIN_DIR=/path`를 지정하세요. 그 디렉터리가 기본 noninteractive `PATH`에 없으면 installer는 interactive shell용 profile 업데이트로만 fallback합니다.
>
> **나중에 기본 codex 경로를 바꾸고 싶다면?** 실행할 때 `CODEX_EXEC_REMOTE_DEFAULT_CODEX_BIN=/absolute/path/to/codex`를 지정하면 installer가 기록한 기본값을 덮어쓸 수 있습니다.

### Bun 글로벌 설치

```bash
bun install -g codex-exec-remote
```

> 실행 시 [Bun](https://bun.sh) 런타임이 필요합니다.

### 수동 설치

```bash
git clone https://github.com/professional-ALFIE/codex-exec-remote.git ~/.codex-exec-remote/source
cd ~/.codex-exec-remote/source
bun install --frozen-lockfile || bun install
bun run build

CODEX_BIN="$(command -v codex)"
NODE_BIN_DIR="$(dirname "$(command -v node)")"
CODEX_BIN_DIR="$(dirname "$CODEX_BIN")"

mkdir -p ~/.codex-exec-remote/runtime /usr/local/bin
cp codex-exec-remote ~/.codex-exec-remote/runtime/codex-exec-remote

cat > /usr/local/bin/codex-exec-remote <<EOF
#!/bin/sh
set -eu
PATH='$NODE_BIN_DIR:$CODEX_BIN_DIR':\$PATH
export PATH
: \${CODEX_EXEC_REMOTE_DEFAULT_CODEX_BIN:='$CODEX_BIN'}
export CODEX_EXEC_REMOTE_DEFAULT_CODEX_BIN
exec '$HOME/.codex-exec-remote/runtime/codex-exec-remote' "\$@"
EOF

chmod +x /usr/local/bin/codex-exec-remote
ln -sfn codex-exec-remote /usr/local/bin/cer
```

환경에 따라 `/usr/local/bin` 대신 clean noninteractive `PATH` 안의 writable 절대경로 디렉터리를 사용하세요. `.`나 `./bin` 같은 relative PATH 엔트리는 자동 launcher 설치 대상으로 보지 않습니다.

clean noninteractive shell에서도 launcher가 보이는지 확인:

```bash
env -i HOME="$HOME" /bin/bash -c 'PATH="/usr/local/bin:/bin:/usr/bin"; cer --help >/dev/null && codex-exec-remote --help >/dev/null'
```

installer는 같은 clean shell 안에서 기록된 `codex` 바이너리가 `app-server --help`를 실행할 수 있는지도 함께 확인합니다.

---

## 사용법

> `cer`는 `codex-exec-remote`의 단축 alias입니다. 둘 다 동일하게 동작합니다.

```bash
# app-server 실행 (기본 ws://127.0.0.1:4501)
codex-exec-remote            # 또는: cer

# app-server 실행 (주소 지정)
codex-exec-remote --listen ws://127.0.0.1:9999  # 또는: cer --listen ws://127.0.0.1:9999

# 새 thread 생성
codex-exec-remote start "hello"           # 또는: cer start "hello"

# 기존 thread에 turn 추가
codex-exec-remote resume <thread-id> "hello"

# 가장 최근 thread에 turn 추가
codex-exec-remote resume --last "hello"   # 또는: cer resume -l "hello"

# JSON 출력 (ThreadEvent JSONL → stdout)
codex-exec-remote start "hello" --json    # 또는: cer start "hello" -j
```

---

## 옵션

### Serve 모드

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--listen <url>` | `ws://127.0.0.1:4501` | `codex app-server` 주소 |
| `--codex-bin <path>` | `codex` | codex 바이너리 경로 |

### Start / Resume (공통)

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--remote <url>` | `ws://127.0.0.1:4501` | 연결할 app-server 주소 |
| `--auth-token-env <VAR>` | _(없음)_ | 환경변수에서 Bearer token 읽기 |
| `-j`, `--json` | `false` | ThreadEvent JSONL을 stdout에 출력 |
| `--timeout <sec>` | `300` | 최대 대기 시간 (초) |
| `--codex-bin <path>` | `codex` | codex 바이너리 경로 |

---

## 작동 원리

```
┌─────────────────────────────────────────────────────┐
│                 codex-exec-remote                    │
│                                                     │
│  argv → parseArgs → WebSocket 연결                   │
│  → initialize 핸드셰이크                              │
│  → thread/start 또는 thread/resume                   │
│  → turn/start → 이벤트 루프 (notifications)           │
│  → thread/read (canonical 출력) → stdout             │
└──────────────────────┬──────────────────────────────┘
                       │ JSON-RPC 2.0 over WebSocket
                       ▼
┌─────────────────────────────────────────────────────┐
│              codex app-server                        │
│              (ws://127.0.0.1:4501)                   │
└─────────────────────────────────────────────────────┘
```

1. WebSocket으로 `codex app-server`에 연결 (선택적 `Authorization` 헤더)
2. JSON-RPC `initialize` / `initialized` 핸드셰이크 수행
3. thread를 생성하거나 이어쓰기한 뒤, 사용자 프롬프트로 turn 시작
4. `item/agentMessage/delta` notification을 stderr로 스트리밍 (human 모드)
5. `turn/completed` 시 `thread/read(includeTurns=true)`로 canonical assistant 응답 조회
6. 최종 응답을 stdout에 출력하고 적절한 종료 코드로 종료

**비대화형, 풀 권한.** 모든 서버 요청(명령 실행, 파일 변경)은 자동 승인됩니다.

---

## 참고

- 기본 모드(서브커맨드 없음)는 `codex app-server`를 실행합니다.
- `start`는 `thread/start`로 새 thread를 만든 뒤 turn을 보냅니다.
- `resume --last`는 `thread/list`에서 `updated_at` 기준으로 가장 최근 thread를 찾습니다.
- `thread/read(includeTurns=true)`가 최종 assistant 출력의 canonical source입니다.
- 모든 서버 요청(명령 실행, 파일 변경, 승인)은 **자동 승인**됩니다 — `codex --dangerously-bypass-approvals-and-sandbox exec --skip-git-repo-check`와 동일합니다.
- JSON 모드는 `codex exec --json` 호환 ThreadEvent JSONL을 출력합니다 (`thread.started`, `turn.started`, `item.started`, `item.completed`, `turn.completed` 등).

---

## Contributors

이 프로젝트는 AI 에이전트와 함께 만들었습니다.

| | 역할 |
|---|------|
| **[professional-ALFIE](https://github.com/professional-ALFIE)** | 설계, 디렉션, 검증 |
| **[Antigravity](https://antigravity.google)** | 구현, 아키텍처 |
| **[Codex](https://openai.com/codex)** | 구현, 코드 리뷰 |

---

## 라이선스

MIT
