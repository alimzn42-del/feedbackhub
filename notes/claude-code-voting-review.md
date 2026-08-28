# Voting slice — review

## 1. Self-voting: keep the rule, but the reasoning in the record has to be mine, not the test's

I'm keeping the restriction. The justification is a product one: a vote is a signal of support from someone **other than** the person who filed the request. The author's interest is already expressed by filing it. Counting their own vote gives every request one free point without changing any relative ordering, and blurs the distinction between *I submitted this* and *I back this*.

Add to `SCOPE.md`:

> The brief does not settle self-voting. It is disallowed: a vote is an expression of support from someone other than the submitter, and the submitter's interest is already expressed by submitting.

**One thing to correct in how it was presented.** You wrote that the self-vote rule finally gave the route-level `403` test something real. That framing is backwards, and I don't want it in the log that way — a rule was not needed to satisfy a test. Two genuine refusals already existed in this slice: voting twice, and withdrawing a vote that was never cast. Either could have carried that test without introducing a rule the brief doesn't ask for. Correct the note in `notes/ai-log.md` to say the rule is a product decision, tested through the route like everything else.

**Display.** A disabled button with no explanation reads as a broken control. On your own request, show the count without a button, with a short label marking it as yours.

---

## 2. Duplicate votes — I need this verified, not reasoned about

You wrote that duplicates can't happen because the button toggles. That is a statement about the browser, and the endpoint is reachable without one — by a double click, by two open tabs racing, or by anyone sending the request directly. The brief judges authorization and correctness on the server, not in the UI.

Confirm three things, by checking rather than recalling:

1. Does `UNIQUE (user_id, request_id)` actually exist in the migration? Show the `SHOW INDEX` output.
2. What does the endpoint return when a duplicate vote arrives — a handled response, or a driver error surfacing as `500`? The same question for withdrawing a vote that isn't there.
3. Is there a test that sends the vote twice **through the route** and asserts the second is handled and no second row is written?

If the constraint is already there from slice 1, say so and show it. If any of the three is missing, that is this slice's remaining work.

The general rule, since this has come up three times now: assume there is no browser, and that someone is calling the endpoint directly. The UI's job is to spare people dead ends; it never establishes a guarantee.

---

## 3. `canVote` — good call, and one question

Computing the answer server-side rather than exposing identity to the client is the right instinct: the rule stays in the policy module with no second copy in the browser.

But `canVote` alone doesn't render the control — the card also needs to show whether *this* actor has already voted, so the button can display its active state. Tell me what the second field is and where it's computed. If it doesn't exist, the client is inferring it from something, and I want to know what.

---

## 4. Measuring the sort instead of asserting it

Running `EXPLAIN` on real data and recording the filesort, rather than claiming the query scales, is the right way to hand me that. Keep doing it for anything where the cost isn't obvious from reading the SQL.

The note in `DECISIONS.md` should say plainly where this stops being acceptable — a row count, not a vague caveat — so the trade is legible to someone reading it cold.

---

## 5. Still outstanding from the previous slice

A regular user refused an **admin-only** action, tested through the route. You're right that nothing admin-gated exists yet; it lands with status change and pinning. Flag it then — I don't want it to slip past that slice.
