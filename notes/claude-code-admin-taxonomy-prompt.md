# Admin screen — categories and statuses

One screen, two tables. Admin only, refused at the route before it is hidden in the interface.

---

## Categories

- Add, rename, reorder, retire.
- **Retiring is not deleting.** A retired category disappears from the selector on the create and edit forms, but requests already carrying it keep displaying it normally. The rows they point at must survive.
- **The slug is immutable once created.** It travels in the URL as a filter, and changing it breaks links people have already shared. The display name is freely editable — that separation is why the two columns exist.
- Show how many requests use each category, so retiring is an informed decision rather than a guess.
- A retired category can be restored.
- **Adding and retiring are independent operations.** The brief's "adds a new category and retires an unused one" describes an admin doing two things in one sitting, not a rule coupling them. Neither requires the other, and there is no cap on how many categories are active. "Unused" there is description, not a precondition: a category with requests on it can still be retired, since retirement exists precisely so those requests keep rendering. Show the usage count alongside a note that existing requests keep the category while it disappears from the selectors — inform the decision, do not block it.

## Statuses

Everything above **except retirement**, plus:

- **One status is the default** — the one a new request receives. Exactly one, always.
- The database constraint enforces *at most one*. The application must enforce the lower bound: setting a new default clears the old one in the same transaction, and nothing may leave the table without a default.

**Statuses are not retired**, unlike categories. A category is a label a request keeps regardless; a status is a position in a workflow that requests are currently sitting in, and retiring one would strand them with nowhere to go. So: add, rename, reorder, set default — and no archive column behaviour here.

---

## Behaviour

Reordering sets the display order used everywhere the taxonomy is listed — the filters, the create form, the status selector on the detail page.

Every mutation is a real request with pending, success and failure states. Validation errors map to the field. Duplicate names and duplicate slugs are refused with a message naming the conflict, not a generic failure.

Keyboard operable throughout, including reordering — a drag-only implementation is not acceptable. Visible focus, and destructive actions confirmed.

---

## Authorization

Route-level tests: a regular user attempting each mutation → `403`, asserting nothing was written. The interface hiding the screen is not the guarantee.

---

## Not in scope

Application-wide settings — registration policy, comment approval, rate limits, the feature flag — are the next slice. This screen is the taxonomy only.
