/** Decide which validation failures need review and verify GitHub's approval protection data. */
export type CheckOutcome = 'success' | 'failure' | 'cancelled' | 'skipped';

interface ValidationResults {
  testOutcome: CheckOutcome;
  lintOutcome: CheckOutcome;
  buildOutcome: CheckOutcome;
  allowOverride: boolean;
}

/** Permit review only for completed test/lint failures after a successful build. */
export function validationNeedsApproval({
  testOutcome,
  lintOutcome,
  buildOutcome,
  allowOverride,
}: ValidationResults): boolean {
  if (typeof allowOverride !== 'boolean') {
    throw new Error('Validation override permission must be a boolean');
  }
  if (buildOutcome !== 'success') {
    throw new Error('Release requires a successful build; build failures cannot be overridden');
  }
  for (const [name, outcome] of [
    ['test', testOutcome],
    ['lint', lintOutcome],
  ]) {
    if (outcome !== 'success' && outcome !== 'failure') {
      throw new Error(`${name}: validation did not complete with a success or failure outcome`);
    }
  }

  const failed = testOutcome === 'failure' || lintOutcome === 'failure';
  if (failed && !allowOverride) {
    throw new Error('Tests or lint failed; this workflow does not allow an approval override');
  }
  return failed;
}

/** Narrow JSON objects without accepting null or arrays as GitHub API records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** GitHub identifiers must retain exact numeric identity across API responses and comparisons. */
function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Require owner review, self-review eligibility and branch restrictions before using an environment. */
export function validateApprovalEnvironment(
  environment: unknown,
  expectedReviewerId: number
): number {
  if (!isId(expectedReviewerId)) throw new Error('The expected reviewer ID is invalid');
  if (!isRecord(environment) || !isId(environment.id)) {
    throw new Error('The approval environment is missing a valid numeric ID');
  }
  if (environment.can_admins_bypass !== false) {
    throw new Error('The approval environment must disable administrator bypass');
  }
  const branchPolicy = environment.deployment_branch_policy;
  if (
    !isRecord(branchPolicy) ||
    branchPolicy.custom_branch_policies !== true ||
    branchPolicy.protected_branches !== false
  ) {
    throw new Error('The approval environment must use explicit deployment branch policies');
  }

  const rules = environment.protection_rules;
  if (!Array.isArray(rules)) {
    throw new Error('The approval environment has no required reviewer protection');
  }
  const reviewerRules = rules.filter(
    (rule): rule is Record<string, unknown> => isRecord(rule) && rule.type === 'required_reviewers'
  );
  if (reviewerRules.length !== 1) {
    throw new Error('The approval environment must have one required reviewer protection rule');
  }
  const rule = reviewerRules[0];
  if (rule.prevent_self_review !== false) {
    throw new Error('The approval environment must allow the owner to approve their manual run');
  }
  // GitHub accepts any listed reviewer, so additional users or teams would weaken owner approval.
  if (
    !Array.isArray(rule.reviewers) ||
    rule.reviewers.length !== 1 ||
    !rule.reviewers.some(
      (entry) =>
        isRecord(entry) &&
        entry.type === 'User' &&
        isRecord(entry.reviewer) &&
        entry.reviewer.id === expectedReviewerId
    )
  ) {
    throw new Error('The approval environment must require the expected user as its only reviewer');
  }
  return environment.id;
}

/** Confirm an actual owner approval for this environment; malformed history never grants approval. */
export function hasApprovedReview(
  history: unknown,
  environmentId: number,
  expectedReviewerId: number
): boolean {
  if (!isId(environmentId) || !isId(expectedReviewerId) || !Array.isArray(history)) return false;
  return history.some(
    (entry) =>
      isRecord(entry) &&
      entry.state === 'approved' &&
      isRecord(entry.user) &&
      entry.user.id === expectedReviewerId &&
      Array.isArray(entry.environments) &&
      entry.environments.some(
        (environment) => isRecord(environment) && environment.id === environmentId
      )
  );
}
