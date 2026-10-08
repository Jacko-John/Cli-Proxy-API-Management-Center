/** Small syntax-based source edits. Missing or ambiguous anchors fail before writing files. */
import { readFileSync } from 'node:fs';
import prettier from 'prettier';
import ts from 'typescript';

const formatOptions = JSON.parse(
  readFileSync(new URL('../../.prettierrc', import.meta.url), 'utf8')
);

/** Compare and emit code with the repository's formatter rather than line/whitespace heuristics. */
export const formatSource = (path: string, source: string): Promise<string> =>
  prettier.format(source, { ...formatOptions, filepath: path });

/** Collect non-overlapping syntax edits against one immutable upstream source file. */
export class SourcePatch {
  readonly tree: ts.SourceFile;
  private readonly edits: { start: number; end: number; text: string }[] = [];

  /** Parse the source once so every edit is located against the same original tree. */
  constructor(
    readonly path: string,
    readonly source: string
  ) {
    this.tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  }

  /** Locate nodes by syntax, independent of imports, comments and neighboring lines. */
  nodes<T extends ts.Node>(guard: (node: ts.Node) => node is T): T[] {
    const matches: T[] = [];
    const visit = (node: ts.Node) => {
      if (guard(node)) matches.push(node);
      ts.forEachChild(node, visit);
    };
    visit(this.tree);
    return matches;
  }

  /** Require one integration point so upstream refactors cannot silently drop fork behavior. */
  one<T extends ts.Node>(nodes: T[], description: string): T {
    if (nodes.length !== 1) {
      throw new Error(`${this.path}: expected one ${description}, found ${nodes.length}`);
    }
    return nodes[0];
  }

  /** Find a declaration by its binding, including useState destructuring. */
  variable(name: string): ts.VariableDeclaration {
    return this.one(
      this.nodes(ts.isVariableDeclaration).filter((node) => {
        if (ts.isIdentifier(node.name)) return node.name.text === name;
        return node.name.elements.some(
          (element) =>
            ts.isBindingElement(element) &&
            ts.isIdentifier(element.name) &&
            element.name.text === name
        );
      }),
      `variable ${name}`
    );
  }

  /** Record replacements against the untouched input; overlapping edits are rejected. */
  edit(start: number, end: number, text: string): void {
    if (this.edits.some((edit) => start < edit.end && end > edit.start)) {
      throw new Error(`${this.path}: source patch edits overlap`);
    }
    this.edits.push({ start, end, text });
  }

  /** Replace or wrap a whole syntax node, preserving the upstream expression as supplied. */
  replace(node: ts.Node, text: string): void {
    this.edit(node.getStart(this.tree), node.getEnd(), text);
  }

  /** Register fork imports without rewriting the upstream import list. */
  import(names: string[], module: string): void {
    const imports = this.nodes(ts.isImportDeclaration);
    if (
      imports.some(
        (node) => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === module
      )
    ) {
      throw new Error(`${this.path}: upstream already imports fork module ${module}`);
    }
    const position = imports.at(-1)?.getEnd() ?? 0;
    this.edit(position, position, `\nimport { ${names.join(', ')} } from '${module}';\n`);
  }

  /** Apply all edits once, then validate syntax and normalize formatting. */
  async finish(): Promise<string> {
    let result = this.source;
    for (const edit of this.edits.sort((left, right) => right.start - left.start)) {
      result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }
    return formatSource(this.path, result);
  }
}
