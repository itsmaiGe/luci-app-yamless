#!/bin/sh
# Build dist/luci-app-yamless-<version>.apk for OpenWrt 25.x (apk-tools v3).
# Needs apk-tools v3 (`apk mkpkg`, set APK=/path/to/apk.static) and runs as root so files are
# owned by root; .github/workflows/build.yml does both.
set -eu
cd "$(dirname "$0")/.."

NAME=luci-app-yamless
VER=$(sed -n 's/^PKG_VERSION:=//p' Makefile)-r$(sed -n 's/^PKG_RELEASE:=//p' Makefile)
OUT=dist/$NAME-$VER.apk
# Stamp files with the last commit that touched the package, so an unchanged source gives a byte-identical apk.
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git -c safe.directory="$PWD" log -1 --format=%ct -- Makefile htdocs root scripts/stage.sh scripts/build-apk.sh)}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

D=$TMP/data S=$TMP/scripts
sh scripts/stage.sh "$D"
mkdir -p "$D/lib/apk/packages" "$S"
( cd "$D" && find . \( -type f -o -type l \) | sed 's/^\.//' | sort ) > "$TMP/list"
mv "$TMP/list" "$D/lib/apk/packages/$NAME.list"

cat > "$S/post-install" <<SH
#!/bin/sh
[ "\${IPKG_NO_SCRIPT}" = "1" ] && exit 0
[ -s "\${IPKG_INSTROOT}/lib/functions.sh" ] || exit 0
. \${IPKG_INSTROOT}/lib/functions.sh
export root="\${IPKG_INSTROOT}"
export pkgname="$NAME"
default_postinst
[ -n "\${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache/
	/etc/init.d/rpcd reload >/dev/null 2>&1
}
exit 0
SH
{ echo '#!/bin/sh'; echo 'export PKG_UPGRADE=1'; sed 1d "$S/post-install"; } > "$S/post-upgrade"
cat > "$S/pre-deinstall" <<SH
#!/bin/sh
[ -s "\${IPKG_INSTROOT}/lib/functions.sh" ] || exit 0
. \${IPKG_INSTROOT}/lib/functions.sh
export root="\${IPKG_INSTROOT}"
export pkgname="$NAME"
default_prerm
SH
cat > "$S/post-deinstall" <<'SH'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache/
exit 0
SH
chmod 755 "$S"/*
find "$D" "$S" -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +

mkdir -p dist
rm -f dist/$NAME-*.apk
${APK:-apk} mkpkg \
	--info "name:$NAME" \
	--info "version:$VER" \
	--info "description:YAMLess, visual split rules for OpenClash" \
	--info "arch:noarch" \
	--info "license:Apache-2.0" \
	--info "origin:$NAME" \
	--info "url:https://github.com/itsmaiGe/$NAME" \
	--info "maintainer:itsmaiGe" \
	--info "depends:libc luci-base" \
	--script "post-install:$S/post-install" \
	--script "post-upgrade:$S/post-upgrade" \
	--script "pre-deinstall:$S/pre-deinstall" \
	--script "post-deinstall:$S/post-deinstall" \
	--files "$D" \
	--output "$OUT"
basename "$OUT" > dist/latest-apk.txt
echo "$OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
