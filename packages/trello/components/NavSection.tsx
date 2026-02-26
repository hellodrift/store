import { useState, useEffect, useCallback } from 'react';
import { NavSection, NavItem, NavSettingsButton, NavHeaderActions } from '@drift/ui/components';
import { useEntityQuery, gql, logger, useEntityDrawer, useEntitySelection, buildEntityURI } from '@drift/plugin-api';
import { useTrelloSettings } from './useTrelloSettings';

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const GET_NAV_CARDS = gql`
  query GetTrelloNavCards($boardIds: [ID!], $showAll: Boolean, $limit: Int) {
    trelloNavCards(boardIds: $boardIds, showAll: $showAll, limit: $limit) {
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

interface ListGroup { listId: string; listName: string; cards: TrelloCard[]; }
interface BoardGroup { boardId: string; boardName: string; lists: ListGroup[]; }

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

function groupCards(cards: TrelloCard[]): BoardGroup[] {
  const boardMap = new Map<string, { boardId: string; boardName: string; lists: Map<string, TrelloCard[]> }>();

  for (const card of cards) {
    const bKey = card.idBoard;
    const bName = card.boardName ?? card.idBoard;
    const lKey = card.idList;

    if (!boardMap.has(bKey)) boardMap.set(bKey, { boardId: bKey, boardName: bName, lists: new Map() });
    const bEntry = boardMap.get(bKey)!;
    if (!bEntry.lists.has(lKey)) bEntry.lists.set(lKey, []);
    bEntry.lists.get(lKey)!.push(card);
  }

  return Array.from(boardMap.values()).map(b => ({
    boardId: b.boardId,
    boardName: b.boardName,
    lists: Array.from(b.lists.entries()).map(([listId, listCards]) => ({
      listId,
      listName: listCards[0]?.listName ?? listId,
      cards: listCards,
    })),
  }));
}

// ─── Persistent Expand State ──────────────────────────────────────────────────

const EXPAND_STORAGE_KEY = 'drift-plugin:trello:nav-expanded';

function readExpandedMap(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(EXPAND_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return {};
}

function usePersistentExpanded(): [Record<string, boolean>, (id: string) => void] {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(readExpandedMap);

  const toggle = useCallback((id: string) => {
    setExpanded(prev => {
      // Default is true (expanded), so absent key = expanded
      const next = { ...prev, [id]: !(prev[id] ?? true) };
      try { localStorage.setItem(EXPAND_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return [expanded, toggle];
}

// ─── Card Nav Item ─────────────────────────────────────────────────────────────

function CardNavItem({ card, depth, onSelect }: { card: TrelloCard; depth: number; onSelect: () => void }) {
  const overdue = isDueOverdue(card.due, card.dueComplete);
  const today = isDueToday(card.due, card.dueComplete);
  const visibleLabels = (card.labels ?? []).filter(l => l.color).slice(0, 3);
  const checkProgress = card.checkItemsTotal ? `${card.checkItemsChecked ?? 0}/${card.checkItemsTotal}` : null;

  return (
    <NavItem
      item={{
        id: card.id,
        label: card.title || '(No title)',
        variant: 'item' as const,
        meta: (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            {visibleLabels.map(l => (
              <span key={l.id} style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: getLabelColor(l.color), display: 'inline-block', flexShrink: 0 }} title={l.name ?? l.color ?? ''} />
            ))}
            {card.due && (
              <span style={{ color: overdue ? 'var(--status-error, #e5484d)' : today ? 'var(--status-warning, #e5933a)' : 'inherit', fontWeight: overdue || today ? 600 : undefined }}>
                {new Date(card.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
            {checkProgress && <span>{checkProgress} ✓</span>}
          </span>
        ),
      }}
      depth={depth}
      onSelect={onSelect}
    />
  );
}

// ─── List Folder ──────────────────────────────────────────────────────────────

function ListFolderItem({ list, depth, isExpanded, onToggle, onSelect }: { list: ListGroup; depth: number; isExpanded: boolean; onToggle: () => void; onSelect: (card: TrelloCard) => void }) {
  return (
    <NavItem
      item={{
        id: list.listId,
        label: list.listName,
        variant: 'folder' as const,
        meta: list.cards.length > 0
          ? <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{list.cards.length}</span>
          : undefined,
      }}
      isExpanded={isExpanded}
      onToggle={onToggle}
      depth={depth}
    >
      {list.cards.map(card => (
        <CardNavItem key={card.id} card={card} depth={depth + 1} onSelect={() => onSelect(card)} />
      ))}
    </NavItem>
  );
}

// ─── Board Folder ─────────────────────────────────────────────────────────────

function BoardFolderItem({ board, showListLevel, isExpanded, onToggle, expanded, onToggleList, onSelect }: { board: BoardGroup; showListLevel: boolean; isExpanded: boolean; onToggle: () => void; expanded: Record<string, boolean>; onToggleList: (id: string) => void; onSelect: (card: TrelloCard) => void }) {
  const totalCards = board.lists.reduce((s, l) => s + l.cards.length, 0);

  return (
    <NavItem
      item={{
        id: board.boardId,
        label: board.boardName,
        variant: 'folder' as const,
        meta: totalCards > 0
          ? <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{totalCards}</span>
          : undefined,
      }}
      isExpanded={isExpanded}
      onToggle={onToggle}
      depth={0}
    >
      {showListLevel
        ? board.lists.map(list => (
            <ListFolderItem key={list.listId} list={list} depth={1} isExpanded={expanded[list.listId] ?? true} onToggle={() => onToggleList(list.listId)} onSelect={onSelect} />
          ))
        : board.lists.flatMap(l => l.cards).map(card => (
            <CardNavItem key={card.id} card={card} depth={1} onSelect={() => onSelect(card)} />
          ))
      }
    </NavItem>
  );
}

// ─── Trello Logo Icon ─────────────────────────────────────────────────────────

function TrelloIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M21.147 0H2.853A2.86 2.86 0 000 2.853v18.294A2.86 2.86 0 002.853 24h18.294A2.86 2.86 0 0024 21.147V2.853A2.86 2.86 0 0021.147 0zM10.34 17.287a.953.953 0 01-.953.953h-4a.954.954 0 01-.954-.953V5.38a.953.953 0 01.954-.953h4a.954.954 0 01.953.953zm9.233-5.467a.944.944 0 01-.953.947h-4a.947.947 0 01-.953-.947V5.38a.953.953 0 01.953-.953h4a.954.954 0 01.953.953z" />
    </svg>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function TrelloNav() {
  const [settings, updateSettings] = useTrelloSettings();
  const [expanded, toggleExpanded] = usePersistentExpanded();
  const { select } = useEntitySelection();
  const { openEntityDrawer } = useEntityDrawer();

  const queryVars = {
    boardIds: settings.boardIds?.length ? settings.boardIds : undefined,
    showAll: settings.showMode === 'all',
    limit: settings.limit,
  };

  const { data, loading, error, refetch } = useEntityQuery(GET_NAV_CARDS, {
    variables: queryVars,
  });

  // Refetch when settings change so the nav updates immediately
  useEffect(() => {
    refetch?.();
  }, [settings.boardIds.join(','), settings.showMode, settings.limit]);

  const cards: TrelloCard[] = data?.trelloNavCards ?? [];
  const boards = groupCards(cards);

  const isAuthErr = !!(error && (
    error.message.includes('401') ||
    error.message.toLowerCase().includes('authentication failed') ||
    error.message.toLowerCase().includes('not configured')
  ));

  if (error) logger.error('Trello nav error', { error: error.message, isAuthErr });

  const handleCardSelect = (card: TrelloCard) => {
    logger.info('Trello card selected', { cardId: card.id, title: card.title });
    openEntityDrawer(buildEntityURI('trello_card', card.id, card.title));
  };

  const openSettings = (e: React.MouseEvent) => {
    e.stopPropagation();
    select({ id: 'settings', type: 'drawer', data: {} });
  };

  const totalCards = cards.length;
  const sectionLabel = `Trello${totalCards ? ` (${totalCards})` : ''}`;
  const showEmpty = !loading && !error && cards.length === 0;

  const section = {
    id: 'trello-cards',
    label: sectionLabel,
    icon: <TrelloIcon />,
    items: [],
    isLoading: loading && cards.length === 0,
    emptyState: '',
    hoverActions: (
      <NavHeaderActions>
        <NavSettingsButton onClick={openSettings} ariaLabel="Trello settings" />
      </NavHeaderActions>
    ),
  };

  const isSingleBoard = boards.length === 1;
  const useFlat = isSingleBoard && settings.flatIfSingleBoard;

  function renderCards() {
    if (boards.length === 0) return null;

    if (useFlat) {
      // Single board flat: lists at depth 0, no board folder
      return settings.showListLevel
        ? boards[0].lists.map(list => (
            <ListFolderItem key={list.listId} list={list} depth={0} isExpanded={expanded[list.listId] ?? true} onToggle={() => toggleExpanded(list.listId)} onSelect={handleCardSelect} />
          ))
        : boards[0].lists.flatMap(l => l.cards).map(card => (
            <CardNavItem key={card.id} card={card} depth={0} onSelect={() => handleCardSelect(card)} />
          ));
    }

    // Multi-board: board folders at depth 0
    return boards.map(board => (
      <BoardFolderItem key={board.boardId} board={board} showListLevel={settings.showListLevel} isExpanded={expanded[board.boardId] ?? true} onToggle={() => toggleExpanded(board.boardId)} expanded={expanded} onToggleList={toggleExpanded} onSelect={handleCardSelect} />
    ));
  }

  return (
    <NavSection section={section}>

      {/* Auth error banner */}
      {isAuthErr && (
        <div style={{ margin: '4px 8px 6px', padding: '8px 10px', borderRadius: 6, background: 'var(--status-error-bg, #fff0f0)', border: '1px solid var(--status-error, #e5484d)', fontSize: 11, color: 'var(--status-error, #e5484d)', lineHeight: 1.4 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Trello: authentication failed</div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
            {error?.message.includes('not configured') ? 'No credentials configured.' : 'API key or token is invalid or expired.'}
          </div>
          <button onClick={openSettings} style={{ fontSize: 11, fontWeight: 600, color: 'var(--status-error, #e5484d)', background: 'none', border: '1px solid var(--status-error, #e5484d)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>
            Open Settings
          </button>
        </div>
      )}

      {/* Directory tree */}
      {renderCards()}

      {/* Empty state */}
      {showEmpty && !isAuthErr && (
        <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {settings.showMode === 'mine'
            ? <>No cards assigned to you.{' '}
                <button onClick={() => updateSettings({ showMode: 'all' })} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-accent, #0079bf)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
                  Show all cards
                </button> instead.
              </>
            : 'No open cards found on your boards.'}
        </div>
      )}

    </NavSection>
  );
}
