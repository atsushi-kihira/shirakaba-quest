// =============================================================
// メール送信サービス（SendGrid）
// =============================================================

type SendMailOptions = {
  to: string;
  subject: string;
  text: string;
  html: string;
  apiKey: string;
  fromEmail?: string;
};

export async function sendMail(opts: SendMailOptions): Promise<void> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: opts.to }] }],
      from: { email: opts.fromEmail ?? "a.kihira@bizolve.jp", name: "白樺クエスト" },
      subject: opts.subject,
      content: [
        { type: "text/plain", value: opts.text },
        { type: "text/html", value: opts.html },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid error ${res.status}: ${body}`);
  }
}

/** OTPメールを送信する */
export async function sendOtpMail(opts: {
  to: string;
  code: string;
  apiKey: string;
  isDev: boolean;
  fromEmail?: string;
}): Promise<void> {
  if (opts.isDev) {
    // 開発環境ではコンソールに出力するだけ（実際には送信しない）
    console.log(`[DEV] OTP for ${opts.to}: ${opts.code}`);
    return;
  }

  await sendMail({
    to: opts.to,
    apiKey: opts.apiKey,
    fromEmail: opts.fromEmail,
    subject: `【白樺クエスト】ログインコード: ${opts.code}`,
    text: [
      "白樺クエストにログインするための確認コードをお送りします。",
      "",
      `確認コード: ${opts.code}`,
      "",
      "このコードの有効期限は10分です。",
      "身に覚えのない場合は、このメールを無視してください。",
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#B5384B;font-size:20px;margin-bottom:8px;">🃏 白樺クエスト</h2>
        <p style="color:#4A3E36;margin-bottom:24px;">ログインのための確認コードです。</p>
        <div style="background:#FAF5E8;border:2px solid #D9C9B0;border-radius:16px;padding:24px;text-align:center;">
          <p style="font-size:40px;font-weight:bold;letter-spacing:12px;color:#1A1410;margin:0;">${opts.code}</p>
        </div>
        <p style="color:#9B8B7A;font-size:13px;margin-top:16px;">
          ※ このコードの有効期限は<strong>10分</strong>です。<br>
          身に覚えのない場合は、このメールを無視してください。
        </p>
      </div>
    `,
  });
}

/** USP新規申請を管理者に通知するメール */
export async function sendUspRequestNotificationMail(opts: {
  to: string;
  adminName: string;
  requesterName: string;
  requesterEmail: string;
  uspName: string;
  emoji: string;
  description: string;
  appTitle: string;
  apiKey: string;
  isDev: boolean;
  fromEmail?: string;
}): Promise<void> {
  if (opts.isDev) {
    console.log(`[DEV] USP申請通知 → ${opts.to}: ${opts.requesterName}さんが「${opts.uspName}」を申請`);
    return;
  }

  await sendMail({
    to: opts.to,
    apiKey: opts.apiKey,
    fromEmail: opts.fromEmail,
    subject: `【${opts.appTitle}】新しいUSP申請が届きました：${opts.uspName}`,
    text: [
      `${opts.adminName}さん`,
      "",
      `${opts.requesterName}さん（${opts.requesterEmail}）から新しいUSPの申請が届きました。`,
      "",
      `USP名: ${opts.emoji} ${opts.uspName}`,
      `説明: ${opts.description || "（説明なし）"}`,
      "",
      "管理画面のUSP管理から承認または却下を行ってください。",
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#B5384B;font-size:20px;margin-bottom:8px;">⭐ ${opts.appTitle}</h2>
        <p style="color:#4A3E36;line-height:1.7;">
          ${opts.adminName}さん<br><br>
          <strong>${opts.requesterName}</strong>さん（${opts.requesterEmail}）から<br>
          新しいUSPの申請が届きました！
        </p>
        <div style="background:#FAF5E8;border:2px solid #D9C9B0;border-radius:16px;padding:20px;margin:16px 0;">
          <p style="font-size:22px;font-weight:bold;color:#1A1410;margin:0 0 8px;">
            ${opts.emoji} ${opts.uspName}
          </p>
          <p style="color:#6B5E50;font-size:14px;margin:0;">
            ${opts.description || "（説明なし）"}
          </p>
        </div>
        <p style="color:#9B8B7A;font-size:13px;">
          管理画面の「USP管理」から承認または却下を行ってください。
        </p>
      </div>
    `,
  });
}

/** USP申請の審査結果をメンバーに通知するメール */
export async function sendUspRequestResultMail(opts: {
  to: string;
  requesterName: string;
  uspName: string;
  emoji: string;
  approved: boolean;
  reviewNote?: string;
  appTitle: string;
  apiKey: string;
  isDev: boolean;
  fromEmail?: string;
}): Promise<void> {
  if (opts.isDev) {
    console.log(`[DEV] USP審査結果 → ${opts.to}: 「${opts.uspName}」${opts.approved ? "承認" : "却下"}`);
    return;
  }

  const resultLabel = opts.approved ? "✅ 承認されました！" : "❌ 今回は見送りとなりました";
  const resultColor = opts.approved ? "#5A8C5C" : "#B5384B";

  await sendMail({
    to: opts.to,
    apiKey: opts.apiKey,
    fromEmail: opts.fromEmail,
    subject: `【${opts.appTitle}】USP申請の結果：${opts.uspName}`,
    text: [
      `${opts.requesterName}さん`,
      "",
      `申請されたUSP「${opts.uspName}」の審査結果をお知らせします。`,
      "",
      `結果: ${opts.approved ? "承認されました！" : "今回は見送りとなりました"}`,
      ...(opts.reviewNote ? [`コメント: ${opts.reviewNote}`] : []),
      "",
      opts.approved
        ? "ログインしてUSPを選択してください。"
        : "ご不明な点は運営チームにお問い合わせください。",
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#B5384B;font-size:20px;margin-bottom:8px;">🃏 ${opts.appTitle}</h2>
        <p style="color:#4A3E36;line-height:1.7;">
          ${opts.requesterName}さん<br><br>
          申請されたUSP「<strong>${opts.emoji} ${opts.uspName}</strong>」の審査結果が届きました。
        </p>
        <div style="background:#FAF5E8;border:2px solid ${resultColor};border-radius:16px;padding:20px;margin:16px 0;text-align:center;">
          <p style="font-size:18px;font-weight:bold;color:${resultColor};margin:0;">
            ${resultLabel}
          </p>
          ${opts.reviewNote ? `<p style="color:#6B5E50;font-size:14px;margin:12px 0 0;">${opts.reviewNote}</p>` : ""}
        </div>
        <p style="color:#9B8B7A;font-size:13px;">
          ${opts.approved ? "ログインしてUSP選択からご利用いただけます。" : "ご不明な点は運営チームにお問い合わせください。"}
        </p>
      </div>
    `,
  });
}

/** 1to1 申込通知メールを送信する */
export async function sendOneOnOneRequestMail(opts: {
  to: string;
  responderName: string;
  requesterName: string;
  appTitle: string;
  apiKey: string;
  isDev: boolean;
  fromEmail?: string;
}): Promise<void> {
  if (opts.isDev) {
    console.log(`[DEV] 1to1通知メール → ${opts.to}: ${opts.requesterName}さんから申込`);
    return;
  }

  await sendMail({
    to: opts.to,
    apiKey: opts.apiKey,
    fromEmail: opts.fromEmail,
    subject: `【${opts.appTitle}】${opts.requesterName}さんから1to1の申込が届きました`,
    text: [
      `${opts.responderName}さん`,
      "",
      `${opts.requesterName}さんから1to1の申込が届きました🤝`,
      "",
      `${opts.appTitle}にログインして確認してみましょう！`,
    ].join("\n"),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#B5384B;font-size:20px;margin-bottom:8px;">🤝 ${opts.appTitle}</h2>
        <p style="color:#4A3E36;line-height:1.7;">
          ${opts.responderName}さん<br><br>
          <strong>${opts.requesterName}</strong>さんから1to1の申込が届きました！<br>
          ${opts.appTitle}を開いて、内容を確認してみましょう。
        </p>
      </div>
    `,
  });
}
