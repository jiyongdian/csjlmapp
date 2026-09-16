import { getAgentSkills } from '@/lib/agent-skills';
import { modelPromptManager } from './modelPromptManager';

export async function seedAgentSkillsToModelPrompts() {
  const skills = getAgentSkills();
  let created = 0;
  let updated = 0;

  for (const [index, skill] of skills.entries()) {
    const existing = await modelPromptManager.getByCode(skill.code);
    const data = {
      name: `Agent技能 · ${skill.name}`,
      description: `${skill.description}（来源：${skill.relativePath}）`,
      module: 'agent-skills',
      systemPrompt: skill.content,
      userPrompt: null,
      sortOrder: 9000 + index,
      isActive: 1,
    };

    if (existing) {
      await modelPromptManager.update(existing.id, data);
      updated++;
    } else {
      await modelPromptManager.create({
        code: skill.code,
        ...data,
      });
      created++;
    }
  }

  modelPromptManager.invalidateCache();
  return { created, updated, total: skills.length };
}
