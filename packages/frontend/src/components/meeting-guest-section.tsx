// =============================================================
// ミーティング・定例会の作成画面で、外部ゲスト（ビジター）を招待する部分
//   ・ゲスト用の共有URL: 作成する前に、URLだけ先に発行できる（有効期間は発行時に選べる。初期は7日）。
//     作成すると、同じURLがそのままミーティング・定例会のゲスト用URLになる。作成せずにやめたものは、期限が来たら自動で削除される。
//     作成前にURLを開いた人には、「準備中」と表示される。
//   ・ゲストを個別に指定: 自分の外部人脈から選ぶ／名前とメールアドレスを入力する（どちらも必須。回答を、メールアドレスで対応づけるため）。
//     作成と同時に、全員に招待メールを送る。人脈にメールアドレスがない場合は、ここで入力して人脈に保存することもできる。
//   ・メールアドレスのわからない方には、共有URLを何らかの方法でお伝えする（回答時に、名前・メールアドレス・会社名を入力してもらう）。
// =============================================================
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link as LinkIcon, Loader2, Mail, Plus, Search, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { fmtDateTimeFull } from "@/lib/date";
import { useTimezone } from "@/hooks/use-timezone";

export type GuestDraft = {
  key: string;
  contactId?: string;
  name: string;
  email: string;
  /** 人脈にメールアドレスが登録済みか（登録済みなら、そのメールアドレスを使う） */
  contactHadEmail: boolean;
  /** 入力したメールアドレスを、人脈にも保存するか（人脈にメールアドレスがない場合のみ） */
  saveToContact: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** メールアドレスが未入力・形式が正しくないゲストの名前（なければ null）。作成の前に確認する */
export function guestMissingEmail(guests: GuestDraft[]): string | null {
  const bad = guests.find((g) => !g.contactHadEmail && !EMAIL_RE.test(g.email.trim()));
  return bad ? bad.name : null;
}

export function guestsToPayload(guests: GuestDraft[]) {
  return guests.map((g) => ({
    name: g.name.trim(),
    email: g.contactHadEmail ? undefined : g.email.trim() || undefined,
    contactId: g.contactId,
    saveToContact: g.contactId && !g.contactHadEmail ? g.saveToContact : undefined,
  }));
}

type Contact = { id: string; name: string; company: string | null; email: string | null };
type Reservation = { token: string; expiresAt: number; url: string };

const DAY_OPTIONS = [1, 3, 7, 14, 30, 60];
const inputStyle = { background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" } as const;

type Props = {
  kind: "meeting" | "series";
  guests: GuestDraft[];
  onGuestsChange: (g: GuestDraft[]) => void;
  /** 発行済みの共有URLの予約トークン（なければ null）。作成するときに、いっしょに送る */
  onReservationChange: (token: string | null) => void;
};

export function MeetingGuestSection({ kind, guests, onGuestsChange, onReservationChange }: Props) {
  const { termExternalGuest } = useSettings();
  const tz = useTimezone();
  const qc = useQueryClient();
  const [days, setDays] = useState(7);
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualError, setManualError] = useState("");

  const reservationKey = ["invite-reservation", kind];
  const { data: reservationData } = useQuery({
    queryKey: reservationKey,
    queryFn: () => api.get<{ data: Reservation | null }>(`/invite-reservations?kind=${kind}`),
  });
  const reservation = reservationData?.data ?? null;
  useEffect(() => { onReservationChange(reservation?.token ?? null); }, [reservation?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = useMutation({
    mutationFn: () => api.post<{ data: Reservation }>("/invite-reservations", { kind, days }),
    onSuccess: () => qc.invalidateQueries({ queryKey: reservationKey }),
  });
  const discard = useMutation({
    mutationFn: () => api.delete(`/invite-reservations?kind=${kind}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: reservationKey }),
  });

  const { data: contactsData } = useQuery({
    queryKey: ["collab", "contacts", "for-guests"],
    queryFn: () => api.get<{ data: Contact[] }>("/collab/contacts"),
    staleTime: 60_000,
  });
  const contacts = contactsData?.data ?? [];
  const pickedContactIds = new Set(guests.map((g) => g.contactId).filter(Boolean));
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts
      .filter((ct) => !pickedContactIds.has(ct.id))
      .filter((ct) => !q || `${ct.name} ${ct.company ?? ""}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [contacts, search, guests]); // eslint-disable-line react-hooks/exhaustive-deps

  function addContact(ct: Contact) {
    onGuestsChange([...guests, {
      key: crypto.randomUUID(), contactId: ct.id, name: ct.name, email: ct.email ?? "",
      contactHadEmail: !!ct.email, saveToContact: true,
    }]);
    setSearch("");
  }
  function addManual() {
    const name = manualName.trim();
    const email = manualEmail.trim();
    if (!name) { setManualError("名前を入力してください"); return; }
    if (!email) { setManualError("メールアドレスを入力してください（わからない方には、共有URLをお伝えください）"); return; }
    if (!EMAIL_RE.test(email)) { setManualError("メールアドレスの形式が正しくありません"); return; }
    if (guests.some((g) => g.email.trim().toLowerCase() === email.toLowerCase())) { setManualError("同じメールアドレスの方が、すでに追加されています"); return; }
    onGuestsChange([...guests, { key: crypto.randomUUID(), name, email, contactHadEmail: false, saveToContact: false }]);
    setManualName(""); setManualEmail(""); setManualError("");
  }
  const update = (key: string, patch: Partial<GuestDraft>) => onGuestsChange(guests.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const remove = (key: string) => onGuestsChange(guests.filter((g) => g.key !== key));

  function copy() {
    if (!reservation) return;
    navigator.clipboard.writeText(reservation.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined);
  }

  const mailCount = guests.filter((g) => (g.contactHadEmail ? true : !!g.email.trim())).length;

  return (
    <div className="space-y-4 rounded-2xl p-4" style={{ background: "var(--color-paper-100)", border: "1px solid var(--color-paper-300)" }}>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--color-ink-800)" }}>🌐 {termExternalGuest}を招待（任意）</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          チャプター外の方を、作成と同時に招待できます。メールアドレスがわかる方は下で指定すると、招待メールが届きます。わからない方には、共有URLをお伝えください（回答のときに、名前・メールアドレス・会社名を入力してもらいます）。
        </p>
      </div>

      {/* ゲスト用の共有URL（作成前に発行） */}
      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>🔗 ゲスト用の共有URL（メールアドレスのわからない方に。先に発行して、送っておけます）</p>
        {reservation ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "var(--color-paper-200)" }}>
              <span className="flex-1 text-xs break-all" style={{ color: "var(--color-ink-600)" }}>{reservation.url}</span>
              <button type="button" onClick={copy} className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl font-medium"
                style={{ background: copied ? "rgba(90,140,92,0.15)" : "var(--color-brand)", color: copied ? "var(--color-success)" : "white" }}>
                {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "コピー済" : "コピー"}
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
              {fmtDateTimeFull(reservation.expiresAt, tz)} まで有効です。作成するまでは、開いた方に「準備中」と表示されます。作成すると、そのまま日程の回答ができるようになります。作成せずにやめた場合は、期限が来ると自動で無効になります。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-3 py-1.5 rounded-xl border text-xs" style={inputStyle} aria-label="有効期間">
                {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d}日間</option>)}
              </select>
              <button type="button" onClick={() => issue.mutate()} disabled={issue.isPending}
                className="px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-60" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
                {issue.isPending ? "更新中…" : "有効期間を、今日からこの日数に変える"}
              </button>
              <button type="button" onClick={() => { if (window.confirm("このURLを無効にしますか？すでに送ったURLは、開けなくなります。")) discard.mutate(); }}
                disabled={discard.isPending} className="px-3 py-1.5 rounded-xl text-xs disabled:opacity-60" style={{ color: "var(--color-ink-500)" }}>
                URLを無効にする
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-3 py-2 rounded-xl border text-sm" style={inputStyle} aria-label="有効期間">
              {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d}日間有効{d === 7 ? "（おすすめ）" : ""}</option>)}
            </select>
            <button type="button" onClick={() => issue.mutate()} disabled={issue.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60" style={{ background: "var(--color-brand)", color: "white" }}>
              {issue.isPending ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}URLを発行する
            </button>
          </div>
        )}
        {(issue.isError || discard.isError) && (
          <p className="text-xs" style={{ color: "var(--color-brand)" }}>
            {(issue.error ?? discard.error) instanceof ApiError ? (issue.error ?? discard.error)!.message : "うまくいきませんでした。時間をおいてもう一度お試しください"}
          </p>
        )}
      </div>

      {/* ゲストを個別に指定 */}
      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>👤 ゲストを個別に指定（メールアドレスが必要です）</p>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="自分の外部人脈から探す（名前・会社名）"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none border" style={inputStyle} />
        </div>
        {contacts.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>外部人脈がまだ登録されていません。下の入力欄から追加できます。</p>
        ) : candidates.length > 0 && (search.trim() || guests.length === 0) ? (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {candidates.map((ct) => (
              <button key={ct.id} type="button" onClick={() => addContact(ct)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left" style={{ background: "var(--color-paper-200)" }}>
                <Plus size={13} style={{ color: "var(--color-brand)" }} />
                <span className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block" style={{ color: "var(--color-ink-800)" }}>{ct.name}</span>
                  {ct.company && <span className="text-xs truncate block" style={{ color: "var(--color-ink-500)" }}>{ct.company}</span>}
                </span>
                {ct.email
                  ? <span className="shrink-0 text-xs flex items-center gap-0.5" style={{ color: "var(--color-success)" }}><Mail size={11} />メールあり</span>
                  : <span className="shrink-0 text-xs" style={{ color: "var(--color-ink-400)" }}>メール未登録（追加時に入力）</span>}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="名前"
            className="flex-1 min-w-[8rem] px-3 py-2 rounded-xl text-sm outline-none border" style={inputStyle} />
          <input value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="メールアドレス（必須）" type="email"
            className="flex-[2] min-w-[10rem] px-3 py-2 rounded-xl text-sm outline-none border" style={inputStyle} />
          <button type="button" onClick={addManual} className="px-3 py-2 rounded-xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
            追加
          </button>
        </div>
        {manualError && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{manualError}</p>}

        {guests.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {guests.map((g) => (
              <div key={g.key} className="rounded-xl px-3 py-2 space-y-1.5" style={{ background: "var(--color-paper-200)" }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm shrink-0">👤</span>
                  <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{g.name}</span>
                  {g.contactHadEmail && (
                    <span className="text-xs shrink-0 flex items-center gap-0.5" style={{ color: "var(--color-success)" }}><Mail size={11} />登録のメールに送ります</span>
                  )}
                  <button type="button" onClick={() => remove(g.key)} aria-label={`${g.name}さんを外す`} className="p-1 shrink-0" style={{ color: "var(--color-ink-400)" }}>
                    <X size={14} />
                  </button>
                </div>
                {!g.contactHadEmail && (
                  <div className="space-y-1">
                    <input value={g.email} onChange={(e) => update(g.key, { email: e.target.value })} type="email"
                      placeholder="メールアドレス（必須。招待メールを送ります）"
                      className="w-full px-3 py-1.5 rounded-lg text-xs outline-none border" style={inputStyle} />
                    {g.contactId && g.email.trim() && (
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--color-ink-600)" }}>
                        <input type="checkbox" checked={g.saveToContact} onChange={(e) => update(g.key, { saveToContact: e.target.checked })} />
                        このメールアドレスを、人脈にも保存する（他のメンバーには見えません）
                      </label>
                    )}
                  </div>
                )}
              </div>
            ))}
            <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
              {mailCount}人には、作成と同時に招待メールを送ります。{guests.length - mailCount > 0 ? `（メールアドレスが未入力の方が${guests.length - mailCount}人います）` : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
