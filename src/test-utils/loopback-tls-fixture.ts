// INT-001 WI-5: a throwaway, self-signed EC (P-256) TLS cert/key pair for
// `loopback-test-guard.ts`'s local HTTPS test server. Committed inline as
// TypeScript string constants -- NOT as `.pem` files -- because this repo's
// `.gitignore` blanket-excludes `*.pem` (a sensible default against
// accidentally committing a real private key), which would otherwise make
// this test-only fixture silently vanish for anyone else who checks out the
// branch. There is no secret here to protect: this key signs nothing but a
// loopback test server that only ever exists inside a single test process.
//
// Regenerate (20-year validity; covers 127.0.0.1, ::1, localhost, and the
// reserved-per-RFC-6761 `.test` hostname the sender's tests dial):
//   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
//     -keyout key.pem -out cert.pem -days 7300 -nodes \
//     -subj "/CN=int001-loopback-test" \
//     -addext "subjectAltName=IP:127.0.0.1,IP:0:0:0:0:0:0:0:1,DNS:localhost,DNS:partner.example.test"

export const LOOPBACK_TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIB2TCCAX+gAwIBAgIUNCOVznRJBV4mx7GQzS6kSS+laqIwCgYIKoZIzj0EAwIw
HzEdMBsGA1UEAwwUaW50MDAxLWxvb3BiYWNrLXRlc3QwHhcNMjYwOTA5MTgzMzE0
WhcNNDYwOTA0MTgzMzE0WjAfMR0wGwYDVQQDDBRpbnQwMDEtbG9vcGJhY2stdGVz
dDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABGK1PJt7j0Y7GIRKvyHuzVvfCeJk
zJsLQ/QI+mobMixa8bAW2Ui874TzVSo85hBSDCZlgO9CwRxId0CED00aR4GjgZgw
gZUwHQYDVR0OBBYEFIJjUf1sKZOWobKv8tRJssDK6HH0MB8GA1UdIwQYMBaAFIJj
Uf1sKZOWobKv8tRJssDK6HH0MA8GA1UdEwEB/wQFMAMBAf8wQgYDVR0RBDswOYcE
fwAAAYcQAAAAAAAAAAAAAAAAAAAAAYIJbG9jYWxob3N0ghRwYXJ0bmVyLmV4YW1w
bGUudGVzdDAKBggqhkjOPQQDAgNIADBFAiBdkdFeamZ1cQK+hUy97ozBBJ5mqEc5
5Tsg7hsuCTJoWwIhAJGFm5TxNiubLVewuOOFp2428oPrSptuQiANR/2wKrc6
-----END CERTIFICATE-----
`

export const LOOPBACK_TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgxSfcQBlOaJvcCzqF
urzVoNqqeeHvwsWhU4bY7yrO9V6hRANCAARitTybe49GOxiESr8h7s1b3wniZMyb
C0P0CPpqGzIsWvGwFtlIvO+E81UqPOYQUgwmZYDvQsEcSHdAhA9NGkeB
-----END PRIVATE KEY-----
`
