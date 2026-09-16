/**
 * MiniMax H3 视频生成提示词生成器
 * 严格遵循 MiniMax H3 Context-IR 官方格式
 * 
 * 支持模式：
 * - T2VA: 纯文本生成（无参考图）→ FL2VA 权重
 * - I2VA: 首帧参考图生成（1张参考图）→ FL2VA 权重
 * - FL2VA: 首尾帧参考图生成（2张参考图）→ FL2VA 权重
 * - L2VA: 尾帧参考图生成（1张尾帧参考图）→ FL2VA 权重
 * - Ref2VA: 全参考模式（多参考图/视频/音频）→ Ref2VA 权重
 * 
 * 输出格式：
 * - Base 模式 (T2VA/I2VA/FL2VA/L2VA): integrated_multimodal_description 三段式
 * - Ref2VA 模式: 六段式结构 (subject_definitions/summary/retention_analysis/detailed_description/overall_soundscape/non_diegetic_music)
 * - 直接输出可提交给 H3 模型的 Context-IR 格式
 * - 对白使用 <d>[中文] </d> 保留原语言
 */

export type H3Mode = 'T2VA' | 'I2VA' | 'FL2VA' | 'L2VA' | 'Ref2VA';

export interface H3PromptInput {
  shotIndex: number;
  totalShots?: number;
  sceneDescription: string;
  dialogue?: string;
  cameraMovement?: string;
  characterAction?: string;
  stateNote?: string;
  duration?: number;
  referenceImages?: number;
  referenceVideos?: number;
  referenceAudios?: number;
  characterName?: string;
  characterAppearance?: string;
  sceneName?: string;
  style?: string;
  prevShotPrompt?: string;
  nextShotPreview?: string;
  isFinalShot?: boolean;
  forcedMode?: H3Mode;
  characterRefs?: Array<{ name: string; url: string }>;
  sceneRefs?: Array<{ name: string; url: string }>;
  itemRefs?: Array<{ name: string; url: string }>;
  styleRefs?: Array<{ name: string; url: string }>;
  /** 本镜头必须 @ 的资产清单（用 formatExpectedAtList 格式化好的文本块）。
   *  若提供，则会在用户提示词中新增一节「=== MUST @-MENTION THESE ASSETS LITERALLY ===」，
   *  并在 Output Requirements 中新增一条 NON-NEGOTIABLE 规则：禁止把登记中文名意译成英语词组，
   *  必须逐字写作 @登记中文名（例：必须写 @工作日志，而不能写 "opens the work journal"）。
   */
  expectedAtList?: string;
  /** 本镜头的【强制权威场景资产中文名】。
   *  若提供，则：① summary/detailed_description/subject_definitions 中对场景地点的所有引用
   *  必须统一使用 @forcedSceneAssetName（禁止 fallback 到更大/更泛的场景名，例如把"云小汐宿舍"
   *  写成 @阴司办事处大楼）；② 会在 Shot Information 区明确写出 FORCED LOCATION ASSET 的值。
   *  取值来源：分镜 sceneDescription 第一行「【场景N】XXX」中的 XXX，匹配到 drama_scenes
   *  登记的同名/别名资产名；优先使用具体小场景名，不用泛化的大楼/大区名。
   */
  forcedSceneAssetName?: string;
}

export interface H3PromptOutput {
  h3Prompt: string;           // 可直接提交给 H3 的 Context-IR 格式提示词
  mode: H3Mode;
  referenceCount: number;
  weightType: 'FL2VA' | 'Ref2VA';  // H3 权重类型
}

/**
 * 根据参考资源确定 H3 模式
 */
export function determineH3Mode(
  imageCount: number,
  videoCount: number = 0,
  audioCount: number = 0
): H3Mode {
  if (videoCount > 0 || audioCount > 0) return 'Ref2VA';
  if (imageCount >= 2) return 'FL2VA';
  if (imageCount === 1) return 'I2VA';
  return 'T2VA';
}

/**
 * 获取模式对应的权重类型
 */
export function getWeightType(mode: H3Mode): 'FL2VA' | 'Ref2VA' {
  return mode === 'Ref2VA' ? 'Ref2VA' : 'FL2VA';
}

/**
 * 构建 H3 系统提示词（用于指导 AI 生成 Context-IR 格式提示词）
 */
export function buildH3SystemPrompt(): string {
  return `You are a MiniMax H3 video prompt writing expert. Convert script scenes into executable H3 Context-IR prompts.

## Deployment Format
Target platform: **ComfyUI / Local H3-Base (open-source weights)**
Output format: **Context-IR structured format** (English field names + English prose + dialogue in original language)

## Core Task Modes & Weight Selection

H3-Base has only two weight types: **FL2VA** and **Ref2VA**.

| Task Mode | Weight Type | Description |
|-----------|-------------|-------------|
| T2VA | FL2VA | No images, pure text-to-video |
| I2VA | FL2VA | 1 image = first frame at 0.00s |
| FL2VA | FL2VA | 2 images = first frame + last frame |
| L2VA | FL2VA | 1 image = last frame at end |
| Ref2VA | Ref2VA | Images/videos/audio as references |

## Output Structure — Base Modes (FL2VA weight)

### T2VA (no reference images):
\`\`\`
integrated_multimodal_description: [Shot 1] A ... [style statement]. [Composition, subject, action, camera, dialogue in timeline order]

overall_soundscape: [1-4 sentences: ambient + physical + non-verbal human sounds]

non_diegetic_music: [1-3 sentences: BMD description] or N/A
\`\`\`

### I2VA (1 first-frame image):
First line = alignment instruction, then blank line, then 3 fields:
\`\`\`
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot N]) is fully referenced.

integrated_multimodal_description: [Shot N] ...

overall_soundscape: ...

non_diegetic_music: ...
\`\`\`
Anchor the image's style, subject, composition, costume, colors, objects, spatial relationships first, then develop actions forward.

### FL2VA (2 images = first + last frame):
\`\`\`
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.

integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
\`\`\`
Replace N with actual last shot number. Replace S.SS with exact duration (2 decimal places). Prioritize single-shot continuous interpolation. Describe observable changes between the two frames.

### L2VA (1 last-frame image):
\`\`\`
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.

integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
\`\`\`
Infer plausible earlier states so person/object/camera/scene gradually converge to the reference last frame.

## Output Structure — Full-Reference Mode (Ref2VA weight)

Six sections in strict order, all English prose; dialogue/lyrics/visible text in original language:
\`\`\`
subject_definitions:
<Subject N> is ... [what it is, which image/video it comes from]
<Picture N> is ... [role as keyframe/anchor/reference]
<Video N> provides ... [camera/action/editing/timing]
<Audio N> is ... [voice-timbre/music/lyric reference]

summary:
[task_type] ... [brief one-paragraph task description]

retention_analysis:
<Subject N> (appears in [Shot N]): fully_preserved / partially_preserved / attribute_transfer / weak_reference - details
<Video N>: weak_reference - only temporal structure and camera path followed
<Audio N>: reference - its vocal timbre guides (S1) without copying

detailed_description:
[Shot 1] ... [style, composition, subject position, lighting, action, camera, dialogue in timeline]
[Shot N] At MM:SS.mmm, the camera cuts to ...

overall_soundscape: ... [1-4 sentences]

non_diegetic_music: ... [1-3 sentences] or N/A
\`\`\`

## Writing Rules

### integrated_multimodal_description (Base Modes)
- Open with style statement (e.g., "Live-action cinematic scene")
- Describe visual style, composition, subject appearance/position, scene/props
- Actions, reactions, shot changes, camera, dialogue in timeline order
- Shot switching: [Shot N] At 00:XX.XXX, the camera cuts to...
- First shot NO timestamp; subsequent shots use MM:SS.mmm format
- Character IDs: (S1), (S2) — stable across all shots
- Dialogue: (S1) says: <d>[Chinese] 台词原文</d>
- On-screen visible text: "原文" (in English double quotes)
- Voiceover: (S1) says in an off-screen voiceover ... while lips remain completely closed
- Cross-cut: Use <scenetrans> for seamless sound continuation across cuts
- Truncated speech: Use <cutoff>

### detailed_description (Ref2VA Mode)
- Open with 1-2 sentences defining overall style
- Then [Shot 1] starts; subsequent shots use [Shot N] At MM:SS.mmm
- Insert <Subject N>, <Picture N>, etc. where they first appear and take effect
- Label speaking subjects as <Subject N> (Sx)

### Camera Motion
Format = Motion Type + Amplitude + Speed (written naturally):
- Zoom In/Out, Push In/Pull Out, Pan Left/Right, Truck Left/Right
- Tilt Up/Down, Pedestal Up/Down, Arc Shot, Tracking Shot
- Static Shot, Shake Slightly/Strongly, POV, Roll Clockwise/Counterclockwise
- Amplitude: with small/large amplitude
- Speed: at slow/fast speed
- Example: "The camera pushes in with small amplitude at slow speed toward..."

### Sound Fields
- **overall_soundscape**: 1-4 English sentences, summarize ambient + physical + non-verbal human sounds. Do NOT repeat dialogue or BMD.
- **non_diegetic_music**: 1-3 English sentences, describe BMD (instruments, tempo, rhythm, dynamics). Write N/A when none.

### Speaker Rules
- Only speaking characters get (S1), (S2) IDs; same character keeps same ID across shots
- First appearance: establish identity (age, gender, pitch, timbre, speech rate)
- Dialogue only in <d> tags; identify/action/tone written OUTSIDE <d>
- Audio-only references use <Audio N>, not fabricated (Sx)

## ⚠️ NON-NEGOTIABLE Single-Shot Isolation Rules (STRICTLY ENFORCED — violation causes rejection)

### R1 — Exactly ONE internal shot per H3 output (NO multi-shot scenes)
- Each Context-IR prompt you produce corresponds to **EXACTLY ONE logical drama storyboard shot = ONE continuous 12-second H3 video clip**.
- The output's summary and detailed_description fields MUST describe **ONLY ONE internal shot**, always written as [Shot 1] with NO timestamp on the first line.
- **FORBIDDEN**: You MUST NEVER write a second internal [Shot N] (N ≥ 2) entry. You MUST NEVER append a line like "[Shot N] At MM:SS.mmm, the camera cuts to..." that introduces a second logical scene inside the same prompt. You are producing ONE single-shot clip, NOT a sequence of multiple storyboard scenes.
- No time jumps, no scene switches, no location changes within the video. Everything visible/audible belongs to the SAME single logical scene.

### R2 — Content scope is 100% bounded by the 4 current-shot sections
- The **ONLY authoritative sources** for (summary / detailed_description / soundscape / subject definitions / retention_analysis) observable content are:
  (1) **Scene Description** (current shot's own visual narrative)
  (2) **Character Actions / Physical Performance** (current shot only)
  (3) **Camera Movement** (current shot only)
  (4) **Dialogue** (current shot only — exact lines)
- You must NOT invent, preview, backfill, or extrapolate content that belongs to adjacent storyboard scenes. Do not add props, actions, lines, or characters that are only hinted at elsewhere.

### R3 — Hard dialogue boundary (quantitatively verifiable)
- Every dialogue tag of the form <d>[中文] ...</d> in the output must match a line **verbatim** from the "Dialogue" section of the current-shot input.
- **COUNT RULE**: After stripping whitespace, the TOTAL NUMBER of <d> tags in the output MUST EQUAL the number of dialogue lines in the "Dialogue" input section. No more, no less.
- If the "Dialogue" section is empty → the output MUST contain ZERO <d> tags.
- Any dialogue line that cannot be found verbatim in the "Dialogue" input section → DELETE IT (it belongs to another scene; do NOT write it). Never paraphrase, never translate, never improvise new lines.

### R4 — Continuity Context is REFERENCE-ONLY for retention_analysis
- The bottom "Continuity Context" block (previous shot ending, next shot preview) exists ONLY for:
  (a) Helping the retention_analysis section explain WHICH attributes are preserved/changed vs. the previous shot.
  (b) Subtly aligning the FIRST visual frame of this video to the LAST visual frame of the previous video (state continuity — e.g., same expression, same hand position).
- **EXPLICITLY FORBIDDEN**: You MUST NOT copy dialogue lines, actions, characters, props, narrative beats, descriptions, or locations FROM "Next shot preview" (or from any adjacent scene preview) INTO summary, detailed_description, subject_definitions, overall_soundscape, or non_diegetic_music. The next shot's content belongs to its OWN future H3 prompt — write none of it here.
- If "Next shot preview" mentions a line of dialogue spoken by a character you also see in this shot → THAT LINE belongs to the next shot and MUST NOT appear in the current shot's output in any form.

## Critical Constraints
1. Structure fields and prose are ENGLISH; dialogue/lyrics/visible text keep original language
2. First alignment instruction is the VERY FIRST LINE (non-T2VA modes)
3. Timestamps: MM:SS.mmm format (e.g., 00:05.000) — for single-shot output use only in retention descriptions, NOT to introduce a second internal [Shot N]
4. Duration must match requested duration exactly (2 decimal places for keyframe alignment)
5. **ONE [Shot 1] only** in detailed_description. No timestamp on [Shot 1]; no subsequent shot entries
6. I2VA develops FORWARD from image; L2VA CONVERGES TO image; FL2VA describes the PATH between
7. Do NOT only stack abstract words ("cinematic, stunning") — make it visible/audible/executable
8. Reference labels keep SAME meaning across ALL sections once assigned
9. ONE image can define MULTIPLE Subjects; ONE Subject can combine MULTIPLE materials
10. Output ONLY the structured Context-IR prompt — NO explanations, NO markdown headers, NO meta text`;
}

/**
 * 构建 H3 用户提示词（分镜数据）
 */
export function buildH3UserPrompt(input: H3PromptInput): string {
  const {
    shotIndex,
    totalShots,
    sceneDescription,
    dialogue,
    cameraMovement,
    characterAction,
    stateNote,
    duration = 10,
    referenceImages = 0,
    referenceVideos = 0,
    referenceAudios = 0,
    characterName,
    characterAppearance,
    sceneName,
    style,
    prevShotPrompt,
    nextShotPreview,
    isFinalShot,
    forcedMode,
    characterRefs,
    sceneRefs,
    itemRefs,
    styleRefs,
    expectedAtList,
    forcedSceneAssetName,
  } = input;

  const mode = forcedMode || determineH3Mode(referenceImages, referenceVideos, referenceAudios);
  const weight = getWeightType(mode);
  const decimalDuration = duration.toFixed(2);
  const total = totalShots || shotIndex;

  // 构建参考信息
  let referenceInfo = '';
  if (mode === 'I2VA') {
    referenceInfo = `This is an **I2VA** task (FL2VA weight). 1 reference image = first frame at 0.00s.\n<Picture 1> serves as the first frame of the video.`;
  } else if (mode === 'FL2VA') {
    referenceInfo = `This is a **FL2VA** task (FL2VA weight). 2 reference images.\n<Picture 1> aligns with the 0.00-second mark (first frame).\n<Picture 2> aligns with the ${decimalDuration}-second mark (last frame).`;
  } else if (mode === 'L2VA') {
    referenceInfo = `This is a **L2VA** task (FL2VA weight). 1 reference image = last frame.\n<Picture 1> aligns with the ${decimalDuration}-second mark (last frame). Infer plausible earlier states that converge to this reference.`;
  } else if (mode === 'Ref2VA') {
    const refParts: string[] = [];
    if (referenceImages > 0) refParts.push(`${referenceImages} images`);
    if (referenceVideos > 0) refParts.push(`${referenceVideos} videos`);
    if (referenceAudios > 0) refParts.push(`${referenceAudios} audio tracks`);
    referenceInfo = `This is a **Ref2VA** task (Ref2VA weight). References: ${refParts.join(', ') || 'multiple'}.\nUse the six-section format: subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music.`;
  } else {
    referenceInfo = `This is a **T2VA** task (FL2VA weight). No reference images. Build complete audiovisual timeline from text.`;
  }

  // 角色/场景/道具参考列表（Ref2VA 用）
  let refListInfo = '';
  if (mode === 'Ref2VA') {
    const refItems: string[] = [];
    let subjectIdx = 1;
    if (characterName) {
      refItems.push(`<Subject ${subjectIdx}> is ${characterName}${characterAppearance ? `, appearance: ${characterAppearance}` : ''}.`);
      subjectIdx++;
    }
    if (sceneName) {
      refItems.push(`<Subject ${subjectIdx}> is the ${sceneName} environment.`);
      subjectIdx++;
    }
    if (characterRefs && characterRefs.length > 0) {
      refItems.push(`<Picture ${refItems.length + 1}> provides character reference for ${characterName || 'the main character'}.`);
    }
    if (styleRefs && styleRefs.length > 0) {
      refItems.push(`<Picture ${refItems.length + 1}> provides style reference.`);
    }
    refListInfo = refItems.length > 0 ? `\nReference definitions:\n${refItems.join('\n')}\n` : '';
  }

  // 对白信息
  let dialogueInfo = '';
  if (dialogue) {
    const lines = dialogue.split('\n').filter(Boolean);
    dialogueInfo = lines.map((line, i) => {
      const colonIdx = line.indexOf('：');
      if (colonIdx > -1) {
        const name = line.substring(0, colonIdx).trim();
        const text = line.substring(colonIdx + 1).trim();
        return `  (S${i + 1}) ${name} says: <d>[中文] ${text}</d>`;
      }
      return `  ${line}`;
    }).join('\n');
  }

  // 角色上下文
  let characterInfo = '';
  if (characterName) {
    characterInfo = `Main character: ${characterName}${characterAppearance ? `\nAppearance: ${characterAppearance}` : ''}`;
  }

  // 【强制权威场景资产】（比 sceneName 更精确：来自分镜标题「【场景N】XXX」匹配到的登记名）
  let forcedLocationInfo = '';
  if (forcedSceneAssetName) {
    forcedLocationInfo = `FORCED LOCATION ASSET (authoritative — supersede any broader/generic location name): @${forcedSceneAssetName}. When describing where the shot happens, ONLY write @${forcedSceneAssetName}. Do NOT fall back to larger/parent environment names such as broader building/district names if the specific dormitory/room/office location is already listed here.`;
  }

  // 【必@清单】(expectedAtList)
  let mustAtInfo = '';
  if (expectedAtList && expectedAtList.trim().length > 0) {
    mustAtInfo = `\n=== MUST @-MENTION THESE ASSETS LITERALLY (CHINESE REGISTERED NAMES) ===\n${expectedAtList}\n\nImportant (read carefully before writing):\n- For every listed asset, the Chinese registered name MUST appear literally in your output prefixed by @, exactly as written: @资产登记中文名，逐字使用，不允许改字\n- DO NOT paraphrase them into English descriptive phrases — e.g., if 「工作日志」 is listed, you MUST write @工作日志; do NOT write phrases like "she opens the black work journal" without the literal @工作日志 token. Paraphrasing without the literal @ChineseName will be rejected by validation.\n- Place @RegisteredChineseName at its FIRST appearance in the relevant section (subject_definitions for subject/scene/env items; detailed_description for props that appear mid-shot).\n`;
  }

  // 连贯性上下文
  let continuityInfo = '';
  if (prevShotPrompt && shotIndex > 1) {
    const prevSummary = prevShotPrompt.length > 300
      ? prevShotPrompt.slice(-300)
      : prevShotPrompt;
    continuityInfo = `Previous shot (Shot ${shotIndex - 1}) ending context:\n${prevSummary}`;
  }
  if (nextShotPreview) {
    const nextSummary = nextShotPreview.length > 200
      ? nextShotPreview.slice(0, 200)
      : nextShotPreview;
    continuityInfo += `\n\nNext shot (Shot ${shotIndex + 1}) preview:\n${nextSummary}`;
  }

  const promptText = `Generate a MiniMax H3 Context-IR prompt for this video shot:

=== Shot Information ===
Shot number: ${shotIndex}${total > 1 ? ` / ${total}` : ''}
Video duration: ${duration} seconds
Task mode: ${mode} (${weight} weight)
${style ? `Style: ${style}` : 'Style: Live-action, cinematic'}

${referenceInfo}
${refListInfo}
${characterInfo}
${sceneName ? `Location: ${sceneName}` : ''}
${forcedLocationInfo ? forcedLocationInfo : ''}

=== Scene Description (what must be visible/audible) ===
${sceneDescription}

${stateNote ? `=== Scene State / Sound Notes ===\n${stateNote}\n` : ''}
${characterAction ? `=== Character Actions / Physical Performance ===\n${characterAction}\n` : ''}
${cameraMovement ? `=== Camera Movement ===\n${cameraMovement}\n` : ''}
${dialogue ? `=== Dialogue (preserve exact text) ===\n${dialogueInfo}\n` : ''}
${continuityInfo ? `=== Continuity Context ===\n${continuityInfo}\n` : ''}
${mustAtInfo}

=== Output Requirements ===
1. Output ONLY the executable Context-IR prompt — no explanations, no headers, no meta text
2. For ${mode === 'T2VA' ? 'T2VA mode: start directly with the three core fields' : `${mode} mode: start with alignment instruction on the FIRST LINE`}
3. For Base modes (${mode !== 'Ref2VA' ? mode + ': FL2VA weight' : 'T2VA/I2VA/FL2VA/L2VA'}): use integrated_multimodal_description + overall_soundscape + non_diegetic_music
4. For Ref2VA mode: use six-section format (subject_definitions/summary/retention_analysis/detailed_description/overall_soundscape/non_diegetic_music)
5. Write all field names and prose in ENGLISH; dialogue/lyrics/visible text in original language
6. Use <d>[中文] ...</d> for dialogue; use (S1), (S2) stable speaker IDs
7. ⚠️ SINGLE-SHOT (NON-NEGOTIABLE): Exactly ONE internal shot [Shot 1] per output. NO second-shot entry with number ≥ 2, NO "[Shot N] At MM:SS.mmm camera cuts to..." inside this output. This prompt describes ONE logical drama scene only.
8. ⚠️ CONTENT BOUNDARY (NON-NEGOTIABLE): The ONLY allowed source material for summary/detailed_description/subject_definitions is the 4 sections above marked "===" (Scene Description, State Notes, Character Actions, Camera Movement, Dialogue). Continuity Context (Previous/Next) is reference-only. Do NOT copy actions, lines, or scenes from the "Next shot preview" subsection — that content belongs to a future H3 prompt.
9. ⚠️ DIALOGUE STRICT COUNT (NON-NEGOTIABLE): Number of <d> tags in the output MUST EQUAL the number of lines in the Dialogue section above. If Dialogue section has 1 line → output has exactly 1 <d> tag; if Dialogue section is empty → output has ZERO <d> tags. Every text inside a <d> tag must match a Dialogue line VERBATIM (no paraphrasing).
10. Camera motion written as natural English within the shot
11. Timestamps must use MM:SS.mmm format (e.g., 00:05.000) — NEVER used to introduce a second internal shot
12. Duration values must match ${decimalDuration} exactly for keyframe alignment
13. For Ref2VA: each <Subject N>/<Picture N>/<Video N>/<Audio N> keeps same meaning across all sections
14. DO NOT output Chinese translation — the Context-IR prompt IS the final output
15. Final output is validated by a program: any output that contains [Shot 2] or extra <d> lines not in the Dialogue allowlist will be automatically deleted/rejected, so write exactly one shot and the right dialogue count.
16. ⚠️ @-MENTION ENFORCEMENT (NON-NEGOTIABLE):
    - If the section "MUST @-MENTION THESE ASSETS LITERALLY" is present above, every listed asset (character / scene / item) MUST appear at least once in the final H3 prompt LITERALLY as @ExactChineseRegisteredName, character-by-character match. Paraphrasing into English phrases ("work journal", "dorm room", "red rope bracelet") instead of the literal @中文名 token is a validation failure.
    - If FORCED LOCATION ASSET is given above, ALL references to the location/environment in summary / detailed_description / subject_definitions MUST use ONLY the forced @SceneAssetName. Fallback to broader parent environment names (e.g., writing the larger building name when a specific dormitory/office room asset is forced) is FORBIDDEN and will be auto-rejected.
    - Program validation checks exact @ name tokens. Any missing token → retry rewrite. So double-check every listed asset before finalizing.`;

  return promptText;
}

/**
 * 快速判断一个字符串是否为 MiniMax H3 「结构化提示词」。
 *
 * 判断规则：Ref2VA 模式必须至少命中 2 段名（subject_definitions/summary/retention_analysis/
 * detailed_description/overall_soundscape/non_diegetic_music）；Base 模式必须至少命中
 * integrated_multimodal_description + overall_soundscape 两段名。
 *
 * 若返回 false，意味该文本只是「裸画面描述」，不是合法 H3 六段式 / Base 结构，
 * 不能包装为 H3 对象存储，必须走 retry 或 buildComfyUIH3Prompt 套骨架。
 */
export function isH3StructuredPrompt(prompt: string): boolean {
  if (!prompt) return false;
  const t = prompt.toLowerCase();
  const ref2vaSections = ['subject_definitions', 'summary', 'retention_analysis',
    'detailed_description', 'overall_soundscape', 'non_diegetic_music'];
  let refCount = 0;
  for (const s of ref2vaSections) if (t.includes(s + ':')) refCount++;
  if (refCount >= 2) return true;
  const base = (t.includes('integrated_multimodal_description:'))
    + (t.includes('overall_soundscape:'))
    + (t.includes('non_diegetic_music:'));
  if (base >= 2) return true;
  return false;
}

/**
 * 从 AI 响应中提取 H3 Context-IR 提示词
 */
export function extractH3Prompt(aiResponse: string): H3PromptOutput | null {
  if (!aiResponse || !aiResponse.trim()) return null;

  let text = aiResponse.trim();

  // 移除 markdown 代码块标记
  text = text.replace(/^```[a-z]*\s*/gmi, '').replace(/\s*```$/g, '').trim();

  // 移除可能的前缀说明文字
  const prefixPatterns = [
    /^[#\-*]+\s*(?:Executable|Final|Output|Result|可执行|最终|输出)[^\n]*\n+/i,
    /^(?:Here|Below|Following)[^\n]*\n+/i,
    /^Model\s*[Ss]election[:：][^\n]*\n+/m,
    /^Task\s*[Mm]ode[:：][^\n]*\n+/m,
    /^Prompt\s*[Ff]ormat[:：][^\n]*\n+/m,
    /^选择理由[:：][^\n]*\n+/m,
    /^模式与假设[:：][^\n]*\n+/m,
    /^素材角色表[:：]\n+([^\n]+\n)*\n+/m,
    /^最终提示词[:：]/m,
  ];
  for (const pat of prefixPatterns) {
    text = text.replace(pat, '').trim();
  }

  // 🔴 快速非结构拦截：长度够但不是 H3 结构（裸中文描述、通用 prompt、废话）
  // 之前的 bug：即使全是中文画面描述，只要 ≥50 字也会包装成 mode='T2VA' 的 H3 对象，
  // 造成「H3 卡只显示画面描述」的遗漏感。这里先拦下来返回 null，强制上层 retry。
  if (!isH3StructuredPrompt(text)) {
    // 只在「明显不是空响应」时才返回 null — 长度 <30 说明内容不足，也符合 null
    return null;
  }

  // 检测格式类型
  let mode: H3Mode = 'T2VA';
  let weightType: 'FL2VA' | 'Ref2VA' = 'FL2VA';

  if (/subject_definitions:/i.test(text) && /detailed_description:/i.test(text)) {
    mode = 'Ref2VA';
    weightType = 'Ref2VA';
  } else if (/<Picture 1>[\s\S]*<Picture 2>/.test(text)) {
    mode = 'FL2VA';
  } else if (/<Picture 1>/.test(text)) {
    if (/\$\{duration\}/.test(text) || /aligns with the.*second.*mark/i.test(text)) {
      mode = 'L2VA';
    } else {
      mode = 'I2VA';
    }
  } else if (/integrated_multimodal_description:/i.test(text)) {
    // Base T2VA 模式（无图片参考）
    mode = 'T2VA';
    weightType = 'FL2VA';
  }

  // 校验并清理格式
  const issues: string[] = [];
  const cleaned = text.trim();

  // 验证必要字段
  if (mode === 'Ref2VA') {
    if (!/subject_definitions:/i.test(cleaned)) issues.push('Missing subject_definitions');
    if (!/summary:/i.test(cleaned)) issues.push('Missing summary');
    if (!/retention_analysis:/i.test(cleaned)) issues.push('Missing retention_analysis');
    if (!/detailed_description:/i.test(cleaned)) issues.push('Missing detailed_description');
    if (!/overall_soundscape:/i.test(cleaned)) issues.push('Missing overall_soundscape');
    if (!/non_diegetic_music:/i.test(cleaned)) issues.push('Missing non_diegetic_music');
  } else {
    if (!/integrated_multimodal_description:/i.test(cleaned)) issues.push('Missing integrated_multimodal_description');
    if (!/overall_soundscape:/i.test(cleaned)) issues.push('Missing overall_soundscape');
    if (!/non_diegetic_music:/i.test(cleaned)) issues.push('Missing non_diegetic_music');
  }

  // 🔴 内容够长但缺段的：只有「极少量缺失（≤1 段）+ cleaned ≥ 400 字」的情况才容忍直接返回，
  //    其余一律返回 null，让 route.ts 上层走 validateH3Prompt + retry 机制补齐。
  //    之前：只要 ≥50 字就不返回 null → 缺 5 段的残缺对象也被保存。
  if (issues.length > 0) {
    const tolerant = (issues.length <= 1 && cleaned.length >= 400);
    if (!tolerant) return null;
  }

  const refCount = mode === 'FL2VA' ? 2 : (mode === 'I2VA' || mode === 'L2VA') ? 1 : 0;

  return {
    h3Prompt: cleaned,
    mode,
    referenceCount: refCount,
    weightType,
  };
}

/**
 * 从 shot 对象中提取参考图数量
 */
export function getReferenceCounts(shot: any): { images: number; videos: number; audios: number } {
  let images = 0;
  let videos = 0;
  let audios = 0;

  if (shot.imageUrl) images++;

  const refFields = ['referenceImages', 'refs', 'characterRefs', 'sceneRefs', 'itemRefs', 'styleRefs'];
  for (const field of refFields) {
    const val = (shot as any)[field];
    if (Array.isArray(val)) {
      images += val.filter(Boolean).length;
    }
  }

  if (Array.isArray((shot as any).referenceVideos)) {
    videos += (shot as any).referenceVideos.filter(Boolean).length;
  }

  if (Array.isArray((shot as any).referenceAudios)) {
    audios += (shot as any).referenceAudios.filter(Boolean).length;
  }

  return { images, videos, audios };
}

/**
 * 构建用于 ComfyUI 提交的最终提示词
 */
export function buildComfyUIH3Prompt(input: H3PromptInput, aiResponse?: string): string {
  const result = aiResponse ? extractH3Prompt(aiResponse) : null;

  if (result) {
    return result.h3Prompt;
  }

  // 无 AI 响应时，构建基础占位格式
  const mode = input.forcedMode || determineH3Mode(
    input.referenceImages || 0,
    input.referenceVideos || 0,
    input.referenceAudios || 0
  );
  const duration = (input.duration || 10).toFixed(2);

  let parts: string[] = [];

  if (mode === 'Ref2VA') {
    parts.push('subject_definitions:');
    if (input.characterName) {
      parts.push(`<Subject 1> is ${input.characterName}${input.characterAppearance ? `, with ${input.characterAppearance}` : ''}.`);
    } else {
      parts.push('<Subject 1> is the main character in the scene.');
    }
    if (input.sceneName) {
      parts.push(`<Subject 2> is the ${input.sceneName} environment.`);
    }
    if (input.referenceImages && input.referenceImages > 0) {
      parts.push('<Picture 1> provides visual reference for the scene.');
    }
    parts.push('');
    parts.push('summary:');
    parts.push(`[reference generation] ${input.sceneDescription}`);
    parts.push('');
    parts.push('retention_analysis:');
    parts.push(`<Subject 1> (appears in [Shot ${input.shotIndex}]): fully_preserved - character appearance and position are retained.`);
    parts.push('');
    parts.push('detailed_description:');
    parts.push(`[Shot ${input.shotIndex}] ${input.sceneDescription}`);
    if (input.dialogue) {
      const lines = input.dialogue.split('\n').filter(Boolean);
      lines.forEach((line, i) => {
        const colonIdx = line.indexOf('：');
        if (colonIdx > -1) {
          const name = line.substring(0, colonIdx).trim();
          const text = line.substring(colonIdx + 1).trim();
          parts.push(`(S${i + 1}) ${name} says: <d>[中文] ${text}</d>`);
        }
      });
    }
    if (input.cameraMovement) {
      parts.push(`Camera: ${input.cameraMovement}`);
    }
    parts.push('');
    parts.push('overall_soundscape:');
    parts.push(input.stateNote || 'Ambient sounds and actions from the scene.');
    parts.push('');
    parts.push('non_diegetic_music:');
    parts.push('N/A');
  } else {
    // Base modes (FL2VA weight)
    if (mode === 'I2VA') {
      parts.push(`For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot ${input.shotIndex}]) is fully referenced.`);
      parts.push('');
    } else if (mode === 'FL2VA') {
      parts.push(`How the reference pictures align with the target video — Picture 1 (from Shot ${input.shotIndex}) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${input.shotIndex}) aligns with the ${duration}-second mark of the target video.`);
      parts.push('');
    } else if (mode === 'L2VA') {
      parts.push(`How the reference pictures align with the target video — <Picture 1> (from [Shot ${input.shotIndex}]) aligns with the ${duration}-second mark of the target video.`);
      parts.push('');
    }

    // 集成多模态描述
    const style = input.style || 'Live-action, cinematic';
    let desc = `integrated_multimodal_description: [Shot ${input.shotIndex}] A ${style} scene. ${input.sceneDescription}`;

    if (input.characterAction) {
      desc += ` ${input.characterAction}`;
    }
    if (input.cameraMovement) {
      desc += ` Camera: ${input.cameraMovement}.`;
    }
    if (input.dialogue) {
      const lines = input.dialogue.split('\n').filter(Boolean);
      lines.forEach((line, i) => {
        const colonIdx = line.indexOf('：');
        if (colonIdx > -1) {
          const name = line.substring(0, colonIdx).trim();
          const text = line.substring(colonIdx + 1).trim();
          desc += ` (S${i + 1}) ${name} says: <d>[中文] ${text}</d>`;
        }
      });
    }

    parts.push(desc);
    parts.push('');
    parts.push(`overall_soundscape: ${input.stateNote || 'Ambient sounds, environmental noise, and physical action sounds from the scene.'}`);
    parts.push('');
    parts.push('non_diegetic_music: N/A');
  }

  return parts.join('\n');
}

/**
 * 验证 H3 Context-IR 提示词格式
 */
export function validateH3Prompt(prompt: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!prompt || !prompt.trim()) {
    return { valid: false, issues: ['Prompt is empty'] };
  }

  const isRef2VA = /subject_definitions:/i.test(prompt) && /detailed_description:/i.test(prompt);

  if (isRef2VA) {
    const requiredSections = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'];
    for (const section of requiredSections) {
      if (!new RegExp(`${section.replace(/_/g, '_')}:`, 'i').test(prompt)) {
        issues.push(`Missing section: ${section}`);
      }
    }
  } else {
    if (!/integrated_multimodal_description:/i.test(prompt)) {
      issues.push('Missing integrated_multimodal_description');
    }
    if (!/overall_soundscape:/i.test(prompt)) {
      issues.push('Missing overall_soundscape');
    }
    if (!/non_diegetic_music:/i.test(prompt)) {
      issues.push('Missing non_diegetic_music');
    }
    if (!/\[Shot \d+\]/i.test(prompt)) {
      issues.push('Missing [Shot N] markers');
    }
  }

  // 检查关键帧对齐（如有 <Picture N> 标签但无对齐指令）
  if (/<Picture \d+>/i.test(prompt) && !/For the target video|How the reference/i.test(prompt)) {
    issues.push('Has <Picture N> tags but missing alignment instruction');
  }

  return { valid: issues.length === 0, issues };
}

/**
 * 从「裴无道：哟，实习生...」或多行对白中解析出每条台词的原文文本（不含说话人名）
 * 用于对白边界校验。
 */
function parseDialogueLines(dialogueBlock: string | undefined | null): string[] {
  if (!dialogueBlock) return [];
  return dialogueBlock
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const colonIdx = line.search(/[：:]/);
      return colonIdx > -1 ? line.substring(colonIdx + 1).trim() : line;
    })
    .filter(line => line.length > 0);
}

/**
 * 从 H3 输出中提取所有 <d>[中文] ...</d> 标签里的台词原文。
 */
function extractAllDHits(prompt: string): Array<{ full: string; text: string; index: number }> {
  const result: Array<{ full: string; text: string; index: number }> = [];
  const dTagRegex = /<d>(?:\[中文\]\s*)?([\s\S]*?)<\/d>/g;
  let m: RegExpExecArray | null;
  while ((m = dTagRegex.exec(prompt)) !== null) {
    result.push({
      full: m[0],
      text: (m[1] || '').trim(),
      index: m.index,
    });
  }
  return result;
}

function strNorm(s: string): string {
  return s
    .replace(/[，。！？、；：,.!?;:\s"'""''（）()《》<>{}【】\[\]…—_`~@#$%^&*+\-=\\/|]/g, '')
    .replace(/[“”‘’]/g, '');
}

/**
 * H3 后处理硬清理（防线 3：即使 AI 违反了单 Shot 规则，这里也会程序化修正）
 *
 * 清理内容：
 *   ① 删除除 [Shot 1] 外的所有内部 [Shot N]（N≥2）段落 —— 防止把下一分镜场景当作第二内部 Shot 写进来
 *   ② 删除对白列表里不存在的 <d>…</d> 标签（即"跨场景泄漏的多余对白"）
 *   ③ 保证 summary 里引用的对白数量与输入一致
 *
 * @param prompt        H3 extractH3Prompt() 输出的 h3Prompt
 * @param dialogueBlock 当前剧本分镜的原始对白原文块（每行"人名：台词"格式）；未提供则跳过对白一致性校验
 * @returns 清理后的 prompt
 */
export function sanitizeH3PromptForSingleShot(prompt: string, dialogueBlock?: string | null): string {
  if (!prompt) return prompt;
  let out = prompt;

  // ─── ① 删除除 [Shot 1] 外的所有内部 [Shot N] 段落（防止 AI 把下一分镜当第二内部 Shot 合入）
  // Ref2VA: 在 detailed_description 段里，只保留第一个 [Shot 1] 开头的完整段落，
  //         后续任何形式的 "[Shot N] At ..." 或 "[Shot N]"（N≥2 或重新写 [Shot 1] At）都删除直到下一节 overall_soundscape / 结尾
  const detailedMatch = out.match(/detailed_description\s*:/i);
  const soundscapeMatch = out.match(/\noverall_soundscape\s*:/i);
  if (detailedMatch && detailedMatch.index !== undefined) {
    const ddStart = detailedMatch.index + detailedMatch[0].length;
    const ddEnd = soundscapeMatch && soundscapeMatch.index !== undefined
      ? soundscapeMatch.index
      : out.length;
    const head = out.slice(0, ddStart);
    const ddSection = out.slice(ddStart, ddEnd);
    const tail = out.slice(ddEnd);

    // 在 detailed_description 正文中：
    // - 找到第一个 [Shot 1]（允许前后空格）
    // - 之后任何出现的 "\[Shot \d+\]"（无论数字多少）都作为第二段落起始符号删掉其行及后续，直到 overall_soundscape / section 结束
    const lines = ddSection.split(/\r?\n/);
    const keptLines: string[] = [];
    let shot1Started = false;
    let truncated = false;
    for (const rawLine of lines) {
      const line = rawLine;
      const isShotMarker = /^\s*\[Shot\s+(\d+)\]/i.test(line) || /^\s*\[Shot\s+\d+\]\s+At\s+\d{2}:\d{2}\.\d{3}/i.test(line);
      if (!shot1Started) {
        // Style preamble lines (before first [Shot 1]) — 全部保留
        if (isShotMarker) {
          // 第一个 [Shot N] 强制保留，但标准化为 "[Shot 1]"
          shot1Started = true;
          const normalized = line.replace(/^\s*\[Shot\s+\d+\]/i, '[Shot 1]');
          keptLines.push(normalized);
          continue;
        }
        keptLines.push(line);
        continue;
      }
      // shot1 已开启，遇到任何后续 [Shot 标记] 都视为跨场景泄漏 → 停止追加（不保留此段及其后内容）
      if (isShotMarker) {
        truncated = true;
        break;  // 丢掉后续（直到 overall_soundscape 之前）
      }
      keptLines.push(line);
    }
    const newDd = keptLines.join('\n').trimEnd();
    out = head + '\n' + newDd + (truncated ? '\n' : '') + tail;
  }

  // Base 模式（integrated_multimodal_description）的简单 [Shot N] 多段修正：把所有多个 [Shot …] 合并为单一 [Shot 1]
  if (!detailedMatch) {
    const imdStartRe = /^integrated_multimodal_description\s*:\s*/im;
    const imdHead = out.match(imdStartRe);
    if (imdHead && imdHead.index !== undefined) {
      const bodyStart = imdHead.index + imdHead[0].length;
      const rest = out.slice(bodyStart);
      // 将行首的 "[Shot N]"（任何数字）统一替换成 "[Shot 1]"，并删掉后续行首 "[Shot N] At …" 形式的新段落开头（改成纯换行不保留 marker）
      const fixedBody = rest
        .split(/\r?\n/)
        .map((ln, lnIdx) => {
          if (lnIdx === 0) return ln.replace(/^\s*\[Shot\s+\d+\]/i, '[Shot 1]');
          // 其它行：如果以 "[Shot N] At …" 开头 → 删除这个 marker（保留 At 后面内容，但因为我们是单 Shot，所以整条都删）
          if (/^\s*\[Shot\s+\d+\]\s+At\s+\d{2}:\d{2}\.\d{3}/i.test(ln)) return null;
          if (/^\s*\[Shot\s+\d+\]/i.test(ln)) return null;
          return ln;
        })
        .filter((x): x is string => x !== null)
        .join('\n');
      out = out.slice(0, bodyStart) + fixedBody;
    }
  }

  // ─── ② 对白一致性：删除不在 dialogueBlock 里的 <d>…</d> 标签（跨场景泄漏的对白）
  if (dialogueBlock !== undefined && dialogueBlock !== null) {
    const expected = parseDialogueLines(dialogueBlock);
    const normExpected = new Set(expected.map(strNorm).filter(s => s.length > 0));
    const dHits = extractAllDHits(out);
    // 从后往前替换，保持 index 稳定
    for (let i = dHits.length - 1; i >= 0; i--) {
      const h = dHits[i];
      const normHit = strNorm(h.text);
      // 精确匹配 expected 中任一条（归一化后相等）
      const inAllowList = normExpected.has(normHit) || Array.from(normExpected).some(e => e.length > 0 && (normHit.includes(e) || e.includes(normHit)));
      if (!inAllowList) {
        // 额外安全检查：如果这条台词完全不在 expected 清单里 → 整句连带 "X says: " 前缀一起删掉
        const before = out.slice(0, h.index);
        const after = out.slice(h.index + h.full.length);
        // 回溯删掉 "<说话者> says: " 前缀（形如 "(S1) Pei says: " 或 "She says: "）
        const prefixRe = /[^\n]*?(?:\((?:S|Subject)\s*\d+\)[^\n:：]{0,60}says\s*:\s*|says\s*:\s*)$/i;
        const trimmedBefore = before.replace(prefixRe, m => {
          // 保留缩进换行
          const idxNL = m.lastIndexOf('\n');
          return idxNL >= 0 ? m.slice(0, idxNL + 1) : (m.startsWith('\n') ? '\n' : '');
        });
        out = trimmedBefore + after;
      }
    }

    // 对白数量检查：若还有 <d> 标签比 expected 多，再强删所有多余的（保留 expected 条，其余按顺序砍尾部）
    const remaining = extractAllDHits(out);
    if (remaining.length > expected.length) {
      const toRemove = remaining.slice(expected.length);
      for (let i = toRemove.length - 1; i >= 0; i--) {
        const h = toRemove[i];
        const before = out.slice(0, h.index);
        const after = out.slice(h.index + h.full.length);
        const prefixRe = /[^\n]*?(?:\((?:S|Subject)\s*\d+\)[^\n:：]{0,60}says\s*:\s*|says\s*:\s*)$/i;
        const trimmedBefore = before.replace(prefixRe, m => {
          const idxNL = m.lastIndexOf('\n');
          return idxNL >= 0 ? m.slice(0, idxNL + 1) : (m.startsWith('\n') ? '\n' : '');
        });
        out = trimmedBefore + after;
      }
    }
  }

  // 清理空段导致的连续空行（最多保留 1 个连续空行）
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  return out.trim() + '\n';
}