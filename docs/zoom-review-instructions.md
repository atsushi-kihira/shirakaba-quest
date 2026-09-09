# Zoom連携の確認手順 / How to Generate a Zoom Meeting URL

Login page / ログインページ: https://bizquest.bizolve.jp/login
Test account / テストアカウント: david.gamus1@zoomappsec.us

---

## 0. Before you start / 事前準備（両パターン共通）

**EN:** Connect your Zoom account once, before trying either flow below.
1. Log in, then go to **マイページ (My Page)** → **日程調整設定 (Scheduling Settings)** → **外部サービス連携 (External Integrations)**.
2. Under the **Zoom** card, click **連携する (Connect)** and authorize the app on Zoom's consent screen.
3. You should see "Zoomとの連携が完了しました！" (Zoom connection complete) at the top of the page.

**JP:** 以下のどちらのパターンを試す場合も、先に一度Zoomアカウントを連携しておいてください。
1. ログイン後、**マイページ** → **日程調整設定** → **外部サービス連携** を開きます。
2. 「Zoom」のカードにある **連携する** ボタンを押し、Zoomの認可画面で許可します。
3. ページ上部に「Zoomとの連携が完了しました！」と表示されれば連携完了です。

---

## Pattern A: Regular meeting (multi-person) / パターンA: 通常のミーティング（複数人）

**EN — Steps:**
1. Go to the **ミーティング (Meetings)** tab in the bottom/side navigation.
2. Tap **ミーティングを立てる (Create a meeting)**.
3. Enter a title and at least one candidate date/time, then create the meeting.
4. Open the meeting you just created. As the host, you'll see a **⚙️ 主催者メニュー (Host menu)** section.
5. Under **日程の確定 (Confirm date)**, tap the candidate date row. **You do not need to wait for anyone else to respond** — as the host, you can confirm it immediately.
6. A confirmation dialog opens with **📹 会議URLを同時に設定する (Also set a conference URL)**. Choose **Zoomを発行して確定 (Issue a Zoom link and confirm)**.
7. The Zoom meeting URL is generated immediately and shown at the top of the meeting page, next to the confirmed date.

**JP — 手順:**
1. 下部（またはサイド）ナビゲーションの **ミーティング** タブを開きます。
2. **ミーティングを立てる** をタップします。
3. タイトルと候補日時を1つ以上入力し、ミーティングを作成します。
4. 作成したミーティングを開きます。主催者には **⚙️ 主催者メニュー** が表示されます。
5. **日程の確定** の欄で、候補日をタップします。**他の参加者の回答を待つ必要はありません** — 主催者はいつでも即座に確定できます。
6. 確認ダイアログが開き、**📹 会議URLを同時に設定する** という項目があります。ここで **Zoomを発行して確定** を選んでください。
7. その場でZoomの会議URLが発行され、確定日程と一緒にミーティング画面の上部に表示されます。

---

## Pattern B: 1-on-1 meeting / パターンB: 1to1（個別面談）

**EN — Steps:**
1. Go to the **なかま (Members)** tab and open any member's profile.
2. Instead of the normal "1to1を申し込む (Request a 1-on-1)" button, tap the smaller button below it: **📅 すでに日程調整済み？日時を指定して申し込む (Already arranged a time elsewhere? Request with a specific date/time)**.
3. In the modal, pick a date, start time, and duration.
4. Under **会議ツール (Conference tool)**, select **🎥 Zoom**.
5. Submit with **この内容で申し込む (Send this request)**.
6. The Zoom meeting URL is generated immediately, before the other member even responds — you (the requester/host) will see it right away.

**JP — 手順:**
1. **なかま** タブを開き、任意のメンバーのプロフィールを開きます。
2. 通常の「1to1を申し込む」ボタンではなく、その下にある小さいボタン **📅 すでに日程調整済み？日時を指定して申し込む** をタップします。
3. モーダル内で日付・開始時刻・所要時間を選びます。
4. **会議ツール** の項目で **🎥 Zoom** を選択します。
5. **この内容で申し込む** で送信します。
6. 相手が回答する前に、その場でZoomの会議URLが発行され、申込者（主催者）にすぐ表示されます。

---

## Note on the app's design / 補足

**EN:** By design, a Zoom/Google Meet URL is only generated once a specific date/time is confirmed by the host (either by confirming a candidate date in a regular meeting, or by specifying a fixed date/time in the 1-on-1 "prearranged" flow above). Simply creating a meeting or sending a normal 1-on-1 request — without confirming a date — will not yet generate a conference URL, since the app doesn't know which time slot to book. This is intentional, not a bug; we've added on-screen hints to make this clearer.

**JP:** 本アプリの仕様として、ZoomやGoogle MeetのURLは、主催者が具体的な日時を確定して初めて発行されます（通常ミーティングでは候補日を確定する、1to1では上記の「日時を指定して申し込む」で日時を指定する、のいずれか）。ミーティングを作成しただけ、あるいは通常の1to1を申し込んだだけ（日時未確定）の状態では、どの時間枠で予約すればよいか未定のため、会議URLはまだ発行されません。これは仕様であり不具合ではありませんが、分かりやすいよう画面上に補足の案内を追加しました。
