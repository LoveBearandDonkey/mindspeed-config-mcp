---
name: mindspeed-config-mcp-deploy
description: Package, release, roll back, and verify the MindSpeed Config MCP service on its Tencent Cloud Ubuntu host. Use when asked to deploy, redeploy, publish, update, roll out, or verify the remote service, including Chinese requests such as “部署到腾讯云”, “重新发布服务”, “更新线上版本”, “回滚服务” or “检查线上版本”.
---

# MindSpeed Config MCP Tencent Cloud deployment

Deploy only an exact, pushed Git commit. Keep the current container serving traffic while the new image builds, preserve the remote `deploy/.env` without reading or printing its bearer token, then switch and verify the service.

## Standard release

1. Inspect `git status --short --branch` and the intended diff. Never absorb unrelated user changes into a release commit.
2. If the requested version is not committed and pushed, run the relevant tests, commit only the intended paths, and push `main` first.
3. Run `scripts/deploy-tencent-cloud.ps1` from this skill. It performs the full local test and packaging gate unless `-SkipLocalVerify` is explicitly used for diagnosis.
4. Report the deployed commit, release directory, image ID, health result, authorization result, and packaged HTML SHA-256.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .agents/skills/mindspeed-config-mcp-deploy/scripts/deploy-tencent-cloud.ps1
```

The script intentionally refuses tracked changes, staged changes, unpushed `HEAD`, and meaningful untracked files. `.tmp-*` leftovers are ignored because they are local release diagnostics and are never included in the Git bundle.

## Invariants

- Transfer the exact commit with `git bundle`; do not use a Windows-created tarball or `git archive`. The Docker UI build depends on the repository's verified line-ending normalization.
- Build with `docker compose build --pull` before `docker compose up -d --no-build`, so the old container stays available during the expensive step.
- Copy the existing remote `.env` with mode `600`. Never display it and never invent a fallback token.
- Keep the service bound to `127.0.0.1:3002`; do not open the MCP port publicly.
- Require `/health` to return success and unauthenticated `/mcp` to return `401`.
- Retain the previous release directory and tag its image with a release-specific rollback tag. If post-switch verification fails, restore the previous image and compose project automatically.
- A failed pre-switch build must not replace the running container.

## Packaging-only requests

For a deployable HTML artifact without a server rollout, use the `mindspeed-config-mcp-package` skill instead. For page or style changes, also follow the repository instruction to run the local `Preview` workflow before the final response.

## Failure handling

- If SSH is unreachable, stop after the connectivity check and report whether TCP/SSH or authentication failed.
- If the local tree is dirty, identify the blocking paths; do not stash, discard, or silently deploy a different commit.
- If the remote build fails, leave the old container running and preserve the new release directory for logs.
- If rollback also fails, report both the original verification error and the rollback error, plus the old release directory and image ID.
