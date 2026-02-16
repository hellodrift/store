import { useState, useCallback, useRef, useEffect } from 'react';
import {
  DrawerHeaderTitle,
  DrawerBody,
  ContentSection,
  Button,
  Badge,
  Separator,
} from '@drift/ui';
import {
  useEntityQuery,
  useEntityDrawer,
  usePluginStorage,
  buildEntityURI,
  gql,
  logger,
} from '@drift/plugin-api';

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL
// ─────────────────────────────────────────────────────────────────────────────

const GET_LINEAR_ISSUES = gql`
  query GetRouletteDrawerIssues($limit: Int, $statusTypes: [String!]) {
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

interface HistoryEntry {
  issue: LinearIssue;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spin logic
// ─────────────────────────────────────────────────────────────────────────────

const SPIN_DURATION = 2600;
const TICK_FAST = 50;
const TICK_SLOW = 120;
const TICK_CRAWL = 250;

// Fun messages for the result reveal
const REVEAL_MESSAGES = [
  'The wheel has spoken!',
  'Destiny has chosen...',
  'Your fate is sealed!',
  "The gods of backlog decree...",
  'No take-backs!',
  'This one has your name on it!',
  "You can't argue with the wheel.",
  'The universe has decided.',
  "Congratulations... I think?",
  'May the force be with you.',
];

const PRIORITY_EMOJIS: Record<number, string> = {
  0: '',
  1: '!!!',
  2: '!!',
  3: '!',
  4: '',
};

function randomMessage(): string {
  return REVEAL_MESSAGES[Math.floor(Math.random() * REVEAL_MESSAGES.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawer
// ─────────────────────────────────────────────────────────────────────────────

interface RouletteDrawerProps {
  payload: Record<string, unknown>;
  drawer: {
    close: () => void;
    open: (payload: Record<string, unknown>) => void;
    push: (payload: Record<string, unknown>) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

export default function RouletteDrawer(_props: RouletteDrawerProps) {
  const { openEntityDrawer } = useEntityDrawer();
  const { data, loading, error } = useEntityQuery(GET_LINEAR_ISSUES, {
    variables: { limit: 50, statusTypes: ['started', 'unstarted'] },
  });

  const issues: LinearIssue[] = data?.linearIssues ?? [];

  const [isSpinning, setIsSpinning] = useState(false);
  const [currentDisplay, setCurrentDisplay] = useState<LinearIssue | null>(null);
  const [result, setResult] = useState<LinearIssue | null>(null);
  const [message, setMessage] = useState('');
  const [history, setHistory] = usePluginStorage<HistoryEntry[]>('spinHistory', []);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef(0);

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
    const elapsed = Date.now() - startRef.current;
    const next = pickRandom();
    if (!next) return;
    setCurrentDisplay(next);

    if (elapsed >= SPIN_DURATION) {
      const finalPick = pickRandom();
      if (finalPick) {
        setCurrentDisplay(finalPick);
        setResult(finalPick);
        setMessage(randomMessage());
        setHistory((prev) => {
          const updated = [{ issue: finalPick, timestamp: Date.now() }, ...prev];
          return updated.slice(0, 20); // Keep last 20
        });
        logger.info('Roulette drawer spin complete', {
          issueId: finalPick.id,
          identifier: finalPick.identifier,
        });
      }
      setIsSpinning(false);
      return;
    }

    let delay: number;
    if (elapsed < 1000) delay = TICK_FAST;
    else if (elapsed < 1800) delay = TICK_SLOW;
    else delay = TICK_CRAWL;

    timerRef.current = setTimeout(tick, delay);
  }, [pickRandom, setHistory]);

  const handleSpin = useCallback(() => {
    if (issues.length === 0) return;
    setIsSpinning(true);
    setResult(null);
    setMessage('');
    startRef.current = Date.now();
    tick();
  }, [issues, tick]);

  const handleOpenIssue = (issue: LinearIssue) => {
    openEntityDrawer(buildEntityURI('linear_issue', issue.id, issue.title));
  };

  const handleClearHistory = () => {
    setHistory([]);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <>
      <DrawerHeaderTitle>Issue Roulette</DrawerHeaderTitle>

      <DrawerBody>
        {/* Error state */}
        {error && !data && (
          <ContentSection>
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--status-error)' }}>
              <p style={{ fontSize: '13px', fontWeight: 600 }}>Linear not connected</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Install and configure the Linear plugin first.
              </p>
            </div>
          </ContentSection>
        )}

        {/* Loading */}
        {loading && !data && (
          <ContentSection>
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)' }}>
              Loading issues...
            </div>
          </ContentSection>
        )}

        {/* Main roulette area */}
        {!loading && !error && (
          <>
            <ContentSection>
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                {/* Wheel display area */}
                <div
                  style={{
                    minHeight: '80px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '8px',
                    background: 'var(--surface-elevated, rgba(255,255,255,0.05))',
                    border: `2px solid ${isSpinning ? 'var(--status-warning, #f5a623)' : result ? 'var(--brand-primary, #6e56cf)' : 'var(--border-muted)'}`,
                    padding: '16px',
                    marginBottom: '16px',
                    transition: 'border-color 0.3s',
                  }}
                >
                  {isSpinning && currentDisplay ? (
                    <>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color: 'var(--status-warning, #f5a623)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {currentDisplay.identifier}
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          marginTop: '4px',
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {currentDisplay.title}
                      </div>
                    </>
                  ) : result ? (
                    <>
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--brand-primary, #6e56cf)',
                          fontWeight: 600,
                          marginBottom: '8px',
                          fontStyle: 'italic',
                        }}
                      >
                        {message}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenIssue(result)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {result.identifier}
                        </div>
                        <div
                          style={{
                            fontSize: '13px',
                            color: 'var(--text-secondary)',
                            marginTop: '4px',
                          }}
                        >
                          {result.title}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '8px' }}>
                          <Badge variant="outline">{result.stateName}</Badge>
                          {result.priority > 0 && (
                            <Badge variant={result.priority <= 2 ? 'default' : 'secondary'}>
                              {result.priorityLabel} {PRIORITY_EMOJIS[result.priority]}
                            </Badge>
                          )}
                          {result.assigneeName && (
                            <Badge variant="secondary">{result.assigneeName}</Badge>
                          )}
                        </div>
                      </button>
                    </>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                      {issues.length > 0
                        ? 'Press Spin to pick your next issue'
                        : 'No issues available'}
                    </div>
                  )}
                </div>

                {/* Spin button */}
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSpin}
                  disabled={isSpinning || issues.length === 0}
                  style={{ minWidth: '120px' }}
                >
                  {isSpinning ? 'Spinning...' : 'Spin!'}
                </Button>

                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>
                  {issues.length} candidate{issues.length !== 1 ? 's' : ''} in the wheel
                </p>
              </div>
            </ContentSection>

            <Separator />

            {/* Candidates preview */}
            <ContentSection title={`Candidates (${issues.length})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '160px', overflow: 'auto' }}>
                {issues.slice(0, 10).map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => handleOpenIssue(issue)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>
                      {issue.identifier}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {issue.title}
                    </span>
                  </button>
                ))}
                {issues.length > 10 && (
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)', padding: '4px 8px' }}>
                    +{issues.length - 10} more
                  </p>
                )}
              </div>
            </ContentSection>

            {/* History */}
            {history.length > 0 && (
              <>
                <Separator />
                <ContentSection title="Spin History">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {history.slice(0, 10).map((entry, i) => (
                      <button
                        key={`${entry.issue.id}-${entry.timestamp}`}
                        type="button"
                        onClick={() => handleOpenIssue(entry.issue)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          border: 'none',
                          background: i === 0 ? 'var(--surface-elevated, rgba(255,255,255,0.05))' : 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                        }}
                      >
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0, width: '16px' }}>
                          {i + 1}.
                        </span>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>
                          {entry.issue.identifier}
                        </span>
                        <span
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {entry.issue.title}
                        </span>
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearHistory}
                    style={{ marginTop: '8px', width: '100%', fontSize: '11px' }}
                  >
                    Clear history
                  </Button>
                </ContentSection>
              </>
            )}
          </>
        )}
      </DrawerBody>
    </>
  );
}
