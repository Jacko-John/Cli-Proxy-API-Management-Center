/** Keep the upstream exception limited to one invalid SSR assertion and retire it after a fix. */
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { formatSource, SourcePatch } from '../../scripts/upstream/ast';
import { applyKnownUpstreamTestExceptions } from '../../scripts/upstream/test-exceptions';

const path = 'tests/authFileCooldowns.test.ts';
const description = 'keeps the reset action contextual and exposes pending state';
const badAssertion = "expect(available).toContain(i18n.t('auth_files.cooldown_reset_hint'));";
const exceptionComment =
  '/* Fork exception: SSR HTML escaping invalidates this raw translation substring assertion. */';

/** Apply the production AST edit without writing any upstream files. */
async function apply(source: string, sourcePath = path): Promise<string> {
  const patch = new SourcePatch(sourcePath, source);
  applyKnownUpstreamTestExceptions(patch);
  return patch.finish();
}

/** Include the original contextual and pending-state checks around the defective assertion. */
function sourceWith(assertion = badAssertion): string {
  return `test('${description}', () => {
    expect(render(snapshot)).not.toContain(i18n.t('auth_files.cooldown_reset_button'));
    const available = render(snapshot, { onReset: () => {} });
    expect(available).toContain(i18n.t('auth_files.cooldown_reset_button'));
    ${assertion}
    expect(available).not.toContain('disabled=""');
    const pending = render(snapshot, { onReset: () => {}, resetting: true });
    expect(pending).toContain('disabled=""');
    expect(pending).toContain('loading-spinner');
  });`;
}

describe('known upstream SSR test exception', () => {
  test('removes only the defective assertion while preserving every functional check', async () => {
    const source = sourceWith();
    const result = await apply(source);
    expect(result).toBe(await formatSource(path, sourceWith(exceptionComment)));
    expect(result.match(/expect\(/g)).toHaveLength(5);
    expect(result).toContain("test('keeps the reset action contextual and exposes pending state'");
    expect(result).toContain('expect(pending).toContain(\'disabled=""\')');
    expect(result).toContain("expect(pending).toContain('loading-spinner')");
    expect(result).not.toContain('test.skip');
  });

  test('leaves a corrected escaped comparison intact and adds no exception comment', async () => {
    const source = sourceWith(
      "expect(available).toContain(escapeHtml(i18n.t('auth_files.cooldown_reset_hint')));"
    );
    expect(await apply(source)).toBe(await formatSource(path, source));
  });

  test('tolerates quote, whitespace, line break, comment and semicolon formatting', async () => {
    const source = `test("${description}", () => {
      expect /* assertion */ (
        available,
      ).toContain(
        i18n.t("auth_files.cooldown_reset_hint",),
      )
      expect(available).toContain('reset button');
    });`;
    const result = await apply(source);
    expect(result).toContain(exceptionComment);
    expect(result).not.toContain('cooldown_reset_hint');
    expect(result).toContain("expect(available).toContain('reset button')");
  });

  test('is idempotent after replacing the assertion with its explanatory comment', async () => {
    const once = await apply(sourceWith());
    expect(await apply(once)).toBe(once);
  });

  test('keeps a following assertion on the same line executable', async () => {
    const functionalAssertion = "expect(pending).toContain('loading-spinner');";
    const source = `test('${description}', () => { ${badAssertion} ${functionalAssertion} });`;
    const result = await apply(source);
    const parsed = new SourcePatch(path, result);
    const statements = parsed.nodes(ts.isExpressionStatement);
    expect(statements.map((statement) => statement.getText().replace(/\s+/g, ''))).toContain(
      functionalAssertion
    );
    expect(result).toBe(
      await formatSource(
        path,
        `test('${description}', () => { ${exceptionComment} ${functionalAssertion} });`
      )
    );
  });

  test.each([
    sourceWith().replace(description, 'renders an unrelated cooldown hint'),
    sourceWith().replace('auth_files.cooldown_reset_hint', 'auth_files.cooldown_reset_button'),
    sourceWith().replace(badAssertion, badAssertion.replace('available', 'pending')),
    sourceWith().replace(badAssertion, badAssertion.replace('.toContain(', '.not.toContain(')),
    sourceWith().replace(badAssertion, badAssertion.replace('i18n.t(', 'translations.t(')),
    sourceWith().replace(badAssertion, badAssertion.replace('i18n.t(', 'i18n.t?.(')),
    sourceWith().replace(badAssertion, badAssertion.replace('.toContain(', '.toContain?.(')),
    sourceWith().replace(badAssertion, badAssertion.replace('expect(', 'expect<string>(')),
    sourceWith().replace(badAssertion, `if (enabled) { ${badAssertion} }`),
    sourceWith().replace(badAssertion, '// Upstream removed the comparison.'),
  ])('does not broaden the exception to a different AST or test', async (source) => {
    expect(await apply(source)).toBe(await formatSource(path, source));
  });

  test('does not touch the same case and assertion in another test file', async () => {
    const source = sourceWith();
    const otherPath = 'tests/other.test.ts';
    expect(await apply(source, otherPath)).toBe(await formatSource(otherPath, source));
  });

  test('preserves a matching assertion in another case beside the affected case', async () => {
    const unrelated = `test('another cooldown case', () => { ${badAssertion} });`;
    const result = await apply(`${unrelated}\n${sourceWith()}`);
    expect(result).toBe(await formatSource(path, `${unrelated}\n${sourceWith(exceptionComment)}`));
  });

  test('rejects duplicate test descriptions before making an exception', () => {
    expect(apply(`${sourceWith()}\n${sourceWith()}`)).rejects.toThrow(
      'expected one contextual cooldown reset test, found 2'
    );
  });

  test('rejects duplicate defective assertions within the same case', () => {
    expect(apply(sourceWith(`${badAssertion}\n${badAssertion}`))).rejects.toThrow(
      'expected one unescaped cooldown hint assertion, found 2'
    );
  });
});
