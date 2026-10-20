import type { Skill } from './model.ts';

/** Filter completed scan results without changing their order or classification. */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return skills.filter((skill) => {
    const name = skill.name.toLowerCase();
    const description = (skill.description ?? '').toLowerCase();
    return terms.every((term) => name.includes(term) || description.includes(term));
  });
}
