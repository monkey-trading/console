"use client";

/** What the House page's panels read their feeds and the console's state through, so a store patch re-renders only the panel whose figures changed. */

import { useEffect, useEffectEvent, useMemo, useSyncExternalStore } from "react";

import { selection } from "@/lib/store/selection";
import { LOADING, type FeedSpec, type FeedState, type HouseStats } from "@/lib/store/house-stats";
import type { ConsoleState } from "@/lib/store/state";

import { useSession } from "../ConsoleProvider";

/** A reader of the feeds under `keys` that keeps its array while every member state is unchanged. */
function feedsReader<T>(stats: HouseStats, keys: readonly string[]): () => readonly FeedState<T>[] {
  let held: readonly FeedState<T>[] = [];
  return () => {
    const next = keys.map((key) => stats.state<T>(key));
    if (next.length !== held.length || next.some((state, i) => state !== held[i])) held = next;
    return held;
  };
}

/** Follows `specs` while the component is mounted and returns each feed's state, in order. */
export function useFeeds<T>(specs: readonly FeedSpec<T>[]): readonly FeedState<T>[] {
  const { store } = useSession();
  const { houseStats } = store;
  const keys = specs.map((spec) => spec.key).join("\n");
  const paces = specs.map((spec) => spec.everyMs).join("\n");
  // The specs are rebuilt on every render; the feeds are followed again only when their keys or paces change.
  const followAll = useEffectEvent(() => specs.map((spec) => houseStats.follow(spec)));
  useEffect(() => {
    const releases = followAll();
    return () => releases.forEach((release) => release());
  }, [houseStats, keys, paces]);
  const read = useMemo(() => feedsReader<T>(houseStats, keys === "" ? [] : keys.split("\n")), [houseStats, keys]);
  return useSyncExternalStore(houseStats.subscribe, read, read);
}

/** Follows `spec` while the component is mounted and returns the feed's state; `null` follows nothing. */
export function useFeed<T>(spec: FeedSpec<T> | null): FeedState<T> {
  return useFeeds(spec === null ? [] : [spec])[0] ?? LOADING;
}

/**
 * A slice of the console's state; `select` must be a stable function. The component re-renders only
 * when the slice changes (structurally), which the whole-state `useConsole` does on every patch, up to
 * five a second from the stream's marks.
 */
export function useSelected<T>(select: (state: ConsoleState) => T): T {
  const { store } = useSession();
  const read = useMemo(() => selection(store.getSnapshot, select), [store, select]);
  return useSyncExternalStore(store.subscribe, read, read);
}
