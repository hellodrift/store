import { useState, useEffect, useCallback, useRef } from 'react';
import { NavSection, NavItem } from '@drift/ui/components';
import {
  useEntityQuery,
  useEntitySelection,
  useEntityDrawer,
  usePluginStorage,
  buildEntityURI,
  gql,
  logger,
} from '@drift/plugin-api';

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL — depends on the Linear integration
// ─────────────────────────────────────────────────────────────────────────────

const GET_LINEAR_ISSUES = gql`
  query GetRouletteIssues($limit: Int, $statusTypes: [String!]) {
    linearIssues(limit: $limit, statusTypes: $statusTypes) {
      id
      title
      identifier
      status
      stateName
      priority
      priorityLabel
      assigneeName
      teamKey
    }
  }
`;

interface LinearIssue {
  id: string;
  title: string;
  identifier: string;
  status: string;
  stateName: string;
  priority: number;
  priorityLabel: string;
  assigneeName?: string;
  teamKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spin state machine
// ─────────────────────────────────────────────────────────────────────────────

type SpinPhase = 'idle' | 'spinning' | 'slowing' | 'done';

const SPIN_FAST_MS = 60;
const SPIN_SLOW_MS = 150;
const SPIN_CRAWL_MS = 300;
const PHASE_FAST_DURATION = 1200;
const PHASE_SLOW_DURATION = 800;
const PHASE_CRAWL_DURATION = 600;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function RouletteNav() {
  const { select } = useEntitySelection();
  const { openEntityDrawer } = useEntityDrawer();

  const { data, loading, error } = useEntityQuery(GET_LINEAR_ISSUES, {
    variables: { limit: 50, statusTypes: ['started', 'unstarted'] },
  });

  const issues: LinearIssue[] = data?.linearIssues ?? [];

  const [lastPick, setLastPick] = usePluginStorage<LinearIssue | null>('lastPick', null);
  const [spinPhase, setSpinPhase] = useState<SpinPhase>('idle');
  const [displayIssue, setDisplayIssue] = useState<LinearIssue | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef(0);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const pickRandom = useCallback((): LinearIssue | null => {
    if (issues.length === 0) return null;
    return issues[Math.floor(Math.random() * issues.length)];
  }, [issues]);

  const tick = useCallback(() => {
    const elapsed = Date.now() - startTimeRef.current;
    const next = pickRandom();
    if (!next) return;

    setDisplayIssue(next);

    let delay: number;
    if (elapsed < PHASE_FAST_DURATION) {
      delay = SPIN_FAST_MS;
    } else if (elapsed < PHASE_FAST_DURATION + PHASE_SLOW_DURATION) {
      delay = SPIN_SLOW_MS;
      setSpinPhase('slowing');
    } else if (elapsed < PHASE_FAST_DURATION + PHASE_SLOW_DURATION + PHASE_CRAWL_DURATION) {
      delay = SPIN_CRAWL_MS;
    } else {
      // Done — land on a final pick
      const finalPick = pickRandom();
      if (finalPick) {
        setDisplayIssue(finalPick);
        setLastPick(finalPick);
        logger.info('Issue Roulette landed', {
          issueId: finalPick.id,
          identifier: finalPick.identifier,
        });
      }
      setSpinPhase('done');
      return;
    }

    timerRef.current = setTimeout(tick, delay);
  }, [pickRandom, setLastPick]);

  const handleSpin = useCallback(() => {
    if (issues.length === 0) return;
    startTimeRef.current = Date.now();
    setSpinPhase('spinning');
    setDisplayIssue(pickRandom());
    tick();
  }, [issues, pickRandom, tick]);

  const handleOpenDrawer = () => {
    select({ id: 'roulette', type: 'drawer', data: {} });
  };

  const handleOpenIssue = (issue: LinearIssue) => {
    openEntityDrawer(buildEntityURI('linear_issue', issue.id, issue.title));
  };

  // Determine what to show in the slot
  const isSpinning = spinPhase === 'spinning' || spinPhase === 'slowing';
  const shownIssue = isSpinning ? displayIssue : (spinPhase === 'done' ? displayIssue : lastPick);

  const section = {
    id: 'issue-roulette',
    label: 'Issue Roulette',
    items: [],
    isLoading: loading && !data,
    emptyState: error ? 'Linear not connected' : undefined,
  };

  return (
    <NavSection section={section}>
      {/* Spin button */}
      <div style={{ padding: '4px 12px 8px' }}>
        <button
          type="button"
          onClick={handleSpin}
          disabled={isSpinning || issues.length === 0}
          style={{
            width: '100%',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 600,
            borderRadius: '6px',
            border: 'none',
            cursor: isSpinning || issues.length === 0 ? 'not-allowed' : 'pointer',
            background: isSpinning
              ? 'var(--status-warning, #f5a623)'
              : 'var(--brand-primary, #6e56cf)',
            color: '#fff',
            transition: 'background 0.2s',
            opacity: issues.length === 0 ? 0.5 : 1,
          }}
        >
          {isSpinning ? 'Spinning...' : issues.length === 0 ? 'No issues' : 'Spin!'}
        </button>
      </div>

      {/* Slot machine display */}
      {isSpinning && displayIssue && (
        <div
          style={{
            margin: '0 12px 8px',
            padding: '8px',
            borderRadius: '6px',
            background: 'var(--surface-elevated, rgba(255,255,255,0.05))',
            border: '1px solid var(--border-muted)',
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden',
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--status-warning, #f5a623)' }}>
            {displayIssue.identifier}
          </div>
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {displayIssue.title}
          </div>
        </div>
      )}

      {/* Result / last pick */}
      {!isSpinning && shownIssue && (
        <NavItem
          item={{
            id: `pick-${shownIssue.id}`,
            label: shownIssue.title,
            variant: 'item' as const,
            meta: (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontWeight: 600 }}>{shownIssue.identifier}</span>
                {shownIssue.priorityLabel && <span>{shownIssue.priorityLabel}</span>}
              </span>
            ),
          }}
          onSelect={() => handleOpenIssue(shownIssue)}
        />
      )}

      {/* Open full drawer */}
      {issues.length > 0 && (
        <NavItem
          item={{
            id: 'roulette-open-drawer',
            label: `${issues.length} candidates`,
            variant: 'item' as const,
            meta: (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                Open wheel
              </span>
            ),
          }}
          onSelect={handleOpenDrawer}
        />
      )}
    </NavSection>
  );
}
