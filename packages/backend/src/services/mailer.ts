// =============================================================
// メール送信サービス（SendGrid）
// =============================================================

type SendMailOptions = {
  to: string;
  subject: string;
  text: string;
  html: string;
  apiKey: string;
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
      from: { email: "noreply@shirakaba-quest.app", name: "白樺クエスト" },
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
}): Promise<void> {
  if (opts.isDev) {
    // 開発環境ではコンソールに出力するだけ（実際には送信しない）
    console.log(`[DEV] OTP for ${opts.to}: ${opts.code}`);
    return;
  }

  await sendMail({
    to: opts.to,
    apiKey: opts.apiKey,
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
