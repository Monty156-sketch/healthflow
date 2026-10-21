"use client";

// Loading and saving with the states the standing instructions require:
// a load can fail with a retry; a save is saving, saved, or failed with a
// retry, and a failed save never throws away what the person typed.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, cachedRead, rememberRead } from "./api";
import type { SaveState } from "@/components/ui";

export function useResource<T>(path: string | null) {
  // A page visited before shows what it had at once and refreshes underneath.
  const seen = path ? cachedRead<T>(path) : undefined;
  const [data, setData] = useState<T | null>(seen ?? null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(Boolean(path) && seen === undefined);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api
      .get<T>(path)
      .then((d) => {
        rememberRead(path, d);
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: ApiError | Error) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => {
    setLoading(true);
    setVersion((v) => v + 1);
  }, []);

  return { data, error, loading, reload, setData };
}

export type FieldErrors = Record<string, string>;

/**
 * Runs a save and tracks its state. Field errors from the API come back in
 * `fieldErrors`; any other failure leaves `state` as "failed" with the
 * message in `message`, and `retry` repeats the last attempt.
 */
export function useSave<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [state, setState] = useState<SaveState>("idle");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const lastArgs = useRef<A | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      lastArgs.current = args;
      window.clearTimeout(savedTimer.current);
      setState("saving");
      setMessage(null);
      try {
        const result = await fn(...args);
        setFieldErrors({});
        setState("saved");
        savedTimer.current = window.setTimeout(() => setState("idle"), 4000);
        return result;
      } catch (e) {
        setState("failed");
        if (e instanceof ApiError) {
          const body = e.body as { fields?: FieldErrors; message?: string } | undefined;
          setFieldErrors(body?.fields ?? {});
          setMessage(
            body?.message ??
              (body?.fields
                ? "Some details need correcting. They are marked below."
                : e.status >= 500
                  ? "The server had a problem saving this. Your changes are still here; try again."
                  : e.status === 403
                    ? "You do not have permission to make this change."
                    : "This could not be saved. Your changes are still here; try again.")
          );
        } else {
          setFieldErrors({});
          setMessage("No connection. Your changes are still here; try again when you are back online.");
        }
        return undefined;
      }
    },
    [fn]
  );

  const retry = useCallback(() => {
    if (lastArgs.current) void run(...lastArgs.current);
  }, [run]);

  return { run, retry, state, fieldErrors, message, setFieldErrors };
}
