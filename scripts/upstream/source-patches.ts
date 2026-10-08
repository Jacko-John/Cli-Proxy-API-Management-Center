/** The fork's complete integration layer, reapplied to the exact upstream release sources. */
import ts from 'typescript';
import { forkPagePaths, forkSidebarGroups } from '../../src/fork/navigation';
import { formatSource, SourcePatch } from './ast';
import { blob } from './git';

type Patch = (source: SourcePatch) => void;

/** Extract declared navigation keys from a construction expression for integration checks. */
function literalProperties(root: ts.Node, key: string): Set<string> {
  const values = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === key &&
      ts.isStringLiteral(node.initializer)
    )
      values.add(node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return values;
}

/** A new upstream route/menu with a fork path is a business conflict, not a merge success. */
function checkNavigationPaths(path: string, root: ts.Node): void {
  const paths = literalProperties(root, 'path');
  for (const added of Object.values(forkPagePaths)) {
    if (paths.has(added))
      throw new Error(
        `${path}: upstream navigation path ${added} conflicts with the fork extension`
      );
  }
}

/** Register translations beside the exported instance without editing language resources. */
const translations: Patch = (patch) => {
  patch.import(['registerForkTranslations'], './forkTranslations');
  const exported = patch.one(
    patch.nodes(ts.isExportAssignment).filter((node) => !node.isExportEquals),
    'default i18n export'
  );
  patch.edit(
    exported.getStart(),
    exported.getStart(),
    `registerForkTranslations(${exported.expression.getText()});\n\n`
  );
};

/** Wrap route construction; upstream additions and capability branches stay intact. */
const routes: Patch = (patch) => {
  patch.import(['extendForkRoutes'], '@/fork/routes');
  const declaration = patch.variable('createMainRoutes');
  const arrow = declaration.initializer;
  if (!arrow || !ts.isArrowFunction(arrow) || arrow.parameters.length !== 1) {
    throw new Error(`${patch.path}: createMainRoutes must accept one capability parameter`);
  }
  const parameter = arrow.parameters[0].name;
  if (!ts.isIdentifier(parameter))
    throw new Error(`${patch.path}: route capability binding changed`);
  checkNavigationPaths(patch.path, arrow.body);
  patch.replace(declaration.name, 'createUpstreamMainRoutes');
  const end = declaration.parent.parent.getEnd();
  patch.edit(
    end,
    end,
    `\nconst createMainRoutes = (${arrow.parameters[0].getText()}) => extendForkRoutes(createUpstreamMainRoutes(${parameter.text}), ${parameter.text});`
  );
};

/** Retain the upstream loader/UI; expose plugin state and decorate its final navigation groups. */
const sidebar: Patch = (patch) => {
  patch.import(['extendForkSidebar', 'isUsagePluginAvailable'], '@/fork/sidebar');
  const groupType = patch.one(
    patch.nodes(ts.isInterfaceDeclaration).filter((node) => node.name.text === 'SidebarNavGroup'),
    'SidebarNavGroup interface'
  );
  if (!groupType.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
    patch.edit(groupType.getStart(), groupType.getStart(), 'export ');
  }
  const resources = patch.variable('pluginResources');
  patch.edit(
    resources.parent.parent.getEnd(),
    resources.parent.parent.getEnd(),
    '\nconst [safetyPluginAvailable, setSafetyPluginAvailable] = useState(false);'
  );
  const setters = patch
    .nodes(ts.isCallExpression)
    .filter(
      (node) => ts.isIdentifier(node.expression) && node.expression.text === 'setPluginResources'
    );
  if (setters.length === 0) throw new Error(`${patch.path}: plugin resource loader is missing`);
  for (const call of setters) {
    if (!ts.isExpressionStatement(call.parent) || call.arguments.length !== 1) {
      throw new Error(`${patch.path}: plugin resource setter contract changed`);
    }
    const argument = call.arguments[0];
    let availability: string;
    if (ts.isArrayLiteralExpression(argument) && argument.elements.length === 0) {
      availability = 'false';
    } else if (
      ts.isCallExpression(argument) &&
      ts.isIdentifier(argument.expression) &&
      argument.expression.text === 'collectPluginResourceEntries' &&
      argument.arguments.length === 1
    ) {
      availability = `isUsagePluginAvailable(${argument.arguments[0].getText()})`;
    } else {
      throw new Error(`${patch.path}: cannot derive availability from plugin resource setter`);
    }
    const statement = call.parent;
    const availabilityStatement = `setSafetyPluginAvailable(${availability});`;
    // Keep the same control flow when upstream uses an if/else or loop without braces.
    if (
      ts.isBlock(statement.parent) ||
      ts.isCaseClause(statement.parent) ||
      ts.isDefaultClause(statement.parent)
    ) {
      patch.edit(statement.getEnd(), statement.getEnd(), `\n${availabilityStatement}`);
    } else {
      patch.replace(statement, `{ ${statement.getText()} ${availabilityStatement} }`);
    }
  }
  const groups = patch.variable('navGroups');
  if (!groups.initializer) throw new Error(`${patch.path}: sidebar groups have no initializer`);
  const ids = literalProperties(groups.initializer, 'id');
  for (const id of Object.values(forkSidebarGroups)) {
    if (!ids.has(id)) throw new Error(`${patch.path}: upstream sidebar group ${id} is missing`);
  }
  checkNavigationPaths(patch.path, groups.initializer);
  patch.replace(groups.name, 'upstreamNavGroups');
  const end = groups.parent.parent.getEnd();
  patch.edit(
    end,
    end,
    '\nconst navGroups = extendForkSidebar(upstreamNavGroups, safetyPluginAvailable);'
  );
};

/** Keep the established fork repository link; require a unique upstream link anchor. */
const systemLink: Patch = (patch) => {
  const link = patch.one(
    patch
      .nodes(ts.isStringLiteral)
      .filter(
        (node) => node.text === 'https://github.com/router-for-me/Cli-Proxy-API-Management-Center'
      ),
    'frontend repository link'
  );
  patch.replace(link, '"https://github.com/Fwindy/Cli-Proxy-API-Management-Center"');
};

/** Keep the existing public exports while preserving any new upstream exports. */
const exportModule =
  (module: string): Patch =>
  (patch) => {
    if (
      patch
        .nodes(ts.isExportDeclaration)
        .some(
          (node) =>
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier) &&
            node.moduleSpecifier.text === module
        )
    )
      return;
    patch.edit(
      patch.source.length,
      patch.source.length,
      `${patch.source.endsWith('\n') ? '' : '\n'}export * from '${module}';\n`
    );
  };

export const sourcePatches: Record<string, Patch> = {
  'src/i18n/index.ts': translations,
  'src/router/MainRoutes.tsx': routes,
  'src/components/layout/MainLayout.tsx': sidebar,
  'src/pages/SystemPage.tsx': systemLink,
  'src/services/api/index.ts': exportModule('./usage'),
  'src/types/index.ts': exportModule('./usageSafety'),
};

/** Build a candidate entirely in memory. A failed anchor leaves the checkout untouched. */
export async function patchUpstreamSource(path: string, source: string): Promise<string> {
  const apply = sourcePatches[path];
  if (!apply) throw new Error(`No fork integration patch registered for ${path}`);
  const patch = new SourcePatch(path, source);
  apply(patch);
  return patch.finish();
}

/** Generate the complete patch plan before either CLI writes files or stages a merge. */
export async function generateSourcePatches(
  repository: string,
  ref: string
): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  for (const path of Object.keys(sourcePatches)) {
    const original = blob(repository, ref, path);
    if (original === null) throw new Error(`${ref}: missing integration source ${path}`);
    sources.set(path, await patchUpstreamSource(path, original));
  }
  return sources;
}

/** Ensure every local edit to an upstream integration source is represented before replacement. */
export async function validateSourcePatches(repository: string, baseline: string): Promise<void> {
  const expectedSources = await generateSourcePatches(repository, baseline);
  for (const [path, expected] of expectedSources) {
    const ours = blob(repository, 'HEAD', path);
    if (ours === null) throw new Error(`Missing integration source ${path}`);
    if ((await formatSource(path, ours)) !== expected) {
      throw new Error(
        `${path}: fork edits are not represented in scripts/upstream/source-patches.ts; refusing to overwrite them`
      );
    }
  }
}
