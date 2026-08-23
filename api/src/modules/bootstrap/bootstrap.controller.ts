import type { RequestHandler } from 'express';
import { categoryPolicy } from '../../policy/categories.policy.js';
import { settingPolicy } from '../../policy/settings.policy.js';
import { statusPolicy } from '../../policy/statuses.policy.js';
import * as categoriesRepository from '../categories/categories.repository.js';
import * as statusesRepository from '../statuses/statuses.repository.js';
import { globalValue, firstPaintFor } from '../settings/settings.service.js';
import * as commentsRepository from '../comments/comments.repository.js';
import { commentPolicy } from '../../policy/comments.policy.js';
import { toProfile } from '../users/users.service.js';

/* ════════════════════════════════════════════════════════════════════════════
 *                            ONE REQUEST, AT STARTUP
 *
 * What the application needs before it can draw anything, answered once.
 *
 * The shape this replaces is the reason it exists. Opening the board used to
 * mean three requests before the first useful pixel — capabilities for the
 * navigation, statuses and categories for the filter bar — and the taxonomy was
 * asked for again by five more components after that. None of them waited on
 * each other, so it was never the classic waterfall, but it was still three
 * round trips deciding whether the shell was drawn correctly, and each of them
 * could fail on its own and leave a screen that was half configured and did not
 * say so.
 *
 * WHAT IS IN HERE, AND WHY EACH PIECE
 *
 *   user         the settings screen edits it and the header greets with it.
 *                Their id, so that every write about themselves can name its
 *                target in the path — see users.routes.ts.
 *
 *   capabilities what they may do where there is no row to hang the answer on.
 *                The navigation cannot decide whether to offer the admin
 *                screens without it, and it is already asked for on every load.
 *
 *   settings     the resolved values that decide what the first paint LOOKS
 *                like: colour scheme, language, and the ordering and filters
 *                the board opens on. Applying any of them after first paint is
 *                a visible flash of the wrong thing, which is the test for
 *                belonging here. Each carries where it came from, because
 *                "using the default" and an explicit choice that matches it
 *                render differently and only one has anything to reset.
 *
 *   moderation   how many comments are waiting, for the admin who has to go and
 *                look at them. Present ONLY when there is a gate up and this
 *                caller may open it: with approval switched off there is no
 *                such thing as a waiting comment, and the indicator is absent
 *                rather than showing a confident zero.
 *
 *   taxonomy     the active categories and statuses. Bounded lists — tens of
 *                rows, not a page of them — that the filter bar, both request
 *                forms and the detail screen all need. They were six requests
 *                for two lists.
 *
 * WHAT IS DELIBERATELY NOT IN HERE
 *
 *   Notification preferences and everything else on the settings screens. They
 *   change nothing until somebody opens that screen, and it fetches them.
 *
 *   The administrative settings document, and the taxonomy's ?scope=all
 *   representation. One screen each, admin only, fetched when opened.
 *
 *   Anything request-shaped: the board, the pinned shelf, a request's comments.
 *   Those belong to a screen and a page of results, and putting them here would
 *   make the address bar's filters arrive too late to be honoured.
 *
 * WHAT IT NEVER SAYS
 *
 *   Who the caller is, in the sense of what they are. There is no role in this
 *   payload. `capabilities` answers every question a screen would have wanted
 *   one for, which is the same rule the rows have followed since slice 2.
 * ══════════════════════════════════════════════════════════════════════════ */
/**
 * The waiting count, or null when the question does not apply.
 *
 * Two ways it does not: the gate is down, so nothing is waiting on anybody's
 * judgement; or this caller cannot approve, in which case the number is none of
 * their business and the header has nothing to offer them anyway.
 */
async function countPendingFor(actor: Parameters<typeof toProfile>[0]): Promise<number | null> {
  if (!commentPolicy.approve(actor).allowed) return null;
  if (!(await globalValue('comments.requireApproval'))) return null;

  return commentsRepository.countPending();
}

export const getBootstrap: RequestHandler = async (req, res) => {
  const actor = req.actor;

  // In parallel, because they have nothing to say to each other. The whole
  // point of this endpoint is that the client does not have to know that.
  const [settings, categories, statuses, pendingComments] = await Promise.all([
    firstPaintFor(actor),
    categoriesRepository.listActive(),
    statusesRepository.listActive(),
    countPendingFor(actor),
  ]);

  res.status(200).json({
    data: {
      user: toProfile(actor),

      capabilities: {
        canManageCategories: categoryPolicy.manage(actor).allowed,
        canManageStatuses: statusPolicy.manage(actor).allowed,
        canManageSettings: settingPolicy.writeGlobal(actor).allowed,
      },

      settings,

      // Omitted, not zeroed. A count of 0 and "there is no moderation here" are
      // different statements, and only one of them should put anything in the
      // header.
      ...(pendingComments === null ? {} : { pendingComments }),

      taxonomy: { categories, statuses },
    },
  });
};
