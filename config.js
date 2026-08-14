export const HOSTED_ORIGIN = "https://ucsbplat.com";
export const LOCAL_ORIGIN = "http://localhost:12345";

// The origin every request and the sign-in link use.
//
// Testing against a local UCSBPlat takes two steps, not one: swap this to LOCAL_ORIGIN
// *and* add "http://localhost:12345/*" back to host_permissions in manifest.json. It is
// deliberately not left in the manifest, because a published extension asking for access
// to a plain-http localhost port is a permission it can never use and one more thing for
// a Web Store reviewer to ask about. Remember to undo both before packaging.
export const UCSBPLAT_ORIGIN = HOSTED_ORIGIN;
