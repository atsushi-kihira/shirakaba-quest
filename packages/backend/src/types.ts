// Workers 環境変数・バインディングの型定義
export type Env = {
  // D1 データベース
  DB: D1Database;
  // KV（OTP・QRトークン等の短命データ）
  KV: KVNamespace;
  // R2 ストレージ（画像等）
  R2: R2Bucket;

  // 環境変数
  ENVIRONMENT: "development" | "production";
  CORS_ORIGIN: string;

  // Secrets（wrangler secret put で登録）
  SENDGRID_API_KEY: string;
  SENDGRID_FROM_EMAIL: string;  // 送信元メールアドレス（SendGridで認証済みのもの）
  ANTHROPIC_API_KEY: string;
  GOOGLE_VISION_API_KEY: string;
  SESSION_SECRET: string;
};

// Hono のコンテキスト変数
export type Variables = {
  userId: string;
  userType: "member" | "admin";
};
