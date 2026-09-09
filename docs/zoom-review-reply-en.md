Hi Zoom Marketplace Admin,

Thank you for the update. We looked into this further, and here is what we found and how to reproduce a successful Zoom URL generation.

**Why no Zoom link appeared:** In our app, a Zoom (or Google Meet) meeting URL is only generated once a specific date/time has been confirmed by the host. Simply creating a meeting, or sending a normal 1-on-1 request without a fixed date, does not yet generate a conference URL, because the app doesn't know which time slot to book. This is intentional design, not a bug — but we agree it wasn't clear enough on screen, so we've since added on-screen hints to make this step clearer for hosts.

Below are two test patterns that will reliably get you to a generated Zoom URL. Before trying either one, please make sure your Zoom account is connected once: log in, then go to **My Page** → **Scheduling Settings** → **External Integrations**, and click **Connect** on the Zoom card.

**Pattern 1 — Regular meeting (multi-person):**
1. Go to the **Meetings** tab and tap **Create a meeting**.
2. Enter a title and at least one candidate date/time, then create the meeting.
3. Open the meeting you just created. As the host, you'll see a **Host menu** section.
4. Under **Confirm date**, tap the candidate date row. You do not need to wait for anyone else to respond — as the host, you can confirm it immediately, with zero other participants.
5. A confirmation dialog opens with an option to also set a conference URL. Choose **Issue a Zoom link and confirm**.
6. The Zoom meeting URL is generated immediately and shown at the top of the meeting page, next to the confirmed date.

**Pattern 2 — 1-on-1 meeting:**
1. Go to the **Meetings** tab → **Create** → **Request a 1-on-1** (or open any member's profile from the **Members** tab).
2. Instead of the plain "Request a 1-on-1" button, tap the smaller button below it: **Already arranged a time elsewhere? Request with a specific date/time**.
3. In the dialog, pick a date, start time, and duration.
4. Under **Conference tool**, select **Zoom**.
5. Submit the request.
6. The Zoom meeting URL is generated immediately, before the other member even responds — you (the requester/host) will see it right away, with no cooperation needed from a second account.

Please let us know if you run into any issue with either pattern above.

Best regards,
BizQuest Scheduler Dev Team
