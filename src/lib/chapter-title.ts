/**
 * 章节标题统一格式化工具
 *
 * 统一格式：`第N章：标题`
 *   - 序号使用阿拉伯数字（如 第1章、第23章）
 *   - 分隔符统一为全角冒号「：」
 *   - 标题内容按每章情节生成，长度 4-16 个中文字符为宜
 *
 * 示例：
 *   第1章：纸条
 *   第2章：洞口
 *   第3章：日记
 *   第1章：海獭四兄妹入住并立家规
 */

/** 去掉标题里已存在的「第X章 / 第X集 / 序号」等前缀，只保留情节标题本体 */
export function stripChapterTitlePrefix(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  if (!s) return '';

  // 去掉 markdown 标题井号、前后空白
  s = s.replace(/^#+\s*/, '').trim();

  // 循环剥除前导编号残留：AI/流水线可能叠加多段前缀（如「第10集：第10章：【第10章】承接」、
  // 「第2章：第2章：xxx」），expand until 稳定
  for (let guard = 0; guard < 8; guard++) {
    const before = s;
    // 「第X章/集/回/节/卷/篇/部」前缀，后可直接跟分隔符、括号残字或下一个编号（如「】」）
    s = s.replace(
      /^第\s*(?:\d+|[一二三四五六七八九十百千万零〇两]+)\s*(?:章|集|回|节|卷|篇|部)\s*(?:[：:、.．·\-—】》」』）)]?\s*)*/,
      ''
    );
    // 纯序号前缀，如「1、」「1.」「1：」「(1)」「一、」
    s = s.replace(/^[（(【\[「『]?\s*(?:\d+|[一二三四五六七八九十百千万零〇两]+)\s*[）)】\]」』]?\s*[、.．：:·\-—]?\s*/, '');
    // 前导编号被剥掉后遗留的右侧括号/书名号残字（如「】承接」→「承接」）
    s = s.replace(/^[】》」』）)]+/, '');
    s = s.replace(/^[：:、.．\-—\s]+/, '').trim();
    if (s === before) break;
  }

  // 去掉书名号 / 引号 / 方括号包裹
  s = s.replace(/^[《【\[「『]+/, '').replace(/[》】\]」』]+$/, '');

  return s.trim();
}

/** 格式化章节标题：第N章：标题（无标题时回退为 第N章） */
export function formatChapterTitle(index: number, rawTitle?: string | null): string {
  const n = Number(index);
  const num = Number.isFinite(n) && n > 0 ? String(n) : '';
  const clean = stripChapterTitlePrefix(rawTitle);
  if (!num) return clean || '';
  return clean ? `第${num}章：${clean}` : `第${num}章`;
}

/**
 * 清洗 + 截断 LLM 生成的标题（去除多余标点、控制长度），返回「情节标题本体」（不含序号前缀）
 * 用于写入 DB 前的规范化。
 */
export function sanitizeChapterTitleText(raw: string | null | undefined, maxLen = 20): string {
  let s = stripChapterTitlePrefix(raw);
  if (!s) return '';
  // 去掉结尾的标点
  s = s.replace(/[。！？!?；;，,、\s]+$/, '').trim();
  // 去掉内嵌引号/书名号
  s = s.replace(/[《》【】「」『』"']/g, '');
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s.trim();
}
