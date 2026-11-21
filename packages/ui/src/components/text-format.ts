export interface TextSelection {
  start: number;
  end: number;
}

interface FormatRange {
  start: number;
  end: number;
}

function formattingRange(text: string, selection: TextSelection, marker: string): FormatRange | undefined {
  const positions: number[] = [];
  let position = 0;
  while (position < text.length) {
    const index = text.indexOf(marker, position);
    if (index < 0) break;
    const before = text[index - 1];
    const after = text[index + marker.length];
    if (before !== marker[0] && before !== '\\' && after === marker[0] && text.slice(index, index + marker.length * 2) === marker + marker && text[index + marker.length * 2] !== marker[0]) {
      positions.push(index, index + marker.length);
      position = index + marker.length * 2;
    } else {
      if (before !== marker[0] && after !== marker[0] && before !== '\\') positions.push(index);
      position = index + marker.length;
    }
  }
  for (let index = 0; index + 1 < positions.length; index += 2) {
    const start = positions[index]!;
    const end = positions[index + 1]!;
    if (selection.start >= start + marker.length && selection.end <= end) return { start, end };
    if (selection.start === start && selection.end === end + marker.length) return { start, end };
  }
  return undefined;
}

export function isTextFormatted(text: string, selection: TextSelection, marker: string, alternateMarker?: string): boolean {
  return formattingRange(text, selection, marker) !== undefined || (alternateMarker !== undefined && formattingRange(text, selection, alternateMarker) !== undefined);
}

export function toggleTextFormat(text: string, selection: TextSelection, marker: string, alternateMarker?: string): { text: string; selection: TextSelection } {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  let activeMarker = marker;
  let range = formattingRange(text, { start, end }, activeMarker);
  if (range === undefined && alternateMarker !== undefined) {
    activeMarker = alternateMarker;
    range = formattingRange(text, { start, end }, activeMarker);
  }
  if (range === undefined) {
    return {
      text: `${text.slice(0, start)}${marker}${text.slice(start, end)}${marker}${text.slice(end)}`,
      selection: { start: start + marker.length, end: end + marker.length }
    };
  }
  const contentStart = range.start + activeMarker.length;
  const selectedStart = Math.max(start, contentStart);
  const selectedEnd = Math.min(end, range.end);
  const before = text.slice(contentStart, selectedStart);
  const selected = text.slice(selectedStart, selectedEnd);
  const after = text.slice(selectedEnd, range.end);
  const wrap = (value: string): string => {
    const match = /^(\s*)([\s\S]*?\S)(\s*)$/.exec(value);
    const remainingMarker = alternateMarker ?? activeMarker;
    return match ? `${match[1]}${remainingMarker}${match[2]}${remainingMarker}${match[3]}` : value;
  };
  const prefix = wrap(before);
  const suffix = wrap(after);
  const nextStart = range.start + prefix.length;
  return {
    text: `${text.slice(0, range.start)}${prefix}${selected}${suffix}${text.slice(range.end + activeMarker.length)}`,
    selection: { start: nextStart, end: nextStart + selected.length }
  };
}