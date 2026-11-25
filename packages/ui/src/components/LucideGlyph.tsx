import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bold,
  ChevronDown,
  ChevronUp,
  Clock3,
  Ellipsis,
  FileText,
  Inbox,
  Italic,
  Mail,
  MessageSquare,
  Paperclip,
  Plus,
  Reply,
  Search,
  Settings,
  SquarePen,
  Star,
  Strikethrough,
  Trash2,
  Type,
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
  star: Star,
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  format: Type
} as const;

export type GlyphName = keyof typeof icons;

export interface GlyphProps {
  name: GlyphName;
  size?: number;
  color: string;
  strokeWidth?: number;
  fill?: string;
}

export function Glyph({ name, size = 18, color, strokeWidth = 1.5, fill = 'none' }: GlyphProps): ReactElement {
  const Icon = icons[name];
  return <Icon size={size} color={color} strokeWidth={strokeWidth} fill={fill} />;
}