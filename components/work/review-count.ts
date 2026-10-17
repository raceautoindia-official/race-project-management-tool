"use client";

import { useEffect, useState } from "react";

/**
 * The number on the Reviews link: subtasks and tasks waiting for my review,
 * plus sign-offs, requests and blockers waiting for me (GET /api/me/work).
 *
 * It must never slow a page down, so it loads after the page is up, is
 * shared by every mount, and is kept for a minute between page changes.
 * Approving or sending back calls reviewsChanged() to fetch it again.
 */

const TTL_MS = 60_000;
const EVENT = "pm:reviews-changed";

let cached: { count: number; at: number } | null = null;
let inflight: Promise<number> | null = null;

interface WorkCounts {
  reviewSubtasks?: unknown[];
  reviewTasks?: unknown[];
  attention?: unknown[];
}

function load(): Promise<number> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.count);
  inflight ??= fetch("/api/me/work")
    .then((r) => (r.ok ? (r.json() as Promise<WorkCounts>) : null))
    .then((w) => {
      const count = w
        ? (w.reviewSubtasks?.length ?? 0) + (w.reviewTasks?.length ?? 0) + (w.attention?.length ?? 0)
        : 0;
      cached = { count, at: Date.now() };
      return count;
    })
    .catch(() => cached?.count ?? 0)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Tell the nav badge that something was approved or sent back. */
export function reviewsChanged() {
  cached = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function useReviewCount(): number {
  const [count, setCount] = useState(() => cached?.count ?? 0);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      load().then((n) => {
        if (live) setCount(n);
      });
    };
    refresh();
    window.addEventListener(EVENT, refresh);
    return () => {
      live = false;
      window.removeEventListener(EVENT, refresh);
    };
  }, []);
  return count;
}
