/**
 * 从 AI 响应文本中提取包含目标字段的 JSON 对象
 * 支持多种 AI 输出格式：
 * 1. 纯 JSON
 * 2. markdown 代码块包裹 ```json ... ```
 * 3. JSON 前后有说明文字（含大括号的思考过程）
 * 4. 多个 JSON 对象（找到包含目标字段的那个）
 * 5. 尾部逗号等常见 AI 输出问题
 */
export function extractJsonObject<T = unknown>(text: string, targetFields?: string[]): T | null {
  if (!text || !text.trim()) return null;

  const cleaned = text.trim();

  // 1. 尝试直接解析
  try {
    const parsed = JSON.parse(cleaned);
    // 如果指定了目标字段，检查是否包含
    if (targetFields && targetFields.length > 0) {
      if (typeof parsed === 'object' && parsed !== null) {
        if (targetFields.some(f => f in parsed)) {
          return parsed;
        }
        // 不包含目标字段，继续尝试其他方式
      }
    } else {
      return parsed;
    }
  } catch {
    // 继续
  }

  // 2. 提取所有候选 JSON 字符串，逐个尝试
  const candidates = extractAllJsonCandidates(cleaned);

  for (const candidate of candidates) {
    // 先尝试直接解析
    try {
      const parsed = JSON.parse(candidate);
      if (targetFields && targetFields.length > 0) {
        if (typeof parsed === 'object' && parsed !== null && targetFields.some(f => f in parsed)) {
          return parsed;
        }
        continue; // 不包含目标字段，继续尝试下一个候选
      }
      return parsed;
    } catch {
      // 继续
    }

    // 尝试修复后解析
    const repaired = tryRepair(candidate);
    if (repaired !== null) {
      try {
        const parsed = JSON.parse(repaired);
        if (targetFields && targetFields.length > 0) {
          if (typeof parsed === 'object' && parsed !== null && targetFields.some(f => f in parsed)) {
            return parsed;
          }
          continue; // 不包含目标字段，继续尝试下一个候选
        }
        return parsed;
      } catch {
        // 继续
      }
    }
  }

  return null;
}

/**
 * 提取所有候选 JSON 字符串
 * 优先级：markdown 代码块 > 括号平衡法
 */
function extractAllJsonCandidates(text: string): string[] {
  const candidates: string[] = [];

  // 优先提取 markdown 代码块中的内容
  const codeBlockRegex = /```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content.startsWith('{')) {
      candidates.push(content);
    }
  }

  // 用括号平衡法找到所有完整的 JSON 对象
  const balanced = findAllBalancedObjects(text);
  for (const obj of balanced) {
    // 避免重复（如果已经在代码块中提取过）
    if (!candidates.some(c => c === obj)) {
      candidates.push(obj);
    }
  }

  return candidates;
}

/**
 * 用括号平衡法找到所有完整的 JSON 对象
 * 从文本中找到每个平衡的 {...} 块
 */
function findAllBalancedObjects(text: string): string[] {
  const results: string[] = [];
  let i = 0;

  while (i < text.length) {
    // 找到下一个未被字符串包裹的 {
    const objStart = findNextObjectStart(text, i);
    if (objStart === -1) break;

    // 从这个 { 开始，找到匹配的 }
    const objEnd = findMatchingCloseBrace(text, objStart);
    if (objEnd === -1) {
      i = objStart + 1;
      continue;
    }

    const candidate = text.slice(objStart, objEnd + 1);
    results.push(candidate);
    i = objEnd + 1;
  }

  return results;
}

/**
 * 找到下一个未被字符串包裹的 { 字符位置
 */
function findNextObjectStart(text: string, fromIndex: number): number {
  let inString = false;
  let escape = false;

  for (let i = fromIndex; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      return i;
    }
  }

  return -1;
}

/**
 * 从指定的 { 位置，找到匹配的 } 位置
 */
function findMatchingCloseBrace(text: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * 尝试修复常见的 JSON 问题
 * 返回修复后的字符串，如果无法修复返回 null
 */
function tryRepair(text: string): string | null {
  let repaired = text;

  // 修复尾部逗号：,} → }  ,] → ]（循环替换，处理嵌套情况）
  let prev = '';
  while (prev !== repaired) {
    prev = repaired;
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
  }

  // 修复属性名/值的单引号 → 双引号
  // 只处理简单的 key: 'value' 模式
  repaired = repaired.replace(/:\s*'([^']*?)'([,}\]])/g, ': "$1"$2');

  // 修复不带引号的 key（AI 有时会输出 {key: "value"}）
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

  // 修复多余的换行和空格
  repaired = repaired.replace(/\n/g, ' ');

  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}
