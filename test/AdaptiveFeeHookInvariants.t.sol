// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console} from "forge-std/console.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {HookMiner} from "@uniswap/hooks-utils/src/HookMiner.sol";
import {AdaptiveFeeHook} from "../src/AdaptiveFeeHook.sol";

contract AdaptiveFeeHookInvariantsTest is Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    AdaptiveFeeHook hook;
    address keeper = makeAddr("keeper");

    uint24 constant LOW_FEE = 500; // 0.05%
    uint24 constant MEDIUM_FEE = 3_000; // 0.30%
    uint24 constant HIGH_FEE = 10_000; // 1.00%
    uint256 constant LOW_VOL_MAX = 100;
    uint256 constant MEDIUM_VOL_MAX = 500;
    uint256 constant MAX_STALENESS = 1 hours;
    uint256 constant MEV_THRESHOLD_BPS = 100; // 1% sqrtPrice move
    uint24 constant MEV_SPIKE_FEE = 50_000; // 5%

    PoolKey hookPoolKey;
    PoolId hookPoolId;

    PoolKey staticPoolKey;
    PoolId staticPoolId;

    function setUp() public {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();

        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs = abi.encode(
            manager,
            keeper,
            LOW_FEE,
            MEDIUM_FEE,
            HIGH_FEE,
            LOW_VOL_MAX,
            MEDIUM_VOL_MAX,
            MAX_STALENESS,
            MEV_THRESHOLD_BPS,
            MEV_SPIKE_FEE
        );
        (address hookAddress, bytes32 salt) =
            HookMiner.find(address(this), flags, type(AdaptiveFeeHook).creationCode, constructorArgs);

        hook = new AdaptiveFeeHook{salt: salt}(
            manager,
            keeper,
            LOW_FEE,
            MEDIUM_FEE,
            HIGH_FEE,
            LOW_VOL_MAX,
            MEDIUM_VOL_MAX,
            MAX_STALENESS,
            MEV_THRESHOLD_BPS,
            MEV_SPIKE_FEE
        );
        require(address(hook) == hookAddress, "hook address mismatch");

        (hookPoolKey, hookPoolId) =
            initPool(currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1);

        (staticPoolKey, staticPoolId) = initPool(currency0, currency1, IHooks(address(0)), 3_000, SQRT_PRICE_1_1);

        modifyLiquidityRouter.modifyLiquidity(
            hookPoolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(hookPoolKey.tickSpacing),
                tickUpper: TickMath.maxUsableTick(hookPoolKey.tickSpacing),
                liquidityDelta: 1e24,
                salt: 0
            }),
            ZERO_BYTES
        );

        modifyLiquidityRouter.modifyLiquidity(
            staticPoolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(staticPoolKey.tickSpacing),
                tickUpper: TickMath.maxUsableTick(staticPoolKey.tickSpacing),
                liquidityDelta: 1e24,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _setVolatility(uint256 value) internal {
        vm.prank(keeper);
        hook.setVolatility(hookPoolId, value);
    }

    function test_GasBenchmark_Comparison() public {
        _setVolatility(50);

        uint256 gasBeforeStatic = gasleft();
        swap(staticPoolKey, true, -1e18, ZERO_BYTES);
        uint256 gasStatic = gasBeforeStatic - gasleft();

        uint256 gasBeforeFirst = gasleft();
        swap(hookPoolKey, true, -1e18, ZERO_BYTES);
        uint256 gasFirst = gasBeforeFirst - gasleft();

        uint256 gasBeforeSecond = gasleft();
        swap(hookPoolKey, true, -1e18, ZERO_BYTES);
        uint256 gasSecond = gasBeforeSecond - gasleft();

        swap(hookPoolKey, true, -4e22, ZERO_BYTES);
        uint256 gasBeforeSpike = gasleft();
        swap(hookPoolKey, true, -1e18, ZERO_BYTES);
        uint256 gasSpike = gasBeforeSpike - gasleft();

        console.log("=== Gas Benchmark Results ===");
        console.log("Static pool swap (no hook) :", gasStatic);
        console.log("Hook pool (first in block)  :", gasFirst);
        console.log("Hook pool (intra-block ok)  :", gasSecond);
        console.log("Hook pool (MEV spike swap)  :", gasSpike);

        assertGt(gasFirst, gasStatic);
        uint256 firstOverhead = gasFirst - gasStatic;
        console.log("Hook overhead (first swap)  :", firstOverhead);
        assertLt(firstOverhead, 35_000, "Hook gas overhead should remain lightweight");
    }

    function test_Invariant_OutputMonotonicityAcrossFeeTiers() public {
        int256 swapAmount = -1e18;

        vm.roll(block.number + 1);
        _setVolatility(50);
        BalanceDelta deltaLow = swap(hookPoolKey, true, swapAmount, ZERO_BYTES);
        uint128 outLow = uint128(int128(deltaLow.amount1()));

        vm.roll(block.number + 1);
        _setVolatility(300);
        BalanceDelta deltaMed = swap(hookPoolKey, true, swapAmount, ZERO_BYTES);
        uint128 outMed = uint128(int128(deltaMed.amount1()));

        vm.roll(block.number + 1);
        _setVolatility(800);
        BalanceDelta deltaHigh = swap(hookPoolKey, true, swapAmount, ZERO_BYTES);
        uint128 outHigh = uint128(int128(deltaHigh.amount1()));

        vm.roll(block.number + 1);
        _setVolatility(50);
        swap(hookPoolKey, true, -1e12, ZERO_BYTES);
        swap(hookPoolKey, true, -4e22, ZERO_BYTES);
        BalanceDelta deltaSpike = swap(hookPoolKey, true, swapAmount, ZERO_BYTES);
        uint128 outSpike = uint128(int128(deltaSpike.amount1()));

        console.log("=== Output Amounts for 1e18 Input ===");
        console.log("Low tier output (0.05% fee)  :", outLow);
        console.log("Med tier output (0.30% fee)  :", outMed);
        console.log("High tier output (1.00% fee) :", outHigh);
        console.log("Spike output (5.00% fee)     :", outSpike);

        assertGt(outLow, outMed, "Low fee output must exceed Medium fee output");
        assertGt(outMed, outHigh, "Medium fee output must exceed High fee output");
        assertGt(outHigh, outSpike, "High fee output must exceed MEV spike output");
    }

    function test_Invariant_PriceDirectionAndStateConsistency() public {
        _setVolatility(200);

        (uint160 sqrtP0,,,) = manager.getSlot0(hookPoolId);

        swap(hookPoolKey, true, -1e18, ZERO_BYTES);
        (uint160 sqrtP1,,,) = manager.getSlot0(hookPoolId);
        assertLt(sqrtP1, sqrtP0, "zeroForOne swap must decrease sqrtPriceX96");

        swap(hookPoolKey, false, -2e18, ZERO_BYTES);
        (uint160 sqrtP2,,,) = manager.getSlot0(hookPoolId);
        assertGt(sqrtP2, sqrtP1, "oneForZero swap must increase sqrtPriceX96");
    }

    function test_MEV_Dampener_ReducesSandwichProfit() public {
        int256 frontrunInput = -3e22;
        int256 victimInput = -1e21;

        vm.roll(100);
        BalanceDelta staticFront = swap(staticPoolKey, true, frontrunInput, ZERO_BYTES);
        uint128 staticTokensAcquired = uint128(int128(staticFront.amount1()));

        swap(staticPoolKey, true, victimInput, ZERO_BYTES);

        BalanceDelta staticBack = swap(staticPoolKey, false, -int256(uint256(staticTokensAcquired)), ZERO_BYTES);
        uint128 staticTokensReturned = uint128(int128(staticBack.amount0()));

        int256 staticPnL = int256(uint256(staticTokensReturned)) - int256(uint256(-frontrunInput));

        vm.roll(200);
        _setVolatility(50);

        swap(hookPoolKey, true, -1e12, ZERO_BYTES);

        BalanceDelta hookFront = swap(hookPoolKey, true, frontrunInput, ZERO_BYTES);
        uint128 hookTokensAcquired = uint128(int128(hookFront.amount1()));

        swap(hookPoolKey, true, victimInput, ZERO_BYTES);

        BalanceDelta hookBack = swap(hookPoolKey, false, -int256(uint256(hookTokensAcquired)), ZERO_BYTES);
        uint128 hookTokensReturned = uint128(int128(hookBack.amount0()));

        int256 hookPnL = int256(uint256(hookTokensReturned)) - int256(uint256(-frontrunInput));

        console.log("=== Sandwich Attack Economic Comparison ===");
        console.log("Static pool attacker PnL (token0):", staticPnL);
        console.log("Hook pool attacker PnL (token0)  :", hookPnL);

        assertLt(
            hookPnL, staticPnL, "Hook MEV dampener must reduce attacker profitability compared to unmitigated pool"
        );
    }
}
