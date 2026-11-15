// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/// Sends FLOAT_BTC (default 0.002 ether) of native BTC to the Refuel contract.
/// Target: REFUEL_ADDRESS env, falling back to deployments/<chainId>.json.
contract Fund is Script {
    function run() external {
        uint256 amount = vm.envOr("FLOAT_BTC", uint256(0.002 ether));
        address refuel = vm.envOr("REFUEL_ADDRESS", address(0));
        if (refuel == address(0)) {
            string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
            refuel = vm.parseJsonAddress(vm.readFile(path), ".refuel");
        }
        require(refuel.code.length > 0, "Refuel not deployed");

        vm.startBroadcast();
        (bool ok,) = refuel.call{value: amount}("");
        vm.stopBroadcast();
        require(ok, "fund failed");
        console2.log("Funded", refuel, "with", amount);
        console2.log("Float now", refuel.balance);
    }
}
