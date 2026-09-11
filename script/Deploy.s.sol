// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {StdConstants} from "forge-std/StdConstants.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {HookMiner} from "@uniswap/hooks-utils/src/HookMiner.sol";
import {AdaptiveFeeHook} from "../src/AdaptiveFeeHook.sol";
import {VolatilityFunctionsConsumer} from "../src/VolatilityFunctionsConsumer.sol";

/// @notice Local/testnet deploy that wires the full primary-path system end
/// to end: stands up a fresh PoolManager, two mock tokens, the hook (with the
/// deployer as a TEMPORARY placeholder keeper), then the VolatilityFunctionsConsumer
/// pointing at that hook, and finally binds the consumer as the real keeper via the
/// hook's one-time `setKeeper`. Then initializes a dynamic-fee pool so the hook is
/// callable.
/// @dev Deployment plumbing for confirming the whole system is callable (Phase 4 of
/// the build plan), not a production script — it deploys its own PoolManager rather
/// than pointing at a canonical one, and the Chainlink Functions parameters below are
/// smoke-test placeholders. The keeper-binding order is the crux: the hook and
/// consumer reference each other, so the hook is deployed with a placeholder keeper,
/// its CREATE2 address is mined deterministically, and the real keeper is bound only
/// AFTER the consumer exists.
contract DeployScript is Script {
    using PoolIdLibrary for PoolKey;

    uint24 constant LOW_FEE = 500; // 0.05%
    uint24 constant MEDIUM_FEE = 3_000; // 0.30%
    uint24 constant HIGH_FEE = 10_000; // 1.00%
    uint256 constant LOW_VOL_MAX = 100;
    uint256 constant MEDIUM_VOL_MAX = 500;
    uint256 constant MAX_STALENESS = 1 hours;
    uint256 constant MEV_THRESHOLD_BPS = 100; // 1%
    uint24 constant MEV_SPIKE_FEE = 50_000; // 5%

    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // --- Chainlink Functions (smoke-test placeholders; override via env for testnet) ---
    // Router address for the target network (e.g. Sepolia Functions router).
    address constant FUNCTIONS_ROUTER = address(0);
    // DON id (bytes32); replace for the target network.
    bytes32 constant DON_ID = bytes32(0);
    uint64 constant SUBSCRIPTION_ID = 0;
    uint32 constant CALLBACK_GAS_LIMIT = 300_000;
    // Inline DON job source. Point this at functions/volatility-source.js contents.
    string constant SOURCE = "return Functions.encodeUint256(0);";

    function run() public {
        address deployer = msg.sender;

        vm.startBroadcast();

        PoolManager manager;
        if (block.chainid == 11155111) {
            // Canonical Uniswap v4 PoolManager on Sepolia
            manager = PoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
            console2.log("Using Canonical Uniswap v4 PoolManager on Sepolia:", address(manager));
        } else {
            manager = new PoolManager(deployer);
            console2.log("Deployed Local PoolManager:", address(manager));
        }

        MockERC20 tokenA = new MockERC20("Token A", "TKA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "TKB", 18);
        tokenA.mint(deployer, 1_000_000 ether);
        tokenB.mint(deployer, 1_000_000 ether);
        (Currency currency0, Currency currency1) = address(tokenA) < address(tokenB)
            ? (Currency.wrap(address(tokenA)), Currency.wrap(address(tokenB)))
            : (Currency.wrap(address(tokenB)), Currency.wrap(address(tokenA)));
        console2.log("currency0:", Currency.unwrap(currency0));
        console2.log("currency1:", Currency.unwrap(currency1));

        // 1) Deploy the hook with the deployer as a TEMPORARY placeholder keeper.
        //    The keeper address is part of the hook's constructor args, so it seeds
        //    the CREATE2 salt — that is why the hook address can only be mined AFTER
        //    we commit to a keeper, and why that keeper must be rebindable once.
        uint160 flags = uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        bytes memory hookConstructorArgs = abi.encode(
            manager,
            deployer, // placeholder keeper; rebound to the consumer in step 3
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
            HookMiner.find(StdConstants.CREATE2_FACTORY, flags, type(AdaptiveFeeHook).creationCode, hookConstructorArgs);

        AdaptiveFeeHook hook = new AdaptiveFeeHook{salt: salt}(
            manager,
            deployer, // placeholder keeper
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
        console2.log("AdaptiveFeeHook (placeholder keeper = deployer):", address(hook));

        // 2) Deploy the consumer pointing at the now-known hook address.
        VolatilityFunctionsConsumer consumer = new VolatilityFunctionsConsumer(
            FUNCTIONS_ROUTER, address(hook), DON_ID, SUBSCRIPTION_ID, CALLBACK_GAS_LIMIT, SOURCE
        );
        console2.log("VolatilityFunctionsConsumer:", address(consumer));

        // 3) Bind the consumer as the real, permanent keeper. Called by the
        //    current keeper (the deployer placeholder); `keeperSet` latches true
        //    so this can never run again. After this, only the consumer can
        //    write volatility — the placeholder deployer key is rotated out.
        hook.setKeeper(address(consumer));
        console2.log("Keeper bound ->", address(consumer));
        console2.log("keeperSet:", hook.keeperSet());

        // 4) Initialize a dynamic-fee pool so the hook is live and callable.
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        manager.initialize(key, SQRT_PRICE_1_1);
        PoolId poolId = key.toId();
        console2.log("Pool initialized, id:");
        console2.logBytes32(PoolId.unwrap(poolId));

        vm.stopBroadcast();
    }
}
