#!/bin/sh
# Render nginx.conf from its template and start nginx.
#
# Substitution is done with sed rather than envsubst, deliberately. envsubst comes
# from the gettext package, which costs roughly 50 MB in an image whose entire job
# is serving a 22 kB JavaScript bundle. busybox already provides sed, so this
# removes a dependency and most of the image size at once. Measured: 78 MB -> 20 MB.
#
# Only the two literal tokens below are replaced. nginx's own runtime variables
# ($host, $request_id, $remote_addr and the rest) are left untouched, which is
# what a bare `envsubst` would have got wrong anyway.
#
# Output goes to /tmp because the chart runs this container with
# readOnlyRootFilesystem: true, and /tmp is the writable emptyDir volume.
set -eu

: "${API_UPSTREAM:=agribridge-api:3000}"

# The DNS server this container was given. Read from resolv.conf rather than
# hardcoded, so the same image works under Kubernetes (CoreDNS) and under
# docker compose (Docker's embedded resolver at 127.0.0.11).
RESOLVER="${DNS_RESOLVER:-$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)}"
: "${RESOLVER:=127.0.0.11}"

echo "{\"level\":\"info\",\"service\":\"agribridge-web\",\"message\":\"rendering nginx config\",\"api_upstream\":\"${API_UPSTREAM}\",\"resolver\":\"${RESOLVER}\"}"

# The | delimiter avoids escaping trouble if a value ever contains a slash.
sed -e "s|\$API_UPSTREAM|${API_UPSTREAM}|g" \
    -e "s|RESOLVER_ADDR|${RESOLVER}|g" \
    /etc/nginx/nginx.conf.template \
    > /tmp/nginx.conf

# Fail fast on a bad config rather than crash-looping with a cryptic exit code.
# Note this no longer fails merely because the API is not yet resolvable - that
# is the point of the resolver directive.
nginx -t -c /tmp/nginx.conf

exec nginx -g 'daemon off;' -c /tmp/nginx.conf
