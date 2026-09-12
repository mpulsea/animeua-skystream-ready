# AnimeUA for SkyStream

Український AnimeUA provider для SkyStream.

Current plugin version: **42**.

v42 keeps stable episode links and resolves fresh video streams only at playback time. It uses UACDN first when available and falls back to Ashdi without depending on the old temporary Worker.

## Repository URL

`https://raw.githubusercontent.com/mpulsea/animeua-skystream-ready/main/repo.json`

## Structure

- `animeua/` - provider source and manifest
- `proxy/` - legacy relay source
- `dist/` - generated SkyStream package and plugin list
- `.github/workflows/build.yml` - repository build/deploy workflow

`repo-v4.json` і `dist/plugins-v4.json` залишені лише для сумісності з уже підключеними пристроями. Нові підключення повинні використовувати `repo.json`.
