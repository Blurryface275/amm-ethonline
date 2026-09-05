# chainlink-functions-vendor

`FunctionsClient.sol` and its transitive dependencies, vendored from
[smartcontractkit/chainlink-evm](https://github.com/smartcontractkit/chainlink-evm)
at tag `contracts-v1.5.0`, unmodified except for a provenance header on the
entry-point file.

## Why vendored instead of `forge install`

`chainlink-evm` is the full Chainlink monorepo (~328MB) — installing it as a
git submodule just to get the ~1000 lines this project actually needs
(`FunctionsClient` and its dependency chain) pulls in a large amount of
unrelated code, mirroring the same problem hit with `Uniswap/v4-hooks-public`
(see `lib/uniswap-hooks-utils/src/BaseHook.sol`). Seven files were vendored
instead, keeping the exact upstream relative directory layout so no import
path needed editing:

```
functions/v1_0_0/FunctionsClient.sol
functions/v1_0_0/interfaces/IFunctionsClient.sol
functions/v1_0_0/interfaces/IFunctionsRouter.sol
functions/v1_0_0/libraries/FunctionsRequest.sol
functions/v1_0_0/libraries/FunctionsResponse.sol
vendor/solidity-cborutils/v2.0.0/CBOR.sol
vendor/@ensdomains/buffer/v0.1.0/Buffer.sol
```

## License

MIT, per the upstream `chainlink-evm` repository.
