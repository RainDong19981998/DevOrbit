export function planExactEditTransaction({ sources, edits, validatePath, maxChangedFiles = 2 }) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) throw new Error('sources must be an object');
  if (!Array.isArray(edits) || edits.length < 1) throw new Error('at least one edit is required');

  const changedPaths = [...new Set(edits.map(edit => edit?.file))];
  if (changedPaths.length > maxChangedFiles) throw new Error(`changed file limit exceeded: ${changedPaths.length}`);
  if (changedPaths.some(path => typeof path !== 'string' || !validatePath(path))) throw new Error('edit path policy violation');

  const staged = new Map(Object.entries(sources));
  for (const edit of edits) {
    if (typeof edit.oldText !== 'string' || !edit.oldText || typeof edit.newText !== 'string' || edit.oldText === edit.newText) {
      throw new Error(`invalid exact replacement: ${edit.file}`);
    }
    if (!staged.has(edit.file)) throw new Error(`source not loaded: ${edit.file}`);
    const before = staged.get(edit.file);
    const occurrences = before.split(edit.oldText).length - 1;
    if (occurrences !== 1) throw new Error(`oldText occurrence count ${occurrences}: ${edit.file}`);
    staged.set(edit.file, before.replace(edit.oldText, edit.newText));
  }

  return {
    changedPaths,
    outputs: Object.fromEntries(changedPaths.map(path => [path, staged.get(path)]))
  };
}
