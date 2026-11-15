import "server-only";
import { parseAbi } from "viem";
import { env, refuelAddress } from "./env";
export { refuelAbi } from "./abi/refuel";

export const erc20PermitAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);

export const addresses = () => ({ refuel: refuelAddress(), musd: env().MUSD_ADDRESS });
