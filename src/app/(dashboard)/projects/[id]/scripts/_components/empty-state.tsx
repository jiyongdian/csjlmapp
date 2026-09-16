"use client";

import { BookOpen, Plus, Sparkles, Workflow } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CreateScriptDialog } from "@/components/dashboard/create-script-dialog";

export function EmptyState({
  projectId,
  projectName,
  showCreateDialog,
  onShowCreateDialog,
  onCreated,
  onParseScript,
  onStartPipeline,
}: {
  projectId: number;
  projectName?: string;
  showCreateDialog: boolean;
  onShowCreateDialog: (show: boolean) => void;
  onCreated: () => void;
  onParseScript: () => void;
  onStartPipeline?: () => void;
}) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col items-center justify-center py-20"
      >
        <div className="h-20 w-20 rounded-2xl bg-linear-to-br from-purple-500/10 via-pink-500/10 to-orange-500/10 flex items-center justify-center mb-6 border border-purple-500/10">
          <BookOpen className="h-10 w-10 text-purple-400/60" />
        </div>
        <h2 className="text-xl font-semibold mb-2">还没有剧本</h2>
        <p className="text-muted-foreground text-sm mb-6 max-w-md text-center">
          选择手动创建、AI 解析现有剧本，或使用三阶段流水线从头生成完整短剧
        </p>
        <div className="flex flex-wrap items-center gap-3 justify-center">
          <button
            onClick={() => onShowCreateDialog(true)}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium",
              "bg-primary text-primary-foreground",
              "hover:opacity-90 hover:scale-[1.02]",
              "active:scale-[0.98] transition-all duration-200"
            )}
          >
            <Plus className="h-4 w-4" />
            手动创建
          </button>
          <button
            onClick={onParseScript}
            className={cn(
              "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium",
              "bg-linear-to-r from-blue-600 to-cyan-600",
              "text-white shadow-lg shadow-blue-500/20",
              "hover:shadow-blue-500/30 hover:scale-[1.02]",
              "active:scale-[0.98] transition-all duration-200"
            )}
          >
            <Sparkles className="h-4 w-4" />
            AI 解析剧本
          </button>
          {onStartPipeline && (
            <button
              onClick={onStartPipeline}
              className={cn(
                "flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium",
                "bg-linear-to-r from-purple-600 to-pink-600",
                "text-white shadow-lg shadow-purple-500/20",
                "hover:shadow-purple-500/30 hover:scale-[1.02]",
                "active:scale-[0.98] transition-all duration-200"
              )}
            >
              <Workflow className="h-4 w-4" />
              三阶段流水线
            </button>
          )}
        </div>
        {onStartPipeline && (
          <p className="text-xs text-muted-foreground mt-4 max-w-md text-center">
            三阶段流水线：故事骨架 → 改编策略 → 剧本编写，每个阶段均有独立审核
          </p>
        )}
      </motion.div>
      <CreateScriptDialog
        open={showCreateDialog}
        projectId={projectId}
        projectName={projectName}
        onClose={() => onShowCreateDialog(false)}
        onCreated={onCreated}
      />
    </>
  );
}
