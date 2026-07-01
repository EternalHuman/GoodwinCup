# Goodwin Cup

Статический сайт для Cloudflare Pages с турнирной таблицей и админкой на `/admin/`.

## Запуск локально

```bash
python -m http.server 8788
```

Откройте `http://localhost:8788/`.

## Деплой на Cloudflare Pages

- Build command: пусто
- Build output directory: `.`
- Главная страница: `/`
- Админка: `/admin/`

Без KV данные хранятся в `localStorage` текущего браузера. Чтобы игроки, игры и очки были общими для всех:

1. Создайте KV namespace в Cloudflare.
2. В Pages project добавьте KV binding с именем `GOODWIN_CUP_KV`.
3. Перезадеплойте проект.
