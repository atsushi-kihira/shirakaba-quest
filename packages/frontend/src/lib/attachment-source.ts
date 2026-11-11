// =============================================================
// 添付の画像・ファイルを、どこから取得するか
//   ・メンバー：ログイン情報つきで /meeting-attachments から取得（既定）
//   ・外部ゲスト：ログインがないので、ゲスト用ページのトークンつきで /schedule/attachments から取得
// ゲスト用ページでは、AttachmentSourceContext.Provider に guestAttachmentPath(token) を渡して使う。
// =============================================================
import { createContext, useContext } from "react";

export type AttachmentPathFn = (id: string, download: boolean) => string;

export const memberAttachmentPath: AttachmentPathFn = (id, download) =>
  `/meeting-attachments/${id}/file${download ? "?download=1" : ""}`;

export const guestAttachmentPath = (token: string): AttachmentPathFn => (id, download) =>
  `/schedule/attachments/${id}/file?token=${encodeURIComponent(token)}${download ? "&download=1" : ""}`;

export const AttachmentSourceContext = createContext<AttachmentPathFn>(memberAttachmentPath);

export function useAttachmentPath(): AttachmentPathFn {
  return useContext(AttachmentSourceContext);
}
