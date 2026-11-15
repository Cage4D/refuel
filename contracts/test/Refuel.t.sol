// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Refuel} from "../src/Refuel.sol";
import {MockPermitToken} from "./mocks/MockPermitToken.sol";
import {MockPriceFeed} from "./mocks/MockPriceFeed.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Owner contract that tries to re-enter refuelWithPermit when it receives BTC.
contract ReentrantOwner {
    Refuel public immutable refuel;
    bool public reentryAttempted;
    bytes4 public reentryError;

    constructor(Refuel r, IERC20 musd) {
        refuel = r;
        musd.approve(address(r), type(uint256).max);
    }

    function go(uint256 amountIn) external {
        refuel.refuelWithPermit(address(this), amountIn, 0, 0, bytes32(0), bytes32(0));
    }

    receive() external payable {
        if (reentryAttempted) return;
        reentryAttempted = true;
        try refuel.refuelWithPermit(address(this), 1e18, 0, 0, bytes32(0), bytes32(0)) {}
        catch (bytes memory err) {
            reentryError = bytes4(err);
        }
    }
}

contract RefuelTest is Test {
    bytes32 constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    Refuel refuel;
    MockPermitToken musd;
    MockPriceFeed feed;

    uint256 ownerPk = 0xA11CE;
    address owner;
    address relayer = makeAddr("relayer");
    address stranger = makeAddr("stranger");

    uint256 constant PRICE = 60_000e18;

    event Refueled(
        address indexed owner, address indexed relayer, uint256 amountIn, uint256 fee, uint256 btcOut, uint256 price
    );

    function setUp() public {
        vm.warp(1_700_000_000);
        owner = vm.addr(ownerPk);
        musd = new MockPermitToken();
        feed = new MockPriceFeed(PRICE);
        refuel = new Refuel(address(musd), address(feed));
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(refuel).call{value: 0.01 ether}("");
        assertTrue(ok);
        musd.mint(owner, 100e18);
    }

    receive() external payable {}

    // ------------------------------------------------------------ helpers

    function _sign(uint256 pk, address holder, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, holder, address(refuel), value, musd.nonces(holder), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", musd.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(pk, digest);
    }

    function _refuel(uint256 amountIn) internal returns (uint256) {
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, amountIn, deadline);
        vm.prank(relayer);
        return refuel.refuelWithPermit(owner, amountIn, deadline, v, r, s);
    }

    function _expected(uint256 amountIn, uint256 price) internal pure returns (uint256 btcOut, uint256 fee) {
        fee = 0.05e18 + (amountIn * 200) / 10_000;
        btcOut = ((amountIn - fee) * 1e18) / price;
    }

    // ------------------------------------------------------------ 1. happy path

    function test_HappyPath() public {
        assertEq(owner.balance, 0);
        uint256 amountIn = 5e18;
        (uint256 expOut, uint256 expFee) = _expected(amountIn, PRICE);
        uint256 musdBefore = musd.balanceOf(owner);
        uint256 floatBefore = address(refuel).balance;

        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, amountIn, deadline);
        vm.expectEmit(true, true, false, true, address(refuel));
        emit Refueled(owner, relayer, amountIn, expFee, expOut, PRICE);
        vm.prank(relayer);
        uint256 out = refuel.refuelWithPermit(owner, amountIn, deadline, v, r, s);

        assertEq(out, expOut);
        assertEq(owner.balance, expOut);
        assertEq(musd.balanceOf(owner), musdBefore - amountIn);
        assertEq(musd.balanceOf(address(refuel)), amountIn);
        assertEq(address(refuel).balance, floatBefore - expOut);
        assertEq(refuel.totalRefuels(), 1);
        assertEq(refuel.totalBtcOut(), expOut);
        assertEq(refuel.totalMusdIn(), amountIn);
        assertEq(refuel.refuelCount(owner), 1);
        assertEq(refuel.lastRefuelAt(owner), block.timestamp);
    }

    // ------------------------------------------------------------ 2. relayer never gets BTC

    function test_BtcGoesToOwnerNotRelayer() public {
        uint256 relayerBefore = relayer.balance;
        uint256 out = _refuel(2e18);
        assertEq(relayer.balance, relayerBefore);
        assertEq(owner.balance, out);
    }

    // ------------------------------------------------------------ 3. front-run permit

    function test_FrontRunPermitStillSucceeds() public {
        uint256 amountIn = 2e18;
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, amountIn, deadline);

        // attacker submits the permit first
        vm.prank(stranger);
        musd.permit(owner, address(refuel), amountIn, deadline, v, r, s);
        assertEq(musd.allowance(owner, address(refuel)), amountIn);

        vm.prank(relayer);
        uint256 out = refuel.refuelWithPermit(owner, amountIn, deadline, v, r, s);
        assertGt(out, 0);
        assertEq(owner.balance, out);
    }

    // ------------------------------------------------------------ 4. amount bounds

    function test_RevertWhen_AmountBelowMin() public {
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, 0.5e18, deadline);
        vm.expectRevert(Refuel.AmountOutOfRange.selector);
        refuel.refuelWithPermit(owner, 0.5e18, deadline, v, r, s);
    }

    function test_RevertWhen_AmountAboveMax() public {
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, 6e18, deadline);
        vm.expectRevert(Refuel.AmountOutOfRange.selector);
        refuel.refuelWithPermit(owner, 6e18, deadline, v, r, s);
    }

    // ------------------------------------------------------------ 5. cooldown

    function test_Cooldown() public {
        _refuel(1e18);
        uint64 nextAt = uint64(block.timestamp + 1 days);

        vm.warp(block.timestamp + 1 days - 1);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, 1e18, deadline);
        vm.expectRevert(abi.encodeWithSelector(Refuel.CooldownActive.selector, nextAt));
        refuel.refuelWithPermit(owner, 1e18, deadline, v, r, s);

        (bool ok, uint8 reason, uint64 eligNext) = refuel.eligibility(owner);
        assertFalse(ok);
        assertEq(reason, 2);
        assertEq(eligNext, nextAt);

        vm.warp(nextAt);
        _refuel(1e18);
        assertEq(refuel.refuelCount(owner), 2);
    }

    // ------------------------------------------------------------ 6. lifetime cap

    function test_MaxRefuelsPerAddress() public {
        for (uint256 i; i < 3; i++) {
            _refuel(1e18);
            vm.warp(block.timestamp + 1 days);
        }
        (bool ok, uint8 reason,) = refuel.eligibility(owner);
        assertFalse(ok);
        assertEq(reason, 3);

        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, 1e18, deadline);
        vm.expectRevert(Refuel.TooManyRefuels.selector);
        refuel.refuelWithPermit(owner, 1e18, deadline, v, r, s);
    }

    // ------------------------------------------------------------ 7. daily cap

    function test_DailyCapEnforcedAndResets() public {
        (uint256 out,) = _expected(5e18, PRICE);
        refuel.setLimits(
            Refuel.Limits({
                minAmountIn: 1e18,
                maxAmountIn: 5e18,
                cooldown: 1 days,
                maxRefuelsPerAddress: 3,
                dailyBtcCap: uint128(out + out / 2) // room for one 5-MUSD refuel, not two
            })
        );
        _refuel(5e18);

        // second user same day
        uint256 pk2 = 0xB0B;
        address owner2 = vm.addr(pk2);
        musd.mint(owner2, 10e18);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(pk2, owner2, 5e18, deadline);
        vm.expectRevert(Refuel.DailyCapReached.selector);
        refuel.refuelWithPermit(owner2, 5e18, deadline, v, r, s);

        // next UTC day
        vm.warp((block.timestamp / 1 days + 1) * 1 days);
        deadline = block.timestamp + 600;
        (v, r, s) = _sign(pk2, owner2, 5e18, deadline);
        uint256 got = refuel.refuelWithPermit(owner2, 5e18, deadline, v, r, s);
        assertEq(got, out);
    }

    function test_EligibilityDailyCapReason() public {
        (uint256 out,) = _expected(1e18, PRICE);
        refuel.setLimits(
            Refuel.Limits({
                minAmountIn: 1e18,
                maxAmountIn: 5e18,
                cooldown: 1 days,
                maxRefuelsPerAddress: 3,
                dailyBtcCap: uint128(out)
            })
        );
        _refuel(1e18);
        (bool ok, uint8 reason,) = refuel.eligibility(stranger);
        assertFalse(ok);
        assertEq(reason, 5);
    }

    // ------------------------------------------------------------ 8. oracle bounds

    function _expectOracleRevert(uint256 price) internal {
        feed.setPrice(price);
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, 2e18, deadline);
        vm.expectRevert(abi.encodeWithSelector(Refuel.OracleOutOfBounds.selector, price));
        refuel.refuelWithPermit(owner, 2e18, deadline, v, r, s);
    }

    function test_RevertWhen_OraclePriceZero() public {
        _expectOracleRevert(0);
    }

    function test_RevertWhen_OraclePriceBelowMin() public {
        _expectOracleRevert(999e18);
    }

    function test_RevertWhen_OraclePriceAboveMax() public {
        _expectOracleRevert(1_000_001e18);
    }

    // ------------------------------------------------------------ 9. float

    function test_RevertWhen_InsufficientFloat() public {
        refuel.withdrawBtc(payable(address(this)), address(refuel).balance);
        (bool ok, uint8 reason,) = refuel.eligibility(owner);
        assertFalse(ok);
        assertEq(reason, 4);

        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, 2e18, deadline);
        vm.expectRevert(Refuel.InsufficientFloat.selector);
        refuel.refuelWithPermit(owner, 2e18, deadline, v, r, s);
    }

    // ------------------------------------------------------------ 10. paused

    function test_RevertWhen_Paused() public {
        refuel.pause();
        (bool ok, uint8 reason,) = refuel.eligibility(owner);
        assertFalse(ok);
        assertEq(reason, 1);

        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, 2e18, deadline);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        refuel.refuelWithPermit(owner, 2e18, deadline, v, r, s);

        refuel.unpause();
        refuel.refuelWithPermit(owner, 2e18, deadline, v, r, s);
    }

    // ------------------------------------------------------------ 11. bad permits

    function test_RevertWhen_PermitExpired() public {
        uint256 deadline = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, 2e18, deadline);
        vm.expectRevert(Refuel.PermitFailed.selector);
        refuel.refuelWithPermit(owner, 2e18, deadline, v, r, s);
    }

    function test_RevertWhen_WrongSigner() public {
        uint256 deadline = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _sign(0xBAD, owner, 2e18, deadline);
        vm.expectRevert(Refuel.PermitFailed.selector);
        refuel.refuelWithPermit(owner, 2e18, deadline, v, r, s);
    }

    function test_RevertWhen_PermitValueTooLow() public {
        uint256 deadline = block.timestamp + 600;
        // signed for 1 MUSD, relayer tries to pull 5
        (uint8 v, bytes32 r, bytes32 s) = _sign(ownerPk, owner, 1e18, deadline);
        vm.expectRevert(Refuel.PermitFailed.selector);
        refuel.refuelWithPermit(owner, 5e18, deadline, v, r, s);
    }

    // ------------------------------------------------------------ 12. fee math (fuzz)

    function testFuzz_FeeMath(uint256 amountIn, uint256 price) public {
        amountIn = bound(amountIn, 1e18, 5e18);
        price = bound(price, 1_000e18, 1_000_000e18);
        feed.setPrice(price);
        // isolate fee math from the daily cap (at low prices 5 MUSD > 0.002 BTC)
        refuel.setLimits(Refuel.Limits(1e18, 5e18, 1 days, 3, 1 ether));

        uint256 fee = 0.05e18 + (amountIn * 200) / 10_000;
        uint256 expected = ((amountIn - fee) * 1e18) / price;

        (uint256 qOut, uint256 qFee, uint256 qPrice) = refuel.quote(amountIn);
        assertEq(qFee, fee);
        assertEq(qPrice, price);
        assertEq(qOut, expected);

        uint256 out = _refuel(amountIn);
        assertEq(out, expected);
        assertEq(owner.balance, expected);
    }

    function test_RevertWhen_FeeExceedsAmount() public {
        refuel.setFees(Refuel.Fees({feeBps: 0, flatFee: 1e18}));
        vm.expectRevert(Refuel.FeeTooHigh.selector);
        refuel.quote(1e18);
    }

    // ------------------------------------------------------------ 13. admin access

    function test_AdminOnlyOwner() public {
        Refuel.Limits memory l = Refuel.Limits(1e18, 5e18, 1 days, 3, 0.002 ether);
        Refuel.Fees memory f = Refuel.Fees(100, 0.01e18);
        Refuel.OracleBounds memory b = Refuel.OracleBounds(1e18, 2e24);
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);

        vm.startPrank(stranger);
        vm.expectRevert(unauthorized);
        refuel.setLimits(l);
        vm.expectRevert(unauthorized);
        refuel.setFees(f);
        vm.expectRevert(unauthorized);
        refuel.setOracleBounds(b);
        vm.expectRevert(unauthorized);
        refuel.pause();
        vm.expectRevert(unauthorized);
        refuel.unpause();
        vm.stopPrank();

        refuel.setFees(f);
        (uint16 bps, uint128 flat) = refuel.fees();
        assertEq(bps, 100);
        assertEq(flat, 0.01e18);
        refuel.setOracleBounds(b);
        refuel.setLimits(l);
    }

    function test_SetFeesRejectsAboveCap() public {
        vm.expectRevert(Refuel.FeeTooHigh.selector);
        refuel.setFees(Refuel.Fees({feeBps: 1001, flatFee: 0}));
        refuel.setFees(Refuel.Fees({feeBps: 1000, flatFee: 0}));
    }

    function test_Ownable2Step() public {
        refuel.transferOwnership(stranger);
        assertEq(refuel.owner(), address(this));
        vm.prank(stranger);
        refuel.acceptOwnership();
        assertEq(refuel.owner(), stranger);
    }

    // ------------------------------------------------------------ 14. withdrawals

    function test_WithdrawBtcAndToken() public {
        _refuel(2e18);
        uint256 collected = musd.balanceOf(address(refuel));
        uint256 float = address(refuel).balance;

        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        refuel.withdrawBtc(payable(stranger), 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        refuel.withdrawToken(IERC20(address(musd)), stranger, 1);
        vm.stopPrank();

        address treasury = makeAddr("treasury");
        refuel.withdrawBtc(payable(treasury), float);
        refuel.withdrawToken(IERC20(address(musd)), treasury, collected);
        assertEq(treasury.balance, float);
        assertEq(musd.balanceOf(treasury), collected);
        assertEq(refuel.floatBalance(), 0);
    }

    function test_ReceiveEmitsFunded() public {
        vm.expectEmit(true, false, false, true, address(refuel));
        emit Refuel.Funded(address(this), 1 ether / 10);
        (bool ok,) = address(refuel).call{value: 1 ether / 10}("");
        assertTrue(ok);
    }

    // ------------------------------------------------------------ 15. reentrancy

    function test_ReentrancyBlocked() public {
        ReentrantOwner attacker = new ReentrantOwner(refuel, IERC20(address(musd)));
        musd.mint(address(attacker), 10e18);

        attacker.go(2e18);

        assertTrue(attacker.reentryAttempted());
        assertEq(attacker.reentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(refuel.refuelCount(address(attacker)), 1);
        (uint256 out,) = _expected(2e18, PRICE);
        assertEq(address(attacker).balance, out);
    }
}
