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
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
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
    event KeeperBound(address indexed oldKeeper, address indexed newKeeper);

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

        (poolKey, poolId) =
            initPool(currency0, currency1, IHooks(address(hook)), LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1);

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
        PoolKey memory staticFeeKey = PoolKey({
            currency0: currency0, currency1: currency1, fee: 3_000, tickSpacing: 60, hooks: IHooks(address(hook))
        });

        // Hooks.beforeInitialize bubbles up the hook's revert wrapped in an
        // ERC-7751 WrappedError rather than letting it propagate directly.
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.beforeInitialize.selector,
                abi.encodeWithSelector(AdaptiveFeeHook.PoolMustUseDynamicFee.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
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
        // Default VolatilityData is (0, 0). Warp forward so "never written"
        // is indistinguishable from "written once, long ago" — both must
        // resolve to the fail-safe tier.
        vm.warp(block.timestamp + MAX_STALENESS + 1);

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

    // A swap's `beforeSwap` observes the pool's *pre*-swap price — its own
    // price impact hasn't happened yet — so no swap can ever flag its own
    // movement. Detection only fires for a swap that lands *after* an
    // earlier same-block swap has already pushed the price away from the
    // block-start baseline. This mirrors the real sandwich shape: the
    // front-run leg that does the pushing is never the one that's flagged;
    // it's whatever trades after it — the victim, or the attacker's own
    // back-run — that pays the spike.
    function test_MEV_AboveThreshold_SpikeOverridesLowTier() public {
        _setVolatility(0); // low tier alone would apply LOW_FEE throughout

        _tinySwap(); // sets the block baseline
        swap(poolKey, true, -4e22, ZERO_BYTES); // large same-block move; priced at the tier fee, since its own beforeSwap ran before this swap moved anything

        // A later swap in the same block observes the cumulative move
        // against the block-start baseline and gets the MEV spike instead
        // of the tier — even though the tier alone says this pool is calm.
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, MEV_SPIKE_FEE, true);
        _tinySwap();
    }

    function test_MEV_NewBlock_ResetsBaseline() public {
        _setVolatility(0);
        _tinySwap(); // sets block N's baseline
        swap(poolKey, true, -4e22, ZERO_BYTES); // large same-block move

        // Confirm the move is actually flagged before rolling forward.
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, MEV_SPIKE_FEE, true);
        _tinySwap();

        vm.roll(block.number + 1);

        // First swap of the new block re-baselines and cannot trigger,
        // regardless of how far the previous block moved the price.
        vm.expectEmit(true, false, false, true, address(hook));
        emit FeeApplied(poolId, LOW_FEE, LOW_FEE, false);
        _tinySwap();
    }

    /* ------------------------------------------------------------------ */
    /* Keeper binding (deploy-wiring fix for the circular keeper<->hook)  */
    /* ------------------------------------------------------------------ */

    function test_SetKeeper_BindsOnceAndLatches() public {
        address newKeeper = makeAddr("newKeeper");

        vm.prank(keeper); // current keeper
        vm.expectEmit(true, true, true, true, address(hook));
        emit KeeperBound(keeper, newKeeper);
        hook.setKeeper(newKeeper);

        assertEq(hook.KEEPER(), newKeeper);
        assertTrue(hook.keeperSet());

        // A second bind must revert — the keeper is frozen for the lifetime.
        vm.prank(newKeeper);
        vm.expectRevert(AdaptiveFeeHook.KeeperAlreadySet.selector);
        hook.setKeeper(makeAddr("another"));
    }

    function test_SetKeeper_RevertsForNonKeeper() public {
        vm.expectRevert(AdaptiveFeeHook.NotKeeper.selector);
        hook.setKeeper(makeAddr("newKeeper"));
    }

    function test_SetKeeper_RevertsOnZeroAddress() public {
        vm.prank(keeper);
        vm.expectRevert(AdaptiveFeeHook.InvalidKeeper.selector);
        hook.setKeeper(address(0));
    }

    function test_SetKeeper_RejectsSameAddress() public {
        vm.prank(keeper);
        vm.expectRevert(AdaptiveFeeHook.InvalidKeeper.selector);
        hook.setKeeper(keeper);
    }

    function test_SetVolatility_AfterBind_OnlyNewKeeper() public {
        address newKeeper = makeAddr("newKeeper");
        vm.prank(keeper);
        hook.setKeeper(newKeeper);

        // Old keeper can no longer write volatility.
        vm.prank(keeper);
        vm.expectRevert(AdaptiveFeeHook.NotKeeper.selector);
        hook.setVolatility(poolId, 10);

        // New keeper can.
        vm.prank(newKeeper);
        hook.setVolatility(poolId, 10);
        (uint256 value, ) = hook.volatilityOf(poolId); assertEq(value, 10);
    }
}
