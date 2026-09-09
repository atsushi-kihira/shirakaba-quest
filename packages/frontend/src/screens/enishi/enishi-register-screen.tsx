// =============================================================
// 金の卵・金のガチョウ 登録ページ（ご縁さがし機能）
// =============================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Pencil, Trash2, Plus, Loader2, Check, X } from "lucide-react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useSettings } from "@/hooks/use-settings";

const MAX_ITEMS = 8;

type GoldenEgg = { id: string; description: string; issue: string | null; priceRange: string | null; region: string | null };
type GoldenGoose = { id: string; description: string; contactHypothesis: string | null; priority: string | null };
type EggsResponse = { data: GoldenEgg[] };
type GeeseResponse = { data: GoldenGoose[] };

export function EnishiRegisterScreen() {
  return <EnishiRegisterContent />;
}

function EnishiRegisterContent() {
  const { termEnishi } = useSettings();
  const qc = useQueryClient();

  const { data: eggsData, isLoading: eggsLoading } = useQuery({
    queryKey: ["enishi", "eggs"],
    queryFn: () => api.get<EggsResponse>("/enishi/eggs"),
  });
  const { data: geeseData, isLoading: geeseLoading } = useQuery({
    queryKey: ["enishi", "geese"],
    queryFn: () => api.get<GeeseResponse>("/enishi/geese"),
  });

  const eggs = eggsData?.data ?? [];
  const geese = geeseData?.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["enishi", "eggs"] });
    qc.invalidateQueries({ queryKey: ["enishi", "geese"] });
  };

  return (
    <div className="px-4 py-6 pb-24 lg:px-0 lg:pb-6 max-w-5xl mx-auto">
      <Link to="/me" className="text-sm inline-flex items-center gap-1 mb-3 hover:underline" style={{ color: "var(--color-brand)" }}>
        <ChevronLeft size={16} /> マイページに戻る
      </Link>
      <h1 className="text-xl font-semibold flex items-center gap-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
        🥚 金の卵・🪙 金のガチョウの登録
      </h1>
      <p className="text-sm mt-1 mb-5" style={{ color: "var(--color-ink-500)" }}>
        それぞれ最大8個まで登録できます。「どんな企業か／どんな立場の人か」を一文で具体的に書くほど、{termEnishi}さがしの精度が上がります。
      </p>

      <div className="grid lg:grid-cols-2 gap-6">
        <EggColumn eggs={eggs} loading={eggsLoading} onChanged={invalidate} />
        <GooseColumn geese={geese} loading={geeseLoading} onChanged={invalidate} />
      </div>
    </div>
  );
}

// ---- 金の卵 ----

function EggColumn({ eggs, loading, onChanged }: { eggs: GoldenEgg[]; loading: boolean; onChanged: () => void }) {
  const [addingNew, setAddingNew] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🥚 金の卵（狙いたい案件・紹介先）
        </h2>
        <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full"
          style={{ background: "var(--color-paper-200)", color: "var(--color-accent)" }}>
          {eggs.length} / {MAX_ITEMS} 登録済み
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>
      ) : (
        <div className="space-y-3">
          {eggs.map((egg, i) => <EggCard key={egg.id} egg={egg} index={i + 1} onChanged={onChanged} />)}

          {addingNew ? (
            <EggForm mode="create" onDone={() => { setAddingNew(false); onChanged(); }} onCancel={() => setAddingNew(false)} />
          ) : eggs.length < MAX_ITEMS ? (
            <button onClick={() => setAddingNew(true)}
              className="w-full card-paper border-dashed rounded-2xl py-4 flex items-center justify-center gap-2 text-sm font-medium hover:opacity-80 transition"
              style={{ color: "var(--color-ink-500)" }}>
              <Plus size={16} /> 金の卵を追加する（あと{MAX_ITEMS - eggs.length}個）
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function EggCard({ egg, index, onChanged }: { egg: GoldenEgg; index: number; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const del = useMutation({
    mutationFn: () => api.delete(`/enishi/eggs/${egg.id}`),
    onSuccess: onChanged,
  });

  if (editing) {
    return <EggForm mode="edit" egg={egg} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="card-paper rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-bold" style={{ color: "var(--color-accent)", fontFamily: "var(--font-klee)" }}>金の卵 {index}</span>
        <div className="flex gap-1">
          <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: "var(--color-ink-500)" }}><Pencil size={14} /></button>
          <button onClick={() => confirm("この金の卵を削除しますか？") && del.mutate()} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: "var(--color-brand)" }}>
            {del.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      </div>
      <p className="text-sm" style={{ color: "var(--color-ink-800)" }}>{egg.description}</p>
      {egg.issue && <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-500)" }}>課題: {egg.issue}</p>}
      {(egg.priceRange || egg.region) && (
        <p className="text-xs mt-0.5" style={{ color: "var(--color-ink-500)" }}>
          {[egg.priceRange && `単価帯: ${egg.priceRange}`, egg.region && `地域: ${egg.region}`].filter(Boolean).join(" / ")}
        </p>
      )}
    </div>
  );
}

function EggForm({ mode, egg, onDone, onCancel }: { mode: "create" | "edit"; egg?: GoldenEgg; onDone: () => void; onCancel: () => void }) {
  const [description, setDescription] = useState(egg?.description ?? "");
  const [issue, setIssue] = useState(egg?.issue ?? "");
  const [priceRange, setPriceRange] = useState(egg?.priceRange ?? "");
  const [region, setRegion] = useState(egg?.region ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { description, issue: issue || undefined, priceRange: priceRange || undefined, region: region || undefined };
      return mode === "create" ? api.post("/enishi/eggs", body) : api.patch(`/enishi/eggs/${egg!.id}`, body);
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : "保存に失敗しました"),
  });

  return (
    <div className="card-paper rounded-2xl p-4 border-2" style={{ borderColor: "var(--color-accent)" }}>
      <label className="block text-xs font-bold mb-1" style={{ color: "var(--color-ink-600)" }}>どんな企業か（業種・規模・決裁層をひとことで）*</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
        className="w-full rounded-xl px-3 py-2 text-sm mb-2" style={{ border: "1px solid var(--color-paper-300)", minHeight: 56 }}
        placeholder="例: 首都圏の中堅製造・卸（従業員50〜300名）で、DXの旗振り役が社内におらず経営者が投資判断をする会社" />

      <label className="block text-xs font-bold mb-1" style={{ color: "var(--color-ink-600)" }}>相手が抱える課題（任意）</label>
      <input value={issue} onChange={(e) => setIssue(e.target.value)}
        className="w-full rounded-xl px-3 py-2 text-sm mb-2" style={{ border: "1px solid var(--color-paper-300)" }} />

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: "var(--color-ink-600)" }}>想定単価帯（任意）</label>
          <input value={priceRange} onChange={(e) => setPriceRange(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-sm" style={{ border: "1px solid var(--color-paper-300)" }} />
        </div>
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: "var(--color-ink-600)" }}>地域（任意）</label>
          <input value={region} onChange={(e) => setRegion(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-sm" style={{ border: "1px solid var(--color-paper-300)" }} />
        </div>
      </div>

      {error && <p className="text-xs mb-2" style={{ color: "var(--color-brand)" }}>{error}</p>}

      <div className="flex gap-2">
        <button onClick={() => description.trim() ? save.mutate() : setError("「どんな企業か」を入力してください")}
          disabled={save.isPending}
          className="flex-1 py-2 rounded-xl text-sm font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}>
          {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 保存する
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ---- 金のガチョウ ----

function GooseColumn({ geese, loading, onChanged }: { geese: GoldenGoose[]; loading: boolean; onChanged: () => void }) {
  const [addingNew, setAddingNew] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
          🪙 金のガチョウ（運んでくれそうな立場）
        </h2>
        <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full"
          style={{ background: "var(--color-paper-200)", color: "var(--color-accent)" }}>
          {geese.length} / {MAX_ITEMS} 登録済み
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin" style={{ color: "var(--color-brand)" }} /></div>
      ) : (
        <div className="space-y-3">
          {geese.map((goose) => <GooseCard key={goose.id} goose={goose} onChanged={onChanged} />)}

          {addingNew ? (
            <GooseForm mode="create" onDone={() => { setAddingNew(false); onChanged(); }} onCancel={() => setAddingNew(false)} />
          ) : geese.length < MAX_ITEMS ? (
            <button onClick={() => setAddingNew(true)}
              className="w-full card-paper border-dashed rounded-2xl py-4 flex items-center justify-center gap-2 text-sm font-medium hover:opacity-80 transition"
              style={{ color: "var(--color-ink-500)" }}>
              <Plus size={16} /> 金のガチョウを追加する（あと{MAX_ITEMS - geese.length}個）
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function GooseCard({ goose, onChanged }: { goose: GoldenGoose; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const del = useMutation({
    mutationFn: () => api.delete(`/enishi/geese/${goose.id}`),
    onSuccess: onChanged,
  });

  if (editing) {
    return <GooseForm mode="edit" goose={goose} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="card-paper rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        {goose.priority && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
            優先度: {goose.priority}
          </span>
        )}
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setEditing(true)} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: "var(--color-ink-500)" }}><Pencil size={14} /></button>
          <button onClick={() => confirm("この金のガチョウを削除しますか？") && del.mutate()} className="p-1.5 rounded-lg hover:opacity-70" style={{ color: "var(--color-brand)" }}>
            {del.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      </div>
      <p className="text-sm" style={{ color: "var(--color-ink-800)" }}>{goose.description}</p>
      {goose.contactHypothesis && <p className="text-xs mt-1.5" style={{ color: "var(--color-ink-500)" }}>接点仮説: {goose.contactHypothesis}</p>}
    </div>
  );
}

function GooseForm({ mode, goose, onDone, onCancel }: { mode: "create" | "edit"; goose?: GoldenGoose; onDone: () => void; onCancel: () => void }) {
  const [description, setDescription] = useState(goose?.description ?? "");
  const [contactHypothesis, setContactHypothesis] = useState(goose?.contactHypothesis ?? "");
  const [priority, setPriority] = useState(goose?.priority ?? "中");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { description, contactHypothesis: contactHypothesis || undefined, priority };
      return mode === "create" ? api.post("/enishi/geese", body) : api.patch(`/enishi/geese/${goose!.id}`, body);
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : "保存に失敗しました"),
  });

  return (
    <div className="card-paper rounded-2xl p-4 border-2" style={{ borderColor: "var(--color-accent)" }}>
      <label className="block text-xs font-bold mb-1" style={{ color: "var(--color-ink-600)" }}>どんな立場の人か（職種・肩書き・活動をひとことで）*</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
        className="w-full rounded-xl px-3 py-2 text-sm mb-2" style={{ border: "1px solid var(--color-paper-300)", minHeight: 56 }}
        placeholder="例: 中小製造業の経営者と日常的に接している士業（税理士・社労士）" />

      <label className="block text-xs font-bold mb-1" style={{ color: "var(--color-ink-600)" }}>なぜ卵を持ちうるか（接点仮説・任意）</label>
      <input value={contactHypothesis} onChange={(e) => setContactHypothesis(e.target.value)}
        className="w-full rounded-xl px-3 py-2 text-sm mb-2" style={{ border: "1px solid var(--color-paper-300)" }} />

      <label className="block text-xs font-bold mb-1" style={{ color: "var(--color-ink-600)" }}>優先度</label>
      <select value={priority} onChange={(e) => setPriority(e.target.value)}
        className="w-full rounded-xl px-3 py-2 text-sm mb-3" style={{ border: "1px solid var(--color-paper-300)" }}>
        <option value="高">高</option>
        <option value="中">中</option>
        <option value="低">低</option>
      </select>

      {error && <p className="text-xs mb-2" style={{ color: "var(--color-brand)" }}>{error}</p>}

      <div className="flex gap-2">
        <button onClick={() => description.trim() ? save.mutate() : setError("「どんな立場の人か」を入力してください")}
          disabled={save.isPending}
          className="flex-1 py-2 rounded-xl text-sm font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ background: "var(--color-brand)" }}>
          {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 保存する
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: "var(--color-paper-200)", color: "var(--color-ink-600)" }}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
