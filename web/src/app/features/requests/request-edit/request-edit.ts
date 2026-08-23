import { Component, computed, inject, input, output, signal, type OnInit } from '@angular/core';
import { httpResource } from '@angular/common/http';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
} from '@angular/forms';
import { RequestsApi } from '../data/requests.api';
import { AppConfig } from '../../../core/config/app-config';
import { toApiError, type ApiError, type FieldIssue } from '../../../core/api/api-error';
import type { FeedbackRequestDetail, TaxonomyRef, Wrapped } from '../../../core/api/api.types';

/**
 * Mirrors the server's limits so the user is told before a round trip. The
 * server revalidates everything; this is a courtesy, not the boundary.
 *
 * The same four numbers as the create form, deliberately duplicated rather than
 * shared through a constants module: they mirror the API's schema, and the day
 * editing and creation disagree the answer is to change one of them, not to
 * discover that both moved because they were one value.
 */
const TITLE_MIN = 5;
const TITLE_MAX = 160;
const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 5000;

/** A 422 names fields by these paths. Anything else is shown at form level. */
const KNOWN_FIELDS = ['title', 'description', 'categoryId'] as const;

interface EditForm {
  title: FormControl<string>;
  description: FormControl<string>;
  categoryId: FormControl<number | null>;
}

/**
 * Editing a request in place on its own page.
 *
 * Status and pinning are absent: they are not the author's to change here, and
 * the server refuses them by name if they are sent. An admin never sees this
 * form for somebody else's request, because they may not edit it — the rule is
 * in the policy module and the row says `canEdit: false`.
 */
@Component({
  selector: 'app-request-edit',
  imports: [ReactiveFormsModule],
  templateUrl: './request-edit.html',
  styleUrl: './request-edit.scss',
})
export class RequestEdit implements OnInit {
  private readonly api = inject(RequestsApi);
  private readonly config = inject(AppConfig);

  readonly request = input.required<FeedbackRequestDetail>();

  readonly saved = output<FeedbackRequestDetail>();
  readonly cancelled = output<void>();

  protected readonly limits = { TITLE_MIN, TITLE_MAX, DESCRIPTION_MIN, DESCRIPTION_MAX };

  /**
   * The categories an admin curates, from the bootstrap payload. Retired ones
   * are not offered, so a request being edited keeps whatever it already has
   * unless its author picks something still on the list.
   */
  protected readonly categoryOptions = this.config.categories;

  protected readonly form = new FormGroup<EditForm>({
    title: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(TITLE_MIN),
        Validators.maxLength(TITLE_MAX),
      ],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(DESCRIPTION_MIN),
        Validators.maxLength(DESCRIPTION_MAX),
      ],
    }),
    categoryId: new FormControl<number | null>(null, {
      validators: [Validators.required],
    }),
  });

  protected readonly saving = signal(false);
  protected readonly failure = signal<ApiError | null>(null);

  /**
   * Seeded once, from the request as it was when editing began.
   *
   * In ngOnInit rather than the constructor: a required input has no value yet
   * when the constructor runs, and the compiler says so rather than letting it
   * read undefined at runtime.
   *
   * Deliberately not an effect that re-seeds. The whole point of this form is
   * that its contents diverge from what it was given, and something that put
   * the original text back mid-edit would be a data-loss bug wearing the
   * costume of a refresh.
   */
  ngOnInit(): void {
    const current = this.request();

    this.form.setValue({
      title: current.title,
      description: current.description,
      categoryId: current.category.id,
    });
  }

  /** Server-side issues that name a field this form does not have. */
  protected readonly unattachedIssues = computed<FieldIssue[]>(() => {
    const error = this.failure();
    if (!error) return [];
    return error.details.filter(
      (issue) => !(KNOWN_FIELDS as readonly string[]).includes(issue.field),
    );
  });

  /**
   * What went wrong, when it is not something to hang on a field.
   *
   * A 403 and a dead connection read differently and need different words: one
   * says the answer will not change by trying again, the other says it might.
   */
  protected readonly formFailure = computed<string | null>(() => {
    const error = this.failure();
    if (!error) return null;

    if (error.status === 403) {
      return error.message;
    }

    if (error.status === 404) {
      return 'This request no longer exists. Somebody may have deleted it while you were editing.';
    }

    if (error.status === 422) {
      // Every issue is already attached to its control, unless it named a field
      // that is not here — which unattachedIssues renders separately.
      return this.unattachedIssues().length > 0 ? error.message : null;
    }

    return error.message;
  });

  protected errorFor(name: keyof EditForm): string | null {
    const control: AbstractControl = this.form.controls[name];

    if (!control.invalid || !(control.dirty || control.touched)) {
      return null;
    }

    const errors = control.errors ?? {};

    if (errors['server']) return String(errors['server']);

    switch (name) {
      case 'title':
        if (errors['required']) return 'Give the request a title.';
        if (errors['minlength']) return `The title must be at least ${TITLE_MIN} characters.`;
        if (errors['maxlength']) return `The title cannot be longer than ${TITLE_MAX} characters.`;
        return 'That title is not valid.';
      case 'description':
        if (errors['required']) return 'Describe what you are asking for.';
        if (errors['minlength'])
          return `Use at least ${DESCRIPTION_MIN} characters so others can judge the request.`;
        if (errors['maxlength'])
          return `The description cannot be longer than ${DESCRIPTION_MAX} characters.`;
        return 'That description is not valid.';
      case 'categoryId':
        return 'Choose a category.';
      default:
        return 'That value is not valid.';
    }
  }

  protected submit(): void {
    this.failure.set(null);
    this.clearServerErrors();

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.saving()) return;

    const value = this.form.getRawValue();
    this.saving.set(true);
    this.form.disable({ emitEvent: false });

    this.api
      .update(this.request().id, {
        title: value.title.trim(),
        description: value.description.trim(),
        categoryId: value.categoryId as number,
      })
      .subscribe({
        next: ({ data }) => {
          this.saving.set(false);
          this.form.enable({ emitEvent: false });
          this.saved.emit(data);
        },
        error: (raw: unknown) => {
          this.saving.set(false);
          this.form.enable({ emitEvent: false });

          const error = toApiError(raw);
          this.failure.set(error);
          this.applyServerIssues(error);
        },
      });
  }

  protected cancel(): void {
    this.cancelled.emit();
  }

  /**
   * Attaches the server's field issues to the matching controls, so a rule the
   * browser cannot check — "that category no longer exists" — lands next to the
   * input rather than in a banner at the top.
   */
  private applyServerIssues(error: ApiError): void {
    for (const issue of error.details) {
      const name = issue.field as keyof EditForm;
      const control = this.form.controls[name] as AbstractControl | undefined;
      if (control) {
        control.setErrors({ ...(control.errors ?? {}), server: issue.message });
        control.markAsTouched();
      }
    }
  }

  private clearServerErrors(): void {
    for (const name of KNOWN_FIELDS) {
      const control = this.form.controls[name];
      const errors = { ...(control.errors ?? {}) };
      if ('server' in errors) {
        delete errors['server'];
        control.setErrors(Object.keys(errors).length > 0 ? errors : null);
      }
    }
  }
}
