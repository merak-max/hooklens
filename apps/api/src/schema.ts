export type Shape = Record<string, string[]>;
export type SchemaChange = { path: string; kind: "added" | "removed" | "type_changed"; before?: string[]; after?: string[] };

// Bounded structural fingerprints; values and secrets never enter the baseline.
export function inferShape(body: unknown): Shape {
  const fields = new Map<string, Set<string>>();
  let visited = 0;
  function visit(value: unknown, path: string, depth: number) {
    if (++visited > 2048 || depth > 12) throw new Error("JSON shape exceeds analysis limits.");
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const types = fields.get(path) ?? new Set<string>();
    types.add(type);
    fields.set(path, types);
    if (Array.isArray(value)) value.forEach((item) => visit(item, `${path}/*`, depth + 1));
    else if (value !== null && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        const escaped = key.replaceAll("~", "~0").replaceAll("/", "~1").replaceAll("*", "~2");
        visit(item, `${path}/${escaped}`, depth + 1);
      }
    }
  }
  visit(body, "$", 0);
  return Object.fromEntries([...fields].sort(([a], [b]) => a.localeCompare(b)).map(([path, types]) => [path, [...types].sort()]));
}

export function compareShapes(baseline: Shape, next: Shape): SchemaChange[] {
  const changes: SchemaChange[] = [];
  for (const path of [...new Set([...Object.keys(baseline), ...Object.keys(next)])].sort()) {
    const before = baseline[path], after = next[path];
    if (!before) changes.push({ path, kind: "added", after });
    else if (!after) changes.push({ path, kind: "removed", before });
    else if (before.join("|") !== after.join("|")) changes.push({ path, kind: "type_changed", before, after });
  }
  return changes;
}
