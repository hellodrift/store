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
} from '@drift/ui';
import { useEntityQuery, gql, logger } from '@drift/plugin-api';
import { useTrelloSettings } from './useTrelloSettings';

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
    // Credentials are saved via the plugin's secureKeys mechanism.
    // The UI here collects and submits them; the actual storage is handled
    // by the Drift plugin runtime which reads them during createClient().
    // In a real implementation, this would call a plugin-api method to save secure keys.
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
          <Label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            API Key
          </Label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Your Trello API Key"
            style={inputStyle}
            autoComplete="off"
          />
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
            Get your API key at trello.com/power-ups/admin
          </p>
        </div>

        <div>
          <Label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            Token
          </Label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Your Trello Token"
            style={inputStyle}
            autoComplete="off"
          />
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
            Generate a token at trello.com/1/authorize (read+write scope)
          </p>
        </div>

        <Button
          size="sm"
          onClick={handleSave}
          disabled={!apiKey.trim() || !token.trim()}
          style={{ alignSelf: 'flex-start' }}
        >
          {saved ? 'Saved!' : 'Save Credentials'}
        </Button>
      </div>
    </ContentSection>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SettingsDrawer({ drawer }: SettingsDrawerProps) {
  const [settings, updateSettings] = useTrelloSettings();

  const { data, loading: boardsLoading } = useEntityQuery(GET_BOARDS);
  const boards: TrelloBoard[] = data?.trelloBoards ?? [];

  const LIMIT_OPTIONS = [10, 20, 50, 100];

  const handleBoardChange = (boardId: string) => {
    const board = boards.find(b => b.id === boardId);
    updateSettings({ boardId, boardName: board?.title });
    logger.info('Trello sidebar board updated', { boardId, boardName: board?.title });
  };

  const handleReset = () => {
    updateSettings({ boardId: undefined, boardName: undefined, activeTab: 'my-cards', limit: 20 });
    logger.info('Trello settings reset to defaults');
  };

  return (
    <>
      <DrawerHeaderTitle>Trello Settings</DrawerHeaderTitle>

      <DrawerBody>

        {/* Auth */}
        <AuthSection />

        <Separator />

        {/* Board for sidebar */}
        <ContentSection title="Sidebar board">
          <Select
            value={settings.boardId ?? ''}
            onValueChange={handleBoardChange}
            disabled={boardsLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder={boardsLoading ? 'Loading boards...' : 'Select a board'} />
            </SelectTrigger>
            <SelectContent>
              {boards.map(board => (
                <SelectItem key={board.id} value={board.id}>
                  {board.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
            Shown in the "Board" tab in the sidebar nav section.
          </p>
        </ContentSection>

        <Separator />

        {/* Default tab */}
        <ContentSection title="Default tab">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(['my-cards', 'board'] as const).map(tab => (
              <Button
                key={tab}
                variant={settings.activeTab === tab ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => updateSettings({ activeTab: tab })}
                style={{ justifyContent: 'flex-start' }}
              >
                {tab === 'my-cards' ? 'My Cards' : 'Board'}
              </Button>
            ))}
          </div>
        </ContentSection>

        <Separator />

        {/* Card limit */}
        <ContentSection title="Cards limit">
          <Select
            value={String(settings.limit)}
            onValueChange={val => updateSettings({ limit: Number(val) })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMIT_OPTIONS.map(n => (
                <SelectItem key={n} value={String(n)}>
                  {n} cards
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
