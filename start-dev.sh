#!/bin/bash
# 白樺クエスト — ローカル開発サーバー起動スクリプト
# 使い方: bash /Users/atsushi/Apps/card_game/shirakaba-quest/start-dev.sh

# nvm をロード
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/packages/backend"
FRONTEND_DIR="$SCRIPT_DIR/packages/frontend"
BACKEND_LOG="/tmp/shirakaba-backend.log"
FRONTEND_LOG="/tmp/shirakaba-frontend.log"

# Mac のローカル IP（Wi-Fi）
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo "🃏 白樺クエスト 開発サーバーを起動します..."
echo ""

# 既存プロセスを停止
lsof -ti:8787,5173 | xargs kill -9 2>/dev/null
sleep 1

# ---- バックエンド起動（ログファイルに記録 + ターミナルに表示） ----
cd "$BACKEND_DIR"
pnpm exec wrangler dev --port 8787 --ip 0.0.0.0 > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

# 起動待ち + ログをリアルタイム表示
sleep 4

# ---- フロントエンド起動 ----
cd "$FRONTEND_DIR"
VITE_API_HOST="http://$LOCAL_IP:8787" pnpm dev --host --port 5173 > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

sleep 3

echo "  ── PC からアクセス ──────────────────────────"
echo "  フロントエンド: http://localhost:5173"
echo ""
echo "  ── iPhone からアクセス（同じ Wi-Fi） ─────────"
echo "  フロントエンド: http://$LOCAL_IP:5173"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📬 ログインコード（OTP）はこの画面に自動表示されます"
echo "   （待っていれば出てきます。Ctrl+C で終了）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# バックエンドログをリアルタイムで流し続ける（OTPが見えるように）
tail -f "$BACKEND_LOG" &
TAIL_PID=$!

# Ctrl+C ですべて停止
trap "
  echo ''
  echo '停止しています...'
  kill $BACKEND_PID $FRONTEND_PID $TAIL_PID 2>/dev/null
  sleep 1
  echo '停止しました'
  exit
" INT TERM

wait $BACKEND_PID
