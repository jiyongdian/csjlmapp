"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

interface LayoutContextValue {
  fullWidth: boolean;
  setFullWidth: (value: boolean) => void;
}

export const LayoutContext = createContext<LayoutContextValue>({
  fullWidth: false,
  setFullWidth: () => {},
});

/**
 * 在 layout 中使用，创建 LayoutContext 的状态。
 * 返回 { fullWidth, setFullWidth, Provider props }
 */
export function useLayoutState() {
  const [fullWidth, setFullWidth] = useState(false);
  return { fullWidth, setFullWidth };
}

/**
 * 子页面调用，声明式控制 layout 是否占满宽度。
 *
 * @param condition - 为 true 时 layout 使用 max-w-none，否则使用 max-w-7xl
 *
 * @example
 * // 始终占满宽度（如分镜页）
 * useFullWidth(true);
 *
 * // 条件性占满宽度（如资产页展开编辑面板时）
 * useFullWidth(isPanelOpen);
 */
export function useFullWidth(condition: boolean) {
  const { setFullWidth } = useContext(LayoutContext);

  useEffect(() => {
    setFullWidth(condition);
    // 卸载时恢复默认
    return () => setFullWidth(false);
  }, [condition, setFullWidth]);
}
