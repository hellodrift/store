import { useState } from 'react';
import { NavSection, NavItem, NavSettingsButton, NavHeaderActions } from '@drift/ui/components';
import { useEntityQuery, gql, logger, useEntityDrawer, useEntitySelection, buildEntityURI } from '@drift/plugin-api';
import { useTrelloSettings } from './useTrelloSettings';

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const GET_MY_CARDS = gql`
  query GetMyTrelloCards($limit: Int) {
    trelloMyCards(limit: $limit) {
      id
      title
      idList
      listName
      idBoard
      boardName
      due
      dueComplete
      labels { id name color }
      memberNames
      checkItemsTotal
      checkItemsChecked
    }
  }
`;

const GET_BOARD_CARDS = gql`
  query GetTrelloBoardCards($boardId: ID!, $limit: Int) {
    trelloBoardCards(boardId: $boardId, limit: $limit) {
      id
      title
      idList
      listName
      idBoard
      boardName
      due
      dueComplete
      labels { id name color }
      memberNames
      checkItemsTotal
      checkItemsChecked
    }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrelloLabel {
  id: string;
  name?: string | null;
  color?: string | null;
}

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
  memberNames?: string | null;
  checkItemsTotal?: number | null;
  checkItemsChecked?: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LABEL_COLOR_MAP: Record<string, string> = {
  red: '#eb5a46',
  orange: '#ff9f1a',
  yellow: '#f2d600',
  green: '#61bd4f',
  blue: '#0079bf',
  purple: '#c377e0',
  pink: '#ff78cb',
  sky: '#00c2e0',
  lime: '#51e898',
  black: '#4d4d4d',
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
  const dueDate = new Date(due);
  const now = new Date();
  return (
    dueDate.getFullYear() === now.getFullYear() &&
    dueDate.getMonth() === now.getMonth() &&
    dueDate.getDate() === now.getDate()
  );
}

function groupCardsByList(cards: TrelloCard[]): Map<string, TrelloCard[]> {
  const groups = new Map<string, TrelloCard[]>();
  for (const card of cards) {
    const key = card.listName ?? card.idList ?? 'Unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(card);
  }
  return groups;
}

// ─── Card Nav Item ─────────────────────────────────────────────────────────────

function CardNavItem({ card, onSelect }: { card: TrelloCard; onSelect: () => void }) {
  const overdue = isDueOverdue(card.due, card.dueComplete);
  const today = isDueToday(card.due, card.dueComplete);
  const visibleLabels = (card.labels ?? []).filter((l) => l.color).slice(0, 3);
  const checkProgress = card.checkItemsTotal
    ? `${card.checkItemsChecked ?? 0}/${card.checkItemsTotal}`
    : null;

  return (
    <NavItem
      key={card.id}
      item={{
        id: card.id,
        label: card.title || '(No title)',
        variant: 'item' as const,
        meta: (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {visibleLabels.map((label) => (
              <span
                key={label.id}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: getLabelColor(label.color),
                  display: 'inline-block',
                  flexShrink: 0,
                }}
                title={label.name ?? label.color ?? ''}
              />
            ))}
            {card.due && (
              <span
                style={{
                  color: overdue
                    ? 'var(--status-error, #e5484d)'
                    : today
                    ? 'var(--status-warning, #e5933a)'
                    : 'inherit',
                  fontWeight: overdue || today ? 600 : undefined,
                }}
              >
                {new Date(card.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
            {checkProgress && <span>{checkProgress} ✓</span>}
          </span>
        ),
      }}
      onSelect={onSelect}
    />
  );
}

// ─── Grouped Cards Section ─────────────────────────────────────────────────────

function GroupedCards({ cards, onSelect }: { cards: TrelloCard[]; onSelect: (card: TrelloCard) => void }) {
  const groups = groupCardsByList(cards);
  return (
    <>
      {Array.from(groups.entries()).map(([listName, groupCards]) => (
        <div key={listName}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '8px 12px 2px',
            }}
          >
            {listName}
          </div>
          {groupCards.map((card) => (
            <CardNavItem key={card.id} card={card} onSelect={() => onSelect(card)} />
          ))}
        </div>
      ))}
    </>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function TrelloNav() {
  const [settings, updateSettings] = useTrelloSettings();
  const { select } = useEntitySelection();
  const { openEntityDrawer } = useEntityDrawer();
  const [activeTab, setActiveTab] = useState<'my-cards' | 'board'>(settings.activeTab ?? 'my-cards');

  // My Cards query
  const {
    data: myCardsData,
    loading: myCardsLoading,
    error: myCardsError,
  } = useEntityQuery(GET_MY_CARDS, {
    variables: { limit: settings.limit },
    skip: activeTab !== 'my-cards',
  });

  // Board cards query
  const {
    data: boardCardsData,
    loading: boardCardsLoading,
    error: boardCardsError,
  } = useEntityQuery(GET_BOARD_CARDS, {
    variables: { boardId: settings.boardId, limit: settings.limit },
    skip: activeTab !== 'board' || !settings.boardId,
  });

  const myCards: TrelloCard[] = myCardsData?.trelloMyCards ?? [];
  const boardCards: TrelloCard[] = boardCardsData?.trelloBoardCards ?? [];

  const cards = activeTab === 'my-cards' ? myCards : boardCards;
  const loading = activeTab === 'my-cards' ? myCardsLoading : boardCardsLoading;
  const error = activeTab === 'my-cards' ? myCardsError : boardCardsError;

  const handleTabChange = (tab: 'my-cards' | 'board') => {
    setActiveTab(tab);
    updateSettings({ activeTab: tab });
  };

  const handleCardSelect = (card: TrelloCard) => {
    logger.info('Trello card selected', { cardId: card.id, title: card.title });
    openEntityDrawer(buildEntityURI('trello_card', card.id, card.title));
  };

  const sectionLabel = activeTab === 'my-cards'
    ? `Trello${cards.length ? ` (${cards.length})` : ''}`
    : `Trello${settings.boardName ? ` — ${settings.boardName}` : ''}${cards.length ? ` (${cards.length})` : ''}`;

  let emptyState = '';
  if (error && !cards.length) {
    emptyState = error.message;
    logger.error('Failed to load Trello cards', { error: error.message });
  } else if (activeTab === 'board' && !settings.boardId) {
    emptyState = 'Configure a board in settings';
  } else {
    emptyState = 'No cards found';
  }

  const section = {
    id: 'trello-cards',
    label: sectionLabel,
    icon: null,
    items: [],
    isLoading: loading && !cards.length,
    emptyState,
    hoverActions: (
      <NavHeaderActions>
        <NavSettingsButton
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            select({ id: 'settings', type: 'drawer', data: {} });
          }}
          ariaLabel="Trello settings"
        />
      </NavHeaderActions>
    ),
  };

  return (
    <NavSection section={section}>
      {/* Tab switcher */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          padding: '4px 8px 2px',
        }}
      >
        {(['my-cards', 'board'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              background: activeTab === tab ? 'var(--surface-hover)' : 'transparent',
              color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === tab ? 600 : 400,
            }}
          >
            {tab === 'my-cards' ? 'My Cards' : 'Board'}
          </button>
        ))}
      </div>

      {cards.length > 0 && (
        <GroupedCards cards={cards} onSelect={handleCardSelect} />
      )}
    </NavSection>
  );
}
