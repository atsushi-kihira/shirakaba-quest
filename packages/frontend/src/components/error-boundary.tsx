// =============================================================
// 画面の表示でエラーが起きたときの、受け皿
//   これがないと、画面のどこかで表示の失敗が起きたとき、アプリ全体が真っ白になって何も操作できなくなる。
//   失敗した画面の代わりに、やさしい案内と「画面を更新する」ボタンを出す。ほかの画面へ移動すると、元に戻る。
//   ※ エラーの受け皿は、React の仕組み上、クラスコンポーネントでしか作れない（このプロジェクトで唯一の例外）
// =============================================================
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { hasNewVersion } from "@/lib/app-version";

type Props = { children: ReactNode; resetKey: string };
type State = { failed: boolean; newVersion: boolean };

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { failed: false, newVersion: false };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[画面の表示エラー]", error, info.componentStack);
    // 古い版の画面のままだと、新しくなった裏側とかみ合わずに失敗することがある。新しい版があれば、案内を変える
    void hasNewVersion().then((newVersion) => { if (newVersion) this.setState({ newVersion }); });
  }

  componentDidUpdate(prev: Props): void {
    // 別の画面へ移動したら、表示を元に戻す
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false, newVersion: false });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-10">
        <div className="card-paper rounded-3xl p-6 max-w-md w-full text-center">
          <p className="text-3xl mb-2" aria-hidden>🙇</p>
          <h1 className="text-base font-semibold mb-2" style={{ fontFamily: "var(--font-klee)", color: "var(--color-ink-900)" }}>
            画面をうまく表示できませんでした
          </h1>
          <p className="text-sm mb-4" style={{ color: "var(--color-ink-600)" }}>
            {this.state.newVersion
              ? "新しい版が公開されたため、いま開いている画面が古くなっているようです。画面を更新すると、直ります。"
              : "画面を更新すると、直ることがあります。"}
            <br />
            検索など、裏で進めている処理は、そのまま続いています（終わったら、通知でお知らせします）。
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button type="button" onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-2xl text-sm font-medium text-white" style={{ background: "var(--color-brand)" }}>
              画面を更新する
            </button>
            <a href="/home" className="px-5 py-2.5 rounded-2xl text-sm font-medium"
              style={{ background: "var(--color-paper-200)", color: "var(--color-ink-700)" }}>
              ホームへ戻る
            </a>
          </div>
        </div>
      </div>
    );
  }
}

/** 画面の表示エラーの受け皿（別の画面へ移動すると、元に戻る） */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundaryInner resetKey={location.pathname}>{children}</ErrorBoundaryInner>;
}
