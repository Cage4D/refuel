// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";

/// @title Refuel
/// @notice Swap a little MUSD for native BTC gas on Mezo with a single gasless EIP-2612 permit.
///         Anyone may relay; BTC always goes to the permit signer (`owner`) and the pull is
///         bounded by the signed permit amount.
contract Refuel is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    struct Limits {
        uint128 minAmountIn; // MUSD, 18 decimals
        uint128 maxAmountIn; // MUSD, 18 decimals
        uint64 cooldown; // seconds between refuels per owner
        uint64 maxRefuelsPerAddress; // lifetime refuels per owner
        uint128 dailyBtcCap; // global BTC out per UTC day, wei
    }

    struct Fees {
        uint16 feeBps; // proportional fee, hard cap 1000 (10%)
        uint128 flatFee; // flat MUSD fee covering relayer gas
    }

    struct OracleBounds {
        uint128 minPrice; // USD per BTC, 18 decimals
        uint128 maxPrice;
    }

    // ------------------------------------------------------------------ constants

    uint16 public constant MAX_FEE_BPS = 1000;

    uint8 public constant REASON_OK = 0;
    uint8 public constant REASON_PAUSED = 1;
    uint8 public constant REASON_COOLDOWN = 2;
    uint8 public constant REASON_MAX_REFUELS = 3;
    uint8 public constant REASON_FLOAT_EMPTY = 4;
    uint8 public constant REASON_DAILY_CAP = 5;

    // ------------------------------------------------------------------ state

    IERC20 public immutable musd;
    IPriceFeed public immutable priceFeed;

    Limits public limits;
    Fees public fees;
    OracleBounds public bounds;

    mapping(address => uint64) public lastRefuelAt;
    mapping(address => uint64) public refuelCount;
    mapping(uint256 => uint256) public btcSentOnDay; // day = block.timestamp / 1 days

    uint256 public totalRefuels;
    uint256 public totalBtcOut;
    uint256 public totalMusdIn;

    // ------------------------------------------------------------------ errors

    error AmountOutOfRange();
    error TooManyRefuels();
    error CooldownActive(uint64 nextAt);
    error PermitFailed();
    error OracleOutOfBounds(uint256 price);
    error FeeTooHigh();
    error ZeroOut();
    error DailyCapReached();
    error InsufficientFloat();
    error BtcTransferFailed();
    error InvalidLimits();
    error InvalidBounds();

    // ------------------------------------------------------------------ events

    event Refueled(
        address indexed owner, address indexed relayer, uint256 amountIn, uint256 fee, uint256 btcOut, uint256 price
    );
    event Funded(address indexed from, uint256 amount);
    event LimitsUpdated(Limits limits);
    event FeesUpdated(Fees fees);
    event OracleBoundsUpdated(OracleBounds bounds);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);
    event BtcWithdrawn(address indexed to, uint256 amount);

    // ------------------------------------------------------------------ constructor

    /// @param musd_ MUSD token (must implement EIP-2612).
    /// @param priceFeed_ Mezo PriceFeed returning USD per BTC with 18 decimals.
    constructor(address musd_, address priceFeed_) Ownable(msg.sender) {
        musd = IERC20(musd_);
        priceFeed = IPriceFeed(priceFeed_);

        _setLimits(
            Limits({
                minAmountIn: 1e18,
                maxAmountIn: 5e18,
                cooldown: 1 days,
                maxRefuelsPerAddress: 3,
                dailyBtcCap: 0.002 ether
            })
        );
        _setFees(Fees({feeBps: 200, flatFee: 0.05e18}));
        _setOracleBounds(OracleBounds({minPrice: 1_000e18, maxPrice: 1_000_000e18}));
    }

    // ------------------------------------------------------------------ core

    /// @notice Pull `amountIn` MUSD from `owner` via an EIP-2612 permit and send `owner` native BTC.
    /// @dev Permissionless: any relayer may submit. The permit call is wrapped in try/catch so a
    ///      front-run permit (allowance already set) does not grief the refuel.
    /// @param owner The permit signer; always the BTC recipient.
    /// @param amountIn MUSD amount to spend (18 decimals), equal to the permit value.
    /// @param deadline Permit deadline.
    /// @param v Permit signature v.
    /// @param r Permit signature r.
    /// @param s Permit signature s.
    /// @return btcOut Native BTC sent to `owner`, in wei.
    function refuelWithPermit(address owner, uint256 amountIn, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 btcOut)
    {
        Limits memory l = limits;

        // 1. amount bounds
        if (amountIn < l.minAmountIn || amountIn > l.maxAmountIn) revert AmountOutOfRange();

        // 2. eligibility
        uint64 count = refuelCount[owner];
        if (count >= l.maxRefuelsPerAddress) revert TooManyRefuels();
        uint64 last = lastRefuelAt[owner];
        if (last != 0 && block.timestamp < uint256(last) + l.cooldown) revert CooldownActive(last + l.cooldown);

        // 3. permit (front-run resistant)
        try IERC20Permit(address(musd)).permit(owner, address(this), amountIn, deadline, v, r, s) {} catch {}
        if (musd.allowance(owner, address(this)) < amountIn) revert PermitFailed();

        // 4-6. price, fee, output
        uint256 fee;
        uint256 price;
        (btcOut, fee, price) = _quote(amountIn);

        // 7. caps
        uint256 today = block.timestamp / 1 days;
        if (btcSentOnDay[today] + btcOut > l.dailyBtcCap) revert DailyCapReached();
        if (address(this).balance < btcOut) revert InsufficientFloat();

        // 8. effects
        lastRefuelAt[owner] = uint64(block.timestamp);
        refuelCount[owner] = count + 1;
        btcSentOnDay[today] += btcOut;
        totalRefuels += 1;
        totalBtcOut += btcOut;
        totalMusdIn += amountIn;

        // 9-10. interactions
        musd.safeTransferFrom(owner, address(this), amountIn);
        (bool ok,) = owner.call{value: btcOut}("");
        if (!ok) revert BtcTransferFailed();

        // 11.
        emit Refueled(owner, msg.sender, amountIn, fee, btcOut, price);
    }

    // ------------------------------------------------------------------ views

    /// @notice Quote a refuel. Non-view because `fetchPrice` may write; call it via eth_call.
    /// @param amountIn MUSD in (18 decimals).
    /// @return btcOut BTC out (wei).
    /// @return fee Total MUSD fee (flat + proportional).
    /// @return price USD per BTC (18 decimals) from the Mezo PriceFeed.
    function quote(uint256 amountIn) external returns (uint256 btcOut, uint256 fee, uint256 price) {
        return _quote(amountIn);
    }

    /// @notice Whether `owner` can refuel right now (ignores amount, permit and oracle checks).
    /// @param owner Address to check.
    /// @return ok True when eligible.
    /// @return reason 0 OK, 1 PAUSED, 2 COOLDOWN, 3 MAX_REFUELS, 4 FLOAT_EMPTY, 5 DAILY_CAP.
    /// @return nextAt Timestamp when the cooldown ends (non-zero only for COOLDOWN).
    function eligibility(address owner) external view returns (bool ok, uint8 reason, uint64 nextAt) {
        Limits memory l = limits;
        if (paused()) return (false, REASON_PAUSED, 0);
        uint64 last = lastRefuelAt[owner];
        if (last != 0 && block.timestamp < uint256(last) + l.cooldown) {
            return (false, REASON_COOLDOWN, last + l.cooldown);
        }
        if (refuelCount[owner] >= l.maxRefuelsPerAddress) return (false, REASON_MAX_REFUELS, 0);
        if (address(this).balance == 0) return (false, REASON_FLOAT_EMPTY, 0);
        if (btcSentOnDay[block.timestamp / 1 days] >= l.dailyBtcCap) return (false, REASON_DAILY_CAP, 0);
        return (true, REASON_OK, 0);
    }

    /// @notice Native BTC available to pay out.
    /// @return The contract's BTC balance in wei.
    function floatBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ------------------------------------------------------------------ admin

    /// @notice Update amount bounds, cooldown, lifetime cap and daily BTC cap.
    /// @param l New limits.
    function setLimits(Limits calldata l) external onlyOwner {
        _setLimits(l);
    }

    /// @notice Update fees. Reverts with `FeeTooHigh` if `feeBps > 1000`.
    /// @param f New fees.
    function setFees(Fees calldata f) external onlyOwner {
        _setFees(f);
    }

    /// @notice Update the accepted oracle price window.
    /// @param b New bounds.
    function setOracleBounds(OracleBounds calldata b) external onlyOwner {
        _setOracleBounds(b);
    }

    /// @notice Pause refuels.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume refuels.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Withdraw ERC20 tokens (e.g. collected MUSD).
    /// @param token Token to withdraw.
    /// @param to Recipient.
    /// @param amt Amount.
    function withdrawToken(IERC20 token, address to, uint256 amt) external onlyOwner {
        token.safeTransfer(to, amt);
        emit TokenWithdrawn(address(token), to, amt);
    }

    /// @notice Withdraw native BTC float.
    /// @param to Recipient.
    /// @param amt Amount in wei.
    function withdrawBtc(address payable to, uint256 amt) external onlyOwner {
        (bool ok,) = to.call{value: amt}("");
        if (!ok) revert BtcTransferFailed();
        emit BtcWithdrawn(to, amt);
    }

    /// @notice Fund the BTC float.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // ------------------------------------------------------------------ internal

    function _quote(uint256 amountIn) internal returns (uint256 btcOut, uint256 fee, uint256 price) {
        price = priceFeed.fetchPrice();
        OracleBounds memory b = bounds;
        if (price < b.minPrice || price > b.maxPrice) revert OracleOutOfBounds(price);

        Fees memory f = fees;
        fee = uint256(f.flatFee) + (amountIn * f.feeBps) / 10_000;
        if (fee >= amountIn) revert FeeTooHigh();

        btcOut = ((amountIn - fee) * 1e18) / price;
        if (btcOut == 0) revert ZeroOut();
    }

    function _setLimits(Limits memory l) internal {
        if (l.minAmountIn == 0 || l.minAmountIn > l.maxAmountIn) revert InvalidLimits();
        limits = l;
        emit LimitsUpdated(l);
    }

    function _setFees(Fees memory f) internal {
        if (f.feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        fees = f;
        emit FeesUpdated(f);
    }

    function _setOracleBounds(OracleBounds memory b) internal {
        if (b.minPrice == 0 || b.minPrice > b.maxPrice) revert InvalidBounds();
        bounds = b;
        emit OracleBoundsUpdated(b);
    }
}
