import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommentThread } from './comment-thread';
import type { Comment } from '../../../core/api/api.types';
import { provideStubbedConfig } from '../../../core/config/app-config.testing';

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    parentId: null,
    author: { id: 2, displayName: 'Dana Okafor' },
    body: 'The original comment',
    createdAt: '2026-08-21T09:00:00.000Z',
    editedAt: null,
    isDeleted: false,
    deletedReason: null,
    canEdit: false,
    canDelete: false,
    canReply: true,
    canApprove: false,
    isPending: false,
    replies: [],
    ...overrides,
  };
}

describe('CommentThread', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideStubbedConfig(), provideHttpClient(), provideHttpClientTesting()],
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

  async function render(comments: Comment[], awaitsApproval = false) {
    const fixture = TestBed.createComponent(CommentThread);
    fixture.componentRef.setInput('requestId', 7);
    fixture.detectChanges();
    http.expectOne('/api/requests/7/comments').flush({ data: comments, awaitsApproval });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /** Lets the response settle so the follow-up reload has actually been sent. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const text = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.textContent?.replace(/\s+/g, ' ') ?? '';

  it('invites the first comment rather than showing an empty box', async () => {
    const fixture = await render([]);

    expect(text(fixture)).toContain('No comments yet');
  });

  it('renders a comment and its reply, nested', async () => {
    const fixture = await render([
      comment({ replies: [comment({ id: 2, parentId: 1, body: 'A reply' })] }),
    ]);

    expect(fixture.nativeElement.querySelectorAll('.thread__list > .comment').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('.replies .comment--reply').length).toBe(1);
    expect(text(fixture)).toContain('A reply');
  });

  it('counts replies in the total, not just top-level comments', async () => {
    const fixture = await render([
      comment({ replies: [comment({ id: 2, parentId: 1 }), comment({ id: 3, parentId: 1 })] }),
      comment({ id: 4 }),
    ]);

    expect(fixture.nativeElement.querySelector('.thread__count')?.textContent?.trim()).toBe('4');
  });

  it('never offers Reply on a reply', async () => {
    // Threads are one level deep. The server says canReply:false on replies;
    // the template does not render the control for them at all.
    const fixture = await render([
      comment({ replies: [comment({ id: 2, parentId: 1, canReply: true })] }),
    ]);

    const replyButtons = [...fixture.nativeElement.querySelectorAll('.replies .link-button')].map(
      (b: Element) => b.textContent?.trim(),
    );

    expect(replyButtons).not.toContain('Reply');
  });

  it('posts through the actual button, not just the method', async () => {
    // This is the test that was missing. The composer is a single control, so
    // no Angular directive sits on its <form> and (ngSubmit) never fired —
    // the browser submitted natively and the page reloaded, discarding the
    // text. Calling submitComment() directly could never have caught that.
    const fixture = await render([comment({ canReply: true })]);

    const box = fixture.nativeElement.querySelector('#new-comment') as HTMLTextAreaElement;
    box.value = 'Typed into the real textarea';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '.composer button[type=submit]',
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    const posted = http.expectOne('/api/requests/7/comments');
    expect(posted.request.method).toBe('POST');
    expect(posted.request.body).toEqual({ body: 'Typed into the real textarea' });

    posted.flush({ data: comment({ id: 9, body: 'Typed into the real textarea' }) });
    await tick();
    await fixture.whenStable();
    fixture.detectChanges();

    // Appended in place: no second GET, and the comment is on screen.
    http.expectNone('/api/requests/7/comments');
    expect(text(fixture)).toContain('Typed into the real textarea');
    expect(box.value).toBe('');

    // And the emptied box does not then complain about being empty. Clearing
    // the value left the control DIRTY from having been typed in, so it failed
    // `required` immediately and told the author to write something first about
    // the comment they had just posted.
    expect(text(fixture)).not.toContain('Write something first');
  });

  it('does not complain about an empty reply box that was only just reopened', async () => {
    const fixture = await render([comment({ canReply: true })]);

    // The trigger in the comment's action row, not the submit button inside the
    // composer — both say "Reply".
    const openReply = () => {
      const trigger = Array.from(
        fixture.nativeElement.querySelectorAll('.comment__actions button'),
      ).find((candidate) => (candidate as HTMLButtonElement).textContent?.trim() === 'Reply') as
        HTMLButtonElement | undefined;
      trigger?.click();
      fixture.detectChanges();
    };

    openReply();
    const box = fixture.nativeElement.querySelector('#reply-1') as HTMLTextAreaElement;
    box.value = 'Half a thought';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    openReply(); // closes it
    openReply(); // and opens it again

    // The same dirty-not-pristine bug: reopening showed a validation message
    // before a key had been pressed.
    expect(text(fixture)).not.toContain('Write something first');
  });

  it('does not let the browser submit the form itself', async () => {
    // A native submit reloads the page. If the handler ever stops calling
    // preventDefault, this fails rather than silently losing people's words.
    const fixture = await render([]);
    const form = fixture.nativeElement.querySelector('.composer') as HTMLFormElement;

    (
      fixture.componentInstance as unknown as {
        newComment: { setValue: (v: string) => void };
      }
    ).newComment.setValue('anything');

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    http.expectOne('/api/requests/7/comments').flush({ data: comment({ id: 9 }) });
    await tick();
    await fixture.whenStable();
  });

  it('sends parentId when replying, and adds the reply under its parent', async () => {
    const fixture = await render([comment({ canReply: true })]);
    const component = fixture.componentInstance as unknown as {
      replyBody: { setValue: (v: string) => void };
      openReply: (c: Comment) => void;
      submitReply: (e: Event, c: Comment) => void;
    };

    component.openReply(comment({ id: 1 }));
    component.replyBody.setValue('  A reply, with padding  ');
    component.submitReply(new Event('submit'), comment({ id: 1 }));

    const replied = http.expectOne('/api/requests/7/comments');
    // Trimmed, and carrying the comment it answers.
    expect(replied.request.body).toEqual({ body: 'A reply, with padding', parentId: 1 });

    replied.flush({
      data: comment({ id: 10, parentId: 1, body: 'A reply, with padding' }),
    });
    await tick();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.replies .comment--reply').length).toBe(1);
    expect(text(fixture)).toContain('A reply, with padding');
  });

  it('refuses to send an empty comment', async () => {
    const fixture = await render([]);
    const component = fixture.componentInstance as unknown as {
      newComment: { setValue: (v: string) => void };
      submitComment: (e: Event) => void;
    };

    component.newComment.setValue('   ');
    component.submitComment(new Event('submit'));

    http.expectNone('/api/requests/7/comments');
    fixture.detectChanges();
    expect(text(fixture)).toContain('Write something first.');
  });

  it('shows who removed a comment, distinguishing the three cases', async () => {
    const fixture = await render([
      comment({ id: 1, isDeleted: true, deletedReason: 'author', author: null, body: null }),
      comment({ id: 2, isDeleted: true, deletedReason: 'moderator', author: null, body: null }),
      comment({
        id: 3,
        replies: [
          comment({
            id: 4,
            parentId: 3,
            isDeleted: true,
            deletedReason: 'with-parent',
            author: null,
            body: null,
          }),
        ],
      }),
    ]);

    const body = text(fixture);

    expect(body).toContain('The author removed this comment.');
    expect(body).toContain('An admin removed this comment.');
    expect(body).toContain('Removed along with the comment it replied to.');
  });

  it('keeps a removed comment in place so its replies still hang from something', async () => {
    const fixture = await render([
      comment({
        isDeleted: true,
        deletedReason: 'moderator',
        author: null,
        body: null,
        replies: [comment({ id: 2, parentId: 1, body: 'A reply that survived' })],
      }),
    ]);

    expect(text(fixture)).toContain('An admin removed this comment.');
    expect(text(fixture)).toContain('A reply that survived');
  });

  it('offers edit and delete only where the server allows them', async () => {
    const fixture = await render([
      comment({ id: 1, canEdit: false, canDelete: false }),
      comment({ id: 2, canEdit: true, canDelete: true }),
    ]);

    const rows = fixture.nativeElement.querySelectorAll('.thread__list > .comment');
    const labels = (row: Element) =>
      [...row.querySelectorAll('.link-button')].map((b) => b.textContent?.trim());

    expect(labels(rows[0])).not.toContain('Edit');
    expect(labels(rows[0])).not.toContain('Delete');
    expect(labels(rows[1])).toContain('Edit');
    expect(labels(rows[1])).toContain('Delete');
  });

  it('reloads the thread after a delete rather than guessing the outcome', async () => {
    // The server decides whether the row goes or becomes a tombstone, and
    // whether replies are hidden with it. Three shapes; none is guessed at.
    const fixture = await render([comment({ canDelete: true })]);

    const deleteButton = [...fixture.nativeElement.querySelectorAll('.link-button')].find(
      (b: Element) => b.textContent?.trim() === 'Delete',
    ) as HTMLButtonElement;

    deleteButton.click();
    fixture.detectChanges();

    // Do not await stability before flushing the reload: the testing backend
    // holds that request open, so waiting first would deadlock.
    http.expectOne('/api/comments/1').flush({ data: { kind: 'soft' } });
    await tick();

    http
      .expectOne('/api/requests/7/comments')
      .flush({ data: [comment({ isDeleted: true, deletedReason: 'author', body: null })] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(text(fixture)).toContain('The author removed this comment.');
  });

  it('surfaces the server message when a mutation is refused', async () => {
    const fixture = await render([comment({ canDelete: true })]);

    const deleteButton = [...fixture.nativeElement.querySelectorAll('.link-button')].find(
      (b: Element) => b.textContent?.trim() === 'Delete',
    ) as HTMLButtonElement;

    deleteButton.click();
    fixture.detectChanges();

    http.expectOne('/api/comments/1').flush(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Only the author or an admin can delete this comment.',
          requestId: 'abc',
        },
      },
      { status: 403, statusText: 'Forbidden' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'Only the author or an admin',
    );
  });

  it('marks an edited comment as edited', async () => {
    const fixture = await render([comment({ editedAt: '2026-08-21T10:00:00.000Z' })]);

    expect(text(fixture)).toContain('edited');
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * Moderation, as it reaches somebody who cannot read the setting.
   *
   * The setting itself is administrative and is never sent here. What arrives
   * is its consequence for this caller on this screen, which is the only part
   * they need — and the only part that would make the interface dishonest if it
   * were missing.
   * ────────────────────────────────────────────────────────────────────────── */

  it('says a comment will wait BEFORE anybody writes one', async () => {
    const fixture = await render([], true);

    const composer = fixture.nativeElement.querySelector('.composer');
    expect(composer.textContent).toContain('approved by an admin');

    // And says nothing of the sort when the gate is open.
    const open = await render([]);
    expect(open.nativeElement.querySelector('.composer').textContent).not.toContain(
      'approved by an admin',
    );
  });

  it('marks a waiting comment as waiting, and leaves a published one alone', async () => {
    const fixture = await render(
      [comment({ id: 1, isPending: true }), comment({ id: 2, isPending: false })],
      true,
    );

    const flags = fixture.nativeElement.querySelectorAll('.pending-flag');

    expect(flags.length).toBe(1);
    expect(flags[0].textContent).toContain('Waiting for approval');
  });

  /**
   * A comment that vanishes on posting reads as a failure, and the author posts
   * it again. It stays on screen, marked.
   */
  it('keeps a newly posted comment on screen while it waits', async () => {
    const fixture = await render([], true);

    const box = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'Something worth saying';
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.composer') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    http
      .expectOne((r) => r.url === '/api/requests/7/comments' && r.method === 'POST')
      .flush({ data: comment({ id: 9, body: 'Something worth saying', isPending: true }) });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Something worth saying');
    expect(fixture.nativeElement.querySelector('.pending-flag')).not.toBeNull();
  });

  /* ──────────────────────────────────────────────────────────────────────────
   * Moderating where the comment was written.
   *
   * Judging one needs the discussion around it, so the controls are beside the
   * words rather than on a queue that lists comments out of their threads.
   * ────────────────────────────────────────────────────────────────────────── */

  it('offers approve and reject on a waiting comment, and on nothing else', async () => {
    const fixture = await render(
      [comment({ id: 1, isPending: true, canApprove: true, canDelete: true }), comment({ id: 2 })],
      true,
    );

    const actions = fixture.nativeElement.querySelectorAll('.comment__actions');

    expect(actions[0].textContent).toContain('Approve');
    expect(actions[0].textContent).toContain('Reject');
    expect(actions[1].textContent).not.toContain('Approve');
  });

  it('approves through the real button and shows the result', async () => {
    const fixture = await render(
      [comment({ id: 1, isPending: true, canApprove: true })],
      true,
    );

    const approve = ([...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[]).find(
      (button) => button.textContent?.includes('Approve'),
    )!;

    approve.click();

    const sent = http.expectOne((r) => r.url === '/api/comments/1/approval' && r.method === 'PUT');
    sent.flush({ data: comment({ id: 1, isPending: false, canApprove: false }) });

    await fixture.whenStable();
    fixture.detectChanges();

    // The flag is gone from the comment, and so is the control.
    expect(fixture.nativeElement.querySelector('.pending-flag')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Approve');
  });

  /**
   * Rejecting takes somebody's words off the board, so it asks first — and it
   * is the ordinary deletion path, which records who removed it.
   */
  it('asks before rejecting, and rejects by deleting', async () => {
    const fixture = await render(
      [comment({ id: 1, isPending: true, canApprove: true, canDelete: true })],
      true,
    );

    const reject = ([...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[]).find(
      (button) => button.textContent?.trim() === 'Reject',
    )!;

    reject.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    // Nothing has been sent by opening it.
    http.expectNone((r) => r.method === 'DELETE');

    const confirm = [...dialog.querySelectorAll('button')].find((button: HTMLButtonElement) =>
      button.textContent?.includes('Reject'),
    ) as HTMLButtonElement;

    confirm.click();

    http.expectOne((r) => r.url === '/api/comments/1' && r.method === 'DELETE').flush({
      data: { kind: 'soft' },
    });

    /**
     * The deletion reloads the thread. That refetch has to be answered before
     * anything awaits stability — an unanswered resource request IS a pending
     * task — and it is scheduled rather than immediate, so this turns the
     * microtask queue over until it appears.
     */
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fixture.detectChanges();
      const reload = http.match((r) => r.url === '/api/requests/7/comments');

      if (reload.length > 0) {
        reload.forEach((r) => r.flush({ data: [], awaitsApproval: true }));
        break;
      }

      await Promise.resolve();
    }

    fixture.detectChanges();
  });
});
