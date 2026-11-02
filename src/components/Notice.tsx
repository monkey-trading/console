"use client";

/** What a surface has to say, in the page's flow beside the control it belongs to: the wallet's pending request, then the last result. Nothing floats, and nothing leaves on a timer. */

import type { Notice as NoticeMessage, NoticeSurface } from "@/lib/store/state";

import { useConsoleValue } from "./ConsoleProvider";

const BASE = "mt-2 text-label leading-relaxed [overflow-wrap:anywhere]";
const TONE = { error: "text-ember", info: "text-fg-2" } as const;

/**
 * The two live regions stay mounted and empty when there is nothing to say, so a message that arrives
 * is announced: failures as an alert, the wallet's request and plain statuses politely. A repeat of
 * the same text is a new message (`key`), so it is announced again.
 */
export function NoticeView({ notice, prompt }: { notice: NoticeMessage | undefined; prompt: string | null }) {
  return (
    <>
      <div role="status" className="empty:hidden">
        {prompt !== null && <p className="mt-2 rounded border border-amber/40 bg-amber/10 px-3 py-2 text-caption leading-relaxed text-amber [overflow-wrap:anywhere]">{prompt}</p>}
        {notice?.tone === "info" && <p key={notice.id} className={`${BASE} ${TONE.info}`}>{notice.text}</p>}
      </div>
      <div role="alert" className="empty:hidden">
        {notice?.tone === "error" && <p key={notice.id} className={`${BASE} ${TONE.error}`}>{notice.text}</p>}
      </div>
    </>
  );
}

/** The notice on `surface`, with the wallet's request while it is asked from there. */
export function Notice({ surface }: { surface: NoticeSurface }) {
  const notice = useConsoleValue((state) => state.notices[surface]);
  const prompt = useConsoleValue((state) => (state.promptAt === surface ? state.prompt : null));
  return <NoticeView notice={notice} prompt={prompt} />;
}
