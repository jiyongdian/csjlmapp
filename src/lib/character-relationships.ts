export interface ParsedCharacterRelationship {
  from: string;
  to: string;
  description: string;
}

export interface CharacterRelationshipRow {
  id?: string;
  fromCharacter?: string | null;
  toCharacter?: string | null;
  relationship?: string | null;
  sortOrder?: number | null;
  [key: string]: any;
}

export interface ExpandedCharacterRelationshipRow extends CharacterRelationshipRow {
  id: string;
  fromCharacter: string;
  toCharacter: string;
  relationship: string | null;
  sourceId?: string;
  isSplitFromMerged?: boolean;
}

const RELATION_HEADER_RE =
  /(?:^|[\n；;。])\s*(?:\d+[.、．]\s*)?([^→:：；;。\n]{1,24}?)\s*(?:→|->|-->|⇒|=>|—)\s*([^:：；;。\n]{1,24}?)\s*[：:]/g;

const ARROW_LINE_RE =
  /^(?:\d+[.、．]\s*)?(.+?)\s*(?:→|->|-->|⇒|=>|—)\s*(.+?)(?:[：:](.*))?$/;

function cleanRelationshipName(value: string): string {
  return value
    .replace(/^[\s\-—–•·、，,；;。]+/, '')
    .replace(/^(?:关系|人物关系|角色关系)\s*\d*[：:、.-]?\s*/i, '')
    .replace(/^["'“”‘’《》【】[\]（）()]+|["'“”‘’《》【】[\]（）()]+$/g, '')
    .trim();
}

function cleanRelationshipDescription(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/^[\s：:，,；;。]+/, '')
    .replace(/[\s；;]+$/g, '')
    .trim();
}

function isReasonableName(value: string): boolean {
  if (!value || value.length > 24) return false;
  if (/[。！？!?；;：:\n]/.test(value)) return false;
  return true;
}

function dedupeRelationships(items: ParsedCharacterRelationship[]): ParsedCharacterRelationship[] {
  const seen = new Set<string>();
  const results: ParsedCharacterRelationship[] = [];
  for (const item of items) {
    const from = cleanRelationshipName(item.from);
    const to = cleanRelationshipName(item.to);
    const description = cleanRelationshipDescription(item.description);
    if (!isReasonableName(from) || !isReasonableName(to)) continue;
    const key = `${from}→${to}→${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ from, to, description });
  }
  return results;
}

function parseRelationshipBlocks(text: string): ParsedCharacterRelationship[] {
  const results: ParsedCharacterRelationship[] = [];
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  let current: ParsedCharacterRelationship | null = null;
  const flush = () => {
    if (current) results.push(current);
    current = null;
  };

  for (const line of lines) {
    const match = line.match(ARROW_LINE_RE);
    if (match) {
      flush();
      const targetPart = match[2].trim();
      current = {
        from: match[1].trim(),
        to: targetPart,
        description: match[3]?.trim() || '',
      };
    } else if (current) {
      current.description = [current.description, line].filter(Boolean).join('\n');
    }
  }
  flush();
  return results;
}

export function parseCharacterRelationshipsText(rawText: string): ParsedCharacterRelationship[] {
  if (!rawText || typeof rawText !== 'string') return [];
  const text = rawText
    .replace(/\r\n?/g, '\n')
    .replace(/\\n/g, '\n')
    .trim();
  if (!text) return [];

  const headerMatches = Array.from(text.matchAll(RELATION_HEADER_RE));
  if (headerMatches.length > 0) {
    const parsed = headerMatches.map((match, index) => {
      const descriptionStart = (match.index || 0) + match[0].length;
      const descriptionEnd = headerMatches[index + 1]?.index ?? text.length;
      return {
        from: match[1],
        to: match[2],
        description: text.slice(descriptionStart, descriptionEnd),
      };
    });
    return dedupeRelationships(parsed);
  }

  return dedupeRelationships(parseRelationshipBlocks(text));
}

export function expandCharacterRelationshipRows(rows: CharacterRelationshipRow[] = []): ExpandedCharacterRelationshipRow[] {
  const expanded: ExpandedCharacterRelationshipRow[] = [];

  rows.forEach((row, rowIndex) => {
    const baseFrom = row.fromCharacter || '';
    const baseTo = row.toCharacter || '';
    const relationship = row.relationship || '';
    const combinedText = baseFrom && baseTo
      ? `${baseFrom} → ${baseTo}：${relationship}`
      : relationship;
    const parsed = parseCharacterRelationshipsText(combinedText);
    const shouldSplit = parsed.length > 1;

    if (parsed.length > 0) {
      parsed.forEach((item, itemIndex) => {
        expanded.push({
          ...row,
          id: shouldSplit
            ? `${row.id || `relationship-${rowIndex}`}-split-${itemIndex}`
            : (row.id || `relationship-${rowIndex}`),
          sourceId: row.id,
          isSplitFromMerged: shouldSplit,
          fromCharacter: item.from,
          toCharacter: item.to,
          relationship: item.description || null,
          sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder + itemIndex / 100 : rowIndex + itemIndex / 100,
        });
      });
      return;
    }

    if (baseFrom || baseTo || relationship) {
      expanded.push({
        ...row,
        id: row.id || `relationship-${rowIndex}`,
        fromCharacter: baseFrom,
        toCharacter: baseTo,
        relationship: relationship || null,
        sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : rowIndex,
      });
    }
  });

  return expanded;
}
