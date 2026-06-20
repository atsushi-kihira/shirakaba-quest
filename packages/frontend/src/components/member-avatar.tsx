// アバター表示コンポーネント
// avatarImageKey が設定されていれば画像を、なければ絵文字＋背景色を表示
import { API_BASE_URL } from "@/lib/api";

type Props = {
  memberId: string;
  emoji: string;
  bgColor: string;
  avatarImageKey?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  rounded?: string;
};

const SIZE_MAP = {
  sm:  "w-8 h-8 text-base",
  md:  "w-10 h-10 text-xl",
  lg:  "w-14 h-14 text-2xl",
  xl:  "w-20 h-20 text-4xl",
};

export function MemberAvatar({ memberId, emoji, bgColor, avatarImageKey, size = "md", className = "", rounded = "rounded-xl" }: Props) {
  const sizeClass = SIZE_MAP[size];

  if (avatarImageKey) {
    return (
      <div className={`${sizeClass} ${rounded} shrink-0 overflow-hidden ${className}`}>
        <img
          src={`${API_BASE_URL}/members/${memberId}/avatar?k=${encodeURIComponent(avatarImageKey)}`}
          alt={emoji}
          className="w-full h-full object-cover"
          onError={(e) => {
            const parent = e.currentTarget.parentElement;
            if (parent) {
              parent.innerHTML = `<div class="${sizeClass} ${rounded} flex items-center justify-center ${bgColor}">${emoji}</div>`;
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={`${sizeClass} ${rounded} flex items-center justify-center shrink-0 ${bgColor} ${className}`}>
      {emoji}
    </div>
  );
}
