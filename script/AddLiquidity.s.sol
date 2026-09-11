// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
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

contract AddLiquidityScript is Script {
    address constant MODIFY_LIQUIDITY_ROUTER = 0x0C478023803a644c94c4CE1C1e7b9A087e411B0A;
    address constant HOOK_ADDRESS = 0xab4c103d0b4783d736e12Ea01a98945f08122080;
    address constant TOKEN0 = 0xc8973F90161307791ce6e18210E25cB00e5079a0;
    address constant TOKEN1 = 0xCb5C55727ABc3067BC7E26b66ad0f5140Af0e64a;

    function run() public {
        vm.startBroadcast();

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(TOKEN0),
            currency1: Currency.wrap(TOKEN1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(HOOK_ADDRESS)
        });

        MockERC20(TOKEN0).approve(MODIFY_LIQUIDITY_ROUTER, type(uint256).max);
        MockERC20(TOKEN1).approve(MODIFY_LIQUIDITY_ROUTER, type(uint256).max);

        int24 tickLower = TickMath.minUsableTick(key.tickSpacing);
        int24 tickUpper = TickMath.maxUsableTick(key.tickSpacing);

        IPoolModifyLiquidityTest(MODIFY_LIQUIDITY_ROUTER)
            .modifyLiquidity(
                key,
                IPoolManager.ModifyLiquidityParams({
                    tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: 1e21, salt: 0
                }),
                ""
            );

        console2.log("Liquidity successfully seeded on Sepolia pool!");
        vm.stopBroadcast();
    }
}
