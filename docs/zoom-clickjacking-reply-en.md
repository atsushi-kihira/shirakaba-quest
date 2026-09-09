Hi, thank you for flagging this. We've fixed the clickjacking vulnerability and deployed the fix to production.

We added the following response headers, applied to every page and API response across the app:
- `X-Frame-Options: DENY`
- `Content-Security-Policy: frame-ancestors 'none'`

This prevents the app from being embedded in an iframe by any site, which addresses the clickjacking risk (OWASP A04:2021 / CWE-1021) you identified.

We've verified the headers are live in production on all pages, including the login page and static assets, and confirmed the app continues to function normally after the change. If you'd like to re-test on your end, using a private/incognito window (or clearing your browser cache) will let you confirm the fix is working correctly.

Please let us know if there's anything else you'd like us to address.

Best regards,
BizQuest Scheduler Dev Team
