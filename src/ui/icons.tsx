// EntityModel.com's icon set, drawn on a 16px grid: 1.5px stroke, square caps, mitred joins,
// straight facets (round things are diamonds or polygons). Names match the lucide icons they replace.
import type { CSSProperties } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const FILE = 'M3.5 1.5h6l3 3v10h-9ZM9.5 1.5v3h3';
const CLIP = 'M5.5 2.5h-2v11h9v-11h-2M5.5 1.5h5v2.5h-5Z';
const DIAMOND = 'M8 1.5L14.5 8 8 14.5 1.5 8Z';
const EYE = 'M1.5 8l4-3.5h5l4 3.5-4 3.5h-5ZM8 6.25L9.75 8 8 9.75 6.25 8Z';
const CLOUD = 'M3.5 12.5l-2-2 1-3h2l2-3.5h4l2 3.5h1l1 3-2 2Z';

function make(name: string, d: string) {
  const Icon = ({ size = 16, className, style, title }: IconProps) => (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      // Hold the drawn stroke at 1.5px whatever the size.
      strokeWidth={(1.5 * 16) / size}
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeMiterlimit={10}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={d} />
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

// basic
export const Plus = make('Plus', 'M8 3v10M3 8h10');
export const Check = make('Check', 'M3 8.5l3.2 3.2L13 4.5');
export const X = make('X', 'M4 4l8 8M12 4l-8 8');
export const Square = make('Square', 'M2.5 2.5h11v11h-11Z');
export const ChevronDown = make('ChevronDown', 'M4 6l4 4 4-4');
export const ChevronRight = make('ChevronRight', 'M6 4l4 4-4 4');
export const ChevronLeft = make('ChevronLeft', 'M10 4L6 8l4 4');
export const ArrowUp = make('ArrowUp', 'M8 13.5v-11M3.5 7L8 2.5 12.5 7');
export const ArrowDown = make('ArrowDown', 'M8 2.5v11M3.5 9L8 13.5 12.5 9');
export const ArrowRight = make('ArrowRight', 'M2.5 8h11M9 3.5L13.5 8 9 12.5');
export const ArrowLeftRight = make('ArrowLeftRight', 'M2.5 5h11M10.5 2l3 3-3 3M13.5 11h-11M5.5 8l-3 3 3 3');
export const ArrowRightLeft = make('ArrowRightLeft', 'M13.5 5h-11M5.5 2l-3 3 3 3M2.5 11h11M10.5 8l3 3-3 3');
export const CornerDownRight = make('CornerDownRight', 'M3.5 2.5v7h10M10.5 6.5l3 3-3 3');
export const Undo2 = make('Undo2', 'M5 2.5L2.5 5 5 7.5M2.5 5h8l3 3v2.5l-3 3H6');
export const Redo2 = make('Redo2', 'M11 2.5L13.5 5 11 7.5M13.5 5h-8l-3 3v2.5l3 3H10');
export const RotateCcw = make('RotateCcw', 'M2.5 2.5v4h4M2.5 6.5L6 3h4.5l3 3v4l-3 3H6l-2.5-2.5');
export const Maximize = make('Maximize', 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10');
export const Focus = make('Focus', 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M8 6l2 2-2 2-2-2Z');
export const ExternalLink = make('ExternalLink', 'M7 3.5H2.5v10h10V9M9.5 2.5h4v4M13.5 2.5l-6 6');
export const Loader2 = make('Loader2', 'M8 1.5V4M8 12v2.5M1.5 8H4M12 8h2.5M3.4 3.4l1.8 1.8M10.8 10.8l1.8 1.8M3.4 12.6l1.8-1.8M10.8 5.2l1.8-1.8');

// status
export const Info = make('Info', `${DIAMOND}M8 7.5V11M8 5.2v.4`);
export const TriangleAlert = make('TriangleAlert', 'M8 2l6.5 11.5h-13ZM8 6.5V10M8 11.8v.4');
export const CircleCheck = make('CircleCheck', `${DIAMOND}M5.5 8l1.7 1.7 3.3-3.2`);
export const CircleX = make('CircleX', `${DIAMOND}M6.25 6.25l3.5 3.5M9.75 6.25l-3.5 3.5`);

// edit
export const Pencil = make('Pencil', 'M10.5 2.5l3 3-8 8h-3v-3ZM8.5 4.5l3 3');
export const Trash2 = make('Trash2', 'M3 4.5h10M6 4.5v-2h4v2M4.5 4.5l.7 9h5.6l.7-9M6.75 7v4M9.25 7v4');
export const Copy = make('Copy', 'M5.5 5.5h8v8h-8ZM2.5 10.5v-8h8');
export const CopyPlus = make('CopyPlus', 'M5.5 5.5h8v8h-8ZM2.5 10.5v-8h8M9.5 7.5v4M7.5 9.5h4');
export const Palette = make('Palette', 'M8 1.5L14.5 8 8 14.5 1.5 8ZM8 1.5v13M1.5 8H8');
export const SquareDashedMousePointer = make('SquareDashedMousePointer', 'M2.5 2.5h1.5M6.5 2.5h2M11 2.5h2.5V4M13.5 6.5v1M2.5 5.5v2M2.5 10v1.5M2.5 13.5H5M7.5 7.5l6 2.5-2.5 1-1 2.5Z');
export const ClipboardCopy = make('ClipboardCopy', `${CLIP}M6 8.5h5.5M9.5 6.5l2 2-2 2`);
export const ClipboardPaste = make('ClipboardPaste', `${CLIP}M11 8.5H5.5M7.5 6.5l-2 2 2 2`);
export const Search = make('Search', 'M7 2.5L11.5 7 7 11.5 2.5 7ZM10.5 10.5L14 14');
export const Send = make('Send', 'M2 2.5L14 8 2 13.5 4 8ZM4 8h4');
export const MousePointer2 = make('MousePointer2', 'M3 2.5L13 8l-4.5 1.5L7 14Z');
export const Wrench = make('Wrench', 'M2.5 13.5L8 8M8 8l-.5-3L10 2.5h2l-2 2 1.5 1.5 2-2v2L11 8.5Z');
export const Wand2 = make('Wand2', 'M2.5 13.5L10 6M8.5 4.5l3 3M12.5 1.5v3M11 3h3');
/** A faceted dial with its needle: measuring data. */
export const Gauge = make('Gauge', 'M1.5 12.5V9.5l1.5-4 3-2.5h4l3 2.5 1.5 4v3M8 11l3-4.5M6.5 12.5h3');
export const Sparkles = make('Sparkles', 'M6.5 2l1.2 3.8 3.8 1.2-3.8 1.2L6.5 12 5.3 8.2 1.5 7l3.8-1.2ZM12.5 10v4M10.5 12h4');
export const SlidersHorizontal = make('SlidersHorizontal', 'M2 4.5h12M2 8h12M2 11.5h12M10 3v3M5 6.5v3M9 10v3');
export const Eye = make('Eye', EYE);
export const EyeOff = make('EyeOff', `${EYE}M2.5 2.5l11 11`);

// files
export const FileText = make('FileText', `${FILE}M5.5 8h5M5.5 10.5h5`);
export const FileUp = make('FileUp', `${FILE}M8 12.5v-5M6 9.5l2-2 2 2`);
export const FileInput = make('FileInput', 'M5 5V1.5h5l3 3v10H5V12M10 1.5v3h3M1.5 8.5h6M5.5 6.5l2 2-2 2');
export const FileJson = make('FileJson', `${FILE}M6.5 7.5h-1V9L5 9.5l.5.5v1.5h1M9.5 7.5h1V9l.5.5-.5.5v1.5h-1`);
export const FileCode2 = make('FileCode2', `${FILE}M6.5 8L5 9.5 6.5 11M9.5 8L11 9.5 9.5 11`);
export const FileSpreadsheet = make('FileSpreadsheet', `${FILE}M5.5 7.5h5V12h-5ZM5.5 9.75h5M8 7.5V12`);
export const FolderInput = make('FolderInput', 'M1.5 6V2.5H6l1.5 1.5h7v9.5h-13V10.5M1 8.25h6.5M5.5 6.25l2 2-2 2');
export const FolderOpen = make('FolderOpen', 'M1.5 13.5v-11H6l1.5 1.5h5v2.5M1.5 13.5l2.5-7h11l-2.5 7Z');
export const Download = make('Download', 'M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11');
export const Image = make('Image', 'M2.5 2.5h11v11h-11ZM2.5 11L6 7.5l3 3 2-2 2.5 2.5M10 5.25h.75');
export const HardDrive = make('HardDrive', 'M2 9.5L4 3h8l2 6.5v4H2ZM2 9.5h12M10.5 11.5h1');
export const Cloud = make('Cloud', CLOUD);
export const Users = make('Users', 'M6 2.5l2 1.5v2L6 7.5 4 6V4ZM1.5 13.5v-1L4 10h4l2.5 2.5v1M10.5 3l1.5 1v2l-1.5 1M12 10l2.5 2.5v1');
export const CloudOff = make('CloudOff', `${CLOUD}M2 2l12 12`);
export const Database = make('Database', 'M3 4l2-1.5h6L13 4l-2 1.5H5ZM3 4v8l2 1.5h6l2-1.5V4M3 8l2 1.5h6L13 8');

// books & notes
export const Book = make('Book', 'M3.5 1.5h9v13h-9ZM6 1.5v13');
export const BookOpen = make('BookOpen', 'M1.5 3L8 4.5 14.5 3v9.5L8 14l-6.5-1.5ZM8 4.5V14');
export const BookMarked = make('BookMarked', 'M3.5 1.5h9v13h-9ZM3.5 11.5h9M6.5 1.5v5L8 5.25 9.5 6.5v-5');
export const StickyNote = make('StickyNote', 'M2.5 2.5h11v7l-4 4h-7ZM13.5 9.5h-4v4');
export const MessageSquare = make('MessageSquare', 'M2.5 2.5h11V11H7l-3 2.5V11H2.5Z');
export const Tag = make('Tag', 'M2.5 2.5H8l6 6L8.5 14l-6-6ZM5 5.5h1');
export const KeyRound = make('KeyRound', 'M5 2.5L8.5 6 5 9.5 1.5 6ZM6.75 7.75L13.5 14.5M11 12l1.5-1.5M12.5 13.5l1.25-1.25');
export const Crown = make('Crown', 'M2 12.5V5l3 3 3-5 3 5 3-3v7.5Z');

// structure & views
export const Table = make('Table', 'M2.5 2.5h11v11h-11ZM2.5 6h11M2.5 9.75h11M6.5 6v7.5');
export const Columns3 = make('Columns3', 'M2.5 2.5h11v11h-11ZM6.17 2.5v11M9.83 2.5v11');
export const LayoutGrid = make('LayoutGrid', 'M2.5 2.5H7V7H2.5ZM9 2.5h4.5V7H9ZM2.5 9H7v4.5H2.5ZM9 9h4.5v4.5H9Z');
export const PanelLeft = make('PanelLeft', 'M2.5 3h11v10h-11ZM6.5 3v10');
export const PanelRight = make('PanelRight', 'M2.5 3h11v10h-11ZM9.5 3v10');
export const PanelsTopLeft = make('PanelsTopLeft', 'M2.5 2.5h11v11h-11ZM2.5 6h11M6 6v7.5');
export const Layers = make('Layers', 'M8 2l6 3-6 3-6-3ZM2 8l6 3 6-3M2 11l6 3 6-3');
export const SquareStack = make('SquareStack', 'M6.5 6.5h7v7h-7ZM4.5 11.5h-2v-9h9v2');
export const ListOrdered = make('ListOrdered', 'M7 4h7M7 8h7M7 12h7M2.5 2.5h1v3M2.5 9.5h2l-2 3h2');
export const ListChecks = make('ListChecks', 'M2 4l1.25 1.25L5.5 3M2 10l1.25 1.25L5.5 9M8 4.5h6M8 10.5h6');
export const Braces = make('Braces', 'M5.5 2.5H4v4L2.5 8 4 9.5v4h1.5M10.5 2.5H12v4L13.5 8 12 9.5v4h-1.5');
export const Code2 = make('Code2', 'M5 4L1.5 8 5 12M11 4l3.5 4L11 12M9.5 2.5l-3 11');
export const Terminal = make('Terminal', 'M2.5 2.5h11v11h-11ZM5 6l2 2-2 2M8.5 10.5H11');
export const Command = make('Command', 'M6 6h4v4H6ZM6 6H3.5V3.5H6ZM10 6V3.5h2.5V6ZM10 10h2.5v2.5H10ZM6 10v2.5H3.5V10Z');
export const Network = make('Network', 'M6 1.5h4v3H6ZM1.5 11.5h4v3h-4ZM10.5 11.5h4v3h-4ZM8 4.5V8M3.5 11.5V8h9v3.5');
export const Workflow = make('Workflow', 'M2.5 2.5h4v4h-4ZM9.5 9.5h4v4h-4ZM4.5 6.5v5h5');
export const Link2 = make('Link2', 'M6.5 5H3v6h3.5M9.5 5H13v6H9.5M5.5 8h5');
export const GitCompareArrows = make('GitCompareArrows', 'M2.5 2.5h3v3h-3ZM10.5 10.5h3v3h-3ZM4 5.5V12h5M7.5 10.5L9 12l-1.5 1.5M12 10.5V4H7M8.5 2.5L7 4l1.5 1.5');
export const Waypoints = make('Waypoints', 'M2 2.5h3v3H2ZM11 10.5h3v3h-3ZM5 4h3.5v8H11');
export const Map =make('Map', 'M1.5 3.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5ZM5.5 2v10.5M10.5 3.5V14');
export const Bot = make('Bot', 'M8 1.5l5.5 4v5L8 14.5l-5.5-4v-5ZM8 1.5v13M2.5 5.5l11 5');

// theme
export const Sun = make('Sun', 'M8 5l3 3-3 3-3-3ZM8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1');
export const Moon = make('Moon', 'M9 2L4 3.5 2 8l2 4.5L9 14l4.5-3.5-4-1.5L7.5 6Z');
