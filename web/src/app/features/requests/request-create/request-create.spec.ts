import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RequestCreate } from './request-create';

const CATEGORIES = {
  data: [
    { id: 1, name: 'Bug', slug: 'bug' },
    { id: 2, name: 'Feature', slug: 'feature' },
  ],
};

describe('RequestCreate', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      // A stub route for '/requests': the success path navigates there, and an
      // unroutable navigation surfaces as an unhandled rejection rather than a
      // test failure, which is worse than a failure.
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  /**
   * A resource propagates its response over a microtask, so flushing alone is
   * not enough — the fixture has to settle before the options exist.
   */
  async function render(withCategories = true) {
    const fixture = TestBed.createComponent(RequestCreate);
    fixture.detectChanges();

    if (withCategories) {
      http.expectOne('/api/categories').flush(CATEGORIES);
      await fixture.whenStable();
      fixture.detectChanges();
    }

    return fixture;
  }

  function fill(fixture: Awaited<ReturnType<typeof render>>, title: string, description: string) {
    const component = fixture.componentInstance as unknown as {
      form: { patchValue: (v: Record<string, unknown>) => void };
      submit: () => void;
    };
    component.form.patchValue({ title, description, categoryId: 2 });
    return component;
  }

  it('loads its categories from the server rather than hardcoding them', async () => {
    const fixture = await render();

    const options = fixture.nativeElement.querySelectorAll('option');

    // The placeholder plus the two the server returned.
    expect(options.length).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('Bug');
    expect(fixture.nativeElement.textContent).toContain('Feature');
  });

  it('shows every validation message at once instead of one per attempt', async () => {
    const fixture = await render();
    const component = fixture.componentInstance as unknown as { submit: () => void };

    component.submit();
    fixture.detectChanges();
    await fixture.whenStable();

    const messages = [...fixture.nativeElement.querySelectorAll('.field__error')].map(
      (el: Element) => el.textContent?.trim(),
    );

    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('Give the request a title');
    expect(messages[1]).toContain('Describe what you are asking for');
    expect(messages[2]).toContain('Choose a category');

    // Nothing was sent: the form did not reach the network.
    http.expectNone('/api/requests');
  });

  it('marks the offending input invalid for assistive technology', async () => {
    const fixture = await render();
    (fixture.componentInstance as unknown as { submit: () => void }).submit();
    fixture.detectChanges();
    await fixture.whenStable();

    const title = fixture.nativeElement.querySelector('#title');

    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toContain('title-error');
  });

  it('sends trimmed values and never sends a status or an author', async () => {
    const fixture = await render();
    const component = fill(fixture, '  A good enough title  ', '  A description long enough to pass validation.  ');

    component.submit();
    fixture.detectChanges();

    const request = http.expectOne('/api/requests');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      title: 'A good enough title',
      description: 'A description long enough to pass validation.',
      categoryId: 2,
    });

    request.flush({ data: { id: 1 } });
    await fixture.whenStable();
  });

  it('attaches a server field error to the control it names', async () => {
    const fixture = await render();
    const component = fill(fixture, 'A good enough title', 'A description long enough to pass validation.');

    component.submit();
    fixture.detectChanges();

    http.expectOne('/api/requests').flush(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The submitted values are not valid.',
          requestId: 'abc-123',
          details: [
            {
              field: 'categoryId',
              code: 'NOT_FOUND',
              message: 'That category does not exist or is no longer available.',
            },
          ],
        },
      },
      { status: 422, statusText: 'Unprocessable Content' },
    );

    fixture.detectChanges();
    await fixture.whenStable();

    const fieldError = fixture.nativeElement.querySelector('#categoryId-error');

    expect(fieldError?.textContent).toContain('That category does not exist');
    // A 422 whose issues all landed on controls needs no banner shouting as well.
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('falls back to a banner when the failure names no field', async () => {
    const fixture = await render();
    const component = fill(fixture, 'A good enough title', 'A description long enough to pass validation.');

    component.submit();
    fixture.detectChanges();

    http.expectOne('/api/requests').flush(
      {
        error: {
          code: 'SERVER_MISCONFIGURED',
          message: 'No default status is configured, so new requests cannot be filed.',
          requestId: 'abc-999',
        },
      },
      { status: 500, statusText: 'Server Error' },
    );

    fixture.detectChanges();
    await fixture.whenStable();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');

    expect(alert?.textContent).toContain('No default status is configured');
    expect(alert?.textContent).toContain('abc-999');
  });

  it('keeps submission disabled while the categories are still unknown', async () => {
    const fixture = await render(false);

    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);

    http.expectOne('/api/categories').flush(CATEGORIES);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
  });
});
