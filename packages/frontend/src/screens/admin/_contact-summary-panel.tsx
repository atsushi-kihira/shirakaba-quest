// =============================================================
// 管理画面 — 外部人脈の「会社の説明」（AI生成）の進み具合と、「いますぐ生成」
// 説明は、人脈の登録後に自動で作られる。途中で止まったときは、ここから残りをまとめて作り直せる。
// ・「いますぐ生成」は、3件ずつ、残りが0になるまで続ける（この画面を開いている間だけ進む）
// ・「止める」を押すと、いま作っている分が終わった時点で止まる
// =============================================================
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Status = {
  done: number; notFound: number; skipped: number; error: number;
  remaining: number; inProgress: number;
  owners: { memberId: string; name: string; count: number }[];
};
type RunResult = { processed: number; remaining: number };

const QUERY_KEY = ["admin", "collab", "contact-summary-status"];
const STEP_SIZE = 3;

export function ContactSummaryPanel() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [runRemaining, setRunRemaining] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const stopRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; stopRef.current = true; };
  }, []);

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<{ data: Status }>("/admin/collab/contacts/business-summary-status"),
    refetchInterval: (q) => {
      const d = q.state.data?.data;
      return d && (d.remaining > 0 || d.inProgress > 0) ? 10000 : false;
    },
  });
  const st = data?.data;
  if (!st) return null;

  async function run(): Promise<void> {
    stopRef.current = false;
    setRunning(true);
    setMessage(null);
    let total = 0;
    try {
      for (;;) {
        const res = await api.post<{ data: RunResult }>("/admin/collab/contacts/backfill-business-summary", { batchSize: STEP_SIZE });
        if (!aliveRef.current) return;
        total += res.data.processed;
        setRunRemaining(res.data.remaining);
        qc.invalidateQueries({ queryKey: QUERY_KEY });
        if (res.data.remaining === 0 || res.data.processed === 0) break;
        if (stopRef.current) break;
      }
      if (!aliveRef.current) return;
      setMessage({ kind: "ok", text: stopRef.current ? `ここで止めました（${total}件を作りました）。` : `${total}件の会社の説明を作りました。` });
    } catch {
      if (!aliveRef.current) return;
      setMessage({ kind: "error", text: `途中で止まりました（${total}件は作れています）。時間をおいて、もう一度「いますぐ生成」を押してください。` });
    } finally {
      if (aliveRef.current) { setRunning(false); setRunRemaining(null); qc.invalidateQueries({ queryKey: QUERY_KEY }); }
    }
  }

  const remaining = running && runRemaining !== null ? runRemaining : st.remaining;

  return (
    <div className="card-paper p-4 mt-6">
      <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink-700)" }}>🏢 外部人脈の「会社の説明」</h2>
      <p className="text-xs mb-3" style={{ color: "var(--color-ink-500)" }}>
        人脈の会社名から、AIがWebで調べて事業の説明を作ります。登録後に自動で作られますが、途中で止まったときは、ここから残りを作れます。
      </p>

      <div className="flex flex-wrap gap-1.5 mb-3 text-xs">
        <span className="px-3 py-1.5 rounded-full font-medium" style={{ background: "rgba(90,140,92,0.14)", color: "var(--color-success)" }}>作成済み <b>{st.done}</b></span>
        <span className="px-3 py-1.5 rounded-full font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>見つからなかった <b>{st.notFound}</b></span>
        <span className="px-3 py-1.5 rounded-full font-medium" style={{ background: remaining > 0 ? "rgba(212,160,59,0.18)" : "var(--color-paper-200)", color: remaining > 0 ? "#8a6414" : "var(--color-ink-600)" }}>作成待ち <b>{remaining}</b></span>
        {st.inProgress > 0 && (
          <span className="px-3 py-1.5 rounded-full font-medium" style={{ background: "rgba(59,110,165,0.12)", color: "#3b6ea5" }}>作成中 <b>{st.inProgress}</b></span>
        )}
        {st.error > 0 && (
          <span className="px-3 py-1.5 rounded-full font-medium" style={{ background: "rgba(181,56,75,0.1)", color: "var(--color-brand)" }}>失敗 <b>{st.error}</b></span>
        )}
      </div>

      {st.owners.length > 0 && (
        <p className="text-xs mb-3" style={{ color: "var(--color-ink-600)" }}>
          作成待ちが多い人：{st.owners.map((o) => `${o.name}さん ${o.count}件`).join("、")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={run}
          disabled={running || st.remaining === 0}
          className="px-4 py-2 rounded-2xl text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}
        >
          {running ? `作っています…（あと${remaining}件）` : "いますぐ生成"}
        </button>
        {running && (
          <button onClick={() => { stopRef.current = true; }} className="px-4 py-2 rounded-2xl text-sm font-medium"
            style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
            止める
          </button>
        )}
        {!running && st.remaining === 0 && <span className="text-xs" style={{ color: "var(--color-success)" }}>作成待ちはありません 🎉</span>}
      </div>

      {running && (
        <p className="text-xs mt-2" style={{ color: "var(--color-ink-500)" }}>
          1件ずつAIが調べるため、時間がかかります（3件で、およそ20〜40秒）。この画面を開いたままお待ちください。
        </p>
      )}
      {message && (
        <p className="text-xs mt-2 font-medium" style={{ color: message.kind === "ok" ? "var(--color-success)" : "var(--color-brand)" }}>{message.text}</p>
      )}
    </div>
  );
}
