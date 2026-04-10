# codex-exec-remote

기본 동작은 `codex app-server --listen ...` 런처이고, `resume` 서브커맨드는 이미 떠 있는 app-server에 붙어서 기존 thread에 non-interactive turn을 넣습니다.

## Usage

```bash
codex-exec-remote

codex-exec-remote --listen ws://127.0.0.1:4501

codex-exec-remote resume <thread-id> "<prompt>" \
  --remote ws://127.0.0.1:4501 \
  --auth-token-env CODEX_AUTH_TOKEN
```

## Development

```bash
bun install
bun test
bun run src/index.ts
bun run src/index.ts --listen ws://127.0.0.1:4501
bun run src/index.ts resume <thread-id> "<prompt>" --remote ws://127.0.0.1:4501
```

## Notes

- 인자 없이 실행하면 `codex app-server --listen ws://127.0.0.1:4501`를 실행합니다.
- `--listen <url>`만 주면 `codex app-server --listen <url>`를 실행합니다.
- v1의 원격 turn sender는 `resume`만 지원합니다.
- `thread/read(includeTurns=true)`를 사용해 최종 assistant 결과를 canonical source로 읽습니다.
- interactive server request를 받으면 reject 후 즉시 실패합니다.
