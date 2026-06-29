// Google Calendar API / OAuth トークンリフレッシュのラッパー

export type BusyBlock = { start: string; end: string };

export type CalendarEventResult = {
  eventId: string;
  meetUrl: string | null;
};

/** FreeBusy クエリで busy 区間を取得 */
export async function fetchBusy(
  accessToken: string,
  calendarId: string,
  fromUtc: string,
  toUtc: string
): Promise<BusyBlock[]> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: fromUtc,
      timeMax: toUtc,
      items: [{ id: calendarId }],
      timeZone: "UTC",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google freeBusy failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as {
    calendars: Record<string, { busy: BusyBlock[] }>;
  };
  return json.calendars[calendarId]?.busy ?? [];
}

export type InsertEventArgs = {
  accessToken: string;
  calendarId: string;
  summary: string;
  description: string;
  startAtUtc: string;
  endAtUtc: string;
  attendeeEmails: string[];
  requestId: string;
  withMeet: boolean;
};

/** Calendar イベントを作成。withMeet=true のとき Google Meet URL を同時発行 */
export async function insertCalendarEvent(args: InsertEventArgs): Promise<CalendarEventResult> {
  const { accessToken, calendarId, summary, description, startAtUtc, endAtUtc,
    attendeeEmails, requestId, withMeet } = args;

  const body: Record<string, unknown> = {
    summary,
    description,
    start: { dateTime: startAtUtc, timeZone: "UTC" },
    end:   { dateTime: endAtUtc,   timeZone: "UTC" },
    attendees: attendeeEmails.map((email) => ({ email })),
    reminders: { useDefault: false },
  };

  if (withMeet) {
    body.conferenceData = {
      createRequest: {
        requestId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const qs = withMeet ? "?conferenceDataVersion=1&sendUpdates=all" : "?sendUpdates=all";
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${qs}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Google Calendar insertEvent failed: ${res.status} ${errBody}`);
  }

  const json = (await res.json()) as {
    id: string;
    conferenceData?: { entryPoints?: { uri: string; entryPointType: string }[] };
  };

  const meetUrl = json.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === "video"
  )?.uri ?? null;

  return { eventId: json.id, meetUrl };
}

/** Calendar イベントを削除 */
export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google Calendar deleteEvent failed: ${res.status}`);
  }
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

/** refresh_token で新しい access_token を取得 */
export async function refreshGoogleToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<TokenResponse>;
}

/** Google プロフィール情報取得 */
export async function fetchGoogleUserInfo(accessToken: string): Promise<{
  email: string;
  sub: string;
}> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`);
  return res.json() as Promise<{ email: string; sub: string }>;
}
