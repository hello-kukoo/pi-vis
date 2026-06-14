#!/usr/bin/env bash
# Converts resources/icon.svg → resources/icon.icns using only built-in macOS tools.
# Requires: swift (Xcode Command Line Tools), iconutil (built-in).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVG="$ROOT/resources/icon.svg"
ICONSET="$ROOT/resources/icon.iconset"
ICNS="$ROOT/resources/icon.icns"

SWIFT_RENDERER=$(cat <<'SWIFT'
import Foundation
import AppKit

let args = CommandLine.arguments
guard args.count == 4,
      let size = Int(args[3]),
      let img  = NSImage(contentsOf: URL(fileURLWithPath: args[1]))
else { print("usage: <svg> <png> <size>"); exit(1) }

let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size, pixelsHigh: size,
    bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
img.draw(in: NSRect(x: 0, y: 0, width: CGFloat(size), height: CGFloat(size)))
NSGraphicsContext.restoreGraphicsState()

let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: args[2]))
print("  \(size)x\(size)  → \(URL(fileURLWithPath: args[2]).lastPathComponent)")
SWIFT
)

render() {
  local size=$1 out=$2
  swift <(echo "$SWIFT_RENDERER") "$SVG" "$out" "$size"
}

echo "Building icon.icns from resources/icon.svg …"
mkdir -p "$ICONSET"

render 16   "$ICONSET/icon_16x16.png"
render 32   "$ICONSET/icon_16x16@2x.png"
render 32   "$ICONSET/icon_32x32.png"
render 64   "$ICONSET/icon_32x32@2x.png"
render 128  "$ICONSET/icon_128x128.png"
render 256  "$ICONSET/icon_128x128@2x.png"
render 256  "$ICONSET/icon_256x256.png"
render 512  "$ICONSET/icon_256x256@2x.png"
render 512  "$ICONSET/icon_512x512.png"
render 1024 "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$ICNS"
rm -rf "$ICONSET"
echo "Done → resources/icon.icns"
