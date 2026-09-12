# AnimeUA for SkyStream

Український AnimeUA provider для SkyStream.

Current plugin version: **47**.

v47 keeps separate AnimeUA release cards isolated, preserves the stable playback path, and adds versioned detail URLs so SkyStream cannot reuse stale episode layouts from older broken builds.

## Repository URL

`https://raw.githubusercontent.com/mpulsea/animeua-skystream-ready/main/repo.json`

## Structure

- `animeua/` - provider source and manifest
- `proxy/` - legacy relay source
- `dist/` - generated SkyStream package and plugin list
- `.github/workflows/build.yml` - repository build/deploy workflow

`repo-v4.json` і `dist/plugins-v4.json` залишені лише для сумісності з уже підключеними пристроями. Нові підключення повинні використовувати `repo.json`.
