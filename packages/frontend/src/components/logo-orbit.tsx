// ログイン・登録画面で共有するロゴ表示（アニメーションなし）

export function LogoOrbit({ logo }: { logo: string }) {
  return (
    <div className="flex items-center justify-center mb-3" style={{ width: 148, height: 148 }}>
      <span className="select-none leading-none" style={{ fontSize: 80 }}>
        {logo}
      </span>
    </div>
  );
}
