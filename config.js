export const HOSTED_ORIGIN = "https://ucsbplat.com";
export const LOCAL_ORIGIN = "http://localhost:3000";

// The origin every request and the sign-in link use.
//
// Local testing uses three settings: swap this to LOCAL_ORIGIN and add the matching
// localhost URL to both host_permissions and externally_connectable.matches. It is
// deliberately not left in a release manifest, because a published extension asking for
// plain-http localhost access is a permission it can never use. package.sh refuses to
// build while any local-development setting remains.
export const UCSBPLAT_ORIGIN = LOCAL_ORIGIN;
