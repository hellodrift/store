import { useState } from 'react';
import { NavSection, NavItem } from '@drift/design/components';

interface Props {
  data?: Record<string, unknown>;
  onSelect?: (item: { id: string; type?: string; data?: unknown }) => void;
}

export default function NanitNavSection({ onSelect }: Props) {
  const [isExpanded, setIsExpanded] = useState(true);

  const sectionData = {
    id: 'nanit',
    label: 'Nanit',
    items: [],
  };

  return (
    <NavSection
      section={sectionData}
      isExpanded={isExpanded}
      onToggle={(_, expanded) => setIsExpanded(expanded)}
    >
      <NavItem
        item={{
          id: 'camera',
          label: 'Live Camera',
          variant: 'item',
          icon: <span style={{ fontSize: 12 }}>📹</span>,
        }}
        onSelect={() => onSelect?.({ id: 'open-drawer', type: 'drawer', data: { view: 'camera' } })}
      />
    </NavSection>
  );
}
