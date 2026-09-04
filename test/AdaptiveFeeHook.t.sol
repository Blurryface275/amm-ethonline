// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {HookMiner} from "@uniswap/hooks-utils/src/HookMiner.sol";
import {AdaptiveFeeHook} from "../src/AdaptiveFeeHook.sol";

contract AdaptiveFeeHookTest is Deployers {
    using PoolIdLibrary for PoolKey;

    AdaptiveFeeHook hook;
    address keeper = makeAddr("keeper");

    uint24 constant LOW_FEE = 500; // 0.05%
    uint24 constant MEDIUM_FEE = 3_000; // 0.30%
    uint24 constant HIGH_FEE = 10_000; // 1.00%
    uint256 constant LOW_VOL_MAX = 100;
    uint256 constant MEDIUM_VOL_MAX = 500;
    uint256 constant MAX_STALENESS = 1 hours;
    uint256 constant MEV_THRESHOLD_BPS = 100; // 1% same-block sqrtPrice move
    uint24 constant MEV_SPIKE_FEE = 50_000; // 5%

    PoolKey poolKey;
    PoolId poolId;

    event VolatilityUpdated(PoolId indexed poolId, uint256 value, uint256 timestamp);
    event FeeApplied(PoolId indexed poolId, uint24 tierFee, uint24 appliedFee, bool mevTriggered);

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

        (poolKey, poolId) = initPool(currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1);

        // Wide, deep liquidity so test swaps move price by a controlled,
        // predictable amount instead of running the position out of range.
        modifyLiquidityRouter.modifyLiquidity(
            poolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(poolKey.tickSpacing),
                tickUpper: TickMath.maxUsableTick(poolKey.tickSpacing),
                liquidityDelta: 1e24,
                salt: 0
            }),
            ZERO_BYTES
        );
    }

    function _setVolatility(uint256 value) internal {
        vm.prank(keeper);
        hook.setVolatility(poolId, value);
    }

    function _tinySwap() internal returns (BalanceDelta) {
        return swap(poolKey, true, -1e12, ZERO_BYTES);
    }

    /* ------------------------------------------------------------------ */
    /* Pool setup / access control                                        */
    /* ------------------------------------------------------------------ */

    function test_RevertWhen_PoolInitializedWithoutDynamicFee() public {
        PoolKey memory staticFeeKey =
            PoolKey({currency0: currency0, currency1: currency1, fee: 3_000, tickSpacing: 60, hooks: IHooks(address(hook))});

        vm.expectRevert(AdaptiveFeeHook.PoolMustUseDynamicFee.selector);
        manager.initialize(staticFeeKey, SQRT_PRICE_1_1);
    }

    function test_SetVolatility_RevertsForNonKeeper() public {
        vm.expectRevert(AdaptiveFeeHook.NotKeeper.selector);
        hook.setVolatility(poolId, 1);
    }

    function test_SetVolatility_KeeperCanWrite() public {
        vm.expectEmit(true, false, false, true, address(hook));
        emit VolatilityUpdated(poolId, 42, block.timestamp);

        _setVolatility(42);

        (uint256 value, uint256 updatedAt) = hook.volatilityOf(poolId);
        assertEq(value, 42);
        assertEq(updatedAt, block.timestamp);
    }

    /* ------------------------------------------------------------------ */
    /* Volatility -> fee tier mapping, including exact boundaries          */
    /* ------------------------------------------------------------------ */

    function test_Tier_Low() public {
        _setVolatility(0);
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, LOW_FEE, false);
        _tinySwap();
    }

    function test_Tier_LowBoundary_ExactlyAtMax() public {
        _setVolatility(LOW_VOL_MAX);
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, LOW_FEE, false);
        _tinySwap();
    }

    function test_Tier_MediumBoundary_JustAboveLowMax() public {
        _setVolatility(LOW_VOL_MAX + 1);
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, MEDIUM_FEE, MEDIUM_FEE, false);
        _tinySwap();
    }

    function test_Tier_MediumBoundary_ExactlyAtMax() public {
        _setVolatility(MEDIUM_VOL_MAX);
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, MEDIUM_FEE, MEDIUM_FEE, false);
        _tinySwap();
    }

    function test_Tier_HighBoundary_JustAboveMediumMax() public {
        _setVolatility(MEDIUM_VOL_MAX + 1);
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, HIGH_FEE, HIGH_FEE, false);
        _tinySwap();
    }

    function test_Tier_High_LargeVolatility() public {
        _setVolatility(type(uint256).max);
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, HIGH_FEE, HIGH_FEE, false);
        _tinySwap();
    }

    /* ------------------------------------------------------------------ */
    /* Staleness: fail-safe to the high tier, never a revert               */
    /* ------------------------------------------------------------------ */

    function test_Stale_NeverWritten_FallsBackToHigh() public {
        // Default VolatilityData is (0, 0); with block.timestamp already
        // past MAX_STALENESS this must resolve to the fail-safe tier.
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, HIGH_FEE, HIGH_FEE, false);
        _tinySwap();
    }

    function test_Stale_ExactlyAtBoundary_StillFresh() public {
        _setVolatility(0); // low tier
        vm.warp(block.timestamp + MAX_STALENESS);

        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, LOW_FEE, false);
        _tinySwap();
    }

    function test_Stale_OneSecondPastBoundary_FallsBackToHigh() public {
        _setVolatility(0); // low tier, would otherwise stay low
        vm.warp(block.timestamp + MAX_STALENESS + 1);

        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, HIGH_FEE, HIGH_FEE, false);
        _tinySwap();
    }

    function test_Stale_DoesNotRevertTheSwap() public {
        // The swap must still execute (non-zero output), not merely avoid
        // reverting at the hook level.
        BalanceDelta delta = _tinySwap();
        assertTrue(BalanceDelta.unwrap(delta) != 0);
    }

    /* ------------------------------------------------------------------ */
    /* MEV dampening: independent of the volatility tier                  */
    /* ------------------------------------------------------------------ */

    function test_MEV_BelowThreshold_TierAppliesUnaffected() public {
        _setVolatility(0); // low tier

        // First swap this block sets the baseline; can never itself trigger.
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, LOW_FEE, false);
        _tinySwap();

        // Second swap, same block, tiny size relative to the 1e24 liquidity
        // seeded in setUp — moves price by a negligible fraction of a bp.
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, LOW_FEE, false);
        _tinySwap();
    }

    function test_MEV_AboveThreshold_SpikeOverridesLowTier() public {
        _setVolatility(0); // low tier alone would apply LOW_FEE

        // First swap this block sets the baseline.
        _tinySwap();

        // Second swap, same block, large enough to move sqrtPrice by more
        // than MEV_THRESHOLD_BPS against the 1e24-liquidity full-range
        // position seeded in setUp.
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, MEV_SPIKE_FEE, true);
        swap(poolKey, true, -4e22, ZERO_BYTES);
    }

    function test_MEV_NewBlock_ResetsBaseline() public {
        _setVolatility(0);
        _tinySwap();
        swap(poolKey, true, -4e22, ZERO_BYTES); // triggers MEV within this block

        vm.roll(block.number + 1);

        // First swap of the new block re-baselines and cannot trigger,
        // regardless of how far the previous block moved the price.
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, LOW_FEE, false);
        _tinySwap();
    }

    function test_MEV_TriggersEvenWhenTierAloneWouldBeLow() public {
        // Restated explicitly per the spec: the spike must win even though
        // the volatility tier alone says this pool is calm.
        _setVolatility(0);
        _tinySwap();

        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, MEV_SPIKE_FEE, true);
        swap(poolKey, true, -4e22, ZERO_BYTES);
    }
}
