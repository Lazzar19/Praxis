const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g;

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Missing template value {{${key}}}.`);
    }
    return value;
  });
}
