import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api/api-base-url';
import type { Profile, SettingDescriptor, Wrapped } from '../../../core/api/api.types';

/**
 * The addresses the settings screens use, in one place, so no component builds
 * a URL out of a string.
 *
 * Personal preferences name the account they belong to. There is no /me: an
 * endpoint that acted on "whoever is calling" could not tell an attempt to
 * change somebody else's preferences from an ordinary save.
 */
@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  readonly appSettingsUrl = `${this.baseUrl}/settings`;

  userSettingsUrl(userId: number): string {
    return `${this.baseUrl}/users/${userId}/settings`;
  }

  updateApp(patch: Record<string, unknown>): Observable<Wrapped<SettingDescriptor[]>> {
    return this.http.patch<Wrapped<SettingDescriptor[]>>(this.appSettingsUrl, patch);
  }

  updateUser(
    userId: number,
    patch: Record<string, unknown>,
  ): Observable<Wrapped<SettingDescriptor[]>> {
    return this.http.patch<Wrapped<SettingDescriptor[]>>(this.userSettingsUrl(userId), patch);
  }

  updateProfile(userId: number, displayName: string): Observable<Wrapped<Profile>> {
    return this.http.patch<Wrapped<Profile>>(`${this.baseUrl}/users/${userId}`, { displayName });
  }

  deleteAccount(userId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/users/${userId}`);
  }
}
