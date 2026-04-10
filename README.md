# codex-exec-remote

기본 동작은 `codex app-server --listen ...` 런처입니다. `start`는 새 thread를 만든 뒤 첫 turn을 보내고, `resume`은 기존 thread에 non-interactive turn을 넣습니다.

## Usage

```bash
codex-exec-remote

codex-exec-remote --listen ws://127.0.0.1:4501

codex-exec-remote serve --listen ws://127.0.0.1:4501

codex-exec-remote start "<prompt>" \
  --remote ws://127.0.0.1:4501 \
  --auth-token-env CODEX_AUTH_TOKEN

codex-exec-remote resume <thread-id> "<prompt>" \
  --remote ws://127.0.0.1:4501 \
  --auth-token-env CODEX_AUTH_TOKEN

codex-exec-remote resume --last "<prompt>" \
  --remote ws://127.0.0.1:4501 \
  --auth-token-env CODEX_AUTH_TOKEN
```

## Development

```bash
bun install
bun test
bun run src/index.ts
bun run src/index.ts --listen ws://127.0.0.1:4501
bun run src/index.ts serve --listen ws://127.0.0.1:4501
bun run src/index.ts start "<prompt>" --remote ws://127.0.0.1:4501
bun run src/index.ts resume <thread-id> "<prompt>" --remote ws://127.0.0.1:4501
bun run src/index.ts resume --last "<prompt>" --remote ws://127.0.0.1:4501
```

## Notes

- 인자 없이 실행하면 `codex app-server --listen ws://127.0.0.1:4501`를 실행합니다.
- `--listen <url>`만 주면 `codex app-server --listen <url>`를 실행합니다.
- `serve`는 기본 실행과 같은 server launcher입니다.
- `start`는 `thread/start` 후 `turn/start`를 호출합니다.
- `resume --last`는 `thread/list`에서 가장 최근 thread를 찾은 뒤 `thread/resume`과 `turn/start`를 호출합니다.
- `thread/read(includeTurns=true)`를 사용해 최종 assistant 결과를 canonical source로 읽습니다.
- interactive server request를 받으면 reject 후 즉시 실패합니다.
