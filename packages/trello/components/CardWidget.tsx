import { useEntityQuery, gql, logger, EntityChip } from '@drift/plugin-api';

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const GET_CARD = gql`
  query GetTrelloCardForWidget($id: ID!) {
    trelloCard(id: $id) {
      id
      title
      idList
      listName
      idBoard
      boardName
      due
      dueComplete
      labels { id name color }
      checkItemsTotal
      checkItemsChecked
    }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrelloLabel { id: string; name?: string | null; color?: string | null; }

interface TrelloCard {
  id: string;
  title: string;
  idList: string;
  listName?: string | null;
  idBoard: string;
  boardName?: string | null;
  due?: string | null;
  dueComplete?: boolean;
  labels?: TrelloLabel[];
  checkItemsTotal?: number | null;
  checkItemsChecked?: number | null;
}

interface WidgetProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  label?: string;
  compact: boolean;
  messageId: string;
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

function isDueOverdue(due: string | null | undefined, dueComplete: boolean | undefined): boolean {
  if (!due || dueComplete) return false;
  return new Date(due) < new Date();
}

function isDueToday(due: string | null | undefined, dueComplete: boolean | undefined): boolean {
  if (!due || dueComplete) return false;
  const d = new Date(due);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// ─── Chip (compact) ───────────────────────────────────────────────────────────

function TrelloChip({ card, loading, label }: { card?: TrelloCard; loading: boolean; label?: string }) {
  if (loading) {
    return <EntityChip label="Loading..." color="var(--surface-subtle)" textColor="var(--text-muted)" />;
  }
  if (!card) {
    return <EntityChip label={label || 'Trello card'} color="var(--surface-subtle)" textColor="var(--text-muted)" />;
  }

  const overdue = isDueOverdue(card.due, card.dueComplete);
  const today = isDueToday(card.due, card.dueComplete);
  const statusColor = overdue ? '#e5484d' : today ? '#e5933a' : undefined;

  return (
    <EntityChip
      label={card.title}
      color="#0079BF"
      textColor="#fff"
      title={card.title}
      style={statusColor ? { borderLeft: `3px solid ${statusColor}` } : undefined}
    />
  );
}

// ─── Card (expanded) ──────────────────────────────────────────────────────────

function TrelloCard({ card, loading, error }: { card?: TrelloCard; loading: boolean; error?: { message: string } }) {
  if (loading) {
    return (
      <div style={{
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ height: 12, width: '30%', borderRadius: 4, background: 'var(--surface-hover)' }} />
        <div style={{ height: 14, width: '85%', borderRadius: 4, background: 'var(--surface-hover)' }} />
        <div style={{ height: 11, width: '50%', borderRadius: 4, background: 'var(--surface-hover)' }} />
      </div>
    );
  }

  if (error || !card) {
    return (
      <div style={{
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid var(--border-muted)',
        background: 'var(--surface-subtle)',
        color: 'var(--text-muted)',
        fontSize: 12,
      }}>
        {error ? `Failed to load card: ${error.message}` : 'Card not found'}
      </div>
    );
  }

  const overdue = isDueOverdue(card.due, card.dueComplete);
  const today = isDueToday(card.due, card.dueComplete);
  const dueColor = card.dueComplete
    ? 'var(--status-success, #30a46c)'
    : overdue ? '#e5484d' : today ? '#e5933a' : 'var(--text-muted)';
  const visibleLabels = (card.labels ?? []).filter(l => l.color).slice(0, 3);
  const checkProgress = card.checkItemsTotal ? `${card.checkItemsChecked ?? 0}/${card.checkItemsTotal}` : null;

  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 8,
      border: '1px solid var(--border-muted)',
      borderLeft: '3px solid #0079bf',
      background: 'var(--surface-subtle)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
        <span style={{ color: '#0079bf', fontWeight: 600, fontSize: 10 }}>Trello</span>
        {card.boardName && <><span>·</span><span>{card.boardName}</span></>}
        {card.listName && <><span>›</span><span style={{ color: 'var(--text-secondary)' }}>{card.listName}</span></>}
      </div>

      {/* Title */}
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3 }}>
        {card.title}
      </div>

      {/* Metadata row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
        {/* Label dots */}
        {visibleLabels.length > 0 && (
          <div style={{ display: 'flex', gap: 3 }}>
            {visibleLabels.map(l => (
              <span
                key={l.id}
                style={{ width: 8, height: 8, borderRadius: '50%', background: getLabelColor(l.color), display: 'inline-block' }}
                title={l.name ?? l.color ?? ''}
              />
            ))}
          </div>
        )}

        {/* Due date */}
        {card.due && (
          <span style={{ color: dueColor, fontWeight: (overdue || today) ? 600 : 400 }}>
            {card.dueComplete ? '✓ ' : ''}{new Date(card.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}

        {/* Checklist progress */}
        {checkProgress && (
          <span style={{ color: 'var(--text-muted)' }}>✓ {checkProgress}</span>
        )}
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function CardWidget({ uri, pathSegments, label, compact }: WidgetProps) {
  const cardId = pathSegments[0];

  const { data, loading, error } = useEntityQuery(GET_CARD, {
    variables: { id: cardId },
    skip: !cardId,
  });

  const card = data?.trelloCard as TrelloCard | undefined;

  if (error) {
    logger.error('Failed to load Trello card for widget', { cardId, uri, error: error.message });
  }

  if (compact) {
    return <TrelloChip card={card} loading={loading} label={label} />;
  }
  return <TrelloCard card={card} loading={loading} error={error} />;
}
