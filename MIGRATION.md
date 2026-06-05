# 白樺クエスト — 移行ガイド

## 概要

このアプリは「設定（シークレット）とコードの完全分離」設計になっています。  
コードを一切変更せずに、すべての環境を新しいオーナーへ移行できます。

---

## 移行に必要なもの（新オーナーが用意）

| 項目 | 必要な作業 |
|---|---|
| Cloudflare アカウント | 新規登録（無料）|
| Anthropic API キー | console.anthropic.com で発行 |
| Google Vision API キー | console.cloud.google.com で発行 |
| SendGrid API キー | sendgrid.com で発行 |
| GitHub アカウント | リポジトリ移管を受け取るため |

---

## 移行手順

### Step 1: データのエクスポート（旧オーナー）

```bash
bash export-data.sh --remote
# exports/YYYYMMDD_HHMMSS/ にJSONが出力される
```

### Step 2: GitHub リポジトリを移管

1. GitHub → リポジトリ → Settings → Danger Zone → Transfer
2. 新オーナーの GitHub アカウントを指定

### Step 3: 新 Cloudflare 環境のセットアップ（新オーナー）

```bash
# Cloudflareにログイン
wrangler login

# インフラを一括作成
bash setup-production.sh

# API シークレットを設定
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GOOGLE_VISION_API_KEY
wrangler secret put SENDGRID_API_KEY
wrangler secret put SESSION_SECRET   # openssl rand -hex 32 で生成
```

### Step 4: バックエンドをデプロイ

```bash
cd packages/backend
wrangler deploy --env production
```

### Step 5: フロントエンドをデプロイ

```bash
cd packages/frontend
pnpm build
wrangler pages deploy dist --project-name shirakaba-quest
```

### Step 6: DNS 切り替え（独自ドメイン使用時）

Cloudflare DNS の CNAME レコードを新しい Workers URL に向け直す。

### Step 7: データのインポート（必要に応じて）

エクスポートした JSON を新しい D1 に投入する。  
※メンバーデータ引き継ぎが必要な場合のみ

---

## 移行後の確認チェックリスト

- [ ] `https://新URL/api/health` が `{ ok: true }` を返す
- [ ] テストアカウントでログインできる
- [ ] 管理者ログインができる
- [ ] メンバー登録フローが動く
- [ ] カード撮影OCRが動く（Google Vision）
- [ ] OTPメールが届く（SendGrid）
- [ ] AIお題生成が動く（Anthropic）

---

## 注意事項

- SendGrid の送信元ドメイン認証は新オーナーのドメインで再設定が必要
- 独自ドメインを使っている場合はドメイン移管またはDNS変更が必要
- wrangler.toml の `database_id` と `kv_namespaces.id` は新環境の値に更新すること
