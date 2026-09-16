/**
 * 分 → 元 显示：整数不带小数；有小数则保留最多两位并去掉末尾多余的 0（如 9.9 → "9.9"、198 → "198"）。
 */
export function formatYuan(cents: number | null | undefined): string {
  const yuan = (Number(cents) || 0) / 100;
  if (!Number.isFinite(yuan)) return "0";
  if (Number.isInteger(yuan)) return String(yuan);
  return yuan.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
