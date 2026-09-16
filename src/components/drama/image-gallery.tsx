'use client';

import { useState } from 'react';
import { Trash2, Check, Images, Loader2 } from 'lucide-react';

export type GalleryImage = {
  url: string;
  prompt?: string;
  createdAt?: string;
};

type ImageGalleryProps = {
  /** 当前主图URL */
  currentImageUrl: string | null;
  /** 所有图片列表（包含当前主图，JSON解析后的数组，或JSON字符串） */
  gallery: GalleryImage[] | string | null | undefined;
  /** 项目ID */
  dramaId: string;
  /** 实体ID（角色/场景/物品的ID） */
  itemId: string;
  /** 类型：character/scene/item */
  type: 'character' | 'scene' | 'item';
  /** token获取函数 */
  getToken: () => string | null;
  /** 刷新回调 */
  onRefresh: () => void;
};

export function ImageGallery({ currentImageUrl, gallery, dramaId, itemId, type, getToken, onRefresh }: ImageGalleryProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // 解析gallery
  let images: GalleryImage[] = [];
  if (Array.isArray(gallery)) {
    images = gallery;
  } else if (typeof gallery === 'string' && gallery) {
    try {
      images = JSON.parse(gallery);
    } catch {}
  }

  // 如果gallery为空但有currentImageUrl（兼容旧数据），构造只有一张的数组
  if (images.length === 0 && currentImageUrl) {
    images = [{ url: currentImageUrl }];
  }

  if (!images || images.length <= 1) return null;

  const apiPath = type === 'character' ? 'characters' : type === 'scene' ? 'scenes' : 'items';
  const idKey = type === 'character' ? 'characterId' : type === 'scene' ? 'sceneId' : 'itemId';

  const handleSelect = async (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    // 如果点击的是当前主图，不做任何操作
    if (images[idx].url === currentImageUrl) return;
    const key = `select-${idx}`;
    setLoadingAction(key);
    try {
      const body: Record<string, any> = { selectGalleryIndex: idx };
      body[idKey] = itemId;

      const res = await fetch(`/api/short-dramas/${dramaId}/${apiPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken() || ''}` },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onRefresh();
      }
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDelete = async (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (images.length <= 1) {
      if (!confirm('这是唯一的一张图片，确定要删除吗？')) return;
    } else {
      if (!confirm('确定删除这张图片吗？')) return;
    }
    const key = `delete-${idx}`;
    setLoadingAction(key);
    try {
      const body: Record<string, any> = { deleteGalleryIndex: idx };
      body[idKey] = itemId;

      const res = await fetch(`/api/short-dramas/${dramaId}/${apiPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken() || ''}` },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onRefresh();
      }
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="mt-2 pt-2 border-t border-white/10" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Images className="w-3 h-3 text-blue-400" />
        <span className="text-[10px] text-gray-400">全部图片 ({images.length})</span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {images.map((img, idx) => {
          const isCurrent = img.url === currentImageUrl;
          const isLoading = loadingAction === `select-${idx}` || loadingAction === `delete-${idx}`;
          return (
            <div key={`${img.url}-${idx}`} className="relative flex-shrink-0 group">
              <div className={`w-14 h-14 rounded-md overflow-hidden border-2 transition-all ${
                isCurrent 
                  ? 'border-green-400 ring-2 ring-green-400/40 cursor-default shadow-lg shadow-green-500/20' 
                  : 'border-white/20 hover:border-blue-400 cursor-pointer hover:ring-1 hover:ring-blue-400/30'
              }`}>
                <img
                  src={img.url}
                  alt={`图片 ${idx + 1}`}
                  className="w-full h-full object-cover"
                  onClick={(e) => !isCurrent && !isLoading && handleSelect(idx, e)}
                />
              </div>
              {isCurrent && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow-md">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
              {/* 删除按钮 - 悬停显示 */}
              <button
                onClick={(e) => !isLoading && handleDelete(idx, e)}
                className="absolute -top-1 -left-1 w-5 h-5 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                title="删除这张图片"
              >
                {isLoading && loadingAction === `delete-${idx}` ? (
                  <Loader2 className="w-3 h-3 text-white animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3 text-white" />
                )}
              </button>
              {isLoading && loadingAction === `select-${idx}` && (
                <div className="absolute inset-0 bg-black/60 rounded-md flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
