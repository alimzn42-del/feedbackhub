/**
 * Optional demo content — NOT the seed.
 *
 * `npm run seed` loads the baseline the brief specifies: one admin, two regular
 * users, four categories, six statuses. That stays exactly as specified, so it
 * is not the place for a populated board.
 *
 * This script builds one instead: several authors, a second admin, votes spread
 * around, threads with replies, and comments removed in each of the three ways
 * so the tombstones are visible. It exists because a board where every request
 * belongs to the person looking at it cannot exercise its own rules — you
 * cannot vote on your own request, so nothing is votable.
 *
 *   npm run demo
 *
 * DESTRUCTIVE: it clears requests, votes and comments first, so re-running it
 * gives the same board rather than three copies of it. Users, categories and
 * statuses are left alone.
 */
import { connectForScripts } from './connect.mjs';

const connection = await connectForScripts();

/** Written relative to a fixed point so the board always looks the same. */
const BASE = new Date('2026-08-14T09:00:00Z').getTime();
const at = (hoursAgo) => new Date(BASE + hoursAgo * 3600_000).toISOString().slice(0, 23).replace('T', ' ');

const PEOPLE = [
  { email: 'admin@feedbackhub.local', name: 'Robin Alvarez', role: 'admin' },
  { email: 'priya@feedbackhub.local', name: 'Priya Raman', role: 'admin' },
  { email: 'dana@feedbackhub.local', name: 'Dana Okafor', role: 'user' },
  { email: 'sam@feedbackhub.local', name: 'Sam Lindqvist', role: 'user' },
  { email: 'marcus@feedbackhub.local', name: 'Marcus Bell', role: 'user' },
  { email: 'lena@feedbackhub.local', name: 'Lena Fischer', role: 'user' },
  { email: 'omar@feedbackhub.local', name: 'Omar Haddad', role: 'user' },
];

const REQUESTS = [
  ['Bulk export the board to CSV', 'Finance want the quarter\'s requests in a spreadsheet for their planning meeting. Copying them out by hand takes an afternoon and goes stale immediately.', 'feature', 'planned', 'dana', 96],
  ['Slack notification when a status changes', 'Half the team never opens the board, so they only hear that something shipped when somebody mentions it. A message in the team channel would close that gap.', 'feature', 'in-progress', 'sam', 88],
  ['Search across descriptions, not just titles', 'People describe the same problem with different words in the title. Searching the body would find the duplicate before a second request gets filed.', 'improvement', 'under-review', 'marcus', 80],
  ['Filter the board by author', 'Before a one-to-one I want to see what my reports have filed. Right now I scroll and squint.', 'improvement', 'new', 'lena', 72],
  ['Attach screenshots to a request', 'A bug report without a screenshot is a guessing game. Half of mine end up as a link to an image pasted somewhere else.', 'feature', 'new', 'omar', 64],
  ['Markdown in descriptions', 'Longer requests need a list or a code sample. At the moment everything is one wall of text.', 'improvement', 'declined', 'dana', 56],
  ['Weekly digest for managers', 'A Monday email with what moved would save me opening the board every day.', 'feature', 'new', 'sam', 48],
  ['Duplicate detection when filing', 'Warn me while I am typing that three people have already asked for this.', 'feature', 'under-review', 'marcus', 40],
  ['Keyboard shortcut to file a request', 'The friction of finding the button is enough that I write things down and forget them.', 'improvement', 'new', 'lena', 32],
  ['Dark mode follows the OS setting', 'Reading the board in the evening is harsh. It already has a dark theme; it just does not pick it up automatically.', 'improvement', 'done', 'omar', 24],
  ['Board loads slowly with many requests', 'Since we passed a few hundred requests the first paint takes several seconds.', 'bug', 'under-review', 'dana', 20],
  ['Category cannot be changed after filing', 'I picked Bug when I meant Improvement and now it is wrong forever.', 'bug', 'new', 'sam', 16],
  ['How do I withdraw a request I filed by mistake?', 'I could not find a way and did not want to leave noise on the board.', 'question', 'done', 'marcus', 12],
  ['Show who voted for a request', 'Knowing which team wants something changes how it gets prioritised.', 'question', 'new', 'lena', 8],
];

/** requestIndex -> the people who voted for it. */
const VOTES = {
  0: ['admin', 'priya', 'sam', 'marcus', 'lena', 'omar'],
  1: ['admin', 'dana', 'marcus', 'lena', 'omar'],
  2: ['priya', 'dana', 'sam', 'lena'],
  3: ['admin', 'dana', 'omar'],
  4: ['priya', 'sam', 'lena'],
  5: ['dana', 'marcus'],
  6: ['admin', 'omar'],
  7: ['lena', 'sam'],
  8: ['marcus'],
  9: ['admin', 'priya', 'dana', 'sam', 'marcus', 'lena'],
  10: ['priya', 'omar', 'sam'],
  11: ['dana'],
  13: ['omar', 'lena'],
};

async function run() {
  console.log('clearing requests, votes and comments…');
  // Comments and votes cascade from the requests they belong to.
  await connection.query('DELETE FROM feedback_requests');

  const users = new Map();
  for (const person of PEOPLE) {
    await connection.execute(
      `INSERT INTO users (email, display_name, role) VALUES (:email, :name, :role) AS incoming
       ON DUPLICATE KEY UPDATE display_name = incoming.display_name, role = incoming.role`,
      { email: person.email, name: person.name, role: person.role },
    );
    const [rows] = await connection.execute('SELECT id FROM users WHERE email = :email', {
      email: person.email,
    });
    users.set(person.email.split('@')[0], rows[0].id);
  }
  console.log(`${PEOPLE.length} people (2 admins, 5 regular users)`);

  const [categoryRows] = await connection.query('SELECT id, slug FROM categories');
  const categories = new Map(categoryRows.map((r) => [r.slug, r.id]));
  const [statusRows] = await connection.query('SELECT id, slug FROM statuses');
  const statuses = new Map(statusRows.map((r) => [r.slug, r.id]));

  const ids = [];
  for (const [title, body, category, status, author, hoursAgo] of REQUESTS) {
    const [result] = await connection.execute(
      `INSERT INTO feedback_requests (title, description, category_id, status_id, author_id, created_at, updated_at)
       VALUES (:title, :body, :category, :status, :author, :created, :created)`,
      {
        title,
        body,
        category: categories.get(category),
        status: statuses.get(status),
        author: users.get(author),
        created: at(-hoursAgo),
      },
    );
    ids.push(result.insertId);
  }
  console.log(`${ids.length} requests across ${new Set(REQUESTS.map((r) => r[4])).size} authors`);

  let voteCount = 0;
  for (const [index, voters] of Object.entries(VOTES)) {
    for (const voter of voters) {
      await connection.execute(
        'INSERT IGNORE INTO votes (request_id, user_id) VALUES (:request, :user)',
        { request: ids[Number(index)], user: users.get(voter) },
      );
      voteCount += 1;
    }
  }
  console.log(`${voteCount} votes`);

  // Pinned by both admins, at different times, so the shelf ordering is visible.
  await connection.execute(
    'UPDATE feedback_requests SET pinned_at = :when, pinned_by = :who WHERE id = :id',
    { when: at(-6), who: users.get('admin'), id: ids[1] },
  );
  await connection.execute(
    'UPDATE feedback_requests SET pinned_at = :when, pinned_by = :who WHERE id = :id',
    { when: at(-30), who: users.get('priya'), id: ids[10] },
  );
  await connection.execute(
    'UPDATE feedback_requests SET pinned_at = :when, pinned_by = :who WHERE id = :id',
    { when: at(-2), who: users.get('priya'), id: ids[0] },
  );
  console.log('3 pinned, by both admins');

  const comment = async ({ request, parent = null, author, body, hoursAgo, deletedBy, withParent }) => {
    const [result] = await connection.execute(
      `INSERT INTO comments (request_id, parent_id, author_id, body, created_at, deleted_at, deleted_by, hidden_with_parent)
       VALUES (:request, :parent, :author, :body, :created, :deletedAt, :deletedBy, :withParent)`,
      {
        request,
        parent,
        author: users.get(author),
        body,
        created: at(-hoursAgo),
        deletedAt: deletedBy ? at(-hoursAgo + 1) : null,
        deletedBy: deletedBy ? users.get(deletedBy) : null,
        withParent: withParent ? 1 : 0,
      },
    );
    return result.insertId;
  };

  // A normal thread.
  const a = await comment({ request: ids[0], author: 'sam', body: 'Would this be the filtered view or the whole board? Finance only ever want the current quarter.', hoursAgo: 90 });
  await comment({ request: ids[0], parent: a, author: 'dana', body: 'Whatever is on screen, I think — otherwise you export and then filter in the spreadsheet anyway.', hoursAgo: 88 });
  await comment({ request: ids[0], parent: a, author: 'lena', body: 'Agreed. And a header row, please.', hoursAgo: 84 });
  await comment({ request: ids[0], author: 'omar', body: 'CSV is fine but XLSX keeps the column widths. Not important.', hoursAgo: 80 });

  // A thread where an admin has moderated one comment.
  const b = await comment({ request: ids[1], author: 'marcus', body: 'Which channel would it post to? Per-team would be better than one firehose.', hoursAgo: 70 });
  await comment({ request: ids[1], parent: b, author: 'admin', body: 'Per-team, configurable. One channel for everything gets muted within a week.', hoursAgo: 68 });
  await comment({ request: ids[1], author: 'omar', body: 'removed by a moderator', hoursAgo: 66, deletedBy: 'priya' });

  // An author removed their own comment, and its reply went with it.
  const c = await comment({ request: ids[2], author: 'dana', body: 'withdrawn by its author', hoursAgo: 60, deletedBy: 'dana' });
  await comment({ request: ids[2], parent: c, author: 'sam', body: 'hidden along with the comment above', hoursAgo: 58, deletedBy: 'dana', withParent: true });
  await comment({ request: ids[2], author: 'lena', body: 'Worth searching comments too — half the context ends up down here.', hoursAgo: 55 });

  // An edited comment.
  const d = await comment({ request: ids[9], author: 'sam', body: 'This works already if you set it manually, it just does not follow the system setting.', hoursAgo: 20 });
  await connection.execute('UPDATE comments SET edited_at = :when WHERE id = :id', {
    when: at(-19),
    id: d,
  });
  await comment({ request: ids[9], parent: d, author: 'marcus', body: 'Confirmed — prefers-color-scheme is all it needs.', hoursAgo: 18 });

  await comment({ request: ids[10], author: 'priya', body: 'How many requests are we talking about? I want to reproduce it before anyone starts on it.', hoursAgo: 15 });
  await comment({ request: ids[12], author: 'admin', body: 'You cannot yet — deleting your own request is on the list.', hoursAgo: 10 });

  const [[{ total }]] = await connection.query('SELECT COUNT(*) AS total FROM comments');
  console.log(`${total} comments, including one removed by its author, one by a moderator, and one hidden with its parent`);
}

try {
  await run();
  console.log('\ndone. Set DEV_CURRENT_USER_EMAIL in .env to any of:');
  for (const person of PEOPLE) {
    console.log(`  ${person.email.padEnd(30)} ${person.name} (${person.role})`);
  }
} catch (error) {
  console.error(`\ndemo data failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
