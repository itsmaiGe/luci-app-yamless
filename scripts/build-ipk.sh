#!/usr/bin/env bash
# Build dist/luci-app-7rules_<version>_all.ipk without an OpenWrt SDK.
# The result is a standard opkg package (tar.gz flavour, like ipkg-build).
set -euo pipefail
cd "$(dirname "$0")/.."

VER=$(sed -n 's/^PKG_VERSION:=//p' Makefile)-r$(sed -n 's/^PKG_RELEASE:=//p' Makefile)
NAME=luci-app-7rules
OUT=dist/${NAME}_${VER}_all.ipk
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export COPYFILE_DISABLE=1   # no macOS ._ files

TAR=tar; command -v gtar >/dev/null && TAR=gtar
own() { if $TAR --version | grep -q GNU; then echo "--format=gnu --owner=0 --group=0 --numeric-owner"; else echo "--format ustar --no-xattrs --no-mac-metadata --uid 0 --gid 0 --uname root --gname root"; fi; }

D=$TMP/data
sh scripts/stage.sh "$D"
SIZE=$(du -sk "$D" | cut -f1)

C=$TMP/control
mkdir -p "$C"
cat > "$C/control" <<CTL
Package: $NAME
Version: $VER
Depends: libc, luci-base
Source: https://github.com/itsmaiGe/$NAME
SourceName: $NAME
License: Apache-2.0
Section: luci
URL: https://github.com/itsmaiGe/$NAME
Maintainer: itsmaiGe
Architecture: all
Installed-Size: $((SIZE * 1024))
Description: 7Rules: visual split rules for OpenClash. Paste a subscription
 link, make groups, pick where each service goes. No YAML.
CTL
cat > "$C/postinst" <<'SH'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
default_postinst $0 $@
[ -n "${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache/
	/etc/init.d/rpcd reload >/dev/null 2>&1
}
exit 0
SH
cat > "$C/prerm" <<'SH'
#!/bin/sh
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
default_prerm $0 $@
SH
cat > "$C/postrm" <<'SH'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache/
exit 0
SH
chmod 644 "$C/control"; chmod 755 "$C/postinst" "$C/prerm" "$C/postrm"
echo "2.0" > "$TMP/debian-binary"

( cd "$D" && $TAR $(own) -czf "$TMP/data.tar.gz" . )
( cd "$C" && $TAR $(own) -czf "$TMP/control.tar.gz" . )
mkdir -p dist
rm -f dist/${NAME}_*.ipk
( cd "$TMP" && $TAR $(own) -czf pkg.tar.gz ./debian-binary ./data.tar.gz ./control.tar.gz )
mv "$TMP/pkg.tar.gz" "$OUT"
basename "$OUT" > dist/latest.txt
echo "$OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
