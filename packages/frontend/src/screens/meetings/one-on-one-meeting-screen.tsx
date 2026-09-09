// =============================================================
// 1to1ミーティング画面
// 「ミーティングを立てる」の入口の一つとして提供するが、
// 実装は既存の1to1機能（メンバー向け）・スケジューラー公開URL（外部ゲスト向け）をそのまま使う
// =============================================================
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Handshake, Loader2, Search, Check, X, Settings, Lock } from "lucide-react";
import { api, request } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";
import { useAuthStore, isApprovedMember } from "@/stores/auth-store";
import { GoogleNotConnectedWarning } from "@/components/google-not-connected-warning";
import { AutoSchedulerShareLinkPanel, useAutoSchedulerShareLink } from "@/components/scheduler-share-link-panel";
import { InProgressOneOnOneSection, OneOnOneHistorySection } from "./_oneonone-sections";
import { PrearrangedRequestModal } from "../members/_prearranged-request-modal";
import { NormalRequestModal } from "../members/_normal-request-modal";

type Member = { id: string; name: string; emoji: string; bgColor: string; connectionStatus: string };
type MembersResponse = { data: Member[] };

export function OneOnOneMeetingScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { termExternalGuest } = useSettings();
  const approved = isApprovedMember(useAuthStore((s) => s.user));
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setModeState] = useState<"member" | "guest">(
    !approved || searchParams.get("mode") === "guest" ? "guest" : "member"
  );

  function setMode(next: "member" | "guest") {
    if (next === "member" && !approved) return;
    setModeState(next);
    setSearchParams(next === "guest" ? { mode: "guest" } : {}, { replace: true });
  }

  return (
    <div className="px-4 py-6 pb-24 max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate(-1)} className="p-2 rounded-2xl hover:opacity-70"
          style={{ background: "var(--color-paper-200)" }}>
          <ChevronLeft size={18} style={{ color: "var(--color-ink-600)" }} />
        </button>
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🤝 1to1ミーティング
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-5">
        <button
          onClick={() => setMode("member")}
          disabled={!approved}
          className="py-2.5 rounded-2xl text-sm font-medium transition flex items-center justify-center gap-1.5"
          style={{
            background: mode === "member" ? "var(--color-brand)" : "var(--color-paper-200)",
            color: !approved ? "var(--color-ink-300)" : mode === "member" ? "white" : "var(--color-ink-600)",
            cursor: !approved ? "not-allowed" : "pointer",
          }}
        >
          メンバーに申し込む
          {!approved && <Lock size={12} />}
        </button>
        <button
          onClick={() => setMode("guest")}
          className="py-2.5 rounded-2xl text-sm font-medium transition"
          style={{
            background: mode === "guest" ? "var(--color-brand)" : "var(--color-paper-200)",
            color: mode === "guest" ? "white" : "var(--color-ink-600)",
          }}
        >
          {termExternalGuest}向け
        </button>
      </div>

      {mode === "member" ? (
        <MemberOneOnOnePanel onDone={() => { qc.invalidateQueries({ queryKey: ["oneonone"] }); navigate("/oneonone"); }} />
      ) : (
        <GuestOneOnOnePanel />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// メンバー向け: 既存の1to1申込機能（POST /oneonone）をそのまま利用
// ----------------------------------------------------------------
function MemberOneOnOnePanel({ onDone }: { onDone: () => void }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [showPrearranged, setShowPrearranged] = useState(false);
  const [showNormalRequest, setShowNormalRequest] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<MembersResponse>("/members"),
  });

  const members = (data?.data ?? []).filter((m) => m.connectionStatus !== "self");
  const selectedMember = members.find((m) => m.id === selectedId) ?? null;
  const filtered = search.trim()
    ? members.filter((m) => m.name.includes(search.trim()))
    : members;

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
        「なかま」画面から1to1を申し込むのと同じ仕組みです。相手を選んで申し込んでください。
      </p>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-ink-400)" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="名前で検索"
          className="w-full pl-9 pr-9 py-2.5 rounded-2xl text-sm outline-none border"
          style={{ background: "var(--color-paper-50)", borderColor: "var(--color-paper-300)", color: "var(--color-ink-900)" }}
        />
        {search && (
          <button type="button" onClick={() => setSearch("")}
            aria-label="検索条件をクリア"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full"
            style={{ color: "var(--color-ink-400)" }}>
            <X size={14} />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={22} className="animate-spin" style={{ color: "var(--color-brand)" }} />
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {filtered.map((m) => (
            <label
              key={m.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-2xl cursor-pointer transition"
              style={{
                background: selectedId === m.id ? "rgba(181,56,75,0.08)" : "var(--color-paper-200)",
                border: selectedId === m.id ? "1.5px solid rgba(181,56,75,0.3)" : "1.5px solid transparent",
              }}
            >
              <input type="radio" name="responder" checked={selectedId === m.id} onChange={() => setSelectedId(m.id)} className="sr-only" />
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-lg ${m.bgColor}`}>{m.emoji}</span>
              <span className="text-sm font-medium flex-1" style={{ color: "var(--color-ink-800)" }}>{m.name}</span>
              {selectedId === m.id && <Check size={16} style={{ color: "var(--color-brand)" }} />}
            </label>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-sm py-6" style={{ color: "var(--color-ink-400)" }}>該当するメンバーがいません</p>
          )}
        </div>
      )}

      <button
        onClick={() => setShowNormalRequest(true)}
        disabled={!selectedId}
        className="w-full py-4 rounded-2xl text-base font-medium text-white flex items-center justify-center gap-2 transition disabled:opacity-50"
        style={{ background: "var(--color-brand)" }}
      >
        <Handshake size={16} />1to1を申し込む
      </button>

      <button
        onClick={() => setShowPrearranged(true)}
        disabled={!selectedId}
        className="w-full flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-xs font-medium transition disabled:opacity-40"
        style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}
      >
        📅 すでに日程調整済み？日時を指定して申し込む
      </button>
      <p className="text-xs mt-1.5 px-3 py-2 rounded-xl" style={{ background: "rgba(212,160,59,0.12)", color: "var(--color-ink-600)" }}>
        💡 相手の回答を待たずに、あなたが日時とZoom等の会議URLをその場で発行して申し込みたい場合は、こちらをご利用ください。
      </p>

      <div className="mt-6 pt-5 border-t space-y-6" style={{ borderColor: "var(--color-paper-300)" }}>
        <InProgressOneOnOneSection />
        <OneOnOneHistorySection />
      </div>

      {showNormalRequest && selectedMember && (
        <NormalRequestModal
          responderId={selectedMember.id}
          responderName={selectedMember.name}
          onClose={() => setShowNormalRequest(false)}
          onSuccess={() => {
            setShowNormalRequest(false);
            onDone();
          }}
        />
      )}

      {showPrearranged && selectedMember && (
        <PrearrangedRequestModal
          responderId={selectedMember.id}
          responderName={selectedMember.name}
          onClose={() => setShowPrearranged(false)}
          onSuccess={() => {
            setShowPrearranged(false);
            onDone();
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// 外部ゲスト向け: 既存の1on1スケジューラー公開URL（/book/:memberSlug）をそのまま利用
// ----------------------------------------------------------------
function GuestOneOnOnePanel() {
  const { data: shareLinkData, isLoading } = useAutoSchedulerShareLink();

  const { data: googleStatusData } = useQuery<{ data: { connected: boolean } }>({
    queryKey: ["scheduler", "google-status"],
    queryFn: () => request("/scheduler/oauth/google/status"),
  });

  const publicUrl = shareLinkData?.publicUrl ?? null;

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 size={22} className="animate-spin" style={{ color: "var(--color-brand)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "var(--color-ink-400)" }}>
        メンバー外の方との1to1は、ご自身のスケジュール公開URL（期限付き）を何らかの手段（メール・チャット等）で直接お送りいただくことで調整できます。
      </p>

      {publicUrl && googleStatusData && !googleStatusData.data.connected && <GoogleNotConnectedWarning />}

      <div className="card-paper rounded-2xl p-4 space-y-3">
        <p className="text-xs font-medium" style={{ color: "var(--color-ink-500)" }}>あなたの公開予約URL</p>
        <AutoSchedulerShareLinkPanel />
        <a
          href={`/scheduler/settings?returnTo=${encodeURIComponent("/meetings/one-on-one?mode=guest")}`}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium"
          style={{ color: "var(--color-ink-500)" }}
        >
          <Settings size={13} />
          日程調整の基本設定・受付時間を変更する
        </a>
      </div>
    </div>
  );
}
