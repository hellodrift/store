/**
 * useOptimistic — Generic hook for optimistic UI updates with auto-rollback.
 *
 * Design:
 * - Maintains a Partial<T> overlay merged on top of server data.
 * - `apply()` is synchronous: the UI updates instantly, async work runs in background.
 * - Per-field version counters prevent concurrent updates from clobbering each other.
 *   If user changes status then immediately changes priority, each field's override
 *   is tracked independently and only cleared when *its own* action completes.
 * - Overrides are cleared after the full action (mutation + refetch) finishes,
 *   so there's no flash back to stale server data.
 * - On action failure, the override is removed (rollback) and an error is surfaced.
 * - Error auto-dismisses after a configurable timeout.
 *
 * Usage:
 *   const { data, error, apply, dismissError } = useOptimistic(serverIssue);
 *
 *   const handleChange = (field, value) => {
 *     const displayUpdates = computeDerived(field, value);
 *     apply(displayUpdates, async () => {
 *       await mutate({ variables: { id, input: { [field]: value } } });
 *       await refetch();
 *     });
 *   };
 */
import { useState, useRef, useEffect } from 'react';

export interface UseOptimisticResult<T> {
  /** Server data merged with pending optimistic overrides. */
  data: T | undefined;
  /** True while any optimistic action is in-flight. */
  pending: boolean;
  /** Error message from the most recent failed update, or null. */
  error: string | null;
  /**
   * Apply an optimistic update.
   * @param updates — fields to overlay immediately (include derived display fields).
   * @param action  — async work (mutation + refetch). On failure, overrides roll back.
   */
  apply: (updates: Partial<T>, action: () => Promise<void>) => void;
  /** Manually dismiss the current error. */
  dismissError: () => void;
}

export function useOptimistic<T extends Record<string, unknown>>(
  serverData: T | undefined,
  options: { errorTimeout?: number } = {},
): UseOptimisticResult<T> {
  const { errorTimeout = 4000 } = options;

  const [overrides, setOverrides] = useState<Partial<T>>({});
  const [error, setError] = useState<string | null>(null);
  const [inflight, setInflight] = useState(0);

  // Per-field version counter. Only the *latest* writer for a given field
  // is allowed to clear its override. Earlier concurrent writes for the
  // same field become no-ops on cleanup.
  const fieldVersions = useRef(new Map<string, number>());
  const errorTimer = useRef<ReturnType<typeof setTimeout>>();

  // Auto-dismiss error
  useEffect(() => {
    if (error && errorTimeout > 0) {
      errorTimer.current = setTimeout(() => setError(null), errorTimeout);
      return () => clearTimeout(errorTimer.current);
    }
  }, [error, errorTimeout]);

  // Merged view: server data + optimistic overrides
  const data = serverData
    ? ({ ...serverData, ...overrides } as T)
    : serverData;

  const apply = (updates: Partial<T>, action: () => Promise<void>) => {
    setError(null);

    // Snapshot the version for each field we're overriding.
    const snapshot = new Map<string, number>();
    for (const key of Object.keys(updates)) {
      const next = (fieldVersions.current.get(key) ?? 0) + 1;
      fieldVersions.current.set(key, next);
      snapshot.set(key, next);
    }

    // Immediately apply overrides (synchronous — UI updates this render).
    setOverrides((prev) => ({ ...prev, ...updates }));
    setInflight((n) => n + 1);

    // Run the async action in the background.
    action()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Update failed');
      })
      .finally(() => {
        // Clear overrides only for fields where we are still the latest writer.
        // If a newer apply() bumped the version, we leave the override in place.
        setOverrides((prev) => {
          const next = { ...prev };
          for (const [key, ver] of snapshot) {
            if (fieldVersions.current.get(key) === ver) {
              delete next[key as keyof T];
              fieldVersions.current.delete(key);
            }
          }
          return next;
        });
        setInflight((n) => n - 1);
      });
  };

  const dismissError = () => setError(null);

  return { data, pending: inflight > 0, error, apply, dismissError };
}
