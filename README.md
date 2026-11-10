# Irwin Framework 🚀

---

---

> **The Industrial-grade Node.js Framework for Rails Lovers.**

Irwin Framework is a powerful, convention-over-configuration Node.js framework inspired by **Ruby on Rails**. It combines the type-safety of **TypeScript**, the performance of **Prisma**, the elegance of **Pug**, and the reactivity of **Vue 3**.

---

### 🌐 Languages / 言語 / Ngôn ngữ

- English
- 日本語 (Japanese)
- Tiếng Việt (Vietnamese)

---

<a name="english"></a>

## 🇺🇸 English

### 🌟 Design Philosophy

- **Convention over Configuration (CoC)**: Standardized directory structure to eliminate boilerplate.
- **Single Source of Truth (SSoT)**: Define Routes, Permissions, and Swagger documentation in a single unified declaration.
- **Modern Frontend Integration**: Seamlessly mix Server-Side Rendering (Pug) with Modern Reactive Components (Vue 3).

### 🏗 Scaffolding Generators

Stop writing manual code. Use the CLI to generate everything:
| Command | Action |
| :--- | :--- |
| `pnpm exec rails generate scaffold [Name]` | Full CRUD (Model, Controller, Service, Route, View) |
| `pnpm exec rails generate controller [Name]` | Generates a new Controller |
| `pnpm exec rails generate service [Name]` | Generates a Service Object for business logic |
| `pnpm exec rails generate job [Name]` | Generates a Background Job (BullMQ/Lambda) |
| `pnpm exec rails generate resource [Name]` | Generates Resourceful Route (API + UI) |

### 🛣 Resourceful Routing & Auto Swagger

```typescript
// app/routes/user.route.ts
this.resource("/users", UsersController, {
  setPermissionFor: "UM",
  document: { body: CreateUserValidator }, // Auto-generates Swagger Schema from Validator
});
```

---

<a name="japanese"></a>

## 🇯🇵 日本語 (Japanese)

### 🌟 設計思想

- **設定より規約 (CoC)**: 標準化されたディレクトリ構造により、ボイラープレートを最小限に抑えます。
- **信頼できる唯一の情報源 (SSoT)**: ルーティング、権限、Swaggerドキュメントを1か所で定義します。
- **モダンなフロントエンド統合**: SSR (Pug) とリアクティブコンポーネント (Vue 3) の強力な組み合わせ。

### 🏗 ジェネレーター

ボイラープレートの作成を自動化します：
| コマンド | 機能 |
| :--- | :--- |
| `pnpm exec rails generate scaffold [Name]` | モデル、コントローラー、サービス、ルート、ビューをフルセットで生成 |
| `pnpm exec rails generate resource [Name]` | Swaggerドキュメント付きのAPIリソースを生成 |

### 🛣 リソースルーティング

```typescript
// 1行でRESTfulなルート、権限チェック、Swagger定義を完結
this.resource("/users", UsersController, {
  setPermissionFor: "UM",
  document: { body: CreateUserValidator },
});
```

---

<a name="vietnamese"></a>

## 🇻🇳 Tiếng Việt (Vietnamese)

### 🌟 Triết lý thiết kế

- **Convention over Configuration**: Giảm thiểu thời gian thiết lập bằng cấu trúc thư mục chuẩn Rails.
- **Single Source of Truth**: Khai báo Route, Phân quyền và Swagger Documentation tại cùng một nơi.
- **Modern Frontend Integration**: Kết hợp hoàn hảo giữa SSR (Pug) và Vue 3 Components.

### 🏗 Generators (Vũ khí Scaffolding)

Đừng viết code thủ công, hãy để framework làm việc đó cho bạn:
| Lệnh | Chức năng |
| :--- | :--- |
| `pnpm exec rails generate scaffold [Name]` | Tạo trọn bộ: Model, Controller, Service, Route, View |
| `pnpm exec rails generate job [Name]` | Tạo Background Job (BullMQ/Lambda) |
| `pnpm exec rails generate resource [Name]` | Tạo Resourceful Route (API + UI) |

---

## 🛠 Getting Started (Quick Start)

### 1. Environment Setup

```bash
pnpm install
cp .env.example .env
```

### 2. Database & Seeds

```bash
pnpm db:migrate
pnpm db:seed
```

### 3. Development

```bash
pnpm dev
```

- App URL: `http://localhost:8000`
- Swagger UI: `http://localhost:8000/api-docs`

---

## 🎮 Controllers & Strong Parameters

Irwin uses `class-validator` to provide powerful, type-safe parameter filtering:

```typescript
export class UsersController extends RailsController {
  async create() {
    // Whitelist, Validate, and Type-cast in one line
    const userParams = await this.params(CreateUserValidator).permit(
      "email",
      "password",
      "roleIds",
    );

    const user = await UserService.create(userParams);

    if (this.req.xhr) {
      return this.renderJson(user, 201);
    }
    this.redirect("/users");
  }
}
```

---

## 📮 Background Jobs

Two queue modes (switch via `JOBS_USE_REDIS`):

| Mode | Env | Stack |
|------|-----|--------|
| **Default** | `JOBS_USE_REDIS=false` | Database queue + in-process worker |
| **Redis** | `JOBS_USE_REDIS=true` | BullMQ + Redis worker |

```typescript
// Enqueue for later processing
await new WelcomeEmailJob().performLater(user.id);

// Scheduled job (node-cron)
export class HeartbeatJob extends ApplicationJob {
  static cron = "*/5 * * * *";
  async perform() { /* ... */ }
}
```

Admin UI: `/admin/jobs` (list, detail, retry, delete).

```bash
# Optional Redis mode
JOBS_USE_REDIS=true
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

---

## 🌍 I18n & View Helpers

- Use `t('key')` in Controllers or Pug views.
- Automatic locale detection via Query, Cookie, or Headers.
- Vite-integrated asset helpers: `h.assetPath('main.ts')`.

---

## 🚀 Deployment

Built-in support for **Serverless Framework**:

```bash
pnpm serverless
```
