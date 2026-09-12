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
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

contract ExecuteSepoliaSwapScript is Script {
    using PoolIdLibrary for PoolKey;

    address constant POOL_SWAP_TEST = 0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe;
    address constant HOOK_ADDRESS = 0xab4c103d0b4783d736e12Ea01a98945f08122080;
    address constant USDC = 0xCb5C55727ABc3067BC7E26b66ad0f5140Af0e64a;

    function run() public {
        vm.startBroadcast();

        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(USDC),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(HOOK_ADDRESS)
        });

        // 1. Swap 0.0001 ETH -> USDC (zeroForOne = true)
        uint256 ethSwapAmount = 0.0001 ether;
        console2.log("Executing Swap 1: 0.0001 Native ETH -> USDC...");
        BalanceDelta delta1 = PoolSwapTest(POOL_SWAP_TEST).swap{value: ethSwapAmount}(
            key,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(ethSwapAmount),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        console2.log("Swap 1 successful!");
        console2.log("Amount0 (ETH spent):", delta1.amount0());
        console2.log("Amount1 (USDC received):", delta1.amount1());

        // 2. Approve USDC to POOL_SWAP_TEST
        MockERC20(USDC).approve(POOL_SWAP_TEST, type(uint256).max);

        // 3. Swap USDC -> Native ETH (zeroForOne = false)
        uint256 usdcSwapAmount = 0.05 ether; // 0.05 USDC units (18 decimals)
        console2.log("Executing Swap 2: 0.05 USDC -> Native ETH...");
        BalanceDelta delta2 = PoolSwapTest(POOL_SWAP_TEST).swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(usdcSwapAmount),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        console2.log("Swap 2 successful!");
        console2.log("Amount0 (ETH received):", delta2.amount0());
        console2.log("Amount1 (USDC spent):", delta2.amount1());

        vm.stopBroadcast();
    }
}
