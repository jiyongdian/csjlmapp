'use client';

import { useEffect, useRef } from 'react';

const CHINESE_CHARS = '创世纪联盟AI智能体小说生成主题创意结构分析章节内容风格设定人物情节悬疑科幻浪漫奇幻冒险历史武侠修仙都市玄幻灵感故事传说命运英雄诗篇梦想星辰大海文字力量想象未来永恒光芒希望勇气自由';

export default function MatrixRain({ transparent = false }: { transparent?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let columns: number;
    let drops: number[];
    let speeds: number[];
    let opacities: number[];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const fontSize = 18;
      columns = Math.floor(canvas.width / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -100);
      speeds = Array.from({ length: columns }, () => 0.3 + Math.random() * 0.7);
      opacities = Array.from({ length: columns }, () => 0.3 + Math.random() * 0.7);
    };

    resize();
    window.addEventListener('resize', resize);

    const fontSize = 18;
    const chars = CHINESE_CHARS.split('');

    const draw = () => {
      if (transparent) {
        // 透明模式：擦除旧像素，保留底层图片/视频
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.font = `${fontSize}px "Microsoft YaHei", "SimHei", monospace`;

      for (let i = 0; i < columns; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Head character - bright white/green
        if (y > 0 && y < canvas.height) {
          ctx.fillStyle = `rgba(180, 255, 180, ${opacities[i]})`;
          ctx.fillText(char, x, y);

          // Trail characters with fading green
          const trailLength = 5 + Math.floor(Math.random() * 3);
          for (let t = 1; t <= trailLength; t++) {
            const trailY = y - t * fontSize;
            if (trailY > 0) {
              const alpha = opacities[i] * (1 - t / (trailLength + 1)) * 0.6;
              const green = Math.floor(180 + (75 * (1 - t / trailLength)));
              ctx.fillStyle = `rgba(0, ${green}, 0, ${alpha})`;
              const trailChar = chars[Math.floor(Math.random() * chars.length)];
              ctx.fillText(trailChar, x, trailY);
            }
          }
        }

        drops[i] += speeds[i];

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = Math.random() * -20;
          speeds[i] = 0.3 + Math.random() * 0.7;
          opacities[i] = 0.3 + Math.random() * 0.7;
        }
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationId);
    };
  }, [transparent]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0"
      style={{ background: transparent ? 'transparent' : '#000' }}
    />
  );
}
