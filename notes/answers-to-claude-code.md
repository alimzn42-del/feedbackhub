# Answers — proceed after reading

## 5. Your objection: accepted

You are right, and the rule as I wrote it was wrong. An admin who leaves the company keeps the role permanently, and the only exit is a manual database edit — which is exactly what the audit trail exists to prevent. Constraining a social problem with a technical dead end was the wrong trade.

The rule is now:

- Any admin may promote a user to admin.
- Any admin may demote any admin, including themselves.
- A demotion that would leave zero admins is rejected.
- Every role change is recorded with actor, target, direction, and timestamp.

The risk I was guarding against is adequately handled by the fact that demotion is reversible, recorded, and floor-limited.

---

## 1. Data access layer: `mysql2/promise`, yes — hand-rolled migration runner, no

Take `mysql2/promise` with hand-written SQL confined to repository files. Your reasoning holds: the vote count is a JOIN with GROUP BY, and a reviewer should see the real DDL rather than a builder's approximation. Skip Kysely — an extra layer and a schema-type file to keep in sync is not justified by four tables.

But do not write the migration runner. Keep the raw `.sql` files exactly as you proposed and run them with an existing tool — `umzug` or equivalent. Forty lines reimplementing a solved problem reads as effort spent in the wrong place, and this assignment is partly judged on where effort goes.

## 2. Pagination: offset/limit, confirmed

Your reasoning is correct — the UI needs to render "page 4 of 7" and keyset cannot produce that, and this dataset will never reach the size where the difference matters.

Fix the response envelope now, since every list screen after this one will consume it:

```
{ items: [...], total: number, page: number, pageSize: number }
```

Query parameters: `?page=&pageSize=`, with a validated maximum on `pageSize`.

## 3. Zod: no objection

Proceed, mapped to the `details` array. Validation messages must name the field and state what is wrong in terms a user can act on — not a serialized schema error.

## 4. `preferences` JSON: defer it

Add the column in the preferences slice, not now. A column nothing reads or writes is dead weight, and migrations exist precisely so that schema arrives when it is needed.

Good catch on the inconsistency — decision 3 describes where preferences will live, not what slice 1 builds.

---

Proceed to slice 1.
