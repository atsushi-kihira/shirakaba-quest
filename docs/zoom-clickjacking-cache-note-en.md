Just to clarify — the screenshot showing the embedded content is the original evidence from your first clickjacking report, taken before our fix was deployed, not a new re-test.

We've since deployed the fix and re-verified it ourselves using the same embedding technique against that exact page: the iframe is now blocked (confirmed via browser console: "Framing ... violates ... frame-ancestors 'none'. The request has been blocked."), and the headers are confirmed present on that URL.

Feel free to re-test on your end whenever convenient (a private/incognito window will avoid any local caching) — we're confident it will now be blocked as expected.
