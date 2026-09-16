/* Where this page keeps a signed-in block, and who it asks about the session.
 *
 * Both services already answer the CLI; the browser reaches them with the
 * shared bl_session cookie rather than a bearer token, which only works while
 * this page is served from a *.bang-labs.eu origin. For a dev server on
 * localhost, point them somewhere local here or with ?api=…&accounts=… on the
 * URL — a cookie ignores ports, so a local accounts on :8010 signs you in to a
 * local toolkit API on :8014 without any more ceremony.
 */

window.FOCUS_CONFIG = {
  api: "https://toolkit.bang-labs.eu",
  accounts: "https://accounts.bang-labs.eu",
};
