# Release guide

## GitHub release

Run the release command from a clean, up-to-date `main` branch:

```sh
npm run release -- 0.2.0
```

Pushing the generated `v0.2.0` tag starts `.github/workflows/release.yml`. The workflow builds on native GitHub-hosted runners and publishes DMG/ZIP, EXE, AppImage, and DEB assets to the matching GitHub Release.

The workflow can also be re-run manually. Choose **Actions → Package and publish release → Run workflow** and enter a version that exactly matches `package.json`.

## Cloudflare R2

Configure these Actions repository variables:

| Variable | Meaning |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_BUCKET` | R2 bucket name |
| `R2_PUBLIC_BASE_URL` | Public bucket or custom-domain base URL |

Configure these Actions repository secrets:

| Secret | Meaning |
| --- | --- |
| `R2_ACCESS_KEY_ID` | R2 S3 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 S3 API token secret key |

When all five values are present, the same release workflow uploads each asset to:

```text
deepseek-harness-desktop/releases/vX.Y.Z/<asset>
```

Versioned objects are immutable: an existing object is reused only when its stored SHA-256 matches. The workflow uploads `deepseek-harness-desktop/latest.json` last and verifies it through the public URL.

Packaged desktop clients consume this manifest for automatic updates. They compare its SemVer with the running app, select the native asset, download it in the background, and require both the declared byte size and SHA-256 to match before offering installation. Keep `schemaVersion: 1`, immutable version URLs, and the `electron-builder` artifact names stable unless the client-side update parser is changed in the same release.

Update installation is platform-aware: Windows launches the verified NSIS installer after quitting; a running Linux AppImage is replaced atomically and restarted; DEB and macOS DMG packages are opened with the system installer. A failed check, download, or installation leaves the currently installed app usable.

If R2 is not configured, GitHub Release publication still succeeds and the job summary explains why R2 was skipped.
