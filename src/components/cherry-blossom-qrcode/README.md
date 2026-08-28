# Cherry Blossom QR Code

A React Native animation vendored **word-for-word** from
[`enzomanuelmangano/demos`](https://github.com/enzomanuelmangano/demos/tree/main/src/animations/cherry-blossom-qrcode)
(by Enzo Manuel Mangano). It renders a QR code as a voxel cherry blossom tree
on a WebGPU canvas: tap to flatten it into a scannable QR, long-press to spawn
a creeper that blows the tree apart, after which it reassembles.

## Provenance

- Upstream: `src/animations/cherry-blossom-qrcode/` on the `main` branch of
  `enzomanuelmangano/demos`.
- License: the upstream repo uses a custom software license — free to use and
  modify in personal and commercial projects, but not to resell or
  redistribute. See the upstream [`LICENSE.md`](https://github.com/enzomanuelmangano/demos/blob/main/LICENSE.md).
- The files in this directory are byte-for-byte copies of upstream. Do not
  reformat or "fix" them — keeping them identical means upstream fixes can be
  re-copied over the top. This directory is ESLint-exempt for that reason.

## Running it on the web

The component is React Native source and imports RN runtime packages
(`react-native`, `react-native-reanimated`,
`react-native-keyboard-controller`, `react-native-pulsar`,
`react-native-webgpu`). In this Next.js app those imports are bridged to the
browser:

| Import | Web equivalent |
| --- | --- |
| `react-native` | `react-native-web` |
| `react-native-reanimated` | `src/lib/web-shims/react-native-reanimated.ts` |
| `react-native-keyboard-controller` | `src/lib/web-shims/react-native-keyboard-controller.ts` |
| `react-native-pulsar` | `src/lib/web-shims/react-native-pulsar.ts` |
| `react-native-webgpu` | `src/lib/web-shims/react-native-webgpu.tsx` |

The mapping lives in two places, kept in sync:

- `next.config.ts` → `turbopack.resolveAlias` (bundle-time resolution).
- `tsconfig.json` → `paths` (type resolution).

The WebGPU scene itself — the shaders in `shaders/` and the render loop in
`hooks/use-web-gpu.ts` — is plain WebGPU JavaScript and runs unchanged in any
WebGPU-capable browser (Chrome, Edge, Firefox 141+, Safari 26+).

The live preview page is at `/preview-cherry-blossom-qr`.
