# bogbus — приём оплат Bank of Georgia (BOG) в Shopify

Лёгкое **Node.js + Express** приложение, которое подключает платёжный шлюз
**Bank of Georgia** (новый Online Payment API, `api.bog.ge/payments/v1`) к
магазину **Shopify** по схеме **«draft order + хостед-страница BOG»** — без
прохождения ревью Shopify как платёжного партнёра.

## Как это работает

```
Покупатель                bogbus (это приложение)            BOG                 Shopify
   │  «Оплатить через BOG»     │                              │                    │
   ├──────────────────────────▶│  POST /checkout              │                    │
   │                           │  1. создаёт draft order ─────┼───────────────────▶│
   │                           │  2. создаёт BOG order ───────▶│                    │
   │                           │◀── redirect URL ─────────────│                    │
   │◀── 302 на стр. BOG ───────│                              │                    │
   │  вводит карту ────────────┼─────────────────────────────▶│                    │
   │                           │   POST /callbacks/bog ◀───────│ (подпись RSA)      │
   │                           │  3. проверяет подпись+сумму   │                    │
   │                           │  4. draftOrderComplete ───────┼───────────────────▶│  Order = PAID
   │◀── /return/success ───────│                              │                    │
```

Источник истины о статусе оплаты — **серверный callback** (`POST /callbacks/bog`),
а не редирект покупателя. Callback подписан приватным ключом BOG (SHA256withRSA);
мы проверяем подпись публичным ключом BOG **до** обработки тела запроса.

## Возможности

- OAuth2 (client credentials) к BOG с кэшированием токена.
- Создание заказа на хостед-странице BOG и редирект покупателя.
- Проверка подписи callback (RSA-SHA256) по сырому телу запроса.
- Повторная сверка суммы и статуса через `GET /receipt/{id}` (защита от подмены).
- Идемпотентная обработка callback (BOG повторяет вызовы).
- Завершение Shopify draft order как **оплаченного** заказа.
- Режим **BOG-only** (без Shopify) — чтобы быстро проверить ключи.
- Хранение платежей в JSON-файле (легко заменить на БД).
- Юнит-тесты на подпись и работу с суммами (без внешних зависимостей).

## Быстрый старт

```bash
git clone <repo> && cd bogbus
cp .env.example .env          # заполните ключи (см. ниже)
npm install
npm test                      # прогнать тесты
npm run dev                   # запустить с автоперезагрузкой
# откройте http://localhost:3000/demo
```

### Переменные окружения (`.env`)

| Переменная | Назначение |
|---|---|
| `APP_URL` | Публичный HTTPS-URL этого приложения (для `callback_url`/`redirect_urls`). |
| `BOG_CLIENT_ID` | Публичный client id (BOG). |
| `BOG_SECRET` | Секретный ключ (BOG). **Не публиковать.** |
| `BOG_PUBLIC_KEY` / `BOG_PUBLIC_KEY_PATH` | Публичный ключ BOG для проверки подписи callback (PEM). |
| `BOG_LANGUAGE` | Язык страницы оплаты: `ka` / `en` / `ru`. |
| `SHOPIFY_SHOP` | `your-store.myshopify.com`. |
| `SHOPIFY_ADMIN_TOKEN` | Admin API access token (custom app). |
| `SHOPIFY_API_VERSION` | Напр. `2025-01`. |
| `CHECKOUT_API_KEY` | (Опц.) защита `/checkout` заголовком `X-Api-Key`. |
| `DEFAULT_CURRENCY` | Валюта для BOG-only режима (по умолчанию `GEL`). |

> **Где взять ключи BOG:** [businessonline.ge](https://businessonline.ge) → Online
> payments → API keys. Публичный ключ для проверки подписи — на странице
> [Callback в документации BOG](https://api.bog.ge/docs/en/payments/standard-process/callback).
> Скопируйте его в `keys/bog_public.pem` или в `BOG_PUBLIC_KEY`.

> **Shopify custom app:** Admin → Settings → Apps and sales channels → Develop
> apps → Create an app → API scopes: `write_draft_orders`, `read_orders` →
> Install → скопируйте Admin API access token (`shpat_…`).

## Эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/checkout` | Создать платёж. `?redirect=1` → сразу 302 на BOG. |
| `GET` | `/pay/:paymentId` | 302 на сохранённую страницу оплаты BOG (повторная оплата). |
| `GET` | `/payments/:paymentId` | Статус платежа (JSON, для опроса). |
| `POST` | `/callbacks/bog` | Серверный callback BOG (проверка подписи). |
| `GET` | `/return/success` `/return/fail` | Страницы возврата покупателя. |
| `GET` | `/demo` | Тестовая форма. |
| `GET` | `/healthz` | Проверка живости. |

### `POST /checkout` — примеры тел запроса

```jsonc
// 1) оплатить уже существующий draft order
{ "draftOrderId": "1234567890" }

// 2) создать draft order из товаров (вариантов) и оплатить
{ "lineItems": [{ "variantId": "gid://shopify/ProductVariant/111", "quantity": 2 }],
  "email": "buyer@example.com" }

// 3) кастомная позиция (произвольная сумма)
{ "lineItems": [{ "title": "Консультация", "quantity": 1, "originalUnitPrice": "49.90" }] }

// 4) BOG-only (Shopify не настроен) — просто проверить ключи
{ "amount": 1.00, "currency": "GEL" }
```

Ответ: `{ "paymentId": "...", "redirectUrl": "https://payment.bog.ge/...", "draftOrderId": "..." }`

## Подключение к витрине Shopify

Поскольку нативный Shopify Checkout нельзя расширить без статуса платёжного
партнёра, покупателя направляют в это приложение одним из способов:

1. **Кнопка «Оплатить через BOG» в теме (через App Proxy).**
   В Shopify настройте App Proxy (Admin → Apps → App setup → App proxy),
   указывающий, например, `/apps/bog` → на этот сервис. Кнопка в теме делает
   `POST /checkout?redirect=1` с корзиной/товарами — покупатель сразу попадёт
   на страницу BOG.
2. **Draft order из админки.** Создайте draft order в Shopify, затем вызовите
   `POST /checkout { "draftOrderId": "<id>" }` и отправьте покупателю ссылку
   `GET /pay/:paymentId`.
3. **Программно** из вашего бэкенда/кастомной витрины (Storefront API) — POST на
   `/checkout` и редирект на `redirectUrl`.

> Для multi-store / публикации в Shopify App Store нужен официальный
> **Payments Apps API** и ревью Shopify — это другой путь (см. раздел ниже).

## Безопасность

- Подпись callback проверяется **до** разбора JSON (по сырым байтам).
- После успешного callback сумма и статус повторно сверяются через `GET /receipt/{id}`.
- Несовпадение суммы → статус `mismatch`, заказ **не** помечается оплаченным.
- `/checkout` можно закрыть заголовком `X-Api-Key` (`CHECKOUT_API_KEY`).
- Все секреты — только в окружении; `.env`, `data/*.json`, `keys/*.pem` в `.gitignore`.
- В продакшене обязательно HTTPS (`APP_URL`) и реальный `BOG_PUBLIC_KEY`.
  Флаг `BOG_SKIP_SIGNATURE_VERIFY=true` — только для локальной отладки.

## Деплой

Приложение без состояния, кроме файла `data/payments.json` (примонтируйте том).

```bash
docker build -t bogbus .
docker run -p 3000:3000 --env-file .env -v $PWD/data:/app/data bogbus
```

Подойдёт любой хостинг Node (Render, Railway, Fly.io, VPS+Nginx). Главное —
публичный HTTPS-URL, доступный серверам BOG для callback.

> **Заметка про окружение Claude Code (web):** контейнер сессии эфемерный и
> сетевая политика может ограничивать исходящие запросы — реальные вызовы BOG/
> Shopify выполняйте там, где ключи и доступ в интернет настроены. Подробнее:
> https://code.claude.com/docs/en/claude-code-on-the-web

## Тесты

```bash
npm test        # node --test: проверка подписи и денежных операций
```

## Структура

```
src/
  config.js            конфиг + валидация
  server.js            Express, middleware, маршруты, graceful shutdown
  bog/
    client.js          OAuth + createOrder + receipt
    signature.js       проверка RSA-подписи callback
  shopify/client.js    Admin GraphQL: draftOrderCreate/Complete
  services/payments.js оркестрация (checkout + обработка callback)
  store/index.js       хранилище платежей (JSON-файл)
  routes/              checkout, callback, return, index(demo/health)
  lib/                 logger, money, errors
test/                  signature.test.js, money.test.js
scripts/               create-test-order.js
```

## Если нужен нативный метод оплаты в Shopify Checkout

Это требует **Payments Apps API** и одобрения Shopify как платёжного партнёра.
Ядро интеграции с BOG (`src/bog/*`) переиспользуется как есть; меняется только
Shopify-сторона: вместо draft order вы реализуете `payment session` (приём
запроса сессии, редирект на BOG, затем `paymentSessionResolve`/`Reject`).
Напишите — соберу и этот вариант.

## Источники / документация BOG

- [Online Payment API — введение](https://api.bog.ge/docs/en/payments/introduction)
- [Аутентификация (OAuth2)](https://api.bog.ge/docs/en/payments/authentication)
- [Создание заказа](https://api.bog.ge/docs/en/payments/standard-process/create-order)
- [Callback и проверка подписи](https://api.bog.ge/docs/en/payments/standard-process/callback)
- [iPay (legacy) — введение](https://api.bog.ge/docs/en/ipay/introduction)
