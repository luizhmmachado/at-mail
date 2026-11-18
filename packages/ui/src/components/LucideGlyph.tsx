import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Clock3,
  Ellipsis,
  FileText,
  Inbox,
  Mail,
  MessageSquare,
  Paperclip,
  Plus,
  Reply,
  Search,
  Settings,
  SquarePen,
  Star,
  Trash2,
  UserRound
} from 'lucide-react-native';
import type { ReactElement } from 'react';

const icons = {
  mail: Mail,
  chat: MessageSquare,
  search: Search,
  compose: SquarePen,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  dots: Ellipsis,
  archive: Archive,
  trash: Trash2,
  clock: Clock3,
  up: ArrowUp,
  down: ArrowDown,
  settings: Settings,
  user: UserRound,
  plus: Plus,
  arrow: ArrowRight,
  reply: Reply,
  attach: Paperclip,
  file: FileText,
  inbox: Inbox,
  star: Star
} as const;

export type GlyphName = keyof typeof icons;

export interface GlyphProps {
  name: GlyphName;
  size?: number;
  color: string;
  strokeWidth?: number;
}

export function Glyph({ name, size = 18, color, strokeWidth = 1.5 }: GlyphProps): ReactElement {
  const Icon = icons[name];
  return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
}