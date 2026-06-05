#!/bin/bash
# =============================================================
# 白樺クエスト — 本番環境初回セットアップスクリプト
# 実行前に: wrangler login でCloudflareにログイン済みであること
# 使い方: bash setup-production.sh
# =============================================================

set -e

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/packages/backend"

echo "🃏 白樺クエスト — 本番環境セットアップ"
echo ""

cd "$BACKEND_DIR"

# ---- D1 データベース作成 ----
echo "📦 D1 データベースを作成します..."
D1_OUTPUT=$(pnpm exec wrangler d1 create shirakaba-quest 2>&1)
echo "$D1_OUTPUT"
DATABASE_ID=$(echo "$D1_OUTPUT" | grep "database_id" | grep -oE '"[0-9a-f\-]{36}"' | tr -d '"')
if [ -n "$DATABASE_ID" ]; then
  echo "✅ D1 database_id: $DATABASE_ID"
  # wrangler.toml を自動更新
  sed -i.bak "s/placeholder-set-after-wrangler-d1-create/$DATABASE_ID/" wrangler.toml
  echo "   wrangler.toml を更新しました"
else
  echo "⚠️  database_id の自動取得に失敗しました。wrangler.toml を手動で更新してください"
fi

# ---- KV ネームスペース作成 ----
echo ""
echo "📦 KV ネームスペースを作成します..."
KV_OUTPUT=$(pnpm exec wrangler kv namespace create KV 2>&1)
echo "$KV_OUTPUT"
KV_ID=$(echo "$KV_OUTPUT" | grep "id = " | grep -oE '"[0-9a-f]{32}"' | tr -d '"')
if [ -n "$KV_ID" ]; then
  echo "✅ KV id: $KV_ID"
  sed -i.bak "s/placeholder-set-after-wrangler-kv-create/$KV_ID/" wrangler.toml
  echo "   wrangler.toml を更新しました"
else
  echo "⚠️  KV id の自動取得に失敗しました。wrangler.toml を手動で更新してください"
fi

# ---- R2 バケット作成 ----
echo ""
echo "📦 R2 バケットを作成します..."
pnpm exec wrangler r2 bucket create shirakaba-assets && echo "✅ R2 バケット作成完了"

# ---- マイグレーション実行 ----
echo ""
echo "📊 本番 DB にマイグレーションを適用します..."
pnpm exec wrangler d1 migrations apply shirakaba-quest --remote
echo "✅ マイグレーション完了"

# ---- Secrets 設定案内 ----
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔑 以下のコマンドで各シークレットを設定してください:"
echo ""
echo "  wrangler secret put SENDGRID_API_KEY"
echo "  wrangler secret put ANTHROPIC_API_KEY"
echo "  wrangler secret put GOOGLE_VISION_API_KEY"
echo "  wrangler secret put SESSION_SECRET"
echo ""
echo "  ※ SESSION_SECRET の値は以下で生成できます:"
echo "  openssl rand -hex 32"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ セットアップ完了！次のステップ:"
echo "  1. 上記のシークレットを設定"
echo "  2. wrangler deploy --env production  ← バックエンドをデプロイ"
echo "  3. cd ../frontend && pnpm build && pnpm exec wrangler pages deploy dist --project-name shirakaba-quest"
echo ""
