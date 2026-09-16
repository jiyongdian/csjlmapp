"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, Menu, Info, Workflow, BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  scriptApi,
  novelLinkApi,
  type Script,
  type ScriptEpisode,
  type SceneItem,
  type NovelBrief,
} from "@/lib/api/script";
import { EpisodeTree } from "./_components/episode-tree";
import { SceneList } from "./_components/scene-list";
import { SceneDetail } from "./_components/scene-detail";
import { ScriptOverview } from "./_components/script-overview";
import { EmptyState } from "./_components/empty-state";
import { ParseScriptDialog } from "@/components/dashboard/parse-script-dialog";
import { EpisodeParseDialog } from "@/components/dashboard/episode-parse-dialog";
import { ScriptPipelineDialog } from "@/components/dashboard/script-pipeline-dialog";
import { usePipelineStore } from "@/lib/store/pipeline-store";
import { useProject } from "../project-context";

export default function ScriptTabPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">加载中...</p></div>}>
      <ScriptTabPageContent />
    </Suspense>
  );
}

function ScriptTabPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = Number(params.id);
  const { project } = useProject();

  const [loading, setLoading] = useState(true);
  const [script, setScript] = useState<Script | null>(null);
  const [episodes, setEpisodes] = useState<ScriptEpisode[]>([]);

  // 当前展示的分集
  const [activeEpisodeId, setActiveEpisodeId] = useState<number | null>(null);
  // 树结构：展开状态
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<number>>(new Set());
  // 各分集的场次缓存
  const [episodeScenes, setEpisodeScenes] = useState<Record<number, SceneItem[]>>({});
  const [loadingEpisodes, setLoadingEpisodes] = useState<Set<number>>(new Set());

  const activeEpisodeIdRef = useRef(activeEpisodeId);
  useEffect(() => {
    activeEpisodeIdRef.current = activeEpisodeId;
  }, [activeEpisodeId]);

  const expandedEpisodesRef = useRef(expandedEpisodes);
  useEffect(() => {
    expandedEpisodesRef.current = expandedEpisodes;
  }, [expandedEpisodes]);

  const episodeScenesRef = useRef(episodeScenes);
  useEffect(() => {
    episodeScenesRef.current = episodeScenes;
  }, [episodeScenes]);

  // 选中的场次（用于右栏显示详情）
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null);

  // 创建剧本对话框
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showParseDialog, setShowParseDialog] = useState(false);
  const [showPipelineDialog, setShowPipelineDialog] = useState(false);

  // 移动端侧边栏状态
  const [leftSheetOpen, setLeftSheetOpen] = useState(false);
  const [rightSheetOpen, setRightSheetOpen] = useState(false);

  // 分集解析弹窗
  const [showEpisodeParseDialog, setShowEpisodeParseDialog] = useState(false);
  const [episodeToParseId, setEpisodeToParseId] = useState<number | null>(null);

  // ========== 小说关联数据 ==========
  const [novelData, setNovelData] = useState<NovelBrief | null>(null);
  const [showNovelInfo, setShowNovelInfo] = useState(true);
  const [novelLoading, setNovelLoading] = useState(false);

  // 从项目 properties 解析 novelId
  const getNovelIdFromProject = useCallback((): string | null => {
    if (!project?.properties) return null;
    try {
      const props = typeof project.properties === 'string' 
        ? JSON.parse(project.properties) 
        : project.properties;
      return (props as any)?.novelId || null;
    } catch {
      return null;
    }
  }, [project]);

  // 加载关联小说数据
  const loadNovelData = useCallback(async () => {
    const novelId = getNovelIdFromProject();
    if (!novelId) return;
    
    setNovelLoading(true);
    try {
      const data = await novelLinkApi.getBrief(novelId);
      setNovelData(data);
    } catch (err) {
      console.error("加载小说数据失败:", err);
    } finally {
      setNovelLoading(false);
    }
  }, [getNovelIdFromProject]);

  // 项目加载完成后自动加载小说数据
  useEffect(() => {
    if (project && !novelData && !novelLoading) {
      loadNovelData();
    }
  }, [project, novelData, novelLoading, loadNovelData]);

  // 从 autoPipeline URL 参数自动打开流水线对话框
  useEffect(() => {
    const autoPipeline = searchParams.get("autoPipeline");
    if (autoPipeline === "1") {
      // 清理 URL 参数
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.delete("autoPipeline");
      window.history.replaceState({}, "", currentUrl.toString());
      // 打开流水线对话框
      setShowPipelineDialog(true);
    }
  }, [searchParams]);

  // Pipeline store
  const { addPipeline, setPanelExpanded, setExpandedTaskId } = usePipelineStore();

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1280px)");
    const handleResize = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setLeftSheetOpen(false);
        setRightSheetOpen(false);
      }
    };
    handleResize(mediaQuery);
    mediaQuery.addEventListener("change", handleResize);
    return () => mediaQuery.removeEventListener("change", handleResize);
  }, []);

  // ========== 数据加载 ==========

  const loadEpisodeScenes = async (episodeId: number) => {
    if (episodeScenes[episodeId]) return;
    setLoadingEpisodes((prev) => new Set(prev).add(episodeId));
    try {
      const scenes = await scriptApi.listScenes(episodeId);
      setEpisodeScenes((prev) => ({ ...prev, [episodeId]: scenes }));
    } catch (err) {
      console.error("加载场次失败:", err);
    } finally {
      setLoadingEpisodes((prev) => {
        const s = new Set(prev);
        s.delete(episodeId);
        return s;
      });
    }
  };

  const loadScript = useCallback(async () => {
    try {
      setLoading(true);
      const scripts = await scriptApi.list(projectId);
      if (scripts.length > 0) {
        const scr = scripts[0];
        setScript(scr);
        const eps = await scriptApi.listEpisodes(scr.id);
        setEpisodes(eps);
        if (eps.length > 0) {
          setActiveEpisodeId(eps[0].id);
          // 默认展开所有分集，并并行加载场次
          setExpandedEpisodes(new Set(eps.map((e) => e.id)));
          await Promise.all(eps.map((e) => loadEpisodeScenes(e.id)));
        }
      } else {
        setScript(null);
        setEpisodes([]);
      }
    } catch (err) {
      console.error("加载剧本失败:", err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    loadScript();
  }, [loadScript]);

  const refreshScript = useCallback(async () => {
    try {
      const scripts = await scriptApi.list(projectId);
      if (scripts.length > 0) {
        const scr = scripts[0];
        setScript(scr);
        const eps = await scriptApi.listEpisodes(scr.id);
        setEpisodes(eps);
        
        if (eps.length > 0) {
          const prevActiveId = activeEpisodeIdRef.current;
          const stillExists = eps.some((e) => e.id === prevActiveId);
          const nextActiveId = stillExists ? prevActiveId : eps[0].id;
          setActiveEpisodeId(nextActiveId);

          const currentExpanded = expandedEpisodesRef.current;
          const currentScenes = episodeScenesRef.current;
          
          const newEpisodeScenes: Record<number, SceneItem[]> = {};
          
          await Promise.all(
            eps.map(async (e) => {
              const shouldLoad = currentExpanded.has(e.id) || !!currentScenes[e.id] || e.id === nextActiveId;
              if (shouldLoad) {
                try {
                  const scenes = await scriptApi.listScenes(e.id);
                  newEpisodeScenes[e.id] = scenes;
                } catch (err) {
                  console.error(`刷新分集 ${e.id} 场次失败:`, err);
                }
              }
            })
          );
          
          setEpisodeScenes((prev) => ({ ...prev, ...newEpisodeScenes }));
        }
      } else {
        setScript(null);
        setEpisodes([]);
        setEpisodeScenes({});
      }
    } catch (err) {
      console.error("刷新剧本数据失败:", err);
    }
  }, [projectId]);

  // AI 工具执行后自动刷新
  const scriptsInvalidation = usePipelineStore((s) => s.invalidation.scripts);
  const scriptsInvRef = useRef(scriptsInvalidation);
  useEffect(() => {
    if (scriptsInvRef.current !== scriptsInvalidation) {
      scriptsInvRef.current = scriptsInvalidation;
      refreshScript();
    }
  }, [scriptsInvalidation, refreshScript]);

  const handleAiScriptCreated = useCallback(
    (createdScript: { id: number; title: string }) => {
      const scriptDisplayTitle =
        createdScript.title?.trim() || project?.name?.trim() || "未命名项目";

      loadScript();

      const pipelineId = addPipeline({
        label: `AI 生成剧本 - ${scriptDisplayTitle}`,
        projectId,
        request: {
          agentType: "script_full_parse",
          category: "pipeline",
          title: `AI 剧本解析：${scriptDisplayTitle}`,
          projectId,
          context: { scriptId: createdScript.id },
        },
        onComplete: () => {
          loadScript();
        },
      });

      setPanelExpanded(true);
      setExpandedTaskId(pipelineId);
    },
    [addPipeline, loadScript, project?.name, projectId, setExpandedTaskId, setPanelExpanded]
  );

  // ========== 导航操作 ==========

  const toggleEpisode = async (episodeId: number) => {
    if (expandedEpisodes.has(episodeId)) {
      setExpandedEpisodes((prev) => {
        const next = new Set(prev);
        next.delete(episodeId);
        return next;
      });
    } else {
      setExpandedEpisodes((prev) => new Set(prev).add(episodeId));
      await loadEpisodeScenes(episodeId);
    }
  };

  const selectEpisode = async (episodeId: number) => {
    setActiveEpisodeId(episodeId);
    setSelectedSceneId(null);
    if (!expandedEpisodes.has(episodeId)) {
      setExpandedEpisodes((prev) => new Set(prev).add(episodeId));
    }
    setLeftSheetOpen(false);
    await loadEpisodeScenes(episodeId);
  };

  // 追踪用户滚动状态，避免点击滚动时触发 observer 误判
  const isUserScrollRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scrollToScene = (sceneId: number) => {
    isUserScrollRef.current = true;
    setSelectedSceneId(sceneId);
    const el = document.querySelector(`[data-scene-id="${sceneId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // 滚动动画完成后恢复 observer
    setTimeout(() => {
      isUserScrollRef.current = false;
    }, 600);
  };

  const handleSelectScene = (sceneId: number, episodeId: number) => {
    selectEpisode(episodeId);
    setSelectedSceneId(sceneId);
    setLeftSheetOpen(false);
    setTimeout(() => scrollToScene(sceneId), 50);
  };

  // ========== 增删操作 ==========

  const handleAddEpisode = async () => {
    if (!script) return;
    try {
      const ep = await scriptApi.createEpisode({
        scriptId: script.id,
        episodeNumber: episodes.length + 1,
        title: `第 ${episodes.length + 1} 集`,
        sortOrder: episodes.length,
      });
      setEpisodes((prev) => [...prev, ep]);
      setExpandedEpisodes((prev) => new Set(prev).add(ep.id));
      setEpisodeScenes((prev) => ({ ...prev, [ep.id]: [] }));
      setActiveEpisodeId(ep.id);
    } catch (err) {
      console.error("添加分集失败:", err);
    }
  };

  const handleDeleteEpisode = async (episodeId: number) => {
    if (!confirm("确定要删除该分集及其所有场次吗？")) return;
    try {
      await scriptApi.deleteEpisode(episodeId);
      setEpisodes((prev) => prev.filter((ep) => ep.id !== episodeId));
      setExpandedEpisodes((prev) => {
        const next = new Set(prev);
        next.delete(episodeId);
        return next;
      });
      const newScenes = { ...episodeScenes };
      delete newScenes[episodeId];
      setEpisodeScenes(newScenes);
      if (activeEpisodeId === episodeId) {
        setActiveEpisodeId(episodes.length > 1 ? episodes[0].id : null);
      }
    } catch (err) {
      console.error("删除分集失败:", err);
    }
  };

  const handleAddScene = async (episodeId: number) => {
    if (!script) return;
    const scenes = episodeScenes[episodeId] || [];
    const ep = episodes.find((e) => e.id === episodeId);
    const epNum = ep?.episodeNumber || 1;
    try {
      const scene = await scriptApi.createScene({
        episodeId,
        scriptId: script.id,
        sceneNumber: `${epNum}-${scenes.length + 1}`,
        sceneHeading: `新场次`,
        sortOrder: scenes.length,
      });
      setEpisodeScenes((prev) => ({
        ...prev,
        [episodeId]: [...(prev[episodeId] || []), scene],
      }));
      setSelectedSceneId(scene.id);
      setTimeout(() => scrollToScene(scene.id), 100);
    } catch (err) {
      console.error("添加场次失败:", err);
    }
  };

  const handleInsertScene = async (episodeId: number, atIndex: number) => {
    if (!script) return;
    const scenes = episodeScenes[episodeId] || [];
    const ep = episodes.find((e) => e.id === episodeId);
    const epNum = ep?.episodeNumber || 1;
    try {
      const scene = await scriptApi.createScene({
        episodeId,
        scriptId: script.id,
        sceneNumber: `${epNum}-${scenes.length + 1}`,
        sceneHeading: `新场次`,
        sortOrder: atIndex,
      });
      // 将新场次插入本地数组指定位置
      const newScenes = [...scenes];
      newScenes.splice(atIndex, 0, scene);
      // 更新后续场次的 sortOrder
      const updated = newScenes.map((s, idx) => ({ ...s, sortOrder: idx }));
      setEpisodeScenes((prev) => ({ ...prev, [episodeId]: updated }));
      setSelectedSceneId(scene.id);
      setTimeout(() => scrollToScene(scene.id), 100);
      // 批量持久化 sortOrder
      await Promise.all(
        updated
          .filter((s) => s.id !== scene.id)
          .map((s) => scriptApi.updateScene({ id: s.id, sortOrder: s.sortOrder }))
      );
    } catch (err) {
      console.error("插入场次失败:", err);
    }
  };

  const handleDeleteScene = async (sceneId: number, episodeId: number) => {
    if (!confirm("确定要删除该场次吗？")) return;
    try {
      await scriptApi.deleteScene(sceneId);
      setEpisodeScenes((prev) => ({
        ...prev,
        [episodeId]: (prev[episodeId] || []).filter((s) => s.id !== sceneId),
      }));
      if (selectedSceneId === sceneId) {
        setSelectedSceneId(null);
      }
    } catch (err) {
      console.error("删除场次失败:", err);
    }
  };

  const handleSceneUpdated = (episodeId: number, updated: SceneItem) => {
    setEpisodeScenes((prev) => ({
      ...prev,
      [episodeId]: (prev[episodeId] || []).map((s) =>
        s.id === updated.id ? updated : s
      ),
    }));
  };

  const handleReorderScenes = async (episodeId: number, oldIndex: number, newIndex: number) => {
    // 乐观更新 UI
    const prevScenes = episodeScenes[episodeId] || [];
    const scenes = [...prevScenes];
    const [moved] = scenes.splice(oldIndex, 1);
    scenes.splice(newIndex, 0, moved);
    setEpisodeScenes((prev) => ({ ...prev, [episodeId]: scenes }));

    // 持久化到后端：为每个场次更新 sortOrder
    try {
      await Promise.all(
        scenes.map((scene, idx) =>
          scriptApi.updateScene({ id: scene.id, sortOrder: idx })
        )
      );
    } catch (err) {
      console.error("排序保存失败，已回滚:", err);
      // 回滚
      setEpisodeScenes((prev) => ({ ...prev, [episodeId]: prevScenes }));
    }
  };

  // ========== 分集 AI 解析 ==========

  const handleOpenEpisodeParse = (episodeId: number) => {
    setEpisodeToParseId(episodeId);
    setShowEpisodeParseDialog(true);
  };

  const handleEpisodeParse = async (rawContent: string) => {
    if (!script || !episodeToParseId) return;
    const ep = episodes.find((e) => e.id === episodeToParseId);
    if (!ep) return;

    try {
      // 1. 先保存原文到分集记录
      await scriptApi.updateEpisode({ id: episodeToParseId, rawContent });

      // 2. 启动 script_episode_parse Pipeline
      const pipelineId = addPipeline({
        label: `AI 解析 · 第 ${ep.episodeNumber} 集`,
        projectId,
        request: {
          agentType: "script_episode_parse",
          category: "pipeline",
          title: `AI 解析 · 第 ${ep.episodeNumber} 集`,
          projectId,
          context: { episodeId: episodeToParseId, scriptId: script.id },
        },
        onComplete: () => {
          // Pipeline 完成后重新加载该集场次
          reloadEpisodeScenes(episodeToParseId);
        },
      });

      // 3. 打开任务面板
      setPanelExpanded(true);
      setExpandedTaskId(pipelineId);
    } catch (err) {
      console.error("启动分集解析失败:", err);
    }
  };

  /** 重新加载指定分集的场次（强制刷新忽略缓存） */
  const reloadEpisodeScenes = async (episodeId: number) => {
    setLoadingEpisodes((prev) => new Set(prev).add(episodeId));
    try {
      const scenes = await scriptApi.listScenes(episodeId);
      setEpisodeScenes((prev) => ({ ...prev, [episodeId]: scenes }));
    } catch (err) {
      console.error("重新加载场次失败:", err);
    } finally {
      setLoadingEpisodes((prev) => {
        const s = new Set(prev);
        s.delete(episodeId);
        return s;
      });
    }
  };

  // ========== 派生数据 ==========

  const selectedScene = selectedSceneId
    ? Object.values(episodeScenes)
        .flat()
        .find((s) => s.id === selectedSceneId) || null
    : null;

  const activeEpisode = episodes.find((ep) => ep.id === activeEpisodeId);
  const activeScenes = activeEpisodeId
    ? episodeScenes[activeEpisodeId] || []
    : [];
  const isActiveLoading = activeEpisodeId
    ? loadingEpisodes.has(activeEpisodeId)
    : false;

  // ========== 滚动监听：IntersectionObserver ==========
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || activeScenes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isUserScrollRef.current) return;
        // 找到最靠近顶部且可见的场次
        let topEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
              topEntry = entry;
            }
          }
        }
        if (topEntry) {
          const id = Number((topEntry.target as HTMLElement).dataset.sceneId);
          if (id) setSelectedSceneId(id);
        }
      },
      {
        root: container,
        rootMargin: "-10% 0px -70% 0px",
        threshold: 0,
      }
    );

    // 延迟一点绑定，确保 DOM 已经渲染完毕
    const timer = setTimeout(() => {
      const elements = container.querySelectorAll("[data-scene-id]");
      elements.forEach((el) => observer.observe(el));
    }, 100);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [activeScenes]);

  // ========== 渲染 ==========

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!script) {
    return (
      <>
        {/* 小说章节数据状态展示 */}
        {novelData && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 p-3 rounded-xl bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20"
          >
            <button
              onClick={() => setShowNovelInfo(!showNovelInfo)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-purple-400" />
                <span className="text-sm font-medium text-purple-300">
                  数据源小说：{novelData.title}
                </span>
                {novelData.chapters && novelData.chapters.length > 0 ? (
                  <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 text-xs">
                    已导入 {novelData.chapters.length} 章
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs">
                    暂无章节内容
                  </span>
                )}
              </div>
              {showNovelInfo ? (
                <ChevronUp className="h-4 w-4 text-purple-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-purple-400" />
              )}
            </button>
            {showNovelInfo && novelData.chapters && novelData.chapters.length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto space-y-1 pr-1">
                {novelData.chapters.map((ch, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs py-0.5">
                    <span className="text-purple-400 shrink-0 w-14">第{idx + 1}章</span>
                    <span className="text-foreground/80 truncate flex-1 font-medium">
                      {ch.title || '无标题'}
                    </span>
                    {ch.content && (
                      <span className="text-muted-foreground text-[10px] shrink-0">
                        {String(ch.content).length}字
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
        
        <EmptyState
          projectId={projectId}
          projectName={project?.name}
          showCreateDialog={showCreateDialog}
          onShowCreateDialog={setShowCreateDialog}
          onCreated={loadScript}
          onParseScript={() => setShowParseDialog(true)}
          onStartPipeline={() => setShowPipelineDialog(true)}
        />
        <ParseScriptDialog
          open={showParseDialog}
          projectId={projectId}
          projectName={project?.name}
          onClose={() => setShowParseDialog(false)}
          onCreated={handleAiScriptCreated}
        />
        <ScriptPipelineDialog
          open={showPipelineDialog}
          novelId={getNovelIdFromProject() || String(projectId)}
          novelTitle={project?.name}
          novelData={novelData}
          onClose={() => setShowPipelineDialog(false)}
          onComplete={() => {
            setShowPipelineDialog(false);
            loadScript();
          }}
        />
      </>
    );
  }

  return (
    <motion.div
      variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }}
      initial="hidden"
      animate="visible"
      className="flex h-full rounded-xl border border-border/20 overflow-hidden bg-card/10"
    >
      {/* 左栏：树形导航 */}
      <motion.div variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } } }} className="shrink-0 hidden xl:block">
      <EpisodeTree
        episodes={episodes}
        expandedEpisodes={expandedEpisodes}
        activeEpisodeId={activeEpisodeId}
        selectedSceneId={selectedSceneId}
        loadingEpisodes={loadingEpisodes}
        episodeScenes={episodeScenes}
        onToggleEpisode={toggleEpisode}
        onSelectEpisode={selectEpisode}
        onSelectScene={handleSelectScene}
        onAddEpisode={handleAddEpisode}
        onDeleteEpisode={handleDeleteEpisode}
        onAddScene={handleAddScene}
        onDeleteScene={handleDeleteScene}
        onReorderScenes={handleReorderScenes}
        onParseEpisode={handleOpenEpisodeParse}
      />
      </motion.div>

      {/* 中栏：场次卡片列表 */}
      <motion.div variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } } }} className="flex-1 flex flex-col min-w-0">
        <div className="2xl:hidden px-4 py-3 border-b border-border/20 flex items-center justify-between shrink-0 bg-card/30 backdrop-blur-sm">
          <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
            <SheetTrigger
              render={
                <button className="xl:hidden p-1.5 -ml-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors">
                  <Menu className="h-5 w-5" />
                </button>
              }
            />
            <SheetContent side="left" className="w-[300px] p-0 border-r-0 flex flex-col pt-12">
              <EpisodeTree
                episodes={episodes}
                expandedEpisodes={expandedEpisodes}
                activeEpisodeId={activeEpisodeId}
                selectedSceneId={selectedSceneId}
                loadingEpisodes={loadingEpisodes}
                episodeScenes={episodeScenes}
                onToggleEpisode={toggleEpisode}
                onSelectEpisode={selectEpisode}
                onSelectScene={handleSelectScene}
                onAddEpisode={handleAddEpisode}
                onDeleteEpisode={handleDeleteEpisode}
                onAddScene={handleAddScene}
                onDeleteScene={handleDeleteScene}
                onReorderScenes={handleReorderScenes}
              />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPipelineDialog(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
            >
              <Workflow className="h-3.5 w-3.5" />
              AI 流水线
            </button>
          </div>
          <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
            <SheetTrigger
              render={
                <button className="p-1.5 -mr-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors">
                  <Info className="h-5 w-5" />
                </button>
              }
            />
            <SheetContent side="right" className="w-[300px] p-0 border-l-0 flex flex-col pt-12 overflow-y-auto">
              {selectedScene ? (
                <SceneDetail scene={selectedScene} projectId={projectId} />
              ) : (
                <ScriptOverview script={script} episodes={episodes} />
              )}
            </SheetContent>
          </Sheet>
        </div>
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          <SceneList
            activeEpisode={activeEpisode}
            activeScenes={activeScenes}
            isLoading={isActiveLoading}
            selectedSceneId={selectedSceneId}
            onSelectScene={setSelectedSceneId}
            onSceneUpdated={handleSceneUpdated}
            onAddScene={handleAddScene}
            onInsertScene={handleInsertScene}
            onDeleteScene={handleDeleteScene}
            onEpisodeUpdated={(updated) => {
              setEpisodes((prev) =>
                prev.map((ep) => (ep.id === updated.id ? updated : ep))
              );
            }}
          />
        </div>
      </motion.div>

      {/* 右栏：场景详情 / 剧本概览 */}
      <motion.div variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] } } }} className="w-72 border-l border-border/20 flex-col shrink-0 bg-card/20 overflow-y-auto hidden 2xl:flex">
        {selectedScene ? (
          <SceneDetail scene={selectedScene} projectId={projectId} />
        ) : (
          <ScriptOverview script={script} episodes={episodes} />
        )}
      </motion.div>

      {/* 分集解析弹窗 */}
      <EpisodeParseDialog
        open={showEpisodeParseDialog}
        episode={episodes.find((e) => e.id === episodeToParseId) ?? null}
        hasExistingScenes={(episodeToParseId && (episodeScenes[episodeToParseId]?.length ?? 0) > 0) || false}
        existingSceneCount={episodeToParseId ? (episodeScenes[episodeToParseId]?.length ?? 0) : 0}
        onClose={() => setShowEpisodeParseDialog(false)}
        onStartParse={handleEpisodeParse}
      />
      <ScriptPipelineDialog
        open={showPipelineDialog}
        novelId={getNovelIdFromProject() || String(projectId)}
        novelTitle={project?.name}
        novelData={novelData}
        onClose={() => setShowPipelineDialog(false)}
        onComplete={() => {
          setShowPipelineDialog(false);
          loadScript();
        }}
      />
    </motion.div>
  );
}
