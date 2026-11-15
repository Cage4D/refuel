// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Mezo PriceFeed. Declared non-view so it works whether the deployed
///         implementation is view or state-changing (Liquity-style feeds cache lastGoodPrice).
interface IPriceFeed {
    /// @return price USD per 1 BTC, 18 decimals.
    function fetchPrice() external returns (uint256);
}
