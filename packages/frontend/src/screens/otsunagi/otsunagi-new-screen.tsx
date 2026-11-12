// =============================================================
// お繋ぎ（ご紹介）を作る画面
//   ① お繋ぎ先のメンバー ② 外部の方（名前・会社名・メール） ③ ひとこと
//   メールアドレスを入れると、システムが案内のメールを送る。わからなければ空のまま、案内文とリンクを、ふだんの連絡手段で送る
// =============================================================
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Copy, Loader2, Search, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { MemberAvatar } from "@/components/member-avatar";
import { useAuthStore } from "@/stores/auth-store";
import type { Contact } from "@/lib/contacts";
import { buildGuestMessage } from "./_types";

type Member = { id: string; name: string; emoji: string; bgColor: string; avatarImageKey?: string | null; connectionStatus: string };
type CreateResult = { id: string; receptionUrl: string; guestEmailSent: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE = 1000;

export function OtsunagiNewScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [memberId, setMemberId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestCompany, setGuestCompany] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [showContacts, setShowContacts] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<{ data: Member[] }>("/members"),
    staleTime: 5 * 60_000,
  });
  const { data: contactsData } = useQuery({
    queryKey: ["collab", "contacts"],
    queryFn: () => api.get<{ data: Contact[] }>("/collab/contacts"),
    enabled: showContacts,
  });
  const meName = useAuthStore((s) => s.user?.name) ?? "";

  const members = (membersData?.data ?? []).filter((m) => m.connectionStatus !== "self");
  const q = memberQuery.trim();
  const shownMembers = q ? members.filter((m) => m.name.includes(q)) : members;
  const selected = members.find((m) => m.id === memberId) ?? null;
  const contacts = (contactsData?.data ?? []).filter((c) => c.mine && c.name);
  const cq = contactQuery.trim();
  const shownContacts = (cq ? contacts.filter((c) => `${c.name ?? ""} ${c.company ?? ""}`.includes(cq)) : contacts).slice(0, 30);

  const emailTyped = guestEmail.trim() !== "";
  const emailOk = !emailTyped || EMAIL_RE.test(guestEmail.trim());
  const canSubmit = !!memberId && !!guestName.trim() && emailOk && (!emailTyped || consent);

  const create = useMutation({
    mutationFn: () => api.post<{ data: CreateResult }>("/otsunagi", {
      memberId, guestName: guestName.trim(), guestCompany: guestCompany.trim() || undefined,
      guestEmail: emailTyped ? guestEmail.trim() : undefined, emailConsent: emailTyped ? consent : undefined,
      message: message.trim() || undefined,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["otsunagi"] });
      setResult(res.data);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "うまく作れませんでした。少し待ってから、もう一度お試しください。"),
  });

  function submit() {
    setError("");
    if (!memberId) { setError("お繋ぎするメンバーを選んでください"); return; }
    if (!guestName.trim()) { setError("お繋ぎする相手（外部の方）のお名前を入力してください"); return; }
    if (emailTyped && !emailOk) { setError("メールアドレスの形式が正しくありません"); return; }
    if (emailTyped && !consent) { setError("メールアドレスを入力したときは、「ご本人の了承を得ています」にチェックを入れてください"); return; }
    create.mutate();
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* コピーできないときは、手で選んでもらう */ }
  }

  // ---- 作成後 ----
  if (result && selected) {
    const text = buildGuestMessage({ guestName: guestName.trim(), introducerName: meName, memberName: selected.name, url: result.receptionUrl });
    return (
      <div className="px-4 py-8 pb-24 max-w-xl mx-auto">
        <div className="text-center mb-6">
          <p className="text-4xl mb-2">🔗</p>
          <h1 className="text-xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>お繋ぎを作りました</h1>
          <p className="text-sm" style={{ color: "var(--color-ink-600)" }}>{selected.name}さんに、お知らせを送りました。</p>
        </div>

        {result.guestEmailSent ? (
          <div className="card-paper rounded-2xl p-4 mb-4">
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-800)" }}>✉️ {guestName.trim()}さんへ、メールで案内しました</p>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
              日程の準備ができたら、{guestName.trim()}さんへ、自動でメールが届きます。あなたが、ほかに送るものはありません。
            </p>
          </div>
        ) : (
          <div className="card-paper rounded-2xl p-4 mb-4">
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-800)" }}>📨 {guestName.trim()}さんへ、案内を送ってください（1回だけ）</p>
            <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
              メールアドレスがわからないので、ふだんの連絡手段（LINE・Messenger など）で、下の案内文を送ってください。相手が、開いたページでメールアドレスを入れれば、日程の準備ができたときに、メールでお知らせが届きます。
            </p>
            <textarea readOnly value={text} rows={9} className="w-full px-3 py-2.5 rounded-xl border text-sm leading-relaxed"
              style={{ borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-800)" }} onFocus={(e) => e.currentTarget.select()} />
            <button onClick={() => copy(text)} className="mt-2 w-full py-2.5 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2" style={{ background: "var(--color-brand)" }}>
              {copied ? <><Check size={15} /> コピーしました</> : <><Copy size={15} /> 案内文をコピー</>}
            </button>
          </div>
        )}

        <p className="text-xs mb-5 px-1" style={{ color: "var(--color-ink-500)" }}>
          このあとは、何もしなくて大丈夫です。日程が決まったら、お知らせします。進み具合は、いつでも「お繋ぎの状況」で見られます。
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Link to={`/otsunagi/${result.id}`} className="py-3 rounded-2xl text-sm font-bold text-center text-white" style={{ background: "var(--color-brand)" }}>状況を見る</Link>
          <Link to="/otsunagi" className="py-3 rounded-2xl text-sm font-medium text-center" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>一覧へ</Link>
        </div>
      </div>
    );
  }

  const label = "block text-xs font-medium mb-1.5";
  const input = "w-full px-3 py-2.5 rounded-xl border text-sm outline-none";
  const inputStyle = { borderColor: "var(--color-paper-300)", background: "var(--color-paper-50)", color: "var(--color-ink-900)" } as const;

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="p-2 rounded-2xl hover:opacity-70" style={{ background: "var(--color-paper-200)" }} aria-label="戻る">
          <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
        </button>
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>🔗 新しくお繋ぎする</h1>
      </div>
      <p className="text-xs mb-5" style={{ color: "var(--color-ink-500)" }}>
        メンバーと外部の方の1to1を、お繋ぎします。あなたは、1to1には参加しません（あなたのカレンダーにも、予定は入りません）。日程の調整は、お繋ぎ先のメンバーが行います。
      </p>

      <section className="card-paper rounded-2xl p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--color-ink-800)" }}>① お繋ぎするメンバー</h2>
        {selected ? (
          <div className="flex items-center gap-3 p-3 rounded-2xl" style={{ background: "var(--color-paper-100)", border: "1.5px solid var(--color-brand)" }}>
            <MemberAvatar memberId={selected.id} emoji={selected.emoji} bgColor={selected.bgColor} avatarImageKey={selected.avatarImageKey} />
            <p className="flex-1 text-sm font-semibold" style={{ color: "var(--color-ink-900)" }}>{selected.name}さん</p>
            <button onClick={() => setMemberId("")} className="p-1.5 rounded-full" style={{ background: "var(--color-paper-200)" }} aria-label="選び直す"><X size={14} /></button>
          </div>
        ) : (
          <>
            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
              <input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="名前で探す" className={`${input} pl-9`} style={inputStyle} />
            </div>
            {membersLoading ? (
              <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1.5">
                {shownMembers.length === 0 && <p className="text-xs py-3 text-center" style={{ color: "var(--color-ink-400)" }}>あてはまるメンバーがいません</p>}
                {shownMembers.map((m) => (
                  <button key={m.id} onClick={() => setMemberId(m.id)} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition active:opacity-80"
                    style={{ background: "var(--color-paper-100)" }}>
                    <MemberAvatar memberId={m.id} emoji={m.emoji} bgColor={m.bgColor} avatarImageKey={m.avatarImageKey} size="sm" />
                    <span className="text-sm" style={{ color: "var(--color-ink-800)" }}>{m.name}さん</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="card-paper rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink-800)" }}>② お繋ぎする外部の方</h2>
          <button type="button" onClick={() => setShowContacts((v) => !v)} className="text-xs font-medium underline" style={{ color: "var(--color-brand)" }}>
            {showContacts ? "人脈から選ぶのを閉じる" : "自分の人脈から選ぶ"}
          </button>
        </div>
        {showContacts && (
          <div className="mb-3 p-2.5 rounded-xl" style={{ background: "var(--color-paper-100)" }}>
            <input value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} placeholder="名前・会社名で探す" className={`${input} mb-2`} style={inputStyle} />
            <div className="max-h-44 overflow-y-auto space-y-1">
              {!contactsData && <div className="flex justify-center py-3"><Loader2 size={14} className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>}
              {contactsData && shownContacts.length === 0 && <p className="text-xs py-2 text-center" style={{ color: "var(--color-ink-400)" }}>あてはまる人脈がありません</p>}
              {shownContacts.map((c) => (
                <button key={c.id} type="button" onClick={() => { setGuestName(c.name ?? ""); setGuestCompany(c.company ?? ""); setShowContacts(false); }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm transition active:opacity-80" style={{ background: "white", color: "var(--color-ink-800)" }}>
                  {c.name}{c.company ? <span className="text-xs" style={{ color: "var(--color-ink-500)" }}>（{c.company}）</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className={label} style={{ color: "var(--color-ink-700)" }}>お名前 <span style={{ color: "var(--color-brand)" }}>*</span></label>
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="田中 一郎" maxLength={60} className={input} style={inputStyle} />
          </div>
          <div>
            <label className={label} style={{ color: "var(--color-ink-700)" }}>会社名・屋号（任意）</label>
            <input value={guestCompany} onChange={(e) => setGuestCompany(e.target.value)} maxLength={100} className={input} style={inputStyle} />
          </div>
          <div>
            <label className={label} style={{ color: "var(--color-ink-700)" }}>メールアドレス（わかる場合だけ）</label>
            <input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="tanaka@example.com" className={input} style={inputStyle} />
            <p className="text-[11px] mt-1" style={{ color: "var(--color-ink-400)" }}>
              わからなければ、空のままで大丈夫です。このあと、案内文とリンクをお渡しします。
            </p>
            {emailTyped && (
              <label className="flex items-start gap-2 mt-2 p-2.5 rounded-xl cursor-pointer" style={{ background: "rgba(212,160,59,0.12)" }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                <span className="text-xs" style={{ color: "var(--color-ink-700)" }}>
                  <span className="font-medium">ご本人の了承を得ています</span>
                  <br />このメールアドレスに、お繋ぎのご案内や日程のお知らせを、システムから送ることを、ご本人に了承してもらっています。
                </span>
              </label>
            )}
          </div>
        </div>
      </section>

      <section className="card-paper rounded-2xl p-4 mb-5">
        <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-800)" }}>③ ひとこと（任意）</h2>
        <p className="text-[11px] mb-2" style={{ color: "var(--color-ink-400)" }}>お繋ぎの理由や、お二人に伝えたいことを、書いてください。メンバーにも、外部の方にも、表示されます。</p>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={MAX_MESSAGE}
          placeholder="例：新しいホームページを検討されているそうなので、Webに強い山田さんをご紹介します。" className={`${input} leading-relaxed`} style={inputStyle} />
        <p className="text-[11px] text-right" style={{ color: "var(--color-ink-400)" }}>{message.length}/{MAX_MESSAGE}</p>
      </section>

      {error && <p className="text-xs mb-3 px-3 py-2 rounded-xl" style={{ background: "rgba(181,56,75,0.08)", color: "var(--color-brand)" }}>{error}</p>}
      <button onClick={submit} disabled={!canSubmit || create.isPending} className="w-full py-3 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: "var(--color-brand)" }}>
        {create.isPending && <Loader2 size={15} className="animate-spin" />}
        この内容でお繋ぎする
      </button>
    </div>
  );
}
