// Google Calendar API / OAuth トークンリフレッシュのラッパー

export type BusyBlock = { start: string; end: string };

export type CalendarEventResult = {
  eventId: string;
  meetUrl: string | null;
};

export type CalendarListEntry = { id: string; summary: string; primary: boolean };

/** 連携アカウントが参照可能なカレンダー一覧（空き状況判定の選択肢用） */
export async function fetchCalendarList(accessToken: string): Promise<CalendarListEntry[]> {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=freeBusyReader",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google calendarList failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { items?: { id: string; summary?: string; primary?: boolean }[] };
  return (json.items ?? []).map((it) => ({
    id: it.id,
    summary: it.summary ?? it.id,
    primary: !!it.primary,
  }));
}

export type InsertEventArgs = {
  accessToken: string;
  calendarId: string;
  summary: string;
  description: string;
  location?: string;
  startAtUtc: string;
  endAtUtc: string;
  attendeeEmails: string[];
  requestId: string;
  withMeet: boolean;
};

/** Calendar イベントを作成。withMeet=true のとき Google Meet URL を同時発行 */
export async function insertCalendarEvent(args: InsertEventArgs): Promise<CalendarEventResult> {
  const { accessToken, calendarId, summary, description, location, startAtUtc, endAtUtc,
    attendeeEmails, requestId, withMeet } = args;

  const body: Record<string, unknown> = {
    summary,
    description,
    ...(location !== undefined && { location }),
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

export type CalendarEventItem = {
  id: string;
  calendarId: string;
  summary: string;
  startUtc: string;
  endUtc: string;
  allDay: boolean;
  /** Googleの「予定あり/予定なし」設定。未設定時は "opaque"（予定あり）扱い */
  transparency: "opaque" | "transparent";
  location: string | null;
  description: string | null;
};

/** 指定カレンダーの予定一覧（タイトル付き）を取得する。終日予定は allDay:true として日付を00:00起点で返す */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMinUtc: string,
  timeMaxUtc: string
): Promise<CalendarEventItem[]> {
  const params = new URLSearchParams({
    timeMin: timeMinUtc,
    timeMax: timeMaxUtc,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Calendar listEvents failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as {
    items?: {
      id: string;
      summary?: string;
      status?: string;
      transparency?: "opaque" | "transparent";
      location?: string;
      description?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }[];
  };
  return (json.items ?? [])
    .filter((it) => it.status !== "cancelled" && (it.start?.dateTime || it.start?.date))
    .map((it) => {
      const allDay = !it.start?.dateTime;
      return {
        id: it.id,
        calendarId,
        summary: it.summary ?? "(タイトルなし)",
        startUtc: it.start?.dateTime ?? `${it.start?.date}T00:00:00.000Z`,
        endUtc: it.end?.dateTime ?? `${it.end?.date}T00:00:00.000Z`,
        allDay,
        transparency: it.transparency ?? "opaque",
        location: it.location ?? null,
        description: it.description ?? null,
      };
    });
}

export type UpdateEventArgs = {
  accessToken: string;
  calendarId: string;
  eventId: string;
  summary: string;
  location?: string;
  description?: string;
} & (
  // 終日予定は date（時刻・タイムゾーンなし）で指定する必要がある。dateTime を送ると
  // Google側が "Invalid start time" で拒否するため、時間指定の予定とは別の形にする。
  | { allDay: true; startDate: string; endDate: string }
  | { allDay?: false; startAtUtc: string; endAtUtc: string }
);

/**
 * Calendar イベントを更新する。Google Calendar API の PATCH は部分更新のため、
 * ここで指定したフィールドのみが上書きされ、参加者など未指定の項目はそのまま保持される。
 */
export async function updateCalendarEvent(args: UpdateEventArgs): Promise<void> {
  const { accessToken, calendarId, eventId, summary, location, description } = args;
  const timeFields = args.allDay
    ? { start: { date: args.startDate }, end: { date: args.endDate } }
    : { start: { dateTime: args.startAtUtc, timeZone: "UTC" }, end: { dateTime: args.endAtUtc, timeZone: "UTC" } };
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary,
        ...timeFields,
        ...(location !== undefined && { location }),
        ...(description !== undefined && { description }),
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Calendar updateEvent failed: ${res.status} ${body}`);
  }
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

/** トークンリフレッシュ失敗時、呼び出し元が恒久的な失敗（再連携が必要）かどうかを判断できるよう HTTP ステータスを保持する */
export class TokenRefreshError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Google token refresh failed: ${status} ${body}`);
    this.status = status;
  }
}

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
    throw new TokenRefreshError(res.status, body);
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
