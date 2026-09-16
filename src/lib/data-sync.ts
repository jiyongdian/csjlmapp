/**
 * 跨标签页数据同步工具（BroadcastChannel）
 * 当前台或后台对小说、剧本、短剧执行删除/创建/更新后，
 * 自动通知所有打开中的同源页面刷新对应列表。
 */

const CHANNEL_NAME = 'writing-data-sync';

export type DataSyncEntityType = 'novel' | 'script' | 'short-drama';
export type DataSyncAction = 'delete' | 'create' | 'update';

export interface DataSyncEvent {
  type: DataSyncEntityType;
  action: DataSyncAction;
  id?: string;
}

/** 广播一次数据变更事件（操作后调用） */
export function broadcastDataChange(event: DataSyncEvent): void {
  if (typeof window === 'undefined') return;
  try {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    ch.postMessage(event);
    ch.close();
  } catch (_) {}
}

/**
 * 监听数据变更事件
 * @returns 取消监听的函数，在组件 useEffect 返回中调用
 */
export function onDataChange(
  callback: (event: DataSyncEvent) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  try {
    const ch = new BroadcastChannel(CHANNEL_NAME);
    ch.onmessage = (e: MessageEvent<DataSyncEvent>) => callback(e.data);
    return () => ch.close();
  } catch (_) {
    return () => {};
  }
}
