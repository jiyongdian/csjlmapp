"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineTask } from "@/lib/store/pipeline-store";
import { formatElapsed } from "./utils";

export function useElapsed(task: PipelineTask): string {
  const [now, setNow] = useState(() => task.finishedAt ?? Date.now());

  useEffect(() => {
    if (task.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [task.status]);

  const endTime = task.finishedAt ?? now;
  return formatElapsed(endTime - task.createdAt);
}

export function ElapsedText({ task }: { task: PipelineTask }) {
  const text = useElapsed(task);
  return <>{text}</>;
}

export function useSmartScroll(deps: unknown[], active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const isNearBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      userScrolledUp.current = !isNearBottom();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [isNearBottom]);

  useEffect(() => {
    if (!active) return;
    if (!userScrolledUp.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}