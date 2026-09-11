// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FunctionsClient} from "@chainlink/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {AdaptiveFeeHook} from "./AdaptiveFeeHook.sol";

/// @title VolatilityFunctionsConsumer
/// @notice Chainlink Functions keeper consumer relaying off-chain volatility metrics to AdaptiveFeeHook.
contract VolatilityFunctionsConsumer is FunctionsClient {
    using FunctionsRequest for FunctionsRequest.Request;

    error NotOwner();
    error UnknownRequestId(bytes32 requestId);

    event VolatilityRequested(bytes32 indexed requestId, PoolId indexed poolId);
    event VolatilityRequestFailed(bytes32 indexed requestId, PoolId indexed poolId, bytes err);

    address public immutable OWNER;
    AdaptiveFeeHook public immutable HOOK;
    bytes32 public immutable DON_ID;
    uint64 public immutable SUBSCRIPTION_ID;
    uint32 public immutable CALLBACK_GAS_LIMIT;

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

    function setSource(string calldata newSource) external onlyOwner {
        source = newSource;
    }

    function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {
        PoolId poolId = poolIdOfRequest[requestId];
        if (PoolId.unwrap(poolId) == bytes32(0)) revert UnknownRequestId(requestId);
        poolIdOfRequest[requestId] = PoolId.wrap(bytes32(0));

        if (err.length > 0) {
            emit VolatilityRequestFailed(requestId, poolId, err);
            return;
        }

        uint256 volatility = abi.decode(response, (uint256));
        HOOK.setVolatility(poolId, volatility);
    }
}
