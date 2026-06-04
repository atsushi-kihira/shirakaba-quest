// =============================================================
// リアルカード受け取り確認ページ
// /receive-card/:memberId
// QRコードをスキャンした後、このページで受け取りを確定する
// =============================================================
import { useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, ArrowLeft, Star } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

type ConnectionStatusResponse = {
  data: {
    member: {
      id: string;
      name: string;
      emoji: string;
      bgColor: string;
      category: string;
      businessDescription: string;
    };
    status: "none" | "digital" | "real";
  };
};

type RealCardResponse = {
  data: { alreadyRecorded: boolean; message: string };
};

export function ReceiveCardScreen() {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();

  // ログインしていない場合はログインページへ
  useEffect(() => {
    if (!user) {
      navigate(`/login?redirect=/receive-card/${memberId}`);
    }
  }, [user, memberId, navigate]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["connection-status", memberId],
    queryFn: () => api.get<ConnectionStatusResponse>(`/members/${memberId}/connection-status`),
    enabled: !!memberId && !!user,
    retry: 1,
  });

  const recordMutation = useMutation({
    mutationFn: () => api.post<RealCardResponse>(`/members/${memberId}/real-card`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["connection-status", memberId] });
      qc.invalidateQueries({ queryKey: ["ranking", "me"] });
    },
  });

  if (!user) {
    return null; // redirect中
  }

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--color-paper-100)" }}>
        <Loader2 size={32} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-6 text-center"
        style={{ background: "var(--color-paper-100)" }}>
        <div className="text-5xl mb-4">😕</div>
        <p className="font-semibold mb-2" style={{ color: "var(--color-ink-700)" }}>
          メンバーが見つかりません
        </p>
        <p className="text-sm mb-6" style={{ color: "var(--color-ink-500)" }}>
          QRコードが正しいか確認してください
        </p>
        <Link to="/" className="px-6 py-3 rounded-2xl text-white font-medium"
          style={{ background: "var(--color-brand)" }}>
          ホームへ戻る
        </Link>
      </div>
    );
  }

  const { member, status } = data.data;
  const alreadyReal = status === "real";
  const isRecorded = alreadyReal || recordMutation.isSuccess;
  const successMessage = recordMutation.data?.data.message ?? `${member.name}さんのリアルカードを受け取りました！`;

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--color-paper-100)" }}>
      {/* ヘッダー */}
      <div className="px-4 flex items-center gap-3 border-b"
        style={{
          paddingTop: "max(env(safe-area-inset-top), 16px)",
          paddingBottom: "12px",
          background: "var(--color-paper-100)",
          borderColor: "var(--color-paper-200)",
        }}>
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full active:opacity-60">
          <ArrowLeft size={22} style={{ color: "var(--color-ink-500)" }} />
        </button>
        <span className="font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-brand)" }}>
          🃏 リアルカード受け取り
        </span>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 px-4 pt-8 pb-10 max-w-md mx-auto w-full">

        {/* メンバー情報 */}
        <div className="card-paper rounded-3xl p-6 mb-6 text-center">
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-5xl mx-auto mb-3 ${member.bgColor}`}>
            {member.emoji}
          </div>
          <h2 className="text-2xl font-semibold mb-1" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            {member.name}
          </h2>
          {member.category && (
            <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink-600)" }}>
              {member.category}
            </p>
          )}
          {member.businessDescription && (
            <p className="text-sm" style={{ color: "var(--color-ink-500)" }}>
              {member.businessDescription}
            </p>
          )}

          {/* 接続ステータスバッジ */}
          <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm"
            style={{
              background: status === "real" ? "rgba(90,140,92,0.12)" : status === "digital" ? "rgba(212,160,59,0.12)" : "var(--color-paper-200)",
              color: status === "real" ? "var(--color-success)" : status === "digital" ? "var(--color-accent)" : "var(--color-ink-500)",
            }}>
            {status === "real" && <><Check size={14} /> リアルカード取得済み</>}
            {status === "digital" && <>🤝 1to1完了済み</>}
            {status === "none" && <>まだつながっていません</>}
          </div>
        </div>

        {/* 受け取り完了 or ボタン */}
        {isRecorded ? (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: "var(--color-success)" }}>
              <Check size={36} color="white" />
            </div>
            <h3 className="text-xl font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-success)" }}>
              {alreadyReal && !recordMutation.isSuccess ? "受け取り済みです" : "受け取り記録完了！"}
            </h3>
            {!alreadyReal && recordMutation.isSuccess && (
              <div className="flex items-center justify-center gap-2 mb-2 text-lg font-bold"
                style={{ color: "var(--color-accent)" }}>
                <Star size={20} fill="currentColor" />
                +1 pt 獲得！
              </div>
            )}
            <p className="text-sm mb-8" style={{ color: "var(--color-ink-600)" }}>
              {successMessage}
            </p>
            <div className="flex flex-col gap-3">
              <Link to={`/members/${member.id}`}
                className="py-3 rounded-2xl text-sm font-medium text-center active:opacity-80"
                style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
                {member.name}さんのプロフィールを見る
              </Link>
              <Link to="/"
                className="py-3 rounded-2xl text-sm font-medium text-center text-white active:opacity-80"
                style={{ background: "var(--color-brand)" }}>
                ホームへ戻る
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <div className="card-paper rounded-3xl p-5 mb-6"
              style={{ borderLeft: "4px solid var(--color-accent)" }}>
              <div className="flex items-start gap-3">
                <span className="text-2xl">🃏</span>
                <div>
                  <p className="font-semibold text-sm mb-1" style={{ color: "var(--color-ink-800)" }}>
                    リアルカードを受け取りましたか？
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--color-ink-500)" }}>
                    {member.name}さんの物理名刺カードを実際に受け取った場合に記録してください。
                    記録すると <strong>+1pt</strong> が加算されます。
                  </p>
                </div>
              </div>
            </div>

            {recordMutation.isError && (
              <div className="mb-4 p-3 rounded-2xl text-sm"
                style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>
                ⚠️ {(recordMutation.error as Error)?.message ?? "エラーが発生しました"}
              </div>
            )}

            <button
              onClick={() => recordMutation.mutate()}
              disabled={recordMutation.isPending}
              className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50 transition"
              style={{ background: "var(--color-success)", minHeight: "52px" }}
            >
              {recordMutation.isPending ? (
                <><Loader2 size={18} className="animate-spin" />記録中...</>
              ) : (
                <><Check size={18} />リアルカードを受け取った！</>
              )}
            </button>

            <button
              onClick={() => navigate(-1)}
              className="mt-3 w-full py-3 rounded-2xl text-sm font-medium active:opacity-80"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
            >
              キャンセル
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
