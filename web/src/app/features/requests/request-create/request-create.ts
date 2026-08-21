import { Component, computed, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RequestsApi } from '../data/requests.api';
import { toApiError, type ApiError, type FieldIssue } from '../../../core/api/api-error';
import type { TaxonomyRef, Wrapped } from '../../../core/api/api.types';

/**
 * Mirrors the server's limits so the user is told before a round trip. The
 * server revalidates everything; this is a courtesy, not the boundary.
 */
const TITLE_MIN = 5;
const TITLE_MAX = 160;
const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 5000;

/** A 422 names fields by these paths. Anything else is shown at form level. */
const KNOWN_FIELDS = ['title', 'description', 'categoryId'] as const;

interface RequestForm {
  title: FormControl<string>;
  description: FormControl<string>;
  categoryId: FormControl<number | null>;
}

@Component({
  selector: 'app-request-create',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './request-create.html',
  styleUrl: './request-create.scss',
})
export class RequestCreate {
  private readonly api = inject(RequestsApi);
  private readonly router = inject(Router);

  protected readonly limits = { TITLE_MIN, TITLE_MAX, DESCRIPTION_MIN, DESCRIPTION_MAX };

  /**
   * Categories are data an admin curates, so the options come from the server
   * rather than a hardcoded list that would silently drift.
   */
  protected readonly categories = httpResource<Wrapped<TaxonomyRef[]>>(() => ({
    url: this.api.categoriesUrl,
  }));

  protected readonly categoryOptions = computed(() => this.categories.value()?.data ?? []);

  protected readonly categoriesError = computed(() => {
    const failure = this.categories.error();
    return failure ? toApiError(failure) : null;
  });

  protected readonly form = new FormGroup<RequestForm>({
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

  protected readonly submitting = signal(false);
  protected readonly submitFailure = signal<ApiError | null>(null);

  /** Server-side issues that name a field the form does not have. */
  protected readonly unattachedIssues = computed<FieldIssue[]>(() => {
    const failure = this.submitFailure();
    if (!failure) return [];
    return failure.details.filter(
      (issue) => !(KNOWN_FIELDS as readonly string[]).includes(issue.field),
    );
  });

  protected readonly canSubmit = computed(
    () => !this.submitting() && this.categories.hasValue() && this.categoryOptions().length > 0,
  );

  /**
   * Messages are written per control rather than generated, so each one says
   * what to do about it. Only shown once the control has been touched or the
   * form has been submitted, so nothing is red before it has been filled in.
   */
  protected errorFor(name: keyof RequestForm): string | null {
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
    this.submitFailure.set(null);
    this.clearServerErrors();

    if (this.form.invalid) {
      // Reveal every message at once rather than one per attempt.
      this.form.markAllAsTouched();
      this.focusFirstInvalid();
      return;
    }

    if (!this.canSubmit()) return;

    const value = this.form.getRawValue();
    this.submitting.set(true);
    this.form.disable({ emitEvent: false });

    this.api
      .create({
        title: value.title.trim(),
        description: value.description.trim(),
        categoryId: value.categoryId as number,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.form.enable({ emitEvent: false });
          void this.router.navigate(['/requests'], { queryParams: { page: 1 } });
        },
        error: (failure: unknown) => {
          this.submitting.set(false);
          this.form.enable({ emitEvent: false });

          const apiError = toApiError(failure);
          this.submitFailure.set(apiError);
          this.applyServerIssues(apiError);
          this.focusFirstInvalid();
        },
      });
  }

  /**
   * Attaches the server's field issues to the matching controls, so a rule the
   * browser cannot check — "that category no longer exists" — lands next to the
   * input rather than in a banner at the top.
   */
  private applyServerIssues(error: ApiError): void {
    for (const issue of error.details) {
      const name = issue.field as keyof RequestForm;
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

  /** Keyboard and screen-reader users land on the problem, not the top of the page. */
  private focusFirstInvalid(): void {
    queueMicrotask(() => {
      const first = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
    });
  }
}
