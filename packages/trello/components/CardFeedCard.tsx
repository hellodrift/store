/**
 * Trello Card Feed Card
 *
 * feed-card canvas for trello_card entities.
 * Renders a rich card summary directly in the Drift feed.
 *
 * Props follow the feed-card contract:
 *   { uri, entityType, pathSegments, title, subtitle, metadata, size }
 */

import { useEntityQuery, gql } from '@drift/plugin-api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeedCardProps {
  uri: string;
  entityType: string;
  pathSegments: string[];
  title?: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
  size: 'small' | 'medium' | 'large' | 'full';
}

interface TrelloLabel { id: string; name?: string | null; color?: string | null; }

interface TrelloCard {
  id: string;
  title: string;
  desc?: string | null;
  idList: string;
  listName?: string | null;
  boardName?: string | null;
  due?: string | null;
  dueComplete?: boolean;
  labels?: TrelloLabel[];
  memberNames?: string | null;
  checkItemsTotal?: number | null;
  checkItemsChecked?: number | null;
  url?: string | null;
}

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const GET_CARD = gql`
  query GetTrelloCardForFeed($id: ID!) {
    trelloCard(id: $id) {
      id
      title
      desc
      idList
      listName
      boardName
      due
      dueComplete
      labels { id name color }
      memberNames
      checkItemsTotal
      checkItemsChecked
      url
    }
  }
`;

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

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonLine({ width, height = 12 }: { width: string | number; height?: number }) {
  return (
    <div style={{ height, width, borderRadius: 4, background: 'var(--surface-hover)' }} />
  );
}

// ─── TrelloLogo ───────────────────────────────────────────────────────────────

function TrelloLogo({ size = 12 }: { size?: number }) {
  // Simple "T" mark in Trello blue
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="4" fill="#0079BF" />
      <rect x="5" y="5" width="9" height="18" rx="2" fill="white" />
      <rect x="18" y="5" width="9" height="11" rx="2" fill="white" />
    </svg>
  );
}

// ─── Metadata Row ─────────────────────────────────────────────────────────────

function MetaRow({ card }: { card: TrelloCard }) {
  const overdue = isDueOverdue(card.due, card.dueComplete);
  const today = isDueToday(card.due, card.dueComplete);
  const dueColor = card.dueComplete ? '#30a46c' : overdue ? '#e5484d' : today ? '#e5933a' : 'var(--text-muted)';
  const visibleLabels = (card.labels ?? []).filter(l => l.color || l.name).slice(0, 3);
  const checkProgress = card.checkItemsTotal ? `${card.checkItemsChecked ?? 0}/${card.checkItemsTotal}` : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
      {/* Labels */}
      {visibleLabels.length > 0 && (
        <div style={{ display: 'flex', gap: 4 }}>
          {visibleLabels.map(l => (
            <span
              key={l.id}
              style={{
                padding: '1px 7px',
                borderRadius: 10,
                background: getLabelColor(l.color) + '33',
                color: getLabelColor(l.color),
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              {l.name ?? l.color}
            </span>
          ))}
        </div>
      )}

      {/* Due date */}
      {card.due && (
        <span style={{ color: dueColor, fontWeight: (overdue || today) ? 600 : 400 }}>
          {card.dueComplete ? '✓ ' : ''}{new Date(card.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      )}

      {/* Assignees */}
      {card.memberNames && <span>{card.memberNames}</span>}

      {/* Checklist */}
      {checkProgress && <span>✓ {checkProgress}</span>}
    </div>
  );
}

// ─── Card Variants ────────────────────────────────────────────────────────────

function SmallCard({ card, loading }: { card?: TrelloCard; loading: boolean }) {
  if (loading || !card) {
    return (
      <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <SkeletonLine width={40} height={10} />
        <SkeletonLine width="80%" height={12} />
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-muted)', borderLeft: '3px solid #0079bf', background: 'var(--surface-subtle)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <TrelloLogo size={10} />
        {card.listName && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{card.listName}</span>}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {card.title}
      </div>
    </div>
  );
}

function MediumCard({ card, loading }: { card?: TrelloCard; loading: boolean }) {
  if (loading || !card) {
    return (
      <div style={{ padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <SkeletonLine width={80} height={11} />
          <SkeletonLine width={60} height={11} />
        </div>
        <SkeletonLine width="90%" height={14} />
        <SkeletonLine width="60%" height={11} />
      </div>
    );
  }

  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border-muted)', borderLeft: '3px solid #0079bf', background: 'var(--surface-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TrelloLogo size={11} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#0079bf' }}>Trello</span>
          {card.boardName && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {card.boardName}</span>}
        </div>
        {card.listName && (
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'var(--surface-hover)', color: 'var(--text-secondary)', fontWeight: 500, flexShrink: 0 }}>
            {card.listName}
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.35 }}>
        {card.title}
      </div>

      <MetaRow card={card} />
    </div>
  );
}

function LargeCard({ card, loading }: { card?: TrelloCard; loading: boolean }) {
  if (loading || !card) {
    return (
      <div style={{ padding: '16px 18px', borderRadius: 10, border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <SkeletonLine width={90} height={12} />
          <SkeletonLine width={70} height={12} />
        </div>
        <SkeletonLine width="85%" height={15} />
        <SkeletonLine width="70%" height={12} />
        <SkeletonLine width="100%" height={11} />
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 18px', borderRadius: 10, border: '1px solid var(--border-muted)', borderLeft: '3px solid #0079bf', background: 'var(--surface-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TrelloLogo size={12} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#0079bf' }}>Trello</span>
          {card.boardName && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {card.boardName}</span>}
        </div>
        {card.listName && (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--surface-hover)', color: 'var(--text-secondary)', fontWeight: 500 }}>
            {card.listName}
          </span>
        )}
      </div>

      {/* Title */}
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
        {card.title}
      </div>

      {/* Description preview */}
      {card.desc && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
          {card.desc}
        </div>
      )}

      {/* Metadata footer */}
      <div style={{ borderTop: '1px solid var(--border-muted)', paddingTop: 8 }}>
        <MetaRow card={card} />
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function CardFeedCard({ pathSegments, size }: FeedCardProps) {
  const cardId = pathSegments[0];

  const { data, loading } = useEntityQuery(GET_CARD, {
    variables: { id: cardId },
    skip: !cardId,
  });

  const card = data?.trelloCard as TrelloCard | undefined;

  if (!cardId) {
    return (
      <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border-muted)', background: 'var(--surface-subtle)', fontSize: 12, color: 'var(--text-muted)' }}>
        Invalid card URI
      </div>
    );
  }

  if (size === 'small') return <SmallCard card={card} loading={loading} />;
  if (size === 'large' || size === 'full') return <LargeCard card={card} loading={loading} />;
  return <MediumCard card={card} loading={loading} />;
}
