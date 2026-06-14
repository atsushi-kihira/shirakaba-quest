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
