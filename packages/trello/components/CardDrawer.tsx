import { useState } from 'react';
import {
  DrawerHeaderTitle,
  DrawerHeaderActions,
  DrawerBody,
  ContentSection,
  InlineEdit,
  Button,
  Textarea,
  Separator,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Markdown,
  MarkdownEditor,
  WorkstreamHeaderAction,
  WorkstreamSection,
  type LinkedWorkstream,
  type ActiveWorkstream,
} from '@drift/ui';
import { useEntityQuery, useEntityMutation, gql, logger, openExternal, buildEntityURI, useWorkstreamLinker } from '@drift/plugin-api';
import { useOptimistic } from './useOptimistic';

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const GET_CARD = gql`
  query GetTrelloCard($id: ID!) {
    trelloCard(id: $id) {
      id
      title
      desc
      idList
      listName
      idBoard
      boardName
      due
      dueComplete
      start
      closed
      url
      memberNames
      members { id username fullName }
      labels { id name color }
      labelNames
      checkItemsTotal
      checkItemsChecked
      checklists {
        id name pos
        checkItems { id name state pos }
      }
      commentCount
    }
  }
`;

const GET_LISTS = gql`
  query GetTrelloLists($boardId: ID!) {
    trelloLists(boardId: $boardId) {
      id
      title
      pos
      closed
    }
  }
`;

const GET_COMMENTS = gql`
  query GetTrelloActions($cardId: ID!, $filter: String) {
    trelloActions(cardId: $cardId, filter: $filter) {
      id
      type
      date
      text
      memberCreatorName
    }
  }
`;

// ─── Mutations ────────────────────────────────────────────────────────────────

const UPDATE_CARD = gql`
  mutation UpdateTrelloCard($id: ID!, $input: UpdateTrelloCardInput!) {
    updateTrelloCard(id: $id, input: $input) { success message }
  }
`;

const MOVE_CARD = gql`
  mutation MoveTrelloCard($id: ID!, $idList: ID!, $pos: String) {
    moveTrelloCard(id: $id, idList: $idList, pos: $pos) { success message }
  }
`;

const ARCHIVE_CARD = gql`
  mutation ArchiveTrelloCard($id: ID!) {
    archiveTrelloCard(id: $id) { success message }
  }
`;

const ADD_COMMENT = gql`
  mutation AddTrelloCardComment($cardId: ID!, $text: String!) {
    addTrelloCardComment(cardId: $cardId, text: $text) { success message }
  }
`;

const COMPLETE_CHECK_ITEM = gql`
  mutation CompleteTrelloCheckItem($cardId: ID!, $checkItemId: ID!, $complete: Boolean!) {
    completeTrelloCheckItem(cardId: $cardId, checkItemId: $checkItemId, complete: $complete) { success message }
  }
`;

const ADD_CHECKLIST = gql`
  mutation AddTrelloChecklist($cardId: ID!, $name: String!) {
    addTrelloChecklist(cardId: $cardId, name: $name) { success message }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrelloMember { id: string; username: string; fullName: string; }
interface TrelloLabel { id: string; name?: string | null; color?: string | null; }
interface TrelloCheckItem { id: string; name: string; state: string; pos: number; }
interface TrelloChecklist { id: string; name: string; pos: number; checkItems: TrelloCheckItem[]; }
interface TrelloAction { id: string; type: string; date: string; text?: string | null; memberCreatorName?: string | null; }

interface TrelloCard {
  id: string;
  title: string;
  desc?: string | null;
  idList: string;
  listName?: string | null;
  idBoard: string;
  boardName?: string | null;
  due?: string | null;
  dueComplete?: boolean;
  start?: string | null;
  closed?: boolean;
  url?: string | null;
  memberNames?: string | null;
  members?: TrelloMember[];
  labels?: TrelloLabel[];
  labelNames?: string | null;
  checkItemsTotal?: number | null;
  checkItemsChecked?: number | null;
  checklists?: TrelloChecklist[];
  commentCount?: number | null;
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCommentDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DueBadge({ due, dueComplete }: { due: string; dueComplete?: boolean }) {
  const overdue = isDueOverdue(due, dueComplete);
  const today = isDueToday(due, dueComplete);
  let color = 'var(--text-muted)';
  if (dueComplete) color = 'var(--status-success, #30a46c)';
  else if (overdue) color = 'var(--status-error, #e5484d)';
  else if (today) color = 'var(--status-warning, #e5933a)';

  return (
    <span style={{ fontSize: 11, fontWeight: 500, color, padding: '2px 7px', borderRadius: 4, border: `1px solid ${color}`, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {dueComplete ? '✓ ' : ''}{formatDate(due)}
    </span>
  );
}

function LabelPill({ label }: { label: TrelloLabel }) {
  const bg = getLabelColor(label.color);
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: bg + '33', color: bg, display: 'inline-block' }}>
      {label.name || label.color || 'Label'}
    </span>
  );
}

function ChecklistSection({ checklist, cardId, onToggleItem }: { checklist: TrelloChecklist; cardId: string; onToggleItem: (checkItemId: string, complete: boolean) => void; }) {
  const total = checklist.checkItems.length;
  const checked = checklist.checkItems.filter(i => i.state === 'complete').length;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{checklist.name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{checked}/{total}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--surface-hover)', marginBottom: 8 }}>
        <div style={{ height: '100%', borderRadius: 2, background: pct === 100 ? 'var(--status-success, #30a46c)' : '#0079bf', width: `${pct}%`, transition: 'width 0.2s' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[...checklist.checkItems].sort((a, b) => a.pos - b.pos).map(item => (
          <label key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', padding: '2px 0' }}>
            <input type="checkbox" checked={item.state === 'complete'} onChange={(e) => onToggleItem(item.id, e.target.checked)} style={{ marginTop: 2, cursor: 'pointer', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: item.state === 'complete' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: item.state === 'complete' ? 'line-through' : 'none', lineHeight: 1.4 }}>
              {item.name}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
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

export default function CardDrawer({ entityId, label, drawer }: EntityDrawerProps) {
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [newChecklistName, setNewChecklistName] = useState('');
  const [showAddChecklist, setShowAddChecklist] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');

  // ── Workstream linking ────────────────────────────────────────────────────
  const entityUri = buildEntityURI('trello_card', entityId);
  const {
    linkedWorkstreams,
    activeWorkstreams,
    linkWorkstream,
    unlinkWorkstream,
    startWorkstream,
    navigateToWorkstream,
  } = useWorkstreamLinker(entityUri, 'trello_card');

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data, loading, error, refetch } = useEntityQuery(GET_CARD, { variables: { id: entityId } });
  const serverCard: TrelloCard | undefined = data?.trelloCard;
  const boardId = serverCard?.idBoard;

  const { data: listsData } = useEntityQuery(GET_LISTS, { variables: { boardId }, skip: !boardId });
  const { data: commentsData, refetch: refetchComments } = useEntityQuery(GET_COMMENTS, {
    variables: { cardId: entityId, filter: 'commentCard' },
  });

  const lists: Array<{ id: string; title: string; pos: number; closed: boolean }> = listsData?.trelloLists ?? [];
  const comments: TrelloAction[] = commentsData?.trelloActions ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────
  const [updateCard] = useEntityMutation(UPDATE_CARD);
  const [moveCard] = useEntityMutation(MOVE_CARD);
  const [archiveCard] = useEntityMutation(ARCHIVE_CARD);
  const [addComment] = useEntityMutation(ADD_COMMENT);
  const [completeCheckItem] = useEntityMutation(COMPLETE_CHECK_ITEM);
  const [addChecklist] = useEntityMutation(ADD_CHECKLIST);

  // ── Optimistic state ───────────────────────────────────────────────────────
  const optimistic = useOptimistic<TrelloCard>(serverCard);
  const card = optimistic.data;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleUpdateTitle = (title: string) => {
    if (!title.trim() || title === card?.title) return;
    optimistic.apply({ title }, async () => {
      await updateCard({ variables: { id: entityId, input: { name: title } } });
      await refetch();
    });
  };

  const handleUpdateDesc = (desc: string) => {
    optimistic.apply({ desc }, async () => {
      await updateCard({ variables: { id: entityId, input: { desc } } });
      await refetch();
    });
  };

  const handleToggleDueComplete = () => {
    const next = !card?.dueComplete;
    optimistic.apply({ dueComplete: next }, async () => {
      await updateCard({ variables: { id: entityId, input: { dueComplete: next } } });
      await refetch();
    });
  };

  const handleMoveCard = (listId: string) => {
    if (!listId || listId === card?.idList) return;
    const targetList = lists.find(l => l.id === listId);
    optimistic.apply({ idList: listId, listName: targetList?.title }, async () => {
      await moveCard({ variables: { id: entityId, idList: listId } });
      await refetch();
    });
  };

  const handleArchive = async () => {
    try {
      await archiveCard({ variables: { id: entityId } });
      drawer.close();
    } catch (err: any) {
      logger.error('Failed to archive Trello card', { error: err?.message });
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      await addComment({ variables: { cardId: entityId, text: commentText } });
      setCommentText('');
      refetchComments();
    } catch (err: any) {
      logger.error('Failed to add comment', { error: err?.message });
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleToggleCheckItem = (checklistId: string, checkItemId: string, complete: boolean) => {
    if (!card?.checklists) return;
    const nextChecklists = card.checklists.map(cl =>
      cl.id === checklistId
        ? { ...cl, checkItems: cl.checkItems.map(i => i.id === checkItemId ? { ...i, state: complete ? 'complete' : 'incomplete' } : i) }
        : cl
    );
    optimistic.apply({ checklists: nextChecklists }, async () => {
      await completeCheckItem({ variables: { cardId: entityId, checkItemId, complete } });
      await refetch();
    });
  };

  const handleAddChecklist = async () => {
    if (!newChecklistName.trim()) return;
    try {
      await addChecklist({ variables: { cardId: entityId, name: newChecklistName } });
      setNewChecklistName('');
      setShowAddChecklist(false);
      await refetch();
    } catch (err: any) {
      logger.error('Failed to add checklist', { error: err?.message });
    }
  };

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading && !serverCard) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading card...</div>
      </div>
    );
  }

  if (error && !serverCard) {
    logger.error('Failed to load Trello card', { entityId, error: error.message });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DrawerHeaderTitle>{label ?? entityId}</DrawerHeaderTitle>
        <div style={{ padding: '16px', color: 'var(--status-error)', fontSize: '13px' }}>
          Failed to load card: {error.message}
        </div>
      </div>
    );
  }

  if (!card) {
    return <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>Card not found</div>;
  }

  const openLists = lists.filter(l => !l.closed).sort((a, b) => a.pos - b.pos);

  return (
    <>

      {/* Header */}
      <DrawerHeaderTitle>
        <InlineEdit value={card.title} onSave={handleUpdateTitle} style={{ fontSize: 15, fontWeight: 600 }} />
      </DrawerHeaderTitle>
      <DrawerHeaderActions>
        {activeWorkstreams && (
          <WorkstreamHeaderAction
            entityId={entityId}
            entityTitle={card.title}
            linkedWorkstreams={linkedWorkstreams as LinkedWorkstream[]}
            activeWorkstreams={activeWorkstreams as ActiveWorkstream[]}
            onStartWorkstream={(_id, title) => startWorkstream(title)}
            onAddToWorkstream={linkWorkstream}
          />
        )}
      </DrawerHeaderActions>

      <DrawerBody>

        {/* Breadcrumb */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>{card.boardName ?? card.idBoard}</span>
          <span>›</span>
          <span style={{ color: 'var(--text-secondary)' }}>{card.listName ?? card.idList}</span>
        </div>

        {/* Optimistic error banner */}
        {optimistic.error && (
          <div style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--status-error-bg, #ffecec)', color: 'var(--status-error, #e5484d)', fontSize: 12, marginBottom: 12 }}>
            {optimistic.error}
            <button onClick={optimistic.dismissError} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 12 }}>✕</button>
          </div>
        )}

        {/* Metadata row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          {(card.labels ?? []).filter(l => l.color || l.name).map(label => (
            <LabelPill key={label.id} label={label} />
          ))}
          {card.due && (
            <button onClick={handleToggleDueComplete} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} title={card.dueComplete ? 'Mark incomplete' : 'Mark complete'}>
              <DueBadge due={card.due} dueComplete={card.dueComplete} />
            </button>
          )}
          {(card.members ?? []).length > 0 && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {(card.members ?? []).map(m => (
                <span key={m.id} title={m.fullName} style={{ width: 24, height: 24, borderRadius: '50%', background: '#0079bf', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {m.fullName?.slice(0, 2).toUpperCase() ?? m.username?.slice(0, 2).toUpperCase()}
                </span>
              ))}
            </div>
          )}
          {(card.checkItemsTotal ?? 0) > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
              ✓ {card.checkItemsChecked ?? 0}/{card.checkItemsTotal}
            </span>
          )}
        </div>

        <Separator />

        {/* Workstreams */}
        {activeWorkstreams && (
          <WorkstreamSection
            workstreams={(linkedWorkstreams ?? []) as LinkedWorkstream[]}
            entityId={entityId}
            entityTitle={card.title}
            activeWorkstreams={activeWorkstreams as ActiveWorkstream[]}
            onRemove={unlinkWorkstream}
            onClick={(ws) => { navigateToWorkstream(ws); drawer.close(); }}
            onStartWorkstream={(_id, title) => startWorkstream(title)}
            onAddToWorkstream={linkWorkstream}
          />
        )}

        {/* Description */}
        <ContentSection
          title="Description"
          titleActions={
            !editingDescription ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setDescriptionDraft(card.desc ?? ''); setEditingDescription(true); }}
                style={{ fontSize: 11, height: 22, padding: '0 6px', color: 'var(--text-muted)' }}
              >
                Edit
              </Button>
            ) : undefined
          }
        >
          {editingDescription ? (
            <MarkdownEditor
              value={descriptionDraft}
              onChange={setDescriptionDraft}
              onSave={(val) => { handleUpdateDesc(val); setEditingDescription(false); }}
              onCancel={() => setEditingDescription(false)}
              size="sm"
              placeholder="Add a description..."
            />
          ) : card.desc ? (
            <div onClick={(e) => {
              const anchor = (e.target as HTMLElement).closest('a');
              if (anchor?.href) { e.preventDefault(); openExternal(anchor.href); }
            }}>
              <Markdown content={card.desc} size="sm" />
            </div>
          ) : (
            <div
              style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0', cursor: 'pointer' }}
              onClick={() => { setDescriptionDraft(''); setEditingDescription(true); }}
            >
              No description. Click to add.
            </div>
          )}
        </ContentSection>

        {/* Checklists */}
        {(card.checklists ?? []).length > 0 && (
          <>
            <Separator />
            <ContentSection title="Checklists">
              {[...(card.checklists ?? [])].sort((a, b) => a.pos - b.pos).map(cl => (
                <ChecklistSection key={cl.id} checklist={cl} cardId={entityId} onToggleItem={(checkItemId, complete) => handleToggleCheckItem(cl.id, checkItemId, complete)} />
              ))}
            </ContentSection>
          </>
        )}

        {/* Add checklist */}
        {showAddChecklist ? (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, marginTop: 8 }}>
            <input
              value={newChecklistName}
              onChange={e => setNewChecklistName(e.target.value)}
              placeholder="Checklist name"
              style={{ flex: 1, fontSize: 12, padding: '5px 8px', borderRadius: 4, border: '1px solid var(--border-muted)', background: 'var(--surface-input)', color: 'var(--text-primary)' }}
              onKeyDown={e => { if (e.key === 'Enter') handleAddChecklist(); if (e.key === 'Escape') setShowAddChecklist(false); }}
              autoFocus
            />
            <Button size="sm" onClick={handleAddChecklist}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowAddChecklist(false); setNewChecklistName(''); }}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setShowAddChecklist(true)} style={{ marginBottom: 8, fontSize: 11 }}>
            + Add checklist
          </Button>
        )}

        <Separator />

        {/* Move card */}
        <ContentSection title="Move to list">
          <Select value={card.idList} onValueChange={handleMoveCard}>
            <SelectTrigger style={{ fontSize: 12 }}>
              <SelectValue placeholder="Select list..." />
            </SelectTrigger>
            <SelectContent>
              {openLists.map(l => (
                <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ContentSection>

        <Separator />

        {/* Comments */}
        <ContentSection title={`Comments${comments.length ? ` (${comments.length})` : ''}`}>
          <div style={{ marginBottom: 16 }}>
            <Textarea
              value={commentText}
              onChange={e => setCommentText((e.target as HTMLTextAreaElement).value)}
              placeholder="Write a comment..."
              rows={3}
              style={{ fontSize: 12, marginBottom: 6 }}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleAddComment(); } }}
            />
            <Button size="sm" onClick={handleAddComment} disabled={!commentText.trim() || submittingComment}>
              {submittingComment ? 'Saving...' : 'Add Comment ⌘↩'}
            </Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {comments.map(comment => (
              <div key={comment.id} style={{ fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{comment.memberCreatorName ?? 'Unknown'}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatCommentDate(comment.date)}</span>
                </div>
                <div style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--surface-subtle)', border: '1px solid var(--border-muted)', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {comment.text ?? ''}
                </div>
              </div>
            ))}
            {comments.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comments yet.</div>}
          </div>
        </ContentSection>

        {/* Archive button inside body */}
        <Separator />
        <ContentSection>
          <Button size="sm" variant="outline" onClick={handleArchive} style={{ color: 'var(--status-warning)', borderColor: 'var(--status-warning)' }}>
            Archive Card
          </Button>
        </ContentSection>

      </DrawerBody>

      {/* Sticky footer — "Open in Trello" link */}
      {card.url && (
        <div style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 8, borderTop: '1px solid var(--border-muted)', background: 'var(--surface-page)' }}>
          <a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { e.preventDefault(); openExternal(card.url!); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none', transition: 'color 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#0079bf'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <svg width="11" height="11" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
              <rect width="32" height="32" rx="4" fill="currentColor" />
              <rect x="5" y="5" width="9" height="18" rx="2" fill="white" />
              <rect x="18" y="5" width="9" height="11" rx="2" fill="white" />
            </svg>
            Open in Trello
          </a>
        </div>
      )}

    </>
  );
}
