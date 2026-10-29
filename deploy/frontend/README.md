# Fork frontend integration

The frontend assets are built from
[`MarSeventh/Sanyue-ImgHub`](https://github.com/MarSeventh/Sanyue-ImgHub)
at commit `5b237cf1ece156909888a8d9b158be8445aad95f`, matching the upstream
duplicate scan report release.

Apply [sightengine.patch](sightengine.patch) to that source checkout before
building. It preserves the fork's Sightengine option, API user, API secret
and model settings, including the Chinese and English labels. The backend's
NSFWJS quota fallback and HuggingFace direct moderation remain in this repository.

Use Node.js 22 and the frontend lockfile:

```sh
git clone https://github.com/MarSeventh/Sanyue-ImgHub.git frontend-source
cd frontend-source
git checkout 5b237cf1ece156909888a8d9b158be8445aad95f
git apply --unidiff-zero /absolute/path/to/CloudFlare-ImgBed/deploy/frontend/sightengine.patch
npm ci
npm test
npm run build
```

Replace this repository's `frontend-dist/` with the complete generated `dist/`
directory, including hashed assets, source maps and compressed files. Do not mix
different builds. Keep the patch when updating the frontend source revision and
check the security settings page after rebuilding.

The main repository is synchronized with upstream `main` at
`274be18fc76294e6548f53dbf442c6cbaeb592e1`.
All upstream features and documentation are included; the fork's moderation
behavior and GHCR image publishing configuration are retained. AI tagging stays
disabled by default and requires a configured vision model and `AI_CONFIG_SECRET`
of at least 32 characters when enabled.
