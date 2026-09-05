// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {HookMiner} from "@uniswap/hooks-utils/src/HookMiner.sol";
import {AdaptiveFeeHook} from "../src/AdaptiveFeeHook.sol";
import {VolatilityFunctionsConsumer} from "../src/VolatilityFunctionsConsumer.sol";

/// @notice Stand-in for Chainlink's real FunctionsRouter, which only exists
/// on testnet/mainnet deployments (no local simulator ships as a Foundry
/// dependency). Implements just the one function FunctionsClient actually
/// calls; the test drives `handleOracleFulfillment` directly, pranked as
/// this contract, to simulate the DON's callback.
contract MockFunctionsRouter {
    function sendRequest(uint64, bytes calldata, uint16, uint32, bytes32) external view returns (bytes32) {
        return keccak256(abi.encode(block.timestamp, msg.sender, gasleft()));
    }
}

contract VolatilityFunctionsConsumerTest is Deployers {
    using PoolIdLibrary for PoolKey;

    AdaptiveFeeHook hook;
    VolatilityFunctionsConsumer consumer;
    MockFunctionsRouter router;

    PoolKey poolKey;
    PoolId poolId;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        router = new MockFunctionsRouter();

        // AdaptiveFeeHook.KEEPER is immutable, but the consumer's
        // constructor needs the hook's address, and the hook's constructor
        // needs the consumer's (its keeper's) address — so the consumer's
        // CREATE address is predicted ahead of time and the hook is
        // deployed with that prediction as its keeper, exactly as a real
        // deploy script must.
        uint256 nonceBeforeHook = vm.getNonce(address(this));
        address predictedConsumer = vm.computeCreateAddress(address(this), nonceBeforeHook + 1);

        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory hookArgs = abi.encode(
            manager,
            predictedConsumer,
            uint24(500),
            uint24(3_000),
            uint24(10_000),
            uint256(100),
            uint256(500),
            uint256(1 hours),
            uint256(100),
            uint24(50_000)
        );
        (address hookAddress, bytes32 salt) =
            HookMiner.find(address(this), flags, type(AdaptiveFeeHook).creationCode, hookArgs);

        hook = new AdaptiveFeeHook{salt: salt}(
            manager, predictedConsumer, 500, 3_000, 10_000, 100, 500, 1 hours, 100, 50_000
        );
        require(address(hook) == hookAddress, "hook address mismatch");

        consumer = new VolatilityFunctionsConsumer(
            address(router), address(hook), bytes32("fun-don-1"), 1, 300_000, "return Functions.encodeUint256(0);"
        );
        require(address(consumer) == predictedConsumer, "consumer address mismatch");

        (poolKey, poolId) =
            initPool(currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1);
    }

    function test_RequestVolatility_RevertsForNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(VolatilityFunctionsConsumer.NotOwner.selector);
        consumer.requestVolatility(poolId);
    }

    function test_RequestVolatility_RecordsPoolIdForRequest() public {
        bytes32 requestId = consumer.requestVolatility(poolId);
        PoolId recorded = consumer.poolIdOfRequest(requestId);
        assertEq(PoolId.unwrap(recorded), PoolId.unwrap(poolId));
    }

    function test_Fulfill_WritesVolatilityToHook() public {
        bytes32 requestId = consumer.requestVolatility(poolId);

        vm.prank(address(router));
        consumer.handleOracleFulfillment(requestId, abi.encode(uint256(321)), "");

        (uint256 value, uint256 updatedAt) = hook.volatilityOf(poolId);
        assertEq(value, 321);
        assertEq(updatedAt, block.timestamp);
    }

    function test_Fulfill_RevertsForUnknownRequestId() public {
        vm.prank(address(router));
        vm.expectRevert(abi.encodeWithSelector(VolatilityFunctionsConsumer.UnknownRequestId.selector, bytes32("bogus")));
        consumer.handleOracleFulfillment(bytes32("bogus"), abi.encode(uint256(1)), "");
    }

    function test_Fulfill_RevertsForNonRouterCaller() public {
        bytes32 requestId = consumer.requestVolatility(poolId);

        vm.expectRevert(); // FunctionsClient.OnlyRouterCanFulfill
        consumer.handleOracleFulfillment(requestId, abi.encode(uint256(1)), "");
    }

    function test_Fulfill_DoesNotWriteVolatilityOnDonError() public {
        bytes32 requestId = consumer.requestVolatility(poolId);

        vm.prank(address(router));
        consumer.handleOracleFulfillment(requestId, "", "computation failed");

        (, uint256 updatedAt) = hook.volatilityOf(poolId);
        assertEq(updatedAt, 0);
    }

    function test_SetSource_RevertsForNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(VolatilityFunctionsConsumer.NotOwner.selector);
        consumer.setSource("return Functions.encodeUint256(1);");
    }
}
