import { useState } from 'react';
import {
  DrawerHeaderTitle,
  DrawerHeaderActions,
  DrawerBody,
  ContentSection,
  InlineEdit,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Combobox,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Calendar,
  Button,
  Badge,
  Textarea,
  Separator,
  Markdown,
  MarkdownEditor,
  WorkstreamHeaderAction,
  WorkstreamSection,
  ConfirmDialog,
  TrashIcon,
  type LinkedWorkstream,
  type ActiveWorkstream,
} from '@drift/ui';
import { logger, openExternal, buildEntityURI } from '@drift/plugin-api';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface LinearIssue {
  id: string;
  title: string;
  identifier?: string;
  status?: string;
  stateId?: string;
  stateName?: string;
  priority?: number;
  priorityLabel?: string;
  assigneeId?: string;
  assigneeName?: string;
  teamId?: string;
  teamKey?: string;
  labels?: { id: string; name: string; color: string }[];
  projectId?: string;
  projectName?: string;
  cycleId?: string;
  cycleName?: string;
  estimate?: number;
  dueDate?: string;
  url?: string;
  description?: string;
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  color: string;
  type: string;
}

export interface LinearUser {
  id: string;
  name: string;
  displayName?: string;
  active: boolean;
}

export interface LinearProject {
  id: string;
  name: string;
  status?: string;
}

export interface LinearCycle {
  id: string;
  name?: string;
  number: number;
  startsAt?: string;
  endsAt?: string;
  isActive: boolean;
}

export interface LinearComment {
  id: string;
  body: string;
  authorName?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface LinearIssueRelation {
  id: string;
  type: string;
  relatedIssueId: string;
  relatedIssueIdentifier?: string;
  relatedIssueTitle?: string;
}

export interface LinearSubIssue {
  id: string;
  title: string;
  identifier?: string;
  status?: string;
  stateName?: string;
  priority?: number;
  priorityLabel?: string;
  assigneeName?: string;
}

export interface TicketDrawerContentProps {
  issue: LinearIssue;
  states?: LinearWorkflowState[];
  members?: LinearUser[];
  labels?: { id: string; name: string; color: string }[];
  projects?: LinearProject[];
  cycles?: LinearCycle[];
  comments?: LinearComment[];
  relations?: LinearIssueRelation[];
  subIssues?: LinearSubIssue[];
  teamIssues?: { id: string; title: string; identifier?: string }[];
  onAddSubIssue?: (childIssueId: string) => void;
  onRemoveSubIssue?: (childIssueId: string) => void;
  onDeleteIssue?: () => void;
  onUpdateField?: (field: string, value: unknown) => void;
  onAddComment?: (body: string) => void;
  onCreateLabel?: (name: string) => void;
  onOpenEntity?: (uri: string) => void;
  error?: string | null;
  onDismissError?: () => void;
  // Workstream linking
  entityUri?: string;
  linkedWorkstreams?: LinkedWorkstream[];
  activeWorkstreams?: ActiveWorkstream[];
  onLinkWorkstream?: (workstreamId: string) => void;
  onUnlinkWorkstream?: (workstream: LinkedWorkstream) => void;
  onStartWorkstream?: (entityId: string, entityTitle: string) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const PRIORITY_OPTIONS = [
  { value: '0', label: 'No priority', color: 'var(--text-muted)' },
  { value: '1', label: 'Urgent', color: 'var(--status-error)' },
  { value: '2', label: 'High', color: 'var(--status-warning)' },
  { value: '3', label: 'Normal', color: 'var(--text-secondary)' },
  { value: '4', label: 'Low', color: 'var(--text-muted)' },
];

const ESTIMATE_OPTIONS = [
  { value: '', label: 'No estimate' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: '8', label: '8' },
  { value: '13', label: '13' },
  { value: '21', label: '21' },
];

const RELATION_TYPE_LABELS: Record<string, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  related: 'Related to',
  duplicate: 'Duplicates',
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function ColorDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: color,
        flexShrink: 0,
      }}
    />
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
      <span style={{ width: 80, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export default function TicketDrawerContent({
  issue,
  states,
  members,
  labels,
  projects,
  cycles,
  comments,
  relations,
  subIssues,
  teamIssues,
  onAddSubIssue,
  onRemoveSubIssue,
  onDeleteIssue,
  onUpdateField,
  onAddComment,
  onCreateLabel,
  onOpenEntity,
  error,
  onDismissError,
  entityUri,
  linkedWorkstreams,
  activeWorkstreams,
  onLinkWorkstream,
  onUnlinkWorkstream,
  onStartWorkstream,
}: TicketDrawerContentProps) {
  const [commentDraft, setCommentDraft] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const handleOpenInLinear = () => {
    if (issue.url) {
      openExternal(issue.url);
      logger.info('Opened issue in Linear', { identifier: issue.identifier });
    }
  };

  const handlePostComment = async () => {
    if (!commentDraft.trim() || !onAddComment) return;
    setPostingComment(true);
    try {
      await onAddComment(commentDraft.trim());
      setCommentDraft('');
    } finally {
      setPostingComment(false);
    }
  };

  const selectedLabelIds = (issue.labels ?? []).map((l) => l.id);
  const labelOptions = (labels ?? []).map((l) => ({
    value: l.id,
    label: l.name,
    icon: <ColorDot color={l.color || '#888'} />,
  }));

  // Group relations by type
  const relationGroups: Record<string, LinearIssueRelation[]> = {};
  for (const rel of relations ?? []) {
    const key = rel.type || 'related';
    if (!relationGroups[key]) relationGroups[key] = [];
    relationGroups[key].push(rel);
  }

  const priorityColor =
    PRIORITY_OPTIONS.find((p) => p.value === String(issue.priority ?? 0))?.color ??
    'var(--text-primary)';

  return (
    <>
      {/* Header (slot injectors — rendered into DrawerContainer header) */}
      <DrawerHeaderTitle>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {issue.identifier && (
            <span style={{ flexShrink: 0, color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>
              {issue.identifier}
            </span>
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
            {onUpdateField ? (
              <InlineEdit
                value={issue.title}
                onSave={(val) => onUpdateField('title', val)}
                className="text-sm font-semibold"
                marqueeOnOverflow
              />
            ) : (
              issue.title
            )}
          </span>
        </span>
      </DrawerHeaderTitle>
      <DrawerHeaderActions>
        {activeWorkstreams && (
          <WorkstreamHeaderAction
            entityId={issue.id}
            entityTitle={issue.identifier || issue.title}
            linkedWorkstreams={linkedWorkstreams}
            activeWorkstreams={activeWorkstreams}
            onStartWorkstream={onStartWorkstream}
            onAddToWorkstream={onLinkWorkstream}
          />
        )}
      </DrawerHeaderActions>

      {/* Body — scrolled by the drawer's ContentContainer */}
      <DrawerBody className="flex flex-col gap-4">

          {/* Error banner — auto-dismisses, with manual close */}
          {error && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 12,
                background: 'var(--status-error-bg, hsl(0 70% 95%))',
                color: 'var(--status-error, hsl(0 70% 40%))',
                border: '1px solid var(--status-error-border, hsl(0 60% 85%))',
              }}
            >
              <span style={{ flex: 1 }}>Update failed: {error}</span>
              {onDismissError && (
                <button
                  type="button"
                  onClick={onDismissError}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 2,
                    color: 'inherit',
                    fontSize: 14,
                    lineHeight: 1,
                    opacity: 0.7,
                  }}
                  aria-label="Dismiss error"
                >
                  &times;
                </button>
              )}
            </div>
          )}

          {/* Properties */}
          <ContentSection title="Properties">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* Status */}
              <PropertyRow label="Status">
                {onUpdateField && states ? (
                  <Select
                    value={issue.stateId ?? ''}
                    onValueChange={(val) => onUpdateField('stateId', val)}
                  >
                    <SelectTrigger size="sm" className="h-7 w-full text-xs">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      {states.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ColorDot color={s.color} />
                            {s.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                    {issue.stateName || '—'}
                  </span>
                )}
              </PropertyRow>

              {/* Priority */}
              <PropertyRow label="Priority">
                {onUpdateField ? (
                  <Select
                    value={String(issue.priority ?? 0)}
                    onValueChange={(val) => onUpdateField('priority', parseInt(val, 10))}
                  >
                    <SelectTrigger size="sm" className="h-7 w-full text-xs">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ColorDot color={p.color} />
                            {p.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span style={{ fontSize: 12, color: priorityColor, fontWeight: 600 }}>
                    {issue.priorityLabel || '—'}
                  </span>
                )}
              </PropertyRow>

              {/* Assignee */}
              <PropertyRow label="Assignee">
                {onUpdateField && members ? (
                  <Combobox
                    options={[
                      { value: '__unassigned__', label: 'Unassigned' },
                      ...members.filter((m) => m.active).map((m) => ({
                        value: m.id,
                        label: m.displayName || m.name,
                      })),
                    ]}
                    value={issue.assigneeId ?? '__unassigned__'}
                    onValueChange={(val) =>
                      onUpdateField('assigneeId', val === '__unassigned__' ? null : val)
                    }
                    placeholder="Unassigned"
                    searchPlaceholder="Search members..."
                    className="min-h-7 text-xs"
                  />
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                    {issue.assigneeName || 'Unassigned'}
                  </span>
                )}
              </PropertyRow>

              {/* Labels */}
              <PropertyRow label="Labels">
                {onUpdateField && labels ? (
                  <Combobox
                    multiple
                    options={labelOptions}
                    value={selectedLabelIds}
                    onValueChange={(vals) => onUpdateField('labelIds', vals)}
                    onCreateOption={onCreateLabel}
                    placeholder="Add labels..."
                    searchPlaceholder="Search labels..."
                    className="min-h-7 text-xs"
                  />
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {issue.labels?.length ? (
                      issue.labels.map((l) => (
                        <Badge key={l.id} variant="secondary" className="text-xs gap-1">
                          <ColorDot color={l.color || '#888'} />
                          {l.name}
                        </Badge>
                      ))
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>None</span>
                    )}
                  </div>
                )}
              </PropertyRow>

              {/* Project */}
              <PropertyRow label="Project">
                {onUpdateField && projects ? (
                  <Select
                    value={issue.projectId ?? '__none__'}
                    onValueChange={(val) =>
                      onUpdateField('projectId', val === '__none__' ? null : val)
                    }
                  >
                    <SelectTrigger size="sm" className="h-7 w-full text-xs">
                      <SelectValue placeholder="No project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No project</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                    {issue.projectName || '—'}
                  </span>
                )}
              </PropertyRow>

              {/* Cycle */}
              <PropertyRow label="Cycle">
                {onUpdateField && cycles ? (
                  <Select
                    value={issue.cycleId ?? '__none__'}
                    onValueChange={(val) =>
                      onUpdateField('cycleId', val === '__none__' ? null : val)
                    }
                  >
                    <SelectTrigger size="sm" className="h-7 w-full text-xs">
                      <SelectValue placeholder="No cycle" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No cycle</SelectItem>
                      {cycles.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name || `Cycle ${c.number}`}
                          {c.isActive ? ' (Active)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                    {issue.cycleName || '—'}
                  </span>
                )}
              </PropertyRow>

              {/* Estimate */}
              <PropertyRow label="Estimate">
                {onUpdateField ? (
                  <Select
                    value={issue.estimate != null ? String(issue.estimate) : '__none__'}
                    onValueChange={(val) =>
                      onUpdateField('estimate', val === '__none__' ? null : parseInt(val, 10))
                    }
                  >
                    <SelectTrigger size="sm" className="h-7 w-full text-xs">
                      <SelectValue placeholder="No estimate" />
                    </SelectTrigger>
                    <SelectContent>
                      {ESTIMATE_OPTIONS.map((e) => (
                        <SelectItem key={e.value || '__none__'} value={e.value || '__none__'}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                    {issue.estimate != null ? issue.estimate : '—'}
                  </span>
                )}
              </PropertyRow>

              {/* Due Date */}
              <PropertyRow label="Due date">
                {onUpdateField ? (
                  <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 w-full justify-start text-xs font-normal">
                        {issue.dueDate ? formatDate(issue.dueDate) : 'No due date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={issue.dueDate ? new Date(issue.dueDate) : undefined}
                        onSelect={(date) => {
                          onUpdateField(
                            'dueDate',
                            date ? date.toISOString().split('T')[0] : null,
                          );
                          setCalendarOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                    {issue.dueDate ? formatDate(issue.dueDate) : '—'}
                  </span>
                )}
              </PropertyRow>
            </div>
          </ContentSection>

          {/* Description */}
          {(issue.description || onUpdateField) && (
            <ContentSection
              title="Description"
              collapsible
              defaultCollapsed={false}
              titleActions={
                onUpdateField && !editingDescription ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-muted-foreground"
                    onClick={() => {
                      setDescriptionDraft(issue.description ?? '');
                      setEditingDescription(true);
                    }}
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
                  onSave={(val) => {
                    onUpdateField?.('description', val);
                    setEditingDescription(false);
                  }}
                  onCancel={() => setEditingDescription(false)}
                  size="sm"
                  placeholder="Add a description..."
                />
              ) : issue.description ? (
                <Markdown content={issue.description} size="sm" />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
                  No description.
                </div>
              )}
            </ContentSection>
          )}

          {/* Sub-issues */}
          {((subIssues && subIssues.length > 0) || onAddSubIssue) && (
            <ContentSection title="Sub-issues">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(subIssues ?? []).map((child) => (
                  <div
                    key={child.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onOpenEntity?.(
                          buildEntityURI('linear_issue', child.id, child.identifier ? `${child.identifier} ${child.title}` : child.title),
                        )
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        flex: 1,
                        minWidth: 0,
                        textAlign: 'left',
                        fontSize: 12,
                        color: 'var(--text-primary)',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--surface-hover)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {child.identifier && (
                        <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>
                          {child.identifier}
                        </span>
                      )}
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {child.title}
                      </span>
                      {child.stateName && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {child.stateName}
                        </Badge>
                      )}
                      {child.priorityLabel && child.priority !== undefined && child.priority > 0 && (
                        <span style={{
                          fontSize: 10,
                          color: PRIORITY_OPTIONS.find((p) => p.value === String(child.priority))?.color ?? 'var(--text-muted)',
                          fontWeight: 600,
                        }}>
                          {child.priorityLabel}
                        </span>
                      )}
                    </button>
                    {onRemoveSubIssue && (
                      <button
                        type="button"
                        onClick={() => onRemoveSubIssue(child.id)}
                        title="Remove sub-issue"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          fontSize: 14,
                          lineHeight: 1,
                          flexShrink: 0,
                          transition: 'color 0.1s, background 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--status-error)';
                          e.currentTarget.style.background = 'var(--surface-hover)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'var(--text-muted)';
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                {onAddSubIssue && teamIssues && (() => {
                  const existingIds = new Set([
                    issue.id,
                    ...(subIssues ?? []).map((s) => s.id),
                  ]);
                  const options = teamIssues
                    .filter((t) => !existingIds.has(t.id))
                    .map((t) => ({
                      value: t.id,
                      label: t.identifier ? `${t.identifier} - ${t.title}` : t.title,
                    }));
                  return (
                    <Combobox
                      options={options}
                      value=""
                      onValueChange={(val) => {
                        if (val) onAddSubIssue(val);
                      }}
                      placeholder="Add sub-issue..."
                      searchPlaceholder="Search issues..."
                      className="min-h-7 text-xs mt-1"
                    />
                  );
                })()}
              </div>
            </ContentSection>
          )}

          {/* Relations */}
          {relations && relations.length > 0 && (
            <ContentSection title="Relations">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(relationGroups).map(([type, rels]) => (
                  <div key={type}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
                      {RELATION_TYPE_LABELS[type] || type}
                    </div>
                    {rels.map((rel) => (
                      <button
                        key={rel.id}
                        type="button"
                        onClick={() =>
                          onOpenEntity?.(
                            buildEntityURI('linear_issue', rel.relatedIssueId, rel.relatedIssueIdentifier ? `${rel.relatedIssueIdentifier} ${rel.relatedIssueTitle ?? ''}`.trim() : rel.relatedIssueTitle ?? rel.relatedIssueId),
                          )
                        }
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 8px',
                          borderRadius: 6,
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          width: '100%',
                          textAlign: 'left',
                          fontSize: 12,
                          color: 'var(--text-primary)',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--surface-hover)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        {rel.relatedIssueIdentifier && (
                          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>
                            {rel.relatedIssueIdentifier}
                          </span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {rel.relatedIssueTitle || rel.relatedIssueId}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </ContentSection>
          )}

          {/* Workstreams */}
          {activeWorkstreams && entityUri && (
            <WorkstreamSection
              workstreams={linkedWorkstreams ?? []}
              entityId={issue.id}
              entityTitle={issue.identifier || issue.title}
              activeWorkstreams={activeWorkstreams}
              onRemove={onUnlinkWorkstream}
              onStartWorkstream={onStartWorkstream}
              onAddToWorkstream={onLinkWorkstream}
            />
          )}

          <Separator />

          {/* Comments */}
          <ContentSection title="Comments">
            {comments && comments.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {comments.map((comment) => (
                  <div key={comment.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {comment.authorName || 'Unknown'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {formatTime(comment.createdAt)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {comment.body}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
                No comments yet.
              </div>
            )}

            {/* New comment form */}
            {onAddComment && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  placeholder="Write a comment..."
                  className="min-h-[60px] text-xs resize-y"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handlePostComment();
                    }
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    size="sm"
                    onClick={handlePostComment}
                    disabled={!commentDraft.trim() || postingComment}
                  >
                    {postingComment ? 'Posting...' : 'Comment'}
                  </Button>
                </div>
              </div>
            )}
          </ContentSection>
        </DrawerBody>

      {/* Sticky footer — stays at bottom of drawer viewport */}
      {(issue.url || onDeleteIssue) && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 8,
            borderTop: '1px solid var(--border-muted)',
            background: 'var(--surface-page)',
          }}
        >
          {issue.url && (
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                handleOpenInLinear();
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--text-muted)',
                textDecoration: 'none',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-accent, #5e6ad2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              <svg width="12" height="12" viewBox="0 0 100 100" fill="currentColor">
                <path d="M2.848 62.845a3.57 3.57 0 0 1 0-5.049L22.4 38.243a3.57 3.57 0 0 1 5.049 0l10.26 10.26a25 25 0 0 1 13.793-13.793l-10.26-10.26a3.57 3.57 0 0 1 0-5.05L60.796 0a3.57 3.57 0 0 1 5.05 0l34.152 34.153a3.57 3.57 0 0 1 0 5.049L80.446 58.755a3.57 3.57 0 0 1-5.05 0L65.137 48.496A25 25 0 0 1 51.344 62.29l10.26 10.26a3.57 3.57 0 0 1 0 5.049l-19.553 19.553a3.57 3.57 0 0 1-5.049 0L2.848 62.845z"/>
              </svg>
              Open in Linear
            </a>
          )}
          {onDeleteIssue && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <TrashIcon size={12} />
                Delete issue
              </Button>
              <ConfirmDialog
                open={deleteConfirmOpen}
                onOpenChange={setDeleteConfirmOpen}
                title="Delete issue"
                description={`Are you sure you want to delete ${issue.identifier ? issue.identifier + ' ' : ''}"${issue.title}"? This action cannot be undone.`}
                confirmLabel="Delete"
                variant="destructive"
                onConfirm={() => {
                  setDeleteConfirmOpen(false);
                  onDeleteIssue();
                }}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
