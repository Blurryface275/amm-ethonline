// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {HookMiner} from "@uniswap/hooks-utils/src/HookMiner.sol";
import {AdaptiveFeeHook} from "../src/AdaptiveFeeHook.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

contract NativeEthPoolTest is Deployers {
    using PoolIdLibrary for PoolKey;

    AdaptiveFeeHook hook;
    MockERC20 usdc;
    PoolKey nativePoolKey;
    PoolId nativePoolId;


    function setUp() public {
        deployFreshManagerAndRouters();

        usdc = new MockERC20("USD Coin", "USDC", 18);
        usdc.mint(address(this), 1_000_000 ether);
        usdc.approve(address(modifyLiquidityRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);

        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory constructorArgs = abi.encode(
            manager,
            address(this),
            uint24(500),
            uint24(3000),
            uint24(10000),
            uint256(100),
            uint256(500),
            uint256(1 hours),
            uint256(100),
            uint24(50000)
        );
        (address hookAddress, bytes32 salt) =
            HookMiner.find(address(this), flags, type(AdaptiveFeeHook).creationCode, constructorArgs);

        hook = new AdaptiveFeeHook{salt: salt}(
            manager,
            address(this),
            500,
            3000,
            10000,
            100,
            500,
            1 hours,
            100,
            50000
        );

        nativePoolKey = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(usdc)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        manager.initialize(nativePoolKey, SQRT_PRICE_1_1);
        nativePoolId = nativePoolKey.toId();

        // Seed liquidity: 10 ETH + 10 USDC
        vm.deal(address(this), 100 ether);
        modifyLiquidityRouter.modifyLiquidity{value: 10 ether}(
            nativePoolKey,
            IPoolManager.ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: 10 ether,
                salt: 0
            }),
            ""
        );
    }

    function test_Swap_NativeEth_For_Usdc() public {
        address trader = makeAddr("trader");
        vm.deal(trader, 5 ether);

        vm.startPrank(trader);
        uint256 usdcBefore = usdc.balanceOf(trader);
        uint256 ethBefore = trader.balance;

        // Trader swaps 0.1 native ETH for USDC
        // zeroForOne = true (currency0 = ETH -> currency1 = USDC)
        swapRouter.swap{value: 0.1 ether}(
            nativePoolKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: -0.1 ether,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        uint256 usdcAfter = usdc.balanceOf(trader);
        uint256 ethAfter = trader.balance;

        assertGt(usdcAfter, usdcBefore, "Trader should receive USDC");
        assertLt(ethAfter, ethBefore, "Trader should have spent ETH");
        vm.stopPrank();
    }

    function test_Swap_Usdc_For_NativeEth() public {
        address trader = makeAddr("trader");
        usdc.mint(trader, 100 ether);

        vm.startPrank(trader);
        usdc.approve(address(swapRouter), type(uint256).max);

        uint256 usdcBefore = usdc.balanceOf(trader);
        uint256 ethBefore = trader.balance;

        // Trader swaps 10 USDC for native ETH
        // zeroForOne = false (currency1 = USDC -> currency0 = ETH)
        swapRouter.swap(
            nativePoolKey,
            IPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -10 ether,
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );

        uint256 usdcAfter = usdc.balanceOf(trader);
        uint256 ethAfter = trader.balance;

        assertGt(ethAfter, ethBefore, "Trader should receive native ETH");
        assertLt(usdcAfter, usdcBefore, "Trader should have spent USDC");
        vm.stopPrank();
    }
}
