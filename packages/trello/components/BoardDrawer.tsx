import {
  DrawerHeaderTitle,
  DrawerBody,
  ContentSection,
  Button,
  Separator,
} from '@drift/ui';
import { useEntityQuery, gql, logger, openExternal } from '@drift/plugin-api';

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const GET_BOARD = gql`
  query GetTrelloBoard($id: ID!) {
    trelloBoard(id: $id) {
      id
      title
      desc
      closed
      url
      shortUrl
      memberCount
      listCount
      lists { id name pos closed }
      labels { id name color }
    }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrelloListSummary { id: string; name: string; pos: number; closed: boolean; }
interface TrelloLabel { id: string; name?: string | null; color?: string | null; }

interface TrelloBoard {
  id: string;
  title: string;
  desc?: string | null;
  closed?: boolean;
  url?: string | null;
  shortUrl?: string | null;
  memberCount?: number | null;
  listCount?: number | null;
  lists?: TrelloListSummary[];
  labels?: TrelloLabel[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LABEL_COLOR_MAP: Record<string, string> = {
  red: '#eb5a46', orange: '#ff9f1a', yellow: '#f2d600',
  green: '#61bd4f', blue: '#0079bf', purple: '#c377e0',
  pink: '#ff78cb', sky: '#00c2e0', lime: '#51e898', black: '#4d4d4d',
};

function getLabelColor(color: string | null | undefined): string {
  return color ? (LABEL_COLOR_MAP[color] ?? '#ccc') : '#ccc';
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface EntityDrawerProps {
  entityId: string;
  entityType: string;
  label?: string;
  drawer: {
    close: () => void;
    open: (uri: string) => void;
    push: (uri: string) => void;
    pop: () => void;
    canPop: boolean;
  };
  pluginId: string;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BoardDrawer({ entityId, label, drawer }: EntityDrawerProps) {
  const { data, loading, error } = useEntityQuery(GET_BOARD, { variables: { id: entityId } });
  const board: TrelloBoard | undefined = data?.trelloBoard;

  if (loading && !board) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading board...</div>
      </div>
    );
  }

  if (error && !board) {
    logger.error('Failed to load Trello board', { entityId, error: error.message });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--status-error)', fontSize: '13px' }}>
          Failed to load board: {error.message}
        </div>
      </div>
    );
  }

  if (!board) {
    return <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>Board not found</div>;
  }

  const openLists = (board.lists ?? []).filter(l => !l.closed).sort((a, b) => a.pos - b.pos);
  const namedLabels = (board.labels ?? []).filter(l => l.name);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <DrawerHeaderTitle>{board.title}</DrawerHeaderTitle>

      <DrawerBody>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          {board.memberCount != null && (
            <span><strong style={{ color: 'var(--text-primary)' }}>{board.memberCount}</strong> member{board.memberCount !== 1 ? 's' : ''}</span>
          )}
          {board.listCount != null && (
            <span><strong style={{ color: 'var(--text-primary)' }}>{board.listCount}</strong> list{board.listCount !== 1 ? 's' : ''}</span>
          )}
          {board.closed && (
            <span style={{ color: 'var(--status-warning)' }}>Archived</span>
          )}
        </div>

        {/* Description */}
        {board.desc && (
          <>
            <ContentSection title="Description">
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                {board.desc}
              </p>
            </ContentSection>
            <Separator />
          </>
        )}

        {/* Lists */}
        {openLists.length > 0 && (
          <>
            <ContentSection title={`Lists (${openLists.length})`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {openLists.map((list, idx) => (
                  <div
                    key={list.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: 'var(--surface-subtle)',
                      border: '1px solid var(--border-muted)',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 16, textAlign: 'right', flexShrink: 0 }}>
                      {idx + 1}
                    </span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{list.name}</span>
                  </div>
                ))}
              </div>
            </ContentSection>
            <Separator />
          </>
        )}

        {/* Labels */}
        {namedLabels.length > 0 && (
          <>
            <ContentSection title="Labels">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {namedLabels.map(label => {
                  const bg = getLabelColor(label.color);
                  return (
                    <span
                      key={label.id}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '3px 10px',
                        borderRadius: 10,
                        background: bg + '33',
                        color: bg,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: bg, display: 'inline-block', flexShrink: 0 }} />
                      {label.name}
                    </span>
                  );
                })}
              </div>
            </ContentSection>
            <Separator />
          </>
        )}

        {/* Action bar */}
        <ContentSection>
          <div style={{ display: 'flex', gap: 8 }}>
            {(board.url || board.shortUrl) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openExternal(board.url ?? board.shortUrl!)}
              >
                Open in Trello ↗
              </Button>
            )}
          </div>
        </ContentSection>

      </DrawerBody>
    </div>
  );
}
