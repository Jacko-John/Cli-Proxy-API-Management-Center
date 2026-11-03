/** Exercise release decisions and representative GitHub environment/review responses. */
import { describe, expect, test } from 'bun:test';
import {
  hasApprovedReview,
  validateApprovalEnvironment,
  validationNeedsApproval,
  type CheckOutcome,
} from '../../scripts/upstream/release-policy';

const reviewerId = 1;
const environmentId = 161088068;

/** GitHub's environment shape includes independent timer, reviewer and branch-policy rules. */
function environmentResponse() {
  return {
    id: environmentId,
    name: 'upstream-validation-override',
    can_admins_bypass: false,
    protection_rules: [
      { id: 3736, type: 'wait_timer', wait_timer: 30 },
      {
        id: 3755,
        type: 'required_reviewers',
        prevent_self_review: false,
        reviewers: [{ type: 'User', reviewer: { id: reviewerId, login: 'octocat', type: 'User' } }],
      },
      { id: 3756, type: 'branch_policy' },
    ],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  };
}

/** A run's review history identifies the approving account and each approved environment by ID. */
function approvalResponse() {
  return {
    state: 'approved',
    comment: 'Reviewed the failing checks and prepared artifact.',
    user: { id: reviewerId, login: 'octocat', type: 'User' },
    environments: [{ id: environmentId, name: 'upstream-validation-override' }],
  };
}

describe('release validation policy', () => {
  test.each([
    ['success', 'success', false, false],
    ['success', 'success', true, false],
    ['failure', 'success', true, true],
    ['success', 'failure', true, true],
    ['failure', 'failure', true, true],
  ] as const)(
    'test=%s lint=%s override=%s requires review=%s',
    (testOutcome, lintOutcome, allowOverride, expected) => {
      expect(
        validationNeedsApproval({
          testOutcome,
          lintOutcome,
          buildOutcome: 'success',
          allowOverride,
        })
      ).toBe(expected);
    }
  );

  test.each([
    ['failure', 'success'],
    ['success', 'failure'],
    ['failure', 'failure'],
  ] as const)(
    'automatic test=%s lint=%s cannot request an override',
    (testOutcome, lintOutcome) => {
      expect(() =>
        validationNeedsApproval({
          testOutcome,
          lintOutcome,
          buildOutcome: 'success',
          allowOverride: false,
        })
      ).toThrow('does not allow');
    }
  );

  test.each(['failure', 'cancelled', 'skipped', 'timed_out', undefined, null])(
    'a non-successful build is never waivable: %s',
    (outcome) => {
      expect(() =>
        validationNeedsApproval({
          testOutcome: 'failure',
          lintOutcome: 'failure',
          buildOutcome: outcome as CheckOutcome,
          allowOverride: true,
        })
      ).toThrow('successful build');
    }
  );

  test.each(['testOutcome', 'lintOutcome'] as const)(
    '%s must represent a completed check even when overrides are enabled',
    (field) => {
      for (const outcome of ['cancelled', 'skipped', 'neutral', '', undefined, null]) {
        expect(() =>
          validationNeedsApproval({
            testOutcome: 'success',
            lintOutcome: 'success',
            buildOutcome: 'success',
            allowOverride: true,
            [field]: outcome as CheckOutcome,
          })
        ).toThrow('did not complete');
      }
    }
  );

  test.each(['false', 'true', 1, 0, undefined, null])(
    'unparsed override input cannot authorize release: %s',
    (allowOverride) => {
      expect(() =>
        validationNeedsApproval({
          testOutcome: 'failure',
          lintOutcome: 'success',
          buildOutcome: 'success',
          allowOverride: allowOverride as boolean,
        })
      ).toThrow('boolean');
    }
  );
});

describe('approval environment protection', () => {
  test('accepts explicit owner review with extra independent protection rules without changing data', () => {
    const environment = environmentResponse();
    const original = structuredClone(environment);
    expect(validateApprovalEnvironment(environment, reviewerId)).toBe(environmentId);
    expect(environment).toEqual(original);
  });

  test.each(
    [undefined, null, [], {}, { id: '161088068' }, { id: 0 }, { id: -1 }, { id: 1.5 }].map(
      (environment) => ({ environment })
    )
  )('rejects a missing or invalid environment ID: %j', ({ environment }) => {
    expect(() => validateApprovalEnvironment(environment, reviewerId)).toThrow();
  });

  test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid configured reviewer IDs: %s',
    (id) => {
      expect(() => validateApprovalEnvironment(environmentResponse(), id)).toThrow('reviewer ID');
    }
  );

  test.each([true, undefined, null, 'false'])(
    'requires explicit administrator bypass disablement: %s',
    (can_admins_bypass) => {
      expect(() =>
        validateApprovalEnvironment({ ...environmentResponse(), can_admins_bypass }, reviewerId)
      ).toThrow('bypass');
    }
  );

  test.each([
    undefined,
    null,
    {},
    { protected_branches: true, custom_branch_policies: false },
    { protected_branches: true, custom_branch_policies: true },
    { protected_branches: false, custom_branch_policies: false },
  ])('requires explicit custom branch-policy mode: %j', (deployment_branch_policy) => {
    expect(() =>
      validateApprovalEnvironment(
        { ...environmentResponse(), deployment_branch_policy },
        reviewerId
      )
    ).toThrow('branch policies');
  });

  test.each(
    [
      undefined,
      null,
      [],
      [{ type: 'wait_timer', wait_timer: 30 }],
      [{ type: 'branch_policy' }],
      [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [] }],
      [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User' }] }],
      [
        {
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [{ type: 'Team', reviewer: { id: reviewerId } }],
        },
      ],
      [
        {
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [{ type: 'User', reviewer: { id: 2, login: 'other-owner' } }],
        },
      ],
    ].map((protection_rules) => ({ protection_rules }))
  )(
    'a timer, empty rule or different reviewer never substitutes for the owner: %j',
    ({ protection_rules }) => {
      expect(() =>
        validateApprovalEnvironment({ ...environmentResponse(), protection_rules }, reviewerId)
      ).toThrow();
    }
  );

  test.each([true, undefined, null, 'false'])(
    'requires the sole owner to be able to review their own manually triggered run: %s',
    (prevent_self_review) => {
      const environment = environmentResponse();
      const protection_rules = environment.protection_rules.map((rule) =>
        rule.type === 'required_reviewers' ? { ...rule, prevent_self_review } : rule
      );
      expect(() =>
        validateApprovalEnvironment({ ...environment, protection_rules }, reviewerId)
      ).toThrow('approve their manual run');
    }
  );

  test('rejects ambiguous duplicate reviewer protections', () => {
    const environment = environmentResponse();
    environment.protection_rules.push(structuredClone(environment.protection_rules[1]));
    expect(() => validateApprovalEnvironment(environment, reviewerId)).toThrow(
      'one required reviewer'
    );
  });

  test.each([
    { type: 'User', reviewer: { id: 2, login: 'another-maintainer' } },
    { type: 'Team', reviewer: { id: 3, slug: 'release-maintainers' } },
  ])('rejects an additional reviewer that could independently unlock the job: %j', (extra) => {
    const environment = environmentResponse();
    const protection_rules = environment.protection_rules.map((rule) =>
      rule.type === 'required_reviewers'
        ? { ...rule, reviewers: [...(rule.reviewers ?? []), extra] }
        : rule
    );
    expect(() =>
      validateApprovalEnvironment({ ...environment, protection_rules }, reviewerId)
    ).toThrow('only reviewer');
  });
});

describe('actual GitHub review history', () => {
  test('matches the owner and environment by ID across multiple approvals without mutation', () => {
    const history = [
      { ...approvalResponse(), state: 'rejected' },
      { ...approvalResponse(), user: { id: 2 } },
      { ...approvalResponse(), environments: [{ id: 2 }] },
      approvalResponse(),
    ];
    const original = structuredClone(history);
    expect(hasApprovedReview(history, environmentId, reviewerId)).toBe(true);
    expect(history).toEqual(original);
  });

  test.each(
    [
      undefined,
      null,
      {},
      { state: 'approved', user: { id: reviewerId }, environments: [{ id: environmentId }] },
      [],
      [null],
      [{ ...approvalResponse(), state: 'rejected' }],
      [{ ...approvalResponse(), state: 'pending' }],
      [{ ...approvalResponse(), user: undefined }],
      [{ ...approvalResponse(), user: { id: String(reviewerId) } }],
      [{ ...approvalResponse(), user: { id: 2, login: 'octocat' } }],
      [{ ...approvalResponse(), environments: undefined }],
      [{ ...approvalResponse(), environments: [] }],
      [{ ...approvalResponse(), environments: [{ id: String(environmentId) }] }],
      [{ ...approvalResponse(), environments: [{ id: 2, name: 'upstream-validation-override' }] }],
    ].map((history) => ({ history }))
  )('missing or mismatched API approval data cannot grant release: %j', ({ history }) => {
    expect(hasApprovedReview(history, environmentId, reviewerId)).toBe(false);
  });

  test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'invalid expected IDs never match an approval: %s',
    (id) => {
      expect(hasApprovedReview([approvalResponse()], id, reviewerId)).toBe(false);
      expect(hasApprovedReview([approvalResponse()], environmentId, id)).toBe(false);
    }
  );
});
