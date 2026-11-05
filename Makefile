# SPDX-License-Identifier: Apache-2.0
#
# 7Rules (分流规则): pick what goes direct and what goes through a proxy, without writing YAML.
# Drop this directory into package/ of an OpenWrt buildroot / SDK.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-7rules
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

LUCI_TITLE:=7Rules - visual split rules for OpenClash
LUCI_DESCRIPTION:=Search a service, pick where it goes, drag to reorder. Writes OpenClash custom rules; \
	never touches the subscription.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=itsmaiGe <https://github.com/itsmaiGe>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
