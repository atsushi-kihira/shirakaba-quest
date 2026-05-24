#!/bin/bash
# 白樺クエスト — ローカル開発サーバー起動スクリプト
# 使い方: bash /Users/atsushi/Apps/card_game/shirakaba-quest/start-dev.sh

# nvm をロード
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# このスクリプト自身のディレクトリを絶対パスで取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/packages/backend"
FRONTEND_DIR="$SCRIPT_DIR/packages/frontend"

echo "🃏 白樺クエスト ローカル開発サーバーを起動します..."
echo ""
echo "  バックエンド: http://localhost:8787"
echo "  フロントエンド: http://localhost:5173"
echo ""
echo "⚠️  ログインコード（OTP）は このターミナル に表示されます"
echo "    例: [DEV] OTP for xxx@xxx.com: 123456"
echo ""

# 念のため既存プロセスを終了
lsof -ti:8787,5173 | xargs kill -9 2>/dev/null

# バックエンドをバックグラウンドで起動
cd "$BACKEND_DIR"
pnpm exec wrangler dev --port 8787 2>&1 &
BACKEND_PID=$!

# バックエンドの起動を待つ
sleep 4

# フロントエンドをバックグラウンドで起動
cd "$FRONTEND_DIR"
pnpm dev --port 5173 2>&1 &
FRONTEND_PID=$!

sleep 3

echo ""
echo "✅ 起動完了！ブラウザで以下を開いてください:"
echo "   http://localhost:5173"
echo ""
echo "終了するには Ctrl+C を押してください"
echo ""

# Ctrl+C で両方終了
trap "echo ''; echo '停止しています...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; sleep 1; echo '停止しました'; exit" INT TERM
wait
