#!/usr/bin/env bash
# Builds the Contacts framework bridge. The Info.plist is embedded so macOS can show the permission prompt.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
swiftc -O main.swift -o build/contacts-helper \
  -framework Contacts \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
echo "built $(pwd)/build/contacts-helper"
