// =============================================================
// 外部ゲスト（ビジター）を個別に指定する部品（メールアドレスは必須。回答・招待を、メールアドレスで対応づけるため）
// 次の2つの流れから選べる。
//   ・名前とメールアドレスだけで招待（かんたん）: 外部人脈には登録しない
//   ・外部人脈から選ぶ・登録して招待: 登録済みの人脈から選ぶ。いない場合は、その場で人脈に登録（名前・会社名・メールアドレス・公開範囲）して加える
// ミーティング・定例会の作成画面、定例会への参加者の追加、グループの編集で使う。
// =============================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Plus, Search, X } from "lucide-react";
import { api } from "@/lib/api";

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
const inputStyle = { background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" } as const;

type PickerProps = {
  guests: GuestDraft[];
  onGuestsChange: (g: GuestDraft[]) => void;
  /** 一覧の下に出す、メールについての説明。未指定なら、作成画面向けの説明 */
  mailNote?: (mailCount: number, missingCount: number) => string | null;
};

const defaultMailNote = (mailCount: number, missing: number): string =>
  `${mailCount}人には、作成と同時に招待メールを送ります。${missing > 0 ? `（メールアドレスが未入力の方が${missing}人います）` : ""}`;

export function GuestPicker({ guests, onGuestsChange, mailNote = defaultMailNote }: PickerProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualError, setManualError] = useState("");
  // 個別に指定する流れ: quick = 名前とメールアドレスだけ／contact = 外部人脈から選ぶ・登録して招待
  const [mode, setMode] = useState<"quick" | "contact">("quick");
  const [showNewContact, setShowNewContact] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncCompany, setNcCompany] = useState("");
  const [ncSpecialty, setNcSpecialty] = useState("");
  const [ncEmail, setNcEmail] = useState("");
  const [ncVisibility, setNcVisibility] = useState<"existence" | "private" | "full">("existence");
  const [ncError, setNcError] = useState("");

  // 新しい人脈をその場で登録して、そのままゲストに加える
  const createContact = useMutation({
    mutationFn: () => api.post<{ data: { id: string } }>("/collab/contacts", {
      name: ncName.trim(), company: ncCompany.trim() || undefined, specialty: ncSpecialty.trim() || undefined,
      email: ncEmail.trim(), visibility: ncVisibility,
    }),
    onSuccess: (res) => {
      onGuestsChange([...guests, {
        key: crypto.randomUUID(), contactId: res.data.id, name: ncName.trim(), email: ncEmail.trim(),
        contactHadEmail: true, saveToContact: false,
      }]);
      qc.invalidateQueries({ queryKey: ["collab", "contacts"] });
      qc.invalidateQueries({ queryKey: ["collab", "graph"] });
      setNcName(""); setNcCompany(""); setNcSpecialty(""); setNcEmail(""); setNcVisibility("existence"); setNcError("");
      setShowNewContact(false); setSearch("");
    },
    onError: (e: Error) => setNcError(
      e.message.includes("上限") ? `${e.message} 公開範囲を「非公開」にすると、上限に関係なく登録できます。` : (e.message || "登録できませんでした。時間をおいてもう一度お試しください"),
    ),
  });

  function submitNewContact() {
    const name = ncName.trim();
    const email = ncEmail.trim();
    setNcError("");
    if (!name) { setNcError("名前を入力してください"); return; }
    if (!email) { setNcError("メールアドレスを入力してください（招待メールの送り先になります）"); return; }
    if (!EMAIL_RE.test(email)) { setNcError("メールアドレスの形式が正しくありません"); return; }
    if (guests.some((g) => g.email.trim().toLowerCase() === email.toLowerCase())) { setNcError("同じメールアドレスの方が、すでに追加されています"); return; }
    createContact.mutate();
  }
  function openNewContact() {
    if (!showNewContact && search.trim() && !ncName) setNcName(search.trim());
    setShowNewContact((v) => !v);
    setNcError("");
  }

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

  const mailCount = guests.filter((g) => (g.contactHadEmail ? true : !!g.email.trim())).length;
  const note = guests.length > 0 ? mailNote(mailCount, guests.length - mailCount) : null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium" style={{ color: "var(--color-ink-600)" }}>👤 ゲストを個別に指定（メールアドレスが必要です）。やりやすいほうを選んでください</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="tablist" aria-label="ゲストの招待のしかた">
        {([
          { key: "quick" as const, icon: "✉️", title: "名前とメールだけで招待", desc: "かんたん。外部人脈には登録しません" },
          { key: "contact" as const, icon: "📇", title: "外部人脈から選ぶ・登録して招待", desc: "人脈に残しておきたい方に" },
        ]).map((m) => (
          <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} onClick={() => setMode(m.key)}
            className="text-left rounded-2xl px-3 py-2.5 transition"
            style={{
              background: mode === m.key ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)",
              border: mode === m.key ? "1.5px solid rgba(181,56,75,0.4)" : "1.5px solid transparent",
            }}>
            <span className="block text-sm font-medium" style={{ color: mode === m.key ? "var(--color-brand)" : "var(--color-ink-800)" }}>{m.icon} {m.title}</span>
            <span className="block text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>{m.desc}</span>
          </button>
        ))}
      </div>

      {mode === "quick" ? (
        <div className="space-y-2">
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
          <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
            名前とメールアドレスだけで、招待メールを送れます。外部人脈には登録されません（ゲストが回答のときに会社名・屋号を入力すると、あなたの外部人脈に「存在のみ公開」で登録されます）。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="自分の外部人脈から探す（名前・会社名）"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none border" style={inputStyle} />
          </div>
          {contacts.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>外部人脈がまだ登録されていません。下の「新しく人脈に登録して招待する」から追加できます。</p>
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
          ) : search.trim() ? (
            <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>「{search.trim()}」に当てはまる人脈がありません。下から新しく登録できます。</p>
          ) : null}

          <button type="button" onClick={openNewContact} aria-expanded={showNewContact}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium"
            style={{ background: showNewContact ? "var(--color-paper-200)" : "var(--color-brand)", color: showNewContact ? "var(--color-ink-700)" : "white" }}>
            {showNewContact ? "登録をやめる" : <><Plus size={14} />新しく人脈に登録して招待する</>}
          </button>

          {showNewContact && (
            <div className="rounded-2xl p-3 space-y-2" style={{ background: "var(--color-paper-50)", border: "1px solid var(--color-paper-300)" }}>
              <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>
                あなたの外部人脈に登録して、そのまま招待します。さらに詳しい情報は、あとで「なかま」の外部人脈から追加できます。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input value={ncName} onChange={(e) => setNcName(e.target.value)} placeholder="名前（必須）" aria-label="名前"
                  className="px-3 py-2 rounded-xl text-sm outline-none border" style={inputStyle} />
                <input value={ncCompany} onChange={(e) => setNcCompany(e.target.value)} placeholder="会社名・屋号" aria-label="会社名・屋号"
                  className="px-3 py-2 rounded-xl text-sm outline-none border" style={inputStyle} />
                <input value={ncEmail} onChange={(e) => setNcEmail(e.target.value)} placeholder="メールアドレス（必須）" type="email" aria-label="メールアドレス"
                  className="px-3 py-2 rounded-xl text-sm outline-none border" style={inputStyle} />
                <input value={ncSpecialty} onChange={(e) => setNcSpecialty(e.target.value)} placeholder="専門分野（任意）" aria-label="専門分野"
                  className="px-3 py-2 rounded-xl text-sm outline-none border" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>公開範囲</label>
                <select value={ncVisibility} onChange={(e) => setNcVisibility(e.target.value as typeof ncVisibility)}
                  className="w-full px-3 py-2 rounded-xl text-sm border" style={inputStyle}>
                  <option value="existence">🌫️ 存在のみ公開（詳細は非公開）</option>
                  <option value="private">🔒 非公開（自分だけ）</option>
                  <option value="full">📖 詳細まで公開（連絡先は非公開）</option>
                </select>
              </div>
              <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>🔒 メールアドレスは、あなただけに見えます。招待メールの送り先にだけ使います。</p>
              {ncError && <p className="text-xs" style={{ color: "var(--color-brand)" }}>{ncError}</p>}
              <button type="button" onClick={submitNewContact} disabled={createContact.isPending}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-60" style={{ background: "var(--color-brand)" }}>
                {createContact.isPending && <Loader2 size={14} className="animate-spin" />}
                {createContact.isPending ? "登録中…" : "人脈に登録して、招待に加える"}
              </button>
            </div>
          )}
        </div>
      )}

      {guests.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {guests.map((g) => (
            <div key={g.key} className="rounded-xl px-3 py-2 space-y-1.5" style={{ background: "var(--color-paper-200)" }}>
              <div className="flex items-center gap-2">
                <span className="text-sm shrink-0">👤</span>
                <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: "var(--color-ink-800)" }}>{g.name}</span>
                <span className="text-[11px] shrink-0 px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-100)", color: "var(--color-ink-500)" }}>
                  {g.contactId ? "📇 外部人脈" : "✉️ メールのみ"}
                </span>
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
          {note && <p className="text-xs" style={{ color: "var(--color-ink-500)" }}>{note}</p>}
        </div>
      )}
    </div>
  );
}
