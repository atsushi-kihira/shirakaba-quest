// =============================================================
// 1to1の案内を、メールではなくDM等で送るときの「お誘いのメッセージ」
// メールで通知できない（相手のメールアドレスが分からない）ときや、メールをあまり見ない相手にDMで送るときに、
// 申込者がそのまま使えるように、相手の名前・自分の名前・日程を選ぶURLを入れた文面を作って表示する（編集してコピーもできる）。
// 定型の文面は、管理画面（メール配信管理）で編集できる。メッセージを入力しているときは、ボタンでAIに全体を整えてもらうこともできる。
// =============================================================
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, Loader2, MessageSquareText, Sparkles } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { buildOneOnOneDmText } from "@/lib/oneonone-dm-text";

export function OneOnOneDmMessage({ partnerName, url, note, defaultOpen = false }: { partnerName: string | null | undefined; url: string; note?: string | null; defaultOpen?: boolean }) {
  const senderName = useAuthStore((s) => s.user?.name) ?? "";
  const [open, setOpen] = useState(defaultOpen);
  // 直したり、AIで整えたりした文面。null のときは、最新の定型から作った文面を表示する
  const [edited, setEdited] = useState<string | null>(null);
  const [aiUsed, setAiUsed] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: templateData } = useQuery({
    queryKey: ["oneonone-dm-template"],
    queryFn: () => api.get<{ data: { bodyText: string } }>("/oneonone/dm/template"),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });
  const built = buildOneOnOneDmText({ partnerName, senderName, url, note, template: templateData?.data.bodyText });
  const text = edited ?? built;
  const hasNote = !!note?.trim();

  const ai = useMutation({
    mutationFn: () => api.post<{ data: { text: string } }>("/oneonone/dm/ai", { partnerName: partnerName ?? null, url, note }),
    onSuccess: (res) => { setEdited(res.data.text); setAiUsed(true); },
  });

  function show() {
    // 開くたびに、最新の名前・URL・定型で文面を作り直す（編集した内容は、開き直すと元に戻る）
    setEdited(null);
    setAiUsed(false);
    ai.reset();
    setOpen(true);
  }
  function backToAuto() {
    setEdited(null);
    setAiUsed(false);
    ai.reset();
  }
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  if (!open) {
    return (
      <button type="button" onClick={show}
        className="w-full py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
        style={{ background: "var(--color-paper-100)", color: "var(--color-ink-600)" }}>
        <MessageSquareText size={12} />DMで送るメッセージを表示
      </button>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>
        メールではなく、DM等でお送りするときの文面です（必要に応じて直してから、コピーしてお使いください）
      </p>
      <textarea
        value={text}
        onChange={(e) => setEdited(e.target.value)}
        rows={9}
        className="w-full px-3 py-2 rounded-xl text-xs leading-relaxed border"
        style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-800)" }}
      />
      {hasNote && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => ai.mutate()} disabled={ai.isPending}
              className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-60"
              style={{ background: "rgba(212,160,59,0.18)", color: "#8a6414" }}>
              {ai.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {ai.isPending ? "整えています…" : aiUsed ? "AIでもう一度整える" : "AIで、全体を自然に整える"}
            </button>
            {aiUsed && (
              <button type="button" onClick={backToAuto} className="text-[11px] underline" style={{ color: "var(--color-ink-500)" }}>
                自動で整えた文面に戻す
              </button>
            )}
          </div>
          <p className="text-[11px]" style={{ color: "var(--color-ink-500)" }}>
            {aiUsed ? "AIが、メッセージと定型の文面の重なりを整えました。内容を確かめて、必要なら直してください。"
              : "メッセージと定型の文面が重なって不自然なときは、AIが全体を整えます（直した内容は置き換わります）。"}
          </p>
          {ai.isError && (
            <p className="text-[11px]" style={{ color: "var(--color-brand)" }}>
              {ai.error instanceof ApiError ? ai.error.message : "AIでの調整がうまくいきませんでした。時間をおいてもう一度お試しください。"}
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={copy}
          className="flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
          style={{ background: copied ? "var(--color-success)" : "var(--color-brand)", color: "white" }}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "コピーしました" : "メッセージをコピー"}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          閉じる
        </button>
      </div>
    </div>
  );
}
