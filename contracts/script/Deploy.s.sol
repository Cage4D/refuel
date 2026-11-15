// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Refuel} from "../src/Refuel.sol";

interface IHasPriceFeed {
    function priceFeed() external view returns (address);
}

/// Resolves the Mezo PriceFeed, deploys Refuel with default parameters and writes deployments/<chainId>.json.
contract Deploy is Script {
    function run() external returns (Refuel refuel) {
        address musd = vm.envAddress("MUSD_ADDRESS");
        address troveManager = vm.envAddress("TROVE_MANAGER");
        address borrowerOps = vm.envAddress("BORROWER_OPERATIONS");

        address priceFeed = _resolvePriceFeed(troveManager, borrowerOps);
        console2.log("PriceFeed:", priceFeed);
        require(priceFeed != address(0) && priceFeed.code.length > 0, "PriceFeed unresolved");
        require(musd.code.length > 0, "MUSD has no code");

        uint256 deployBlock = block.number;
        vm.startBroadcast();
        refuel = new Refuel(musd, priceFeed);
        vm.stopBroadcast();
        console2.log("Refuel:", address(refuel));

        string memory k = "deployment";
        vm.serializeAddress(k, "refuel", address(refuel));
        vm.serializeAddress(k, "musd", musd);
        vm.serializeAddress(k, "priceFeed", priceFeed);
        vm.serializeUint(k, "deployBlock", deployBlock);
        string memory json = vm.serializeAddress(k, "deployer", refuel.owner());
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("Wrote", path);
    }

    function _resolvePriceFeed(address troveManager, address borrowerOps) internal view returns (address) {
        try IHasPriceFeed(troveManager).priceFeed() returns (address pf) {
            if (pf != address(0)) return pf;
        } catch {}
        return IHasPriceFeed(borrowerOps).priceFeed();
    }
}
