// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

interface IPoolModifyLiquidityTest {
    function modifyLiquidity(
        PoolKey memory key,
        IPoolManager.ModifyLiquidityParams memory params,
        bytes memory hookData
    ) external payable returns (BalanceDelta delta);
}

contract DeployNativePoolScript is Script {
    using PoolIdLibrary for PoolKey;

    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant MODIFY_LIQUIDITY_ROUTER = 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A;
    address constant HOOK_ADDRESS = 0xab4c103d0b4783d736e12Ea01a98945f08122080;
    address constant USDC = 0xCb5C55727ABc3067BC7E26b66ad0f5140Af0e64a;

    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function run() public {
        vm.startBroadcast();

        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(USDC),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(HOOK_ADDRESS)
        });

        IPoolManager(POOL_MANAGER).initialize(key, SQRT_PRICE_1_1);
        PoolId poolId = key.toId();
        console2.log("Initialized Native ETH / USDC pool, id:");
        console2.logBytes32(PoolId.unwrap(poolId));

        MockERC20(USDC).approve(MODIFY_LIQUIDITY_ROUTER, type(uint256).max);

        int24 tickLower = TickMath.minUsableTick(key.tickSpacing);
        int24 tickUpper = TickMath.maxUsableTick(key.tickSpacing);

        uint256 ethLiq = 0.005 ether;
        IPoolModifyLiquidityTest(MODIFY_LIQUIDITY_ROUTER).modifyLiquidity{value: ethLiq}(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(ethLiq),
                salt: 0
            }),
            ""
        );

        console2.log("Seeded liquidity on Native ETH / USDC pool!");
        vm.stopBroadcast();
    }
}
