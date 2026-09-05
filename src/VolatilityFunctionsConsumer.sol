// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FunctionsClient} from "@chainlink/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {AdaptiveFeeHook} from "./AdaptiveFeeHook.sol";

/// @title VolatilityFunctionsConsumer
/// @notice Chainlink Functions consumer that is the `KEEPER` of an
/// AdaptiveFeeHook. `requestVolatility` asks the DON to run `source` — JS
/// that queries the project's subgraph for a pool's recent swap history and
/// computes a realized-volatility metric — and `fulfillRequest` writes the
/// DON's answer onchain via `AdaptiveFeeHook.setVolatility`.
/// @dev This bridges the primary architecture's offchain leg (subgraph +
/// Chainlink Functions) into the hook. It has no bearing on the hook's own
/// correctness: AdaptiveFeeHook treats its `KEEPER` as an opaque address and
/// would work identically if this were swapped for the fallback path's
/// onchain TWAP estimator instead.
contract VolatilityFunctionsConsumer is FunctionsClient {
    using FunctionsRequest for FunctionsRequest.Request;

    error NotOwner();
    error UnknownRequestId(bytes32 requestId);

    event VolatilityRequested(bytes32 indexed requestId, PoolId indexed poolId);
    event VolatilityRequestFailed(bytes32 indexed requestId, PoolId indexed poolId, bytes err);

    /// @notice Sole address permitted to trigger a new volatility request and rotate the DON job source.
    address public immutable OWNER;
    /// @notice The hook this consumer feeds. Set once; rotating hooks means deploying a new consumer.
    AdaptiveFeeHook public immutable HOOK;
    bytes32 public immutable DON_ID;
    uint64 public immutable SUBSCRIPTION_ID;
    uint32 public immutable CALLBACK_GAS_LIMIT;

    /// @notice The JavaScript executed by the DON for every request. See
    /// functions/volatility-source.js for the source this is deployed with.
    string public source;

    mapping(bytes32 requestId => PoolId poolId) public poolIdOfRequest;

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    constructor(
        address router,
        address hook,
        bytes32 donId,
        uint64 subscriptionId,
        uint32 callbackGasLimit,
        string memory _source
    ) FunctionsClient(router) {
        OWNER = msg.sender;
        HOOK = AdaptiveFeeHook(hook);
        DON_ID = donId;
        SUBSCRIPTION_ID = subscriptionId;
        CALLBACK_GAS_LIMIT = callbackGasLimit;
        source = _source;
    }

    function _checkOwner() internal view {
        if (msg.sender != OWNER) revert NotOwner();
    }

    /// @notice Requests a fresh volatility reading for `poolId`.
    /// @dev Intended to be called on a fixed cadence by an Automation
    /// upkeep or an external cron-style caller restricted to `OWNER` for
    /// this MVP — see README for why polling cadence is out of scope here.
    function requestVolatility(PoolId poolId) external onlyOwner returns (bytes32 requestId) {
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(source);

        bytes[] memory args = new bytes[](1);
        args[0] = abi.encodePacked(PoolId.unwrap(poolId));
        req.setBytesArgs(args);

        requestId = _sendRequest(req.encodeCBOR(), SUBSCRIPTION_ID, CALLBACK_GAS_LIMIT, DON_ID);
        poolIdOfRequest[requestId] = poolId;
        emit VolatilityRequested(requestId, poolId);
    }

    /// @notice Sets the DON job source. Owner-only, exercised when the
    /// volatility computation itself changes, not on every request.
    function setSource(string calldata newSource) external onlyOwner {
        source = newSource;
    }

    /// @inheritdoc FunctionsClient
    function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {
        PoolId poolId = poolIdOfRequest[requestId];
        if (PoolId.unwrap(poolId) == bytes32(0)) revert UnknownRequestId(requestId);
        poolIdOfRequest[requestId] = PoolId.wrap(bytes32(0));

        // Fail safe: a DON-side error must not revert the callback (the
        // router pays for and expects fulfillment to succeed) and must not
        // touch the hook's stored volatility — leaving the existing value
        // in place lets AdaptiveFeeHook's own staleness check take over on
        // its normal schedule rather than this consumer silently writing
        // bad data.
        if (err.length > 0) {
            emit VolatilityRequestFailed(requestId, poolId, err);
            return;
        }

        uint256 volatility = abi.decode(response, (uint256));
        HOOK.setVolatility(poolId, volatility);
    }
}
