# AnimeUA for SkyStream

Експериментальний порт AnimeUA з Sora-модуля на SkyStream.

## Що має працювати

- окремий Provider `AnimeUA`
- головний каталог AnimeUA
- пошук
- сторінка тайтлу
- серії
- HLS/прямі відеопотоки

> AnimeUA може бути геоблокований. За межами України інколи потрібен VPN з українською IP-адресою.

## Як викласти на GitHub

1. Створи **публічний** GitHub repository, наприклад `animeua-skystream`.
2. Завантаж **весь вміст цього архіву** в корінь репозиторію.
3. Зроби commit у гілку `main`.
4. Відкрий вкладку **Actions** й дочекайся зеленого `Build and Deploy Repository`.
5. Після Action файл `repo.json` буде оновлений автоматично, а в `dist/` з'являться `plugins.json` та `.sky`.

## Що вставити в SkyStream

Після успішного Action:

`https://raw.githubusercontent.com/ТВІЙ_GITHUB_USERNAME/animeua-skystream/main/repo.json`

Якщо назва репозиторію інша - заміни `animeua-skystream` на свою.

## Тестування через CLI

```bash
npm install -g skystream-cli
skystream test -f getHome -p animeua
skystream test -f search -p animeua -q "Наруто"
```

Порт зроблений на основі публічного AnimeUA Sora-модуля waruhachi та актуальної SkyStream Gen 2 plugin API.
