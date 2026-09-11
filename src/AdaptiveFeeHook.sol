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
/// @notice Uniswap v4 hook implementing volatility-tiered dynamic fees with intra-block MEV dampening.
contract AdaptiveFeeHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using LPFeeLibrary for uint24;

    struct VolatilityData {
        uint256 value;
        uint256 updatedAt;
    }

    struct BlockPriceSnapshot {
        uint256 blockNumber;
        uint160 sqrtPriceX96;
    }

    error NotKeeper();
    error PoolMustUseDynamicFee();
    error InvalidConfig();
    error KeeperAlreadySet();
    error InvalidKeeper();

    event VolatilityUpdated(PoolId indexed poolId, uint256 value, uint256 timestamp);
    event FeeApplied(PoolId indexed poolId, uint24 tierFee, uint24 appliedFee, bool mevTriggered);
    event KeeperBound(address indexed oldKeeper, address indexed newKeeper);

    address public KEEPER;
    bool public keeperSet;

    uint24 public immutable LOW_FEE;
    uint24 public immutable MEDIUM_FEE;
    uint24 public immutable HIGH_FEE;

    uint256 public immutable LOW_VOLATILITY_MAX;
    uint256 public immutable MEDIUM_VOLATILITY_MAX;
    uint256 public immutable MAX_STALENESS;

    uint256 public immutable MEV_PRICE_DELTA_THRESHOLD_BPS;
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

    function setVolatility(PoolId poolId, uint256 newVolatility) external onlyKeeper {
        volatilityOf[poolId] = VolatilityData({value: newVolatility, updatedAt: block.timestamp});
        emit VolatilityUpdated(poolId, newVolatility, block.timestamp);
    }

    function setKeeper(address newKeeper) external onlyKeeper {
        if (keeperSet) revert KeeperAlreadySet();
        if (newKeeper == address(0) || newKeeper == KEEPER) revert InvalidKeeper();

        address oldKeeper = KEEPER;
        KEEPER = newKeeper;
        keeperSet = true;
        emit KeeperBound(oldKeeper, newKeeper);
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

    function _tierFee(PoolId poolId) internal view returns (uint24) {
        VolatilityData memory data = volatilityOf[poolId];

        unchecked {
            if (block.timestamp - data.updatedAt > MAX_STALENESS) return HIGH_FEE;
        }
        if (data.value <= LOW_VOLATILITY_MAX) return LOW_FEE;
        if (data.value <= MEDIUM_VOLATILITY_MAX) return MEDIUM_FEE;
        return HIGH_FEE;
    }

    /// @dev Relative price deviation approximated via sqrtPriceX96 delta without fixed-point squaring.
    function _checkAndUpdateMevBaseline(PoolId poolId) internal returns (bool) {
        (uint160 currentSqrtPriceX96,,,) = poolManager.getSlot0(poolId);
        BlockPriceSnapshot storage snapshot = blockBaselineOf[poolId];

        uint256 currentBlock = block.number;
        if (snapshot.blockNumber != currentBlock) {
            snapshot.blockNumber = currentBlock;
            snapshot.sqrtPriceX96 = currentSqrtPriceX96;
            return false;
        }

        uint160 baseline = snapshot.sqrtPriceX96;
        uint256 diff;
        unchecked {
            diff = currentSqrtPriceX96 > baseline ? currentSqrtPriceX96 - baseline : baseline - currentSqrtPriceX96;
        }

        return (diff * 10_000) / baseline > MEV_PRICE_DELTA_THRESHOLD_BPS;
    }
}
