# Места Лебедева

Telegram Mini App для отметок городов из «рейтинга интересности» Артемия Лебедева. Каждый пользователь видит свой прогресс (N из 1181), отмечает посещённые города чекбоксом и может указать год посещения. Данные хранятся в `Telegram.WebApp.CloudStorage` (привязано к user_id Telegram, без своего бэкенда).

## Стек

- Astro (static output) + Preact-остров с собственной фиксированной виртуализацией списка
- `@preact/signals` для реактивности
- GitHub Pages для хостинга, GitHub Actions для деплоя
- Бот в Telegram — только лаунчер (настраивается в BotFather), кода бота нет

## Локальная разработка

```bash
npm install
npm run dev
```

Сайт откроется на `http://localhost:4321/lebedev-places/`. Вне Telegram приложение работает в режиме fallback: отметки хранятся в `localStorage`, видна подсказка «откройте в Telegram». Это рабочий режим для разработки.

## Парсинг списка городов

Источник — `src/data/cities.raw.txt`. Команда

```bash
npm run build:cities
```

обновляет `src/data/cities.generated.json`. Скрипт убирает soft hyphens, выделяет страну из скобок и проставляет дизамбигуирующие суффиксы в slug для повторяющихся названий (Гранада, Сен-Пьер, Портленд и др.).

Правила правки списка — `src/data/README.md`. Главное: **append-only**, идентификатор города — его позиция в массиве, на ней держится сериализация состояния.

## Настройка Telegram-бота (BotFather)

Все шаги — в чате с `@BotFather`:

1. `/newbot` — задать имя и username (с суффиксом `bot`). Сохранить HTTP API-токен (на будущее, если появится свой бэк).
2. `/mybots` → выбрать бота → **Bot Settings** → **Menu Button**:
   - URL: `https://<your-username>.github.io/lebedev-places/`
   - Caption: «Открыть».
3. `/setdomain` → указать хост без схемы (`<your-username>.github.io`). Нужен для корректной работы initData.
4. (Опционально) `/setdescription`, `/setabouttext`, `/setuserpic`.
5. (Опционально) `/setcommands`:

   ```
   start - Открыть приложение
   ```

После этого ссылка `https://t.me/<botusername>?startapp` запускает Mini App.

### Тест без публикации

Локальный сайт можно прокинуть в Telegram через тоннель:

```bash
cloudflared tunnel --url http://localhost:4321
```

Полученный HTTPS-URL подставить в BotFather (Menu Button URL и `/setdomain`) на время тестирования. После — вернуть URL GitHub Pages.

## Деплой

`main` → push → GitHub Actions собирает Astro и пушит в Pages. Source в настройках репозитория — **GitHub Actions** (не «Deploy from branch»).

Workflow прописывает `SITE` и `BASE` из имени репозитория, поэтому конфиг `astro.config.mjs` универсален. Если перейдёте на кастомный домен:

1. Добавить `public/CNAME` со строкой домена.
2. В CI: `BASE=/` (можно жёстко в `env` шага build).
3. В BotFather: обновить Menu Button URL и `/setdomain`.

## Карта: Stadia Maps

Тайлы карты берутся со Stadia Maps (стили Alidade Smooth / Alidade Smooth Dark). Без API-ключа доступ работает только с авторизованных доменов — это одноразовая настройка:

1. Зарегистрироваться на https://client.stadiamaps.com.
2. **Properties → Add property** → ввести домен: `shurochkin.github.io`. Для локальной разработки добавить `localhost`.
3. Бесплатного тарифа (200 000 тайлов в месяц) хватит на личное использование с запасом.

Пока домен не добавлен, тайлы возвращаются с 401 и карта будет серой. В этом случае откатите MapView на OSM (`tile.openstreetmap.org`) одной правкой в `tilesForTheme()` или добавьте API-ключ в URL через `?api_key=...`.

## Архитектурные заметки

- **Состояние** = битовая маска посещённых (1 бит на город) + sparse-map `idx → год`. Упакованное представление пишется в один CloudStorage-ключ `v1:state`. Если суммарная длина превышает ~3900 символов (при ~600+ датированных городах), годовые пары автоматически переезжают в шарды `v1:y:0…3`. Маска всегда остаётся источником истины.
- **Запись** дебаунсится 300 мс, повторяется с экспоненциальной паузой при ошибках, ставит флаг closing-confirmation пока есть pending writes.
- **Виртуализация** — самописная фиксированной высоты (56 px на ряд), без зависимостей. Окно ±6 строк overscan.

Подробности: `src/lib/encoding.ts`, `src/lib/storage.ts`, `src/components/CityList.island.tsx`.
