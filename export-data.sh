#!/bin/bash
# =============================================================
# 白樺クエスト — データエクスポートスクリプト（移行・バックアップ用）
# 使い方: bash export-data.sh [--remote]
# --remote: 本番DB からエクスポート（省略時はローカル）
# =============================================================

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/packages/backend"
EXPORT_DIR="$SCRIPT_DIR/exports/$(date +%Y%m%d_%H%M%S)"
REMOTE_FLAG=""

if [ "$1" = "--remote" ]; then
  REMOTE_FLAG="--remote"
  echo "🌐 本番DBからエクスポートします..."
else
  echo "💻 ローカルDBからエクスポートします..."
fi

mkdir -p "$EXPORT_DIR"
cd "$BACKEND_DIR"

TABLES=("members" "admins" "connections" "one_on_one_sessions" "quests" "quest_attempts" "point_transactions" "card_designs")

for TABLE in "${TABLES[@]}"; do
  echo "  📦 $TABLE をエクスポート中..."
  pnpm exec wrangler d1 execute shirakaba-quest $REMOTE_FLAG \
    --command "SELECT * FROM $TABLE" \
    --json > "$EXPORT_DIR/${TABLE}.json" 2>/dev/null
done

# メタ情報
echo "{\"exportedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"tables\": $(echo ${TABLES[@]} | jq -R 'split(" ")' 2>/dev/null || echo '[]')}" \
  > "$EXPORT_DIR/meta.json"

echo ""
echo "✅ エクスポート完了: $EXPORT_DIR"
echo "   $(ls -la $EXPORT_DIR | wc -l) ファイルを保存しました"
