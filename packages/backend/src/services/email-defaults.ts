// =============================================================
// メールテンプレートのデフォルト定義（プレーンテキスト）
// 管理者がDBで上書きしていない場合はここの値を使用する
// =============================================================

export type EmailVar = {
  key: string;
  label: string;
  example: string;
};

export type EmailDefault = {
  emailKey: string;
  label: string;
  category: "auth" | "usp" | "meeting" | "oneonone" | "card" | "scheduler";
  triggerDescription: string;
  enabled: boolean;
  subject: string;
  bodyText: string;
  availableVars: EmailVar[];
};

// ── テンプレート定義 ─────────────────────────────────────────
export const EMAIL_DEFAULTS: EmailDefault[] = [

  // ============================================================
  // 認証
  // ============================================================
  {
    emailKey: "otp_login",
    label: "ログインOTP",
    category: "auth",
    triggerDescription: "メンバー・管理者がログインリクエストを送信したとき",
    enabled: true,
    subject: "【{{appTitle}}】ログインコード: {{otpCode}}",
    bodyText: `{{appTitle}} ログインコード

ログインのための確認コードです。

▼ 確認コード（6桁）
{{otpCode}}

※ このコードの有効期限は10分です。
身に覚えのない場合は、このメールを無視してください。

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "otpCode", label: "ログインコード（6桁）", example: "123456" },
    ],
  },

  // ============================================================
  // USP
  // ============================================================
  {
    emailKey: "usp_request_admin",
    label: "USP申請通知（管理者向け）",
    category: "usp",
    triggerDescription: "メンバーがUSPの申請を送信したとき（管理者全員に送信）",
    enabled: true,
    subject: "【{{appTitle}}】新しいUSP申請が届きました：{{uspName}}",
    bodyText: `{{adminName}} さん

{{requesterName}}さん（{{requesterEmail}}）から新しいUSPの申請が届きました。

▼ 申請内容
{{uspEmoji}} {{uspName}}
{{uspDescription}}

管理画面の「USP管理」から承認または却下を行ってください。

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "adminName", label: "管理者名", example: "山田 太郎" },
      { key: "requesterName", label: "申請者名", example: "佐藤 花子" },
      { key: "requesterEmail", label: "申請者メール", example: "sato@example.com" },
      { key: "uspEmoji", label: "USP絵文字", example: "⭐" },
      { key: "uspName", label: "USP名", example: "リスク判断力" },
      { key: "uspDescription", label: "USP説明", example: "課題解決のプロフェッショナル" },
    ],
  },
  {
    emailKey: "usp_request_result",
    label: "USP審査結果（申請者向け）",
    category: "usp",
    triggerDescription: "管理者がUSP申請を承認または却下したとき",
    enabled: true,
    subject: "【{{appTitle}}】USP申請の結果：{{uspName}}",
    bodyText: `{{requesterName}} さん

申請されたUSP「{{uspEmoji}} {{uspName}}」の審査結果が届きました。

▼ 審査結果
{{resultLabel}}
{{reviewNote}}

{{resultMessage}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "requesterName", label: "申請者名", example: "佐藤 花子" },
      { key: "uspEmoji", label: "USP絵文字", example: "⭐" },
      { key: "uspName", label: "USP名", example: "リスク判断力" },
      { key: "resultLabel", label: "審査結果ラベル", example: "✅ 承認されました！" },
      { key: "reviewNote", label: "審査コメント（空白可）", example: "すばらしいUSPです" },
      { key: "resultMessage", label: "結果後のメッセージ", example: "ログインしてUSPを選択してください。" },
    ],
  },

  // ============================================================
  // ミーティング
  // ============================================================
  {
    emailKey: "meeting_invitation",
    label: "ミーティング招待（メンバー向け）",
    category: "meeting",
    triggerDescription: "ミーティングが作成・メンバー追加され、対象メンバーに招待が送られるとき",
    enabled: true,
    subject: "【{{appTitle}}】📅 「{{meetingTitle}}」の日程調整に招待されました",
    bodyText: `{{memberName}} さん

{{hostName}}さんから「{{meetingTitle}}」の日程調整に招待されました。{{deadlineStr}}

{{meetingDescription}}

下記のURLから日程を回答してください。
{{meetingUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "memberName", label: "招待メンバー名", example: "山田 太郎" },
      { key: "hostName", label: "主催者名", example: "紀平 篤志" },
      { key: "meetingTitle", label: "ミーティング名", example: "月例チームMTG" },
      { key: "meetingDescription", label: "ミーティング説明（空白可）", example: "議題：先月の振り返り" },
      { key: "deadlineStr", label: "回答期限テキスト（空白可）", example: "（回答期限: 2024/7/10）" },
      { key: "meetingUrl", label: "ミーティングページURL", example: "https://app.example.com/meetings/xxx" },
    ],
  },
  {
    emailKey: "meeting_response_member",
    label: "日程回答受付（メンバー向け）",
    category: "meeting",
    triggerDescription: "メンバーがミーティングの日程回答を送信したとき（回答者本人に送信）",
    enabled: true,
    subject: "【{{appTitle}}】📅 「{{meetingTitle}}」への回答を受け付けました",
    bodyText: `{{memberName}} さん

「{{meetingTitle}}」への回答を受け付けました。
主催者が日程を確定したらお知らせします。

▼ 回答確認URL
{{meetingUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "memberName", label: "回答メンバー名", example: "山田 太郎" },
      { key: "meetingTitle", label: "ミーティング名", example: "月例チームMTG" },
      { key: "meetingUrl", label: "ミーティングページURL", example: "https://app.example.com/meetings/xxx" },
    ],
  },
  {
    emailKey: "meeting_response_guest",
    label: "日程回答受付（外部ゲスト向け）",
    category: "meeting",
    triggerDescription: "外部ゲストがミーティングの日程回答を初めて送信したとき（ゲスト本人に送信）",
    enabled: true,
    subject: "【{{appTitle}}】📅 「{{meetingTitle}}」への回答を受け付けました",
    bodyText: `{{guestName}} さん

「{{meetingTitle}}」への回答を受け付けました。

▼ 回答確認・変更URL（ブックマーク推奨）
{{scheduleUrl}}

このURLから、回答の変更やミーティングの確定状況をいつでも確認できます。

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "guestName", label: "ゲスト名", example: "鈴木 一郎" },
      { key: "hostName", label: "主催者名", example: "紀平 篤志" },
      { key: "meetingTitle", label: "ミーティング名", example: "月例チームMTG" },
      { key: "scheduleUrl", label: "個人ページURL（ブックマーク用）", example: "https://app.example.com/schedule/xxx" },
    ],
  },
  {
    emailKey: "meeting_confirmed_member",
    label: "日程確定通知（メンバー向け）",
    category: "meeting",
    triggerDescription: "ミーティングの日程が確定したとき（参加メンバー全員に送信）",
    enabled: true,
    subject: "【{{appTitle}}】📅 「{{meetingTitle}}」の日程が確定しました",
    bodyText: `{{memberName}} さん

「{{meetingTitle}}」の日程が確定しました！

▼ 確定日時
{{confirmedDate}}
主催：{{hostName}}
{{urlPendingNote}}

▼ 詳細確認URL
{{meetingUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "memberName", label: "メンバー名", example: "山田 太郎" },
      { key: "hostName", label: "主催者名", example: "紀平 篤志" },
      { key: "meetingTitle", label: "ミーティング名", example: "月例チームMTG" },
      { key: "confirmedDate", label: "確定日時", example: "2024年7月15日(月) 10:00〜11:00" },
      { key: "urlPendingNote", label: "会議URL未定の注記（設定済みなら空）", example: "📹 会議URLは別途お知らせします" },
      { key: "meetingUrl", label: "ミーティングページURL", example: "https://app.example.com/meetings/xxx" },
    ],
  },
  {
    emailKey: "meeting_confirmed_guest",
    label: "日程確定通知（外部ゲスト向け）",
    category: "meeting",
    triggerDescription: "ミーティングの日程が確定したとき（外部ゲスト全員に送信）",
    enabled: true,
    subject: "【{{appTitle}}】📅 「{{meetingTitle}}」の日程が確定しました",
    bodyText: `{{guestName}} さん

「{{meetingTitle}}」の日程が確定しました！

▼ 確定日時
{{confirmedDate}}
主催：{{hostName}}
{{urlPendingNote}}

▼ 回答確認・変更URL（ブックマーク推奨）
{{scheduleUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "guestName", label: "ゲスト名", example: "鈴木 一郎" },
      { key: "hostName", label: "主催者名", example: "紀平 篤志" },
      { key: "meetingTitle", label: "ミーティング名", example: "月例チームMTG" },
      { key: "confirmedDate", label: "確定日時", example: "2024年7月15日(月) 10:00〜11:00" },
      { key: "urlPendingNote", label: "会議URL未定の注記（設定済みなら空）", example: "📹 会議URLは別途お知らせします" },
      { key: "scheduleUrl", label: "個人ページURL", example: "https://app.example.com/schedule/xxx" },
    ],
  },
  {
    emailKey: "meeting_details_member",
    label: "ミーティング詳細更新（メンバー向け）",
    category: "meeting",
    triggerDescription: "ミーティングの詳細情報が追加・更新されたとき（参加メンバー全員に送信）",
    enabled: true,
    subject: "【{{appTitle}}】📋 「{{meetingTitle}}」に詳細情報が追加されました",
    bodyText: `{{memberName}} さん

「{{meetingTitle}}」に詳細情報が追加されました。

▼ 詳細
{{details}}

主催：{{hostName}}

▼ 確認URL
{{meetingUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "memberName", label: "メンバー名", example: "山田 太郎" },
      { key: "hostName", label: "主催者名", example: "紀平 篤志" },
      { key: "meetingTitle", label: "ミーティング名", example: "月例チームMTG" },
      { key: "details", label: "詳細内容", example: "会議室はB棟2階です" },
      { key: "meetingUrl", label: "ミーティングページURL", example: "https://app.example.com/meetings/xxx" },
    ],
  },
  {
    emailKey: "meeting_details_guest",
    label: "ミーティング詳細更新（外部ゲスト向け）",
    category: "meeting",
    triggerDescription: "ミーティングの詳細情報が追加・更新されたとき（外部ゲスト全員に送信）",
    enabled: true,
    subject: "【{{appTitle}}】📋 「{{meetingTitle}}」に詳細情報が追加されました",
    bodyText: `{{guestName}} さん

「{{meetingTitle}}」に詳細情報が追加されました。

▼ 詳細
{{details}}

▼ 回答確認URL
{{scheduleUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "guestName", label: "ゲスト名", example: "鈴木 一郎" },
      { key: "hostName", label: "主催者名", example: "紀平 篤志" },
      { key: "meetingTitle", label: "ミーティング名", example: "月例チームMTG" },
      { key: "details", label: "詳細内容", example: "会議室はB棟2階です" },
      { key: "scheduleUrl", label: "個人ページURL", example: "https://app.example.com/schedule/xxx" },
    ],
  },
  {
    emailKey: "meeting_conference_member",
    label: "会議URL通知（メンバー向け）",
    category: "meeting",
    triggerDescription: "ミーティングにZoom/Google Meet等の会議URLが設定されたとき（メンバー向け）",
    enabled: true,
    subject: "【{{appTitle}}】📹 {{subjectAction}}「{{meetingTitle}}」",
    bodyText: `{{memberName}} さん

{{confirmIntro}}

▼ 確定日時
{{confirmedDate}}
主催：{{hostName}}

▼ {{conferenceType}}参加URL
{{conferenceUrl}}

▼ ミーティング詳細URL
{{meetingUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "memberName", label: "メンバー名", example: "山田 太郎" },
      { key: "hostName", label: "主催者名", example: "紀平 篤志" },
      { key: "meetingTitle", label: "ミーティング名", example: "月例チームMTG" },
      { key: "confirmedDate", label: "確定日時", example: "2024年7月15日(月) 10:00〜11:00" },
      { key: "conferenceType", label: "会議ツール名", example: "Google Meet" },
      { key: "conferenceUrl", label: "会議URL", example: "https://meet.google.com/xxx" },
      { key: "subjectAction", label: "件名アクション文", example: "日程が確定し、会議URLが届きました — " },
      { key: "confirmHeading", label: "確定見出し文", example: "日程確定 ＆ 会議URL" },
      { key: "confirmIntro", label: "本文紹介文", example: "「月例チームMTG」の日程が確定し、会議URLが発行されました！" },
      { key: "meetingUrl", label: "ミーティングページURL", example: "https://app.example.com/meetings/xxx" },
    ],
  },
  {
    emailKey: "meeting_conference_guest",
    label: "会議URL通知（外部ゲスト向け）",
    category: "meeting",
    triggerDescription: "ミーティングにZoom/Google Meet等の会議URLが設定されたとき（外部ゲスト向け）",
    enabled: true,
    subject: "【{{appTitle}}】📹 {{subjectAction}}「{{meetingTitle}}」",
    bodyText: `{{guestName}} さん

{{confirmIntro}}

▼ 確定日時
{{confirmedDate}}
主催：{{hostName}}

▼ {{conferenceType}}参加URL
{{conferenceUrl}}

▼ 回答確認・変更URL（ブックマーク推奨）
{{scheduleUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "guestName", label: "ゲスト名", example: "鈴木 一郎" },
      { key: "hostName", label: "主催者名", example: "紀平 篤志" },
      { key: "meetingTitle", label: "ミーティング名", example: "月例チームMTG" },
      { key: "confirmedDate", label: "確定日時", example: "2024年7月15日(月) 10:00〜11:00" },
      { key: "conferenceType", label: "会議ツール名", example: "Google Meet" },
      { key: "conferenceUrl", label: "会議URL", example: "https://meet.google.com/xxx" },
      { key: "subjectAction", label: "件名アクション文", example: "日程が確定し、会議URLが届きました — " },
      { key: "confirmHeading", label: "確定見出し文", example: "日程確定 ＆ 会議URL" },
      { key: "confirmIntro", label: "本文紹介文", example: "「月例チームMTG」の日程が確定し、会議URLが発行されました！" },
      { key: "scheduleUrl", label: "個人ページURL", example: "https://app.example.com/schedule/xxx" },
    ],
  },

  // ============================================================
  // ミーティング（追加）
  // ============================================================
  {
    emailKey: "meeting_response_host",
    label: "日程回答通知（主催者向け）",
    category: "meeting",
    triggerDescription: "メンバーがミーティングの日程回答を送信したとき（主催者に送信）",
    enabled: true,
    subject: "【{{appTitle}}】📅 「{{meetingTitle}}」に{{respondentName}}さんが回答しました",
    bodyText: `{{hostName}} さん

「{{meetingTitle}}」に{{respondentName}}さんが日程回答を送信しました。

▼ ミーティングページURL
{{meetingUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "hostName", label: "主催者名", example: "紀平 篤志" },
      { key: "respondentName", label: "回答者名", example: "山田 太郎" },
      { key: "meetingTitle", label: "ミーティング名", example: "月例チームMTG" },
      { key: "meetingUrl", label: "ミーティングページURL", example: "https://app.example.com/meetings/xxx" },
    ],
  },

  // ============================================================
  // 1to1
  // ============================================================
  {
    emailKey: "oneonone_request",
    label: "1to1申込通知",
    category: "oneonone",
    triggerDescription: "メンバーが別のメンバーに1to1を申し込んだとき（相手に送信）",
    enabled: true,
    subject: "【{{appTitle}}】{{requesterName}}さんから1to1の申込が届きました",
    bodyText: `{{responderName}} さん

{{requesterName}}さんから1to1の申込が届きました！

{{schedulerBlock}}アプリを開いて内容を確認してみましょう。

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "responderName", label: "受取人名", example: "山田 太郎" },
      { key: "requesterName", label: "申込者名", example: "紀平 篤志" },
      { key: "schedulerBlock", label: "スケジューラーURL（設定済みの場合のみ表示）", example: "📅 日程を予約する: https://...\n\n" },
    ],
  },

  // ============================================================
  // スケジューラー（1to1予約）
  // ============================================================
  {
    emailKey: "scheduler_booking_guest",
    label: "1to1予約確認（予約者向け）",
    category: "oneonone",
    triggerDescription: "スケジューラーから1to1の予約が確定したとき（予約したゲスト本人に送信）",
    enabled: true,
    subject: "【予約確定】{{dateRange}} {{hostName}}さんとのミーティング",
    bodyText: `{{guestName}} さん

{{hostName}}さんとの「{{displayTitle}}」の予約が確定しました。

▼ 日時
{{dateRange}}

{{conferenceInfo}}

▼ 予約の管理（キャンセル等）
{{cancellationUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "guestName", label: "予約者名", example: "山田 太郎" },
      { key: "hostName", label: "ホスト名（申込者）", example: "紀平 篤志" },
      { key: "displayTitle", label: "スケジューラーのタイトル", example: "1on1 ミーティング" },
      { key: "dateRange", label: "予約日時", example: "2024年7月15日(月) 10:00〜11:00" },
      { key: "conferenceInfo", label: "会議URL情報", example: "📹 Google Meet: https://meet.google.com/xxx" },
      { key: "cancellationUrl", label: "キャンセルURL", example: "https://app.example.com/book/confirmation/xxx" },
    ],
  },
  {
    emailKey: "scheduler_booking_host",
    label: "1to1予約通知（ホスト向け）",
    category: "oneonone",
    triggerDescription: "スケジューラーから1to1の予約が確定したとき（ホスト＝申込者に送信）",
    enabled: true,
    subject: "【予約通知】{{dateRange}} {{guestName}}さんが予約しました",
    bodyText: `{{hostName}} さん

{{guestName}}さん（{{guestEmail}}）から「{{displayTitle}}」の予約が入りました。

▼ 日時
{{dateRange}}

{{conferenceInfo}}
{{guestMessageBlock}}

▼ 予約詳細
{{bookingUrl}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "hostName", label: "ホスト名（申込者）", example: "紀平 篤志" },
      { key: "guestName", label: "予約者名", example: "山田 太郎" },
      { key: "guestEmail", label: "予約者メール", example: "yamada@example.com" },
      { key: "displayTitle", label: "スケジューラーのタイトル", example: "1on1 ミーティング" },
      { key: "dateRange", label: "予約日時", example: "2024年7月15日(月) 10:00〜11:00" },
      { key: "conferenceInfo", label: "会議URL情報", example: "📹 Google Meet: https://meet.google.com/xxx" },
      { key: "guestMessageBlock", label: "予約者メッセージ（ある場合のみ表示）", example: "💬 メッセージ：よろしくお願いします" },
      { key: "bookingUrl", label: "予約詳細URL", example: "https://app.example.com/scheduler/bookings/xxx" },
    ],
  },

  // ============================================================
  // カード発注
  // ============================================================
  {
    emailKey: "card_order_company",
    label: "カード発注通知（カード会社向け）",
    category: "card",
    triggerDescription: "メンバーがカードを発注したとき（カード会社宛に送信）",
    enabled: true,
    subject: "【{{appTitle}}】カード作成のご注文：{{memberName}}様",
    bodyText: `カード作成のご注文が届きました

▼ 注文プラン
{{planName}}　¥{{planPrice}}

▼ 会員情報
{{memberTableText}}

▼ USP（強み）
{{skillsText}}

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "memberName", label: "注文者名", example: "山田 太郎" },
      { key: "planName", label: "プラン名", example: "スタンダードプラン" },
      { key: "planPrice", label: "価格（数字）", example: "15000" },
      { key: "memberTableText", label: "会員情報（自動生成テキスト）", example: "お名前: 山田 太郎\nメール: yamada@example.com" },
      { key: "skillsText", label: "USP一覧（自動生成テキスト）", example: "・⭐ リスク判断力" },
      { key: "characterLabel", label: "キャラクター", example: "ライオン" },
    ],
  },
  {
    emailKey: "card_order_confirm",
    label: "カード発注確認（注文者向け）",
    category: "card",
    triggerDescription: "メンバーがカードを発注したとき（注文者本人に送信）",
    enabled: true,
    subject: "【{{appTitle}}】カード作成のご注文を承りました",
    bodyText: `{{thankYouMessage}}

{{memberName}} 様
以下の内容でご注文を承りました。

▼ 注文プラン
{{planName}}　¥{{planPrice}}

▼ キャラクター
{{characterLabel}}

▼ USP（強み）
{{skillsText}}

ご不明な点は {{companyName}} までお問い合わせください。

---
{{appTitle}}`,
    availableVars: [
      { key: "appTitle", label: "アプリ名", example: "白樺クエスト" },
      { key: "memberName", label: "注文者名", example: "山田 太郎" },
      { key: "planName", label: "プラン名", example: "スタンダードプラン" },
      { key: "planPrice", label: "価格（数字）", example: "15000" },
      { key: "thankYouMessage", label: "サンクスメッセージ", example: "ご注文ありがとうございました。" },
      { key: "companyName", label: "カード会社名", example: "株式会社〇〇" },
      { key: "skillsText", label: "USP一覧（自動生成テキスト）", example: "・⭐ リスク判断力" },
      { key: "characterLabel", label: "キャラクター", example: "ライオン" },
      { key: "orderAddress", label: "カード記載住所", example: "東京都渋谷区..." },
      { key: "orderPhone", label: "カード記載電話番号", example: "03-0000-0000" },
    ],
  },
];

export const EMAIL_DEFAULTS_MAP = new Map<string, EmailDefault>(
  EMAIL_DEFAULTS.map((d) => [d.emailKey, d])
);

export const CATEGORY_LABELS: Record<EmailDefault["category"], string> = {
  auth: "認証",
  usp: "USP",
  meeting: "ミーティング",
  oneonone: "1to1",
  card: "カード発注",
  scheduler: "スケジューラー",
};
