# SPDX-License-Identifier: Apache-2.0
#
# 7Rules (分流规则): from one subscription link to a working OpenClash config, without writing YAML.
# Drop this directory into package/ of an OpenWrt buildroot / SDK.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-7rules
PKG_VERSION:=0.3.0
PKG_RELEASE:=1

LUCI_TITLE:=7Rules - visual split rules for OpenClash
LUCI_DESCRIPTION:=Paste a subscription link, then make groups: their nodes and what goes through them. \
	Writes one complete OpenClash config; no YAML.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=itsmaiGe <https://github.com/itsmaiGe>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
