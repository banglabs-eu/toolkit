/* Where accounts and the toolkit API live.
 *
 * Scoped to *.bang-labs.eu when hosted there, or overridden with ?api=…&accounts=…
 * for local development.
 */

const params = new URLSearchParams(window.location.search);

export const CONFIG = {
  accounts: params.get("accounts") || "https://accounts.bang-labs.eu",
  api: params.get("api") || "https://toolkit.bang-labs.eu",
};
