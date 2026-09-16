/**
 * ComfyUI MiniMax H3 尺寸预设（纯数据，可在客户端组件安全引用）
 */

/**
 * MiniMax H3 尺寸预设表（基于 megapixels × 16:9）
 * 竖屏时自动交换 width ↔ height
 */
export const COMFYUI_SIZE_PRESETS: Array<{
  label: string;
  megapixels: number;
  width: number;  // 16:9 横屏
  height: number;
}> = [
  { label: '0.2MP', megapixels: 0.2, width: 608, height: 352 },
  { label: '0.3MP', megapixels: 0.3, width: 736, height: 416 },
  { label: '0.4MP', megapixels: 0.4, width: 864, height: 480 },
  { label: '0.5MP', megapixels: 0.5, width: 960, height: 544 },
  { label: '0.6MP', megapixels: 0.6, width: 1056, height: 608 },
  { label: '0.7MP', megapixels: 0.7, width: 1152, height: 640 },
  { label: '0.8MP', megapixels: 0.8, width: 1216, height: 672 },
  { label: '0.9MP', megapixels: 0.9, width: 1280, height: 736 },
  { label: '0.98MP', megapixels: 0.98, width: 1344, height: 768 },
  { label: '1.0MP', megapixels: 1.0, width: 1376, height: 768 },
  { label: '1.2MP', megapixels: 1.2, width: 1504, height: 832 },
  { label: '1.5MP', megapixels: 1.5, width: 1664, height: 928 },
  { label: '1.8MP', megapixels: 1.8, width: 1824, height: 1024 },
  { label: '2.0MP', megapixels: 2.0, width: 1920, height: 1088 },
];

/**
 * 根据宽高比获取正确的尺寸（竖屏时宽高互换）
 * @param aspectRatio 宽高比 '16:9' | '9:16' | '1:1' 等
 * @param presetIndex 预设索引（默认 2 = 0.4MP）
 */
export function getComfyUISize(
  aspectRatio: string = '16:9',
  presetIndex: number = 2
): { width: number; height: number; label: string } {
  const preset = COMFYUI_SIZE_PRESETS[presetIndex] || COMFYUI_SIZE_PRESETS[2];
  const isPortrait = aspectRatio === '9:16' || aspectRatio === '3:4' || aspectRatio === '2:3';
  const isSquare = aspectRatio === '1:1';
  
  if (isPortrait) {
    return { width: preset.height, height: preset.width, label: `${preset.label} 竖屏 ${preset.height}×${preset.width}` };
  } else if (isSquare) {
    const square = Math.min(preset.width, preset.height);
    return { width: square, height: square, label: `${preset.label} 方形 ${square}×${square}` };
  } else {
    return { width: preset.width, height: preset.height, label: `${preset.label} 横屏 ${preset.width}×${preset.height}` };
  }
}
