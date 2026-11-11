// =============================================================
// ミーティング・定例会の「説明」の表示（書式つきの説明＋説明の下の添付ファイル）
//   書式つきの説明が無い会（これまでの会）は、文章だけの説明を、同じ見た目で表示する。
// =============================================================
import { useMemo } from "react";
import { AttachmentGallery } from "@/components/attachment-gallery";
import { RichTextView } from "@/components/rich-text-view";
import type { Attachment } from "@/lib/attachments";
import { effectiveDoc, type RichDoc } from "@/lib/rich-doc";
import { AttachmentSourceContext, guestAttachmentPath } from "@/lib/attachment-source";

export function DescriptionBody({ doc, plain, attachments, className }: {
  doc: RichDoc | null | undefined;
  plain: string | null | undefined;
  attachments: Attachment[];
  className?: string;
}) {
  const shown = effectiveDoc(doc, plain);
  if (!shown && attachments.length === 0) return null;
  return (
    <div className={className}>
      {shown && <RichTextView doc={shown} />}
      <AttachmentGallery attachments={attachments} className={shown ? "mt-2" : ""} />
    </div>
  );
}

/** 外部ゲスト用ページの説明。ログインがないので、ゲスト用ページのトークンで、画像・ファイルを取得する */
export function GuestDescriptionBody({ token, ...props }: {
  token: string;
  doc: RichDoc | null | undefined;
  plain: string | null | undefined;
  attachments: Attachment[];
  className?: string;
}) {
  const pathOf = useMemo(() => guestAttachmentPath(token), [token]);
  return (
    <AttachmentSourceContext.Provider value={pathOf}>
      <DescriptionBody {...props} />
    </AttachmentSourceContext.Provider>
  );
}
