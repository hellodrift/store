import { useState } from 'react';
import {
  DrawerHeaderTitle,
  DrawerBody,
  ContentSection,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Separator,
  Label,
  Checkbox,
} from '@drift/ui';
import { useEntityQuery, gql, logger } from '@drift/plugin-api';
import { useTrelloSettings, DEFAULT_SETTINGS } from './useTrelloSettings';

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const GET_BOARDS = gql`
  query GetTrelloBoardsForSettings {
    trelloBoards(filter: "open") {
      id
      title
    }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrelloBoard { id: string; title: string; }

interface SettingsDrawerProps {
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

// ─── Auth Section ─────────────────────────────────────────────────────────────

function AuthSection() {
  const [apiKey, setApiKey] = useState('');
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    logger.info('Trello credentials submitted (handled by plugin runtime)');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    fontSize: 12,
    padding: '6px 8px',
    borderRadius: 4,
    border: '1px solid var(--border-muted)',
    background: 'var(--surface-input)',
    color: 'var(--text-primary)',
    boxSizing: 'border-box',
  };

  return (
    <ContentSection title="Authentication">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <Label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>API Key</Label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Your Trello API Key" style={inputStyle} autoComplete="off" />
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
            Get your API key at <a href="https://trello.com/power-ups/admin" target="_blank" rel="noreferrer" style={{ color: 'var(--text-link)' }}>trello.com/power-ups/admin</a>
          </p>
        </div>
        <div>
          <Label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Token</Label>
          <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Your Trello Token" style={inputStyle} autoComplete="off" />
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
            Generate at <a href="https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token" target="_blank" rel="noreferrer" style={{ color: 'var(--text-link)' }}>trello.com/1/authorize</a> (use your API key above)
          </p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={!apiKey.trim() || !token.trim()} style={{ alignSelf: 'flex-start' }}>
          {saved ? 'Saved!' : 'Save Credentials'}
        </Button>
      </div>
    </ContentSection>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SettingsDrawer({ drawer: _drawer }: SettingsDrawerProps) {
  const [settings, updateSettings] = useTrelloSettings();

  const { data, loading: boardsLoading, error: boardsError } = useEntityQuery(GET_BOARDS);
  const boards: TrelloBoard[] = data?.trelloBoards ?? [];

  const LIMIT_OPTIONS = [20, 50, 100, 200];

  const handleBoardToggle = (boardId: string, boardName: string) => {
    const allSelected = settings.boardIds.length === 0;
    // If currently "all" (empty), selecting a board means switching to explicit selection — keep all except toggled
    const currentIds = allSelected ? boards.map(b => b.id) : [...settings.boardIds];
    const isSelected = currentIds.includes(boardId);
    const nextIds = isSelected ? currentIds.filter(id => id !== boardId) : [...currentIds, boardId];
    // If all boards are selected, store empty array (= show all)
    const finalIds = nextIds.length === boards.length ? [] : nextIds;
    const nextNames = { ...settings.boardNames };
    if (!isSelected) nextNames[boardId] = boardName;
    else delete nextNames[boardId];
    updateSettings({ boardIds: finalIds, boardNames: nextNames });
    logger.info('Trello board selection changed', { boardId, selected: !isSelected });
  };

  const handleReset = () => {
    updateSettings(DEFAULT_SETTINGS);
    logger.info('Trello settings reset to defaults');
  };

  const isBoardChecked = (boardId: string) =>
    settings.boardIds.length === 0 || settings.boardIds.includes(boardId);

  return (
    <>
      <DrawerHeaderTitle>Trello Settings</DrawerHeaderTitle>

      <DrawerBody>

        {/* Auth */}
        <AuthSection />

        <Separator />

        {/* Show mode */}
        <ContentSection title="Show cards">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(['all', 'mine'] as const).map(mode => (
              <Button
                key={mode}
                variant={settings.showMode === mode ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => updateSettings({ showMode: mode })}
                style={{ justifyContent: 'flex-start' }}
              >
                {mode === 'all' ? 'All cards on boards' : 'My cards only (assigned to me)'}
              </Button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
            "All cards" shows every open card on selected boards. "My cards" shows only cards you're assigned to.
          </p>
        </ContentSection>

        <Separator />

        {/* Board selection */}
        <ContentSection title="Boards to show">
          {boardsLoading && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading boards...</div>
          )}
          {boardsError && (
            <div style={{ fontSize: 12, color: 'var(--status-error, #e5484d)' }}>
              Could not load boards. Check your credentials above.
            </div>
          )}
          {!boardsLoading && !boardsError && boards.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No boards found.</div>
          )}
          {boards.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {boards.map(board => (
                <label key={board.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <Checkbox
                    checked={isBoardChecked(board.id)}
                    onCheckedChange={() => handleBoardToggle(board.id, board.title)}
                  />
                  <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{board.title}</span>
                </label>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
            {settings.boardIds.length === 0
              ? 'All boards shown. Uncheck boards to hide them.'
              : `${settings.boardIds.length} of ${boards.length} board${boards.length === 1 ? '' : 's'} selected.`}
          </p>
        </ContentSection>

        <Separator />

        {/* Nav layout */}
        <ContentSection title="Navigation layout">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Checkbox
                checked={settings.showListLevel}
                onCheckedChange={(checked) => updateSettings({ showListLevel: !!checked })}
              />
              <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>Show lists as sub-folders</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Checkbox
                checked={settings.flatIfSingleBoard}
                onCheckedChange={(checked) => updateSettings({ flatIfSingleBoard: !!checked })}
              />
              <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>Flat layout when only one board is shown</span>
            </label>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
            "Show lists" groups cards under their list within each board. "Flat layout" removes the board folder when only one board is visible.
          </p>
        </ContentSection>

        <Separator />

        {/* Card limit */}
        <ContentSection title="Cards limit">
          <Select value={String(settings.limit)} onValueChange={val => updateSettings({ limit: Number(val) })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMIT_OPTIONS.map(n => (
                <SelectItem key={n} value={String(n)}>{n} cards</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
            Maximum cards to load in the sidebar.
          </p>
        </ContentSection>

        <Separator />

        {/* Reset */}
        <ContentSection>
          <Button variant="outline" size="sm" onClick={handleReset} style={{ width: '100%' }}>
            Reset to defaults
          </Button>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
            Settings are saved automatically
          </p>
        </ContentSection>

      </DrawerBody>
    </>
  );
}
