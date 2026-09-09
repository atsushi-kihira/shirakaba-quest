// =============================================================
// Google連携が未設定（または連携切れ）の状態で、予約の公開URLを共有しようとしている
// メンバーに向けた注意喚起。放置すると、実際の予定に関わらず「すべて空いている」
// カレンダーとして表示されてしまうため、共有前にマイページの連携設定へ誘導する。
// =============================================================
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

export function GoogleNotConnectedWarning() {
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 rounded-2xl text-xs mb-2"
      style={{ background: "rgba(212,160,59,0.12)", border: "1px solid rgba(212,160,59,0.35)" }}>
      <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: "var(--color-accent)" }} />
      <p style={{ color: "var(--color-ink-700)" }}>
        <span className="font-medium">Googleカレンダーが連携されていません。</span>
        {" "}このまま共有すると、実際の予定に関わらず「すべて空いている」状態で表示されてしまいます。
        先に<Link to="/scheduler/integrations" className="underline font-medium" style={{ color: "var(--color-brand)" }}>
          マイページ →日程調整の連携設定
        </Link>からGoogle連携をしてから共有してください。
      </p>
    </div>
  );
}
