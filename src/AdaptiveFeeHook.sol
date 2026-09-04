// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "@uniswap/hooks-utils/src/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @title AdaptiveFeeHook
/// @notice Uniswap v4 hook that prices swaps on a volatility-tiered dynamic
/// fee, and independently overrides that fee with a spike whenever it
/// detects an abnormal same-block price move (the sandwich/LVR pattern).
/// @dev All fee tiers, the staleness bound, and the MEV threshold are set
/// once at deployment and are immutable. There is no governance surface on
/// this contract: a governable fee parameter is itself an attack vector, and
/// this hackathon MVP does not attempt to solve that problem. Rotating any
/// of these values means deploying a new hook and migrating pools to it.
contract AdaptiveFeeHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using LPFeeLibrary for uint24;

    /// @notice Per-pool volatility reading and the timestamp it was written.
    /// @dev Populated by `KEEPER` from the offchain pipeline (subgraph +
    /// bridge in the primary architecture, onchain TWAP delta in the
    /// fallback). The hook only ever reads this data — it never estimates
    /// volatility itself.
    struct VolatilityData {
        uint256 value;
        uint256 updatedAt;
    }

    /// @notice Per-pool snapshot of price at the first swap this hook saw in
    /// the current block, used as the MEV baseline for every later swap in
    /// the same block.
    struct BlockPriceSnapshot {
        uint256 blockNumber;
        uint160 sqrtPriceX96;
    }

    /// @notice Thrown when a caller other than `KEEPER` tries to write volatility data.
    error NotKeeper();
    /// @notice Thrown when a pool is initialized without the dynamic-fee flag set.
    error PoolMustUseDynamicFee();
    /// @notice Thrown when the constructor is given non-increasing tier fees or thresholds.
    error InvalidConfig();

    event VolatilityUpdated(PoolId indexed poolId, uint256 value, uint256 timestamp);
    event FeeApplied(PoolId indexed poolId, uint24 tierFee, uint24 appliedFee, bool mevTriggered);

    /// @notice Sole address permitted to write volatility readings onchain.
    address public immutable KEEPER;

    /// @notice LP fee (in hundredths of a bip) for the low-volatility tier.
    uint24 public immutable LOW_FEE;
    /// @notice LP fee for the medium-volatility tier.
    uint24 public immutable MEDIUM_FEE;
    /// @notice LP fee applied for the high-volatility tier, and the fail-safe
    /// fee used whenever volatility data is stale.
    uint24 public immutable HIGH_FEE;

    /// @notice Volatility at or below this value maps to `LOW_FEE`.
    uint256 public immutable LOW_VOLATILITY_MAX;
    /// @notice Volatility at or below this value (and above `LOW_VOLATILITY_MAX`) maps to `MEDIUM_FEE`.
    /// @dev Volatility above this value maps to `HIGH_FEE`.
    uint256 public immutable MEDIUM_VOLATILITY_MAX;

    /// @notice Maximum age, in seconds, a volatility reading may have before
    /// it is treated as untrustworthy.
    /// @dev On staleness the hook fails *safe*, not open: it falls back to
    /// `HIGH_FEE`, never to a lower tier, and it never reverts the swap.
    uint256 public immutable MAX_STALENESS;

    /// @notice Same-block price move threshold, in basis points of the
    /// block-start price, above which the MEV spike fee overrides the
    /// volatility tier.
    uint256 public immutable MEV_PRICE_DELTA_THRESHOLD_BPS;
    /// @notice Flat LP fee applied when the MEV check triggers.
    uint24 public immutable MEV_SPIKE_FEE;

    mapping(PoolId => VolatilityData) public volatilityOf;
    mapping(PoolId => BlockPriceSnapshot) public blockBaselineOf;

    modifier onlyKeeper() {
        _checkKeeper();
        _;
    }

    constructor(
        IPoolManager _poolManager,
        address _keeper,
        uint24 _lowFee,
        uint24 _mediumFee,
        uint24 _highFee,
        uint256 _lowVolatilityMax,
        uint256 _mediumVolatilityMax,
        uint256 _maxStaleness,
        uint256 _mevPriceDeltaThresholdBps,
        uint24 _mevSpikeFee
    ) BaseHook(_poolManager) {
        if (_lowFee >= _mediumFee || _mediumFee >= _highFee) revert InvalidConfig();
        if (_lowVolatilityMax >= _mediumVolatilityMax) revert InvalidConfig();
        _highFee.validate();
        _mevSpikeFee.validate();

        KEEPER = _keeper;
        LOW_FEE = _lowFee;
        MEDIUM_FEE = _mediumFee;
        HIGH_FEE = _highFee;
        LOW_VOLATILITY_MAX = _lowVolatilityMax;
        MEDIUM_VOLATILITY_MAX = _mediumVolatilityMax;
        MAX_STALENESS = _maxStaleness;
        MEV_PRICE_DELTA_THRESHOLD_BPS = _mevPriceDeltaThresholdBps;
        MEV_SPIKE_FEE = _mevSpikeFee;
    }

    /// @inheritdoc BaseHook
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice Written by the keeper/bridge with the latest volatility
    /// reading for a pool. Never called by traders or LPs.
    function setVolatility(PoolId poolId, uint256 newVolatility) external onlyKeeper {
        volatilityOf[poolId] = VolatilityData({value: newVolatility, updatedAt: block.timestamp});
        emit VolatilityUpdated(poolId, newVolatility, block.timestamp);
    }

    function _checkKeeper() internal view {
        if (msg.sender != KEEPER) revert NotKeeper();
    }

    function _beforeInitialize(address, PoolKey calldata key, uint160) internal pure override returns (bytes4) {
        if (!key.fee.isDynamicFee()) revert PoolMustUseDynamicFee();
        return BaseHook.beforeInitialize.selector;
    }

    function _beforeSwap(address, PoolKey calldata key, IPoolManager.SwapParams calldata, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId poolId = key.toId();

        uint24 tierFee = _tierFee(poolId);
        bool mevTriggered = _checkAndUpdateMevBaseline(poolId);
        uint24 appliedFee = mevTriggered && MEV_SPIKE_FEE > tierFee ? MEV_SPIKE_FEE : tierFee;

        emit FeeApplied(poolId, tierFee, appliedFee, mevTriggered);

        return
            (
                BaseHook.beforeSwap.selector,
                BeforeSwapDeltaLibrary.ZERO_DELTA,
                appliedFee | LPFeeLibrary.OVERRIDE_FEE_FLAG
            );
    }

    /// @notice Maps the pool's current volatility reading to a fee tier,
    /// falling back to `HIGH_FEE` if the reading is missing or stale.
    /// @dev Fail-safe, not fail-open: staleness (including "never written")
    /// always resolves to the highest tier, never a lower one.
    function _tierFee(PoolId poolId) internal view returns (uint24) {
        VolatilityData memory data = volatilityOf[poolId];

        if (block.timestamp - data.updatedAt > MAX_STALENESS) {
            return HIGH_FEE;
        }
        if (data.value <= LOW_VOLATILITY_MAX) {
            return LOW_FEE;
        }
        if (data.value <= MEDIUM_VOLATILITY_MAX) {
            return MEDIUM_FEE;
        }
        return HIGH_FEE;
    }

    /// @notice Compares the pool's current price to the price recorded at
    /// the first swap this hook observed in the current block, and records
    /// the current price as the baseline as a side effect if this is the
    /// first swap this hook has seen this block.
    /// @dev This check is independent of the volatility tier above — it
    /// runs unconditionally on every swap, on the theory that a sandwich
    /// attacker doesn't care what tier the pool is quoting. Approximates
    /// price movement via sqrtPriceX96 directly (rather than squaring it
    /// into a true price) since the ratio is monotonic and this avoids
    /// overflow-prone fixed-point squaring for what is, for this MVP, a
    /// threshold comparison rather than an exact price feed.
    /// @return mevTriggered True if the same-block move exceeded the threshold.
    function _checkAndUpdateMevBaseline(PoolId poolId) internal returns (bool mevTriggered) {
        (uint160 currentSqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        BlockPriceSnapshot storage snapshot = blockBaselineOf[poolId];

        if (snapshot.blockNumber != block.number) {
            snapshot.blockNumber = block.number;
            snapshot.sqrtPriceX96 = currentSqrtPriceX96;
            return false;
        }

        uint160 baseline = snapshot.sqrtPriceX96;
        uint256 diff = currentSqrtPriceX96 > baseline ? currentSqrtPriceX96 - baseline : baseline - currentSqrtPriceX96;

        // sqrtPrice deviation of X bps corresponds to roughly 2*X bps of
        // price deviation, but we threshold on the sqrtPrice ratio directly
        // and size `MEV_PRICE_DELTA_THRESHOLD_BPS` for that in the
        // deployment config rather than compensating for the factor of two
        // here.
        return (diff * 10_000) / baseline > MEV_PRICE_DELTA_THRESHOLD_BPS;
    }
}
