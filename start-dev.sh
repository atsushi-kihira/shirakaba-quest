#!/bin/bash
# 白樺クエスト — ローカル開発サーバー起動スクリプト
# 使い方: bash /Users/atsushi/Apps/card_game/shirakaba-quest/start-dev.sh
# iPhone からもアクセス可能（同じ WiFi に接続していること）

# nvm をロード
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# このスクリプト自身のディレクトリを絶対パスで取得
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/packages/backend"
FRONTEND_DIR="$SCRIPT_DIR/packages/frontend"

# Mac のローカル IP アドレスを取得（Wi-Fi）
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo "🃏 白樺クエスト ローカル開発サーバーを起動します..."
echo ""
echo "  ── PC からアクセス ──────────────────────────"
echo "  フロントエンド: http://localhost:5173"
echo "  バックエンド:   http://localhost:8787"
echo ""
echo "  ── iPhone からアクセス（同じ Wi-Fi） ─────────"
echo "  フロントエンド: http://$LOCAL_IP:5173"
echo "  バックエンド:   http://$LOCAL_IP:8787"
echo ""
echo "⚠️  ログインコード（OTP）は このターミナル に表示されます"
echo "    例: [DEV] OTP for xxx@xxx.com: 123456"
echo ""

# 念のため既存プロセスを終了
lsof -ti:8787,5173 | xargs kill -9 2>/dev/null

# バックエンドをバックグラウンドで起動（0.0.0.0 でネットワーク公開）
cd "$BACKEND_DIR"
pnpm exec wrangler dev --port 8787 --ip 0.0.0.0 2>&1 &
BACKEND_PID=$!

# バックエンドの起動を待つ
sleep 4

# フロントエンドをバックグラウンドで起動（--host でネットワーク公開）
# vite.config.ts の server.proxy も設定するため環境変数で LOCAL_IP を渡す
cd "$FRONTEND_DIR"
VITE_API_HOST="http://$LOCAL_IP:8787" pnpm dev --host --port 5173 2>&1 &
FRONTEND_PID=$!

sleep 3

echo ""
echo "✅ 起動完了！"
echo ""
echo "📱 iPhone で登録フローを試す場合:"
echo "   Safari で → http://$LOCAL_IP:5173/register を開く"
echo ""
echo "終了するには Ctrl+C を押してください"
echo ""

# Ctrl+C で両方終了
trap "echo ''; echo '停止しています...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; sleep 1; echo '停止しました'; exit" INT TERM
wait
