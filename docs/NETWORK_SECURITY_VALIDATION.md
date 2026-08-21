# Network security validation

The required route is company VPN, private DNS, internal TLS ingress, Provider Tracker authentication, server-side authorization, then private PostgreSQL/PostGIS. Application responses do not prove the route is private.

## Outside the VPN

Run from two authorized networks that are definitely outside the company VPN. Include the friendly hostname, every cloud/load-balancer/origin hostname, every known origin IP/port, alternate hostname, preview route, and the database address.

```powershell
$env:PUBLIC_PROBE_BASE_URL='https://<private-provider-tracker-host>'
$env:PUBLIC_PROBE_ADDITIONAL_BASE_URLS='https://<alternate-host-if-any>'
$env:PUBLIC_PROBE_ORIGIN_TARGETS='<origin-host-or-ip>:443'
$env:PUBLIC_PROBE_APPLICATION_HOSTNAME='<private-provider-tracker-host>'
$env:PUBLIC_PROBE_DATABASE_HOST='<database-host>'
$env:PUBLIC_PROBE_DATABASE_PORT='5432'
$env:PUBLIC_PROBE_CONFIRM_OUTSIDE_VPN='YES'
npm run test:public-exposure
```

The command probes pages, authentication, health, readiness, session, metrics, user API, and admin API. It also sends the expected application hostname to each direct origin. Any HTTP response, application-protocol response from an origin, or database TCP connection is exposure and fails. A `401`, `403`, `404`, redirect, or health response is still a failure.

Save output, timestamp, tester, source network/public address, DNS result, and matching firewall/ingress logs.

## Inside the VPN

Run from an ordinary company VPN client, not an application or database administration subnet:

```powershell
$env:STAGING_NETWORK_BASE_URL='https://<private-provider-tracker-host>'
$env:STAGING_NETWORK_DATABASE_HOST='<database-host>'
$env:STAGING_NETWORK_DATABASE_PORT='5432'
$env:STAGING_NETWORK_ORIGIN_TARGETS='<origin-host-or-ip>:443'
$env:STAGING_NETWORK_CONFIRM_ON_VPN='YES'
$env:STAGING_NETWORK_AUTHORIZED='YES'
npm run test:staging-network
```

Expected results:

- the private hostname resolves and HTTPS uses a trusted matching certificate;
- TLS 1.2 or 1.3 is negotiated and HSTS is present;
- sign-in is reachable;
- an anonymous protected page redirects to sign-in;
- an anonymous protected API returns `401`;
- anonymous metrics return `404`;
- health and readiness pass;
- spoofed forwarded headers do not change the redirect origin;
- direct origin targets do not accept an ordinary VPN client;
- PostgreSQL does not accept an ordinary VPN client.

Then run `npm run test:staging` with dedicated fixture accounts to prove URA, auditor, and administrator boundaries. Run the database privilege suite from a disposable staging database using the runtime role.

## Private DNS

Record the internal hostname, private DNS zone owner, on-VPN answer, off-VPN answer, TTL, and approved ingress target. Off VPN, the name must not provide a usable route. On VPN, it must resolve only to the approved private ingress. Remove stale records and preview hostnames before approval.

## Proxy trust

Record the proxy product/version and reviewed configuration. The proxy must remove client copies of `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, vendor client-IP headers, and request IDs before writing its own values. Only the proxy tier may reach the application port.

Test duplicate/conflicting headers, invalid transfer framing, oversized headers/body, absolute-form targets, hostile Host values, and protocol downgrade behavior in the authorized staging test window. Reject or safely return `4xx`; never route a request to the wrong host or produce a poisoned redirect.

## TLS evidence

Retain certificate subject alternative name, issuer/chain result, validity dates, negotiated protocols, HTTP behavior, HSTS, and secure-cookie proof. Test the private hostname and every ingress listener. VPN transport does not replace HTTPS.

## Acceptance statement

Use `VPN-ONLY ACCESS VERIFIED` only after both outside positions, the inside position, direct origins, DNS, proxy behavior, and database segmentation pass with dated owner approval. Until then use:

`VPN-ONLY ACCESS REQUIRES IT STAGING VALIDATION`
