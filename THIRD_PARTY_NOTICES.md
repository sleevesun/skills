# Third-party notices

## CodeDrobe Core

`workbuddy-skin-studio` depends on `@codedrobe/core` version `0.6.1`, distributed under the Apache License 2.0.

- Project: https://github.com/CodeDrobe/core
- Package: https://www.npmjs.com/package/@codedrobe/core
- License: Apache-2.0

The dependency itself and `node_modules/` are not committed to this repository. They are installed from the package lock with `npm ci`.

## better-sqlite3-multiple-ciphers

`summarize-woa-chat` can install `better-sqlite3-multiple-ciphers` version `12.10.0`, distributed under the MIT License, together with its runtime loader dependencies.

- Project: https://github.com/m4heshd/better-sqlite3-multiple-ciphers
- Package: https://www.npmjs.com/package/better-sqlite3-multiple-ciphers
- License: MIT

The dependency and `node_modules/` are not committed. The Skill's bootstrap pins package versions, verifies npm integrity metadata and a fixed SHA-256 for the selected official native prebuild, then installs only inside the Skill directory.
