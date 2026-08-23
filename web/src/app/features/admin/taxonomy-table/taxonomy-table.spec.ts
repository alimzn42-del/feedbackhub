import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  TaxonomyTable,
  type CreateIntent,
  type RenameIntent,
  type TaxonomyRow,
} from './taxonomy-table';

/* ════════════════════════════════════════════════════════════════════════════
 * The taxonomy table, used for both categories and statuses.
 *
 * Everything here goes through the DOM. Reordering especially: the requirement
 * is that it works from a keyboard, and the only way to show that is to press
 * the controls a keyboard can reach.
 * ══════════════════════════════════════════════════════════════════════════ */

function row(overrides: Partial<TaxonomyRow> = {}): TaxonomyRow {
  return {
    id: 1,
    name: 'Feature',
    slug: 'feature',
    sortOrder: 0,
    requestCount: 0,
    ...overrides,
  };
}

const CATEGORIES: TaxonomyRow[] = [
  row({ id: 2, name: 'Feature', slug: 'feature', sortOrder: 0, requestCount: 4 }),
  row({ id: 4, name: 'Bug', slug: 'bug', sortOrder: 1, requestCount: 0 }),
  row({ id: 6, name: 'Question', slug: 'question', sortOrder: 2, requestCount: 2 }),
];

describe('TaxonomyTable', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  function render(rows: TaxonomyRow[] = CATEGORIES, options: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(TaxonomyTable);
    fixture.componentRef.setInput('heading', 'Categories');
    fixture.componentRef.setInput('noun', 'category');
    fixture.componentRef.setInput('rows', rows);

    for (const [key, value] of Object.entries(options)) {
      fixture.componentRef.setInput(key, value);
    }

    fixture.detectChanges();
    return fixture;
  }

  type Fixture = ReturnType<typeof render>;

  function byLabel(fixture: Fixture, label: string): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(`button[aria-label="${label}"]`);
  }

  /* ── Rendering ───────────────────────────────────────────────────────── */

  it('shows the slug, and offers no way to change it', () => {
    const fixture = render();

    expect(fixture.nativeElement.textContent).toContain('feature');
    // The slug is in URLs people have shared. It is rendered as text, never as
    // an input, and there is no endpoint for it either.
    const inputs = Array.from(
      fixture.nativeElement.querySelectorAll('input'),
    ) as HTMLInputElement[];
    expect(inputs.map((input) => input.value)).not.toContain('feature');
  });

  it('shows how many requests use each row, so retiring is informed', () => {
    const fixture = render();

    expect(fixture.nativeElement.textContent).toContain('4 requests');
    expect(fixture.nativeElement.textContent).toContain('0 requests');
  });

  it('offers no retire button unless the taxonomy is retirable', () => {
    const statuses = render(CATEGORIES, { noun: 'status', hasDefault: true });

    // Statuses are not retired: a status is a position requests are sitting in.
    expect(byLabel(statuses, 'Retire Feature')).toBeNull();

    const categories = render(CATEGORIES, { retirable: true });
    expect(byLabel(categories, 'Retire Feature')).not.toBeNull();
  });

  it('marks the default status and does not offer to make it the default again', () => {
    const fixture = render(
      [
        row({ id: 1, name: 'New', slug: 'new', isDefault: true }),
        row({ id: 5, name: 'Done', slug: 'done', isDefault: false }),
      ],
      { noun: 'status', hasDefault: true },
    );

    expect(fixture.nativeElement.textContent).toContain('Default');
    expect(byLabel(fixture, 'Make New the default status')).toBeNull();
    expect(byLabel(fixture, 'Make Done the default status')).not.toBeNull();
  });

  it('shows a retired row as retired without hiding it', () => {
    const fixture = render(
      [row({ id: 2, name: 'Feature', archivedAt: '2026-08-22T09:00:00.000Z' })],
      {
        retirable: true,
      },
    );

    // Still on screen: it is still real, still carried by requests, and still
    // the thing an admin came here to reconsider.
    expect(fixture.nativeElement.textContent).toContain('Feature');
    expect(fixture.nativeElement.textContent).toContain('Retired');
    expect(byLabel(fixture, 'Restore Feature')).not.toBeNull();
  });

  /* ── Reordering ──────────────────────────────────────────────────────── */

  it('reorders from the keyboard, sending the whole new order', () => {
    const fixture = render();
    const orders: number[][] = [];
    fixture.componentInstance.reordered.subscribe((ids) => orders.push(ids));

    byLabel(fixture, 'Move Bug up')!.click();

    // The whole order, not "Bug moved": a partial update can half-apply and
    // leave a list in an order nobody chose.
    expect(orders[0]).toEqual([4, 2, 6]);
  });

  it('moves a row down as well', () => {
    const fixture = render();
    const orders: number[][] = [];
    fixture.componentInstance.reordered.subscribe((ids) => orders.push(ids));

    byLabel(fixture, 'Move Feature down')!.click();

    expect(orders[0]).toEqual([4, 2, 6]);
  });

  it('cannot move the first row up or the last row down', () => {
    const fixture = render();

    expect(byLabel(fixture, 'Move Feature up')!.disabled).toBe(true);
    expect(byLabel(fixture, 'Move Question down')!.disabled).toBe(true);
    expect(byLabel(fixture, 'Move Feature down')!.disabled).toBe(false);
  });

  it('names the row in each control, so the buttons are not two anonymous arrows', () => {
    const fixture = render();

    // "Move Bug up" rather than "up" — a screen reader user hears which row.
    expect(byLabel(fixture, 'Move Bug up')).not.toBeNull();
    expect(byLabel(fixture, 'Move Bug down')).not.toBeNull();
  });

  /* ── Renaming ────────────────────────────────────────────────────────── */

  it('renames through the row, emitting the new name', () => {
    const fixture = render();
    const renames: RenameIntent[] = [];
    fixture.componentInstance.renamed.subscribe((intent) => renames.push(intent));

    byLabel(fixture, 'Rename Bug')!.click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#rename-4') as HTMLInputElement;
    expect(input.value).toBe('Bug');

    input.value = 'Defect';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = input.closest('form') as HTMLFormElement;
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);

    expect(renames[0]).toEqual({ id: 4, name: 'Defect' });
    // A native submit would reload the page and lose the edit.
    expect(submit.defaultPrevented).toBe(true);
  });

  it('sends nothing when a rename changes nothing', () => {
    const fixture = render();
    const renames: RenameIntent[] = [];
    fixture.componentInstance.renamed.subscribe((intent) => renames.push(intent));

    byLabel(fixture, 'Rename Bug')!.click();
    fixture.detectChanges();

    const form = fixture.nativeElement
      .querySelector('#rename-4')!
      .closest('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(renames).toHaveLength(0);
  });

  /* ── Adding ──────────────────────────────────────────────────────────── */

  it('suggests a slug from the name, and stops once the slug is typed in', () => {
    const fixture = render();
    const name = fixture.nativeElement.querySelector('#new-name-category') as HTMLInputElement;
    const slug = fixture.nativeElement.querySelector('#new-slug-category') as HTMLInputElement;

    name.value = 'Developer Experience';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(slug.value).toBe('developer-experience');

    slug.value = 'dx';
    slug.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    name.value = 'Developer Experience and more';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // A suggestion, not a derivation: the slug is permanent and the name is
    // not, so the two have to be free to differ from the first moment.
    expect(slug.value).toBe('dx');
  });

  it('adds through the real form, without letting the browser submit it', () => {
    const fixture = render();
    const created: CreateIntent[] = [];
    fixture.componentInstance.created.subscribe((intent) => created.push(intent));

    const name = fixture.nativeElement.querySelector('#new-name-category') as HTMLInputElement;
    name.value = 'Documentation';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = name.closest('form') as HTMLFormElement;
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);

    expect(created[0]).toEqual({ name: 'Documentation', slug: 'documentation' });
    expect(submit.defaultPrevented).toBe(true);
  });

  it('sends nothing when the name is empty', () => {
    const fixture = render();
    const created: CreateIntent[] = [];
    fixture.componentInstance.created.subscribe((intent) => created.push(intent));

    const form = fixture.nativeElement.querySelector('.add') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(created).toHaveLength(0);
  });

  it('puts a server field error against the field that caused it', () => {
    const fixture = render(CATEGORIES, {
      issues: { name: 'A category called "Bug" already exists.' },
    });

    const name = fixture.nativeElement.querySelector('#new-name-category') as HTMLInputElement;

    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('already exists');
  });
});
