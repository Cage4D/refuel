// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Refuel} from "../src/Refuel.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

interface IHasPriceFeed {
    function priceFeed() external view returns (address);
}

/// Fork smoke test against Mezo testnet. Runs only when MEZO_RPC is set.
contract RefuelForkTest is Test {
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant TROVE_MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;

    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("MEZO_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
    }

    function test_Fork_RefuelAgainstRealMusdAndPriceFeed() public {
        if (!forked) {
            console2.log("MEZO_RPC not set; skipping fork test");
            vm.skip(true);
        }
        assertEq(block.chainid, 31611);

        address pf = IHasPriceFeed(TROVE_MANAGER).priceFeed();
        assertTrue(pf != address(0) && pf.code.length > 0, "price feed");
        // The PriceFeed reads a Mezo-native oracle precompile that Foundry's EVM cannot execute.
        // Ask the live node for the real price, then mock only that call.
        bytes memory raw =
            vm.rpc("eth_call", string.concat('[{"to":"', vm.toString(pf), '","data":"0x0fdb11cf"},"latest"]'));
        uint256 price = abi.decode(raw, (uint256));
        vm.mockCall(pf, abi.encodeWithSelector(IPriceFeed.fetchPrice.selector), abi.encode(price));
        assertEq(IPriceFeed(pf).fetchPrice(), price);
        console2.log("PriceFeed", pf);
        console2.log("BTC price (1e18)", price);
        assertGe(price, 1_000e18);
        assertLe(price, 1_000_000e18);

        Refuel refuel = new Refuel(MUSD, pf);
        vm.deal(address(refuel), 0.01 ether);

        uint256 pk = uint256(keccak256("refuel-fork-owner"));
        address owner = vm.addr(pk);
        assertEq(owner.balance, 0);
        deal(MUSD, owner, 5e18);
        assertEq(IERC20(MUSD).balanceOf(owner), 5e18);

        uint256 amountIn = 2e18;
        uint256 deadline = block.timestamp + 600;
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, owner, address(refuel), amountIn, IERC20Permit(MUSD).nonces(owner), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IERC20Permit(MUSD).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        (uint256 quoted,,) = refuel.quote(amountIn);
        vm.prank(makeAddr("relayer"));
        uint256 out = refuel.refuelWithPermit(owner, amountIn, deadline, v, r, s);

        console2.log("btcOut (wei)", out);
        assertEq(out, quoted);
        assertEq(owner.balance, out);
        assertEq(IERC20(MUSD).balanceOf(owner), 3e18);
    }
}
