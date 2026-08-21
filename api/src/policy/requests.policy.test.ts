import { describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor.js';
import { authorize } from './index.js';
import { requestPolicy, type RequestSubject } from './requests.policy.js';
import { ForbiddenError } from '../http/errors.js';

const author: Actor = {
  id: 1,
  externalId: null,
  email: 'dana@feedbackhub.local',
  displayName: 'Dana Okafor',
  role: 'user',
};

const bystander: Actor = { ...author, id: 2, email: 'sam@feedbackhub.local', displayName: 'Sam' };

const admin: Actor = {
  ...author,
  id: 3,
  email: 'admin@feedbackhub.local',
  displayName: 'Robin',
  role: 'admin',
};

const request: RequestSubject = { authorId: author.id };

describe('feedback request policy', () => {
  describe('editing the text of a request', () => {
    it('refuses a user who is neither the author nor an admin', () => {
      const decision = requestPolicy.editContent(bystander, request);

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/only the author/i);
    });

    it('allows the author', () => {
      expect(requestPolicy.editContent(author, request).allowed).toBe(true);
    });

    it('refuses an admin', () => {
      // Deliberate, and the rule most likely to be "fixed" by mistake later.
      // Moderation is deleting a request or changing its status; it is not
      // rewriting what somebody wrote under their own name.
      expect(requestPolicy.editContent(admin, request).allowed).toBe(false);
    });
  });

  describe('deleting a request', () => {
    it('refuses a user who is neither the author nor an admin', () => {
      expect(requestPolicy.delete(bystander, request).allowed).toBe(false);
    });

    it('allows the author', () => {
      expect(requestPolicy.delete(author, request).allowed).toBe(true);
    });

    it('allows an admin, as moderation', () => {
      expect(requestPolicy.delete(admin, request).allowed).toBe(true);
    });
  });

  describe('triage', () => {
    it('refuses a regular user changing status or pinning', () => {
      expect(requestPolicy.changeStatus(bystander).allowed).toBe(false);
      expect(requestPolicy.setPinned(bystander).allowed).toBe(false);
    });

    it('allows an admin', () => {
      expect(requestPolicy.changeStatus(admin).allowed).toBe(true);
      expect(requestPolicy.setPinned(admin).allowed).toBe(true);
    });
  });

  describe('creating and reading', () => {
    it('allows any authenticated user', () => {
      expect(requestPolicy.create(bystander).allowed).toBe(true);
      expect(requestPolicy.list(bystander).allowed).toBe(true);
      expect(requestPolicy.read(bystander).allowed).toBe(true);
    });
  });

  describe('authorize()', () => {
    it('raises a 403 carrying the denial reason, not a 404', () => {
      const denial = requestPolicy.editContent(bystander, request);

      expect(() => authorize(denial)).toThrow(ForbiddenError);

      try {
        authorize(denial);
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as ForbiddenError).status).toBe(403);
        expect((error as ForbiddenError).message).toBe(denial.reason);
      }
    });

    it('does nothing when the decision allows', () => {
      expect(() => authorize(requestPolicy.editContent(author, request))).not.toThrow();
    });
  });
});
